import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SerenityExportService } from './serenity-export.service';
import { TestRun } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
import { SupabaseClientService } from '../database/supabase-client.service';

export interface HydrateProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface SerenityReportAzureState {
  phase: 'idle' | 'hydrating' | 'building' | 'dispatching' | 'polling' | 'downloading' | 'done' | 'error';
  jobId?: string;
  buildId?: number;
  artifactDownloadUrl?: string;
  error?: string;
  hydrateProgress?: HydrateProgress;
  statusMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class SerenityReportAzureService {
  state: SerenityReportAzureState = { phase: 'idle' };
  suppressAutoDownload = false;
  private pollTimer: any = null;
  private apiUrl = '/api/serenity-report-azure';
  private bundlePath: string | null = null;

  constructor(
    private http: HttpClient,
    private serenityExport: SerenityExportService,
    private storage: ExecutionStorageService,
    private supabaseClient: SupabaseClientService,
  ) {}

  async generateReport(run: TestRun): Promise<void> {
    if (this.state.phase === 'polling' || this.state.phase === 'dispatching') return;

    try {
      if (!run.executionId) {
        throw new Error('Esta ejecucion no tiene datos ejecutados todavia.');
      }

      this.state = { phase: 'hydrating', statusMessage: 'Cargando ejecucion desde BD...' };

      const execution = await this.storage.getExecution(run.executionId, { throwOnError: true });
      if (!execution) {
        throw new Error('No se encontro la ejecucion en la base de datos.');
      }

      const totalEvidence = execution.testCases.reduce((sum, tc) =>
        sum + tc.steps.reduce((s, step) => s + (step.evidences?.length || 0), 0), 0);

      this.state = {
        phase: 'hydrating',
        statusMessage: 'Descargando evidencias...',
        hydrateProgress: { current: 0, total: totalEvidence, percentage: 0 },
      };

      await this.storage.hydrateAllEvidence(execution, {
        maxConcurrent: 6,
        onProgress: (current, total) => {
          this.state = {
            ...this.state,
            phase: 'hydrating',
            statusMessage: `Descargando evidencias (${current}/${total})...`,
            hydrateProgress: { current, total, percentage: total > 0 ? Math.round((current / total) * 100) : 0 },
          };
        },
      });

      this.state = {
        phase: 'building',
        statusMessage: 'Construyendo y comprimiendo imagenes...',
        hydrateProgress: { current: 0, total: totalEvidence, percentage: 0 },
      };

      const bundle = await this.serenityExport.buildCompressedBundle(execution, run);
      const bundleJson = JSON.stringify(bundle);

      this.state = {
        phase: 'dispatching',
        statusMessage: `Subiendo evidencias (${(bundleJson.length / 1024 / 1024).toFixed(1)} MB)...`,
        hydrateProgress: undefined,
      };

      // Subir el bundle DIRECTAMENTE a Supabase Storage desde el navegador.
      // Esto evita el límite de body de Vercel (4.5MB): las imágenes ya no pasan
      // por la función serverless, solo se envía la URL firmada del bundle.
      const { url: bundleUrl, path: bundlePath } = await this.uploadBundleDirect(bundleJson);
      this.bundlePath = bundlePath;

      this.state = {
        ...this.state,
        statusMessage: 'Iniciando pipeline en Azure DevOps...',
      };

      const headers = await this.buildAuthHeaders();
      const startResult = await firstValueFrom(
        this.http.post<any>(this.apiUrl, { bundleUrl, executionId: run.executionId }, { headers })
      );

      if (!startResult.success) {
        throw new Error(startResult.error || 'Error al iniciar el pipeline de Azure DevOps');
      }

      this.state = {
        phase: 'polling',
        statusMessage: 'Generando reporte en Azure DevOps...',
        jobId: startResult.jobId,
        buildId: startResult.buildId,
      };

      this.startPolling();
    } catch (err: any) {
      this.cleanupBundle();
      this.state = { phase: 'error', error: err?.message || 'Error desconocido' };
      throw err;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll(), 5000);
    this.poll();
  }

  private async poll(): Promise<void> {
    const { jobId, buildId } = this.state;

    try {
      const params = new URLSearchParams();
      if (buildId) params.set('buildId', String(buildId));
      if (jobId) params.set('jobId', jobId);

      if (!buildId) {
        this.state = { ...this.state, phase: 'error', error: 'Falta buildId.' };
        this.stopPolling();
        return;
      }

      const headers = await this.buildAuthHeaders();
      const result = await firstValueFrom(
        this.http.get<any>(`${this.apiUrl}?${params.toString()}`, { headers })
      );

      if (result.status === 'done') {
        this.stopPolling();
        if (result.artifactDownloadUrl) {
          this.state = {
            ...this.state,
            phase: 'downloading',
            statusMessage: 'Descargando reporte Serenity...',
            artifactDownloadUrl: result.artifactDownloadUrl,
          };
          if (!this.suppressAutoDownload) {
            const dlUrl = result.artifactDownloadUrl;
            const a = document.createElement('a');
            a.href = dlUrl;
            a.download = 'serenity-report.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          this.state = { ...this.state, phase: 'done', statusMessage: 'Completado' };
        } else {
          this.state = { ...this.state, phase: 'error', error: result.message || 'No se encontro el artifact' };
        }
        this.cleanupBundle();
      } else if (result.status === 'running') {
        const phaseLabels: Record<string, string> = {
          notStarted: 'Pipeline en cola...',
          inProgress: 'Pipeline en ejecucion...',
          cancelling: 'Cancelando...',
        };
        this.state = { ...this.state, phase: 'polling', statusMessage: phaseLabels[result.phase] || 'Pipeline en progreso...' };
      } else {
        this.stopPolling();
        this.state = { ...this.state, phase: 'error', error: result.message || 'Estado desconocido' };
        this.cleanupBundle();
      }
    } catch (err: any) {
      this.stopPolling();
      this.state = { ...this.state, phase: 'error', error: err?.message || 'Error al consultar estado' };
    }
  }

  /**
   * Sube el bundle JSON (con imágenes en base64) DIRECTAMENTE a Supabase Storage
   * desde el navegador y devuelve una URL firmada (24h) + el path para limpieza.
   * Evita el límite de 4.5MB del body de las funciones serverless de Vercel.
   */
  private async uploadBundleDirect(bundleJson: string): Promise<{ url: string; path: string }> {
    const { data: userData } = await this.supabaseClient.supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) throw new Error('Usuario no autenticado para subir el bundle.');

    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `serenity-bundles/${userId}/${name}.json`;
    const blob = new Blob([bundleJson], { type: 'application/json' });

    const { error } = await this.supabaseClient.supabase.storage
      .from('execution-evidence')
      .upload(path, blob, { contentType: 'application/json', upsert: true });

    if (error) {
      throw new Error('No se pudo subir el bundle a Storage: ' + error.message);
    }

    const { data: signed, error: signErr } = await this.supabaseClient.supabase.storage
      .from('execution-evidence')
      .createSignedUrl(path, 86400);

    if (signErr || !signed?.signedUrl) {
      throw new Error('No se pudo generar la URL firmada del bundle.');
    }

    return { url: signed.signedUrl, path };
  }

  /** Elimina el bundle temporal de Storage una vez terminado (o si falla). */
  private async cleanupBundle(): Promise<void> {
    if (!this.bundlePath) return;
    const path = this.bundlePath;
    this.bundlePath = null;
    try {
      await this.supabaseClient.supabase.storage.from('execution-evidence').remove([path]);
    } catch { /* no-op */ }
  }

  private async buildAuthHeaders(): Promise<HttpHeaders> {
    let { data, error } = await this.supabaseClient.supabase.auth.getSession();
    let session = data.session;

    const isExpired = !!session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;

    if ((!session?.access_token || isExpired) && !error) {
      const refreshed = await this.supabaseClient.supabase.auth.refreshSession();
      session = refreshed.data.session ?? null;
      error = refreshed.error ?? null;
    }

    if (!session?.access_token) {
      await this.supabaseClient.supabase.auth.signOut().catch(() => undefined);
      throw new Error('Sesión inválida o expirada. Inicia sesión nuevamente.');
    }

    return new HttpHeaders({ Authorization: `Bearer ${session.access_token}` });
  }

  stopPolling(): void { if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; } }
  reset(): void { this.stopPolling(); this.state = { phase: 'idle' }; }
}
