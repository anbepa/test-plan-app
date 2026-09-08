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

export type SerenityBackend = 'azure';

export interface SerenityReportState {
  phase: 'idle' | 'hydrating' | 'building' | 'dispatching' | 'polling' | 'downloading' | 'done' | 'error';
  jobId?: string;
  gistId?: string;
  runId?: string;
  buildId?: number;
  releaseId?: number;
  releaseUrl?: string;
  artifactDownloadUrl?: string;
  error?: string;
  hydrateProgress?: HydrateProgress;
  statusMessage?: string;
}

export interface SerenityReportRecord {
  id: string;
  name: string;
  generatedAt: string;
  backend: SerenityBackend;
  status: 'pending' | 'completed' | 'error';
  progress: number;
  executionId?: string;
  artifactDownloadUrl?: string;
  releaseUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class SerenityReportService {
  state: SerenityReportState = { phase: 'idle' };
  suppressAutoDownload = false;
  /**
   * Backend activo. Actualmente solo se soporta Azure DevOps.
   */
  backend: SerenityBackend = 'azure';
  _currentRunName = 'Reporte Serenity';
  private pollTimer: any = null;
  private readonly azApiUrl = '/api/serenity-report-azure';
  private bundlePath: string | null = null;

  constructor(
    private http: HttpClient,
    private serenityExport: SerenityExportService,
    private storage: ExecutionStorageService,
    private supabaseClient: SupabaseClientService,
  ) {}

  /**
   * Determina que backend usar. Actualmente solo se soporta Azure DevOps.
   */
  private async resolveBackend(): Promise<SerenityBackend> {
    return 'azure';
  }

  async generateReport(
    run: TestRun,
    options: { autoDetectBackend?: boolean } = {}
  ): Promise<void> {
    if (this.state.phase === 'polling' || this.state.phase === 'dispatching') return;

    try {
      if (!run.executionId) {
        throw new Error('Esta ejecucion no tiene datos ejecutados todavia.');
      }

      // Resolver el backend en cada ejecucion: el servicio es singleton y sin
      // esto quedaria pegado el valor de la generacion anterior.
      if (options.autoDetectBackend !== false) {
        this.backend = await this.resolveBackend();
        this._currentRunName = run.name || run.huTitle || 'Reporte Serenity';
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
      // Esto evita el límite de body (4.5MB en el plan gratuito) de las
      // funciones serverless de Vercel, que provocaba errores 413 con
      // evidencias pesadas. La URL firmada la genera el BACKEND (service role)
      // para no depender de policies de SELECT del lado del cliente, que
      // provocaban URLs inválidas (curl 400) al descargarlas desde Azure.
      const bundlePath = await this.uploadBundleDirect(bundleJson);
      this.bundlePath = bundlePath;

      this.state = {
        ...this.state,
        statusMessage: 'Iniciando pipeline en Azure DevOps...',
      };

      const headers = await this.buildAuthHeaders();

      await this.dispatchAzure(bundlePath, headers, run.executionId);
      // IMPORTANTE: no borrar el bundle aquí. El release recién creado queda
      // en cola en Azure DevOps y la tarea "Descargar bundle" puede tardar
      // minutos en ejecutarse; si se borra el objeto de Storage de inmediato,
      // el curl del pipeline falla con 400 (Object not found) porque el
      // archivo ya no existe cuando el agente intenta descargarlo. El bundle
      // se conserva y expira solo (signed URL de 6h); Storage no lo borra
      // automáticamente, pero el próximo reporte sobreescribe/limpia los
      // bundles previos del usuario en el backend.
      this.bundlePath = null;
    } catch (err: any) {
      this.cleanupBundle();
      this.state = { phase: 'error', error: err?.message || 'Error desconocido' };
      throw err;
    }
  }

  /**
   * Sube el bundle JSON (con imágenes en base64) DIRECTAMENTE a Supabase Storage
   * desde el navegador y devuelve el path del objeto. Evita el límite de
   * 4.5MB del body de las funciones serverless de Vercel. La URL firmada se
   * genera del lado del backend con el service role (ver dispatchAzure), ya
   * que firmar desde el navegador (sujeto a RLS) puede producir URLs que
   * Azure no puede descargar (curl 400).
   */
  private async uploadBundleDirect(bundleJson: string): Promise<string> {
    const { data: userData } = await this.supabaseClient.supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) throw new Error('Usuario no autenticado para subir el bundle.');

    // Limpieza best-effort de bundles previos de este usuario (>1h) antes de
    // subir el nuevo. Como ya no se borra el bundle justo tras el dispatch
    // (eso causaba 400 en el pipeline si tardaba en ejecutarse), evitamos que
    // Storage acumule bundles indefinidamente.
    await this.cleanupOldBundles(userId);

    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // El primer segmento del path DEBE ser el userId: la policy RLS de Storage
    // valida (storage.foldername(name))[1] = auth.uid(), igual que el resto de
    // rutas de evidencia usadas en execution-storage-supabase.service.ts.
    const path = `${userId}/serenity-bundles/${name}.json`;
    const blob = new Blob([bundleJson], { type: 'application/json' });

    const { error } = await this.supabaseClient.supabase.storage
      .from('execution-evidence')
      .upload(path, blob, { contentType: 'application/json', upsert: true });

    if (error) {
      throw new Error('No se pudo subir el bundle a Storage: ' + error.message);
    }

    return path;
  }

  /**
   * Elimina bundles de Serenity subidos por este usuario hace más de 1 hora.
   * Best-effort: los errores se ignoran para no bloquear la generación del
   * reporte actual. Se asume que a esas alturas cualquier pipeline de Azure
   * que los necesitara ya terminó de descargarlos.
   */
  private async cleanupOldBundles(userId: string): Promise<void> {
    try {
      const folder = `${userId}/serenity-bundles`;
      const { data: files, error } = await this.supabaseClient.supabase.storage
        .from('execution-evidence')
        .list(folder, { limit: 100 });

      if (error || !files?.length) return;

      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const stale = files
        .filter(f => {
          const created = f.created_at ? new Date(f.created_at).getTime() : 0;
          return created > 0 && created < oneHourAgo;
        })
        .map(f => `${folder}/${f.name}`);

      if (stale.length) {
        await this.supabaseClient.supabase.storage.from('execution-evidence').remove(stale);
      }
    } catch { /* no-op */ }
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

  private async dispatchAzure(bundlePath: string, headers: HttpHeaders, executionId?: string): Promise<void> {
    const startResult = await firstValueFrom(
      this.http.post<any>(this.azApiUrl, { bundlePath, executionId }, { headers })
    );

    if (!startResult.success) {
      throw new Error(startResult.error || 'Error al iniciar el release de Azure DevOps');
    }

    this.state = {
      phase: 'done',
      statusMessage: 'Reporte enviado a Azure DevOps. Revisa el historial para descargarlo.',
      jobId: startResult.jobId,
      releaseId: startResult.releaseId,
    };
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll(), 5000);
    this.poll();
  }

  private async poll(): Promise<void> {
    return this.pollAzure();
  }

  private async pollAzure(): Promise<void> {
    const { jobId, releaseId } = this.state;

    try {
      const params = new URLSearchParams();
      if (releaseId) params.set('releaseId', String(releaseId));
      if (jobId) params.set('jobId', jobId);

      if (!releaseId) {
        this.state = { ...this.state, phase: 'error', error: 'Falta releaseId.' };
        this.stopPolling();
        return;
      }

      const headers = await this.buildAuthHeaders();
      const result = await firstValueFrom(
        this.http.get<any>(`${this.azApiUrl}?${params.toString()}`, { headers })
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
            this.downloadArtifact(result.artifactDownloadUrl);
          }
          this.state = { ...this.state, phase: 'done', statusMessage: 'Completado' };
        } else if (result.releaseUrl) {
          this.state = {
            ...this.state,
            phase: 'downloading',
            statusMessage: 'Abriendo release de Azure DevOps...',
            releaseUrl: result.releaseUrl,
          };
          if (!this.suppressAutoDownload) {
            window.open(result.releaseUrl, '_blank');
          }
          this.state = { ...this.state, phase: 'done', statusMessage: 'Completado' };
        } else {
          this.state = { ...this.state, phase: 'error', error: result.message || 'Release sin URL' };
        }
      } else if (result.status === 'running') {
        const phaseLabels: Record<string, string> = {
          notStarted: 'Release en cola...',
          inProgress: 'Release en ejecución...',
        };
        this.state = { ...this.state, phase: 'polling', statusMessage: phaseLabels[result.phase] || 'Release en progreso...' };
      } else {
        this.stopPolling();
        this.state = { ...this.state, phase: 'error', error: result.message || 'Estado desconocido' };
      }
    } catch (err: any) {
      this.stopPolling();
      this.state = { ...this.state, phase: 'error', error: err?.message || 'Error al consultar estado' };
    }
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

  private downloadArtifact(url: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'serenity-report.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  stopPolling(): void { if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; } }
  reset(): void { this.stopPolling(); this.state = { phase: 'idle' }; }

  async loadHistory(executionId?: string): Promise<SerenityReportRecord[]> {
    try {
      const { data } = await this.supabaseClient.supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return [];

      let query = this.supabaseClient.supabase
        .from('serenity_report_results')
        .select('id, name, backend, status, progress, execution_id, artifact_download_url, release_url, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (executionId) {
        query = query.eq('execution_id', executionId);
      }

      // Solo se conserva/muestra el último reporte generado (no se guarda histórico).
      const { data: rows, error } = await query.limit(1);

      if (error || !rows) return [];

      return rows.map((r: any) => ({
        id: r.id,
        name: r.name || '',
        generatedAt: r.created_at,
        backend: r.backend as SerenityBackend,
        status: r.artifact_download_url ? 'completed' : (r.status || 'pending'),
        progress: r.artifact_download_url ? 100 : (r.progress || 0),
        executionId: r.execution_id || undefined,
        artifactDownloadUrl: r.artifact_download_url || undefined,
        releaseUrl: r.release_url || undefined,
      }));
    } catch {
      return [];
    }
  }

  async checkReportStatus(id: string): Promise<SerenityReportRecord | null> {
    try {
      const { data: rows, error } = await this.supabaseClient.supabase
        .from('serenity_report_results')
        .select('id, name, backend, status, progress, execution_id, artifact_download_url, release_url, created_at')
        .eq('id', id)
        .limit(1);

      if (error || !rows?.length) return null;

      const r = rows[0];
      return {
        id: r.id,
        name: r.name || '',
        generatedAt: r.created_at,
        backend: r.backend as SerenityBackend,
        status: r.artifact_download_url ? 'completed' : (r.status || 'pending'),
        progress: r.artifact_download_url ? 100 : (r.progress || 0),
        executionId: r.execution_id || undefined,
        artifactDownloadUrl: r.artifact_download_url || undefined,
        releaseUrl: r.release_url || undefined,
      };
    } catch {
      return null;
    }
  }

  async saveToHistory(record: SerenityReportRecord): Promise<void> {
    try {
      const { data } = await this.supabaseClient.supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;

      await this.supabaseClient.supabase
        .from('serenity_report_results')
        .upsert({
          id: record.id,
          user_id: userId,
          execution_id: record.executionId || null,
          name: record.name,
          backend: record.backend,
          status: record.status,
          progress: record.progress,
          artifact_download_url: record.artifactDownloadUrl || null,
          release_url: record.releaseUrl || null,
        }, { onConflict: 'id' });
    } catch (_) { /* no-op */ }
  }

  async removeFromHistory(id: string, executionId?: string): Promise<void> {
    try {
      const { data } = await this.supabaseClient.supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;

      let query = this.supabaseClient.supabase
        .from('serenity_report_results')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (executionId) {
        query = query.eq('execution_id', executionId);
      }

      await query;
    } catch (_) { /* no-op */ }
  }
}
