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

      const execution = await this.storage.getExecution(run.executionId);
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
        statusMessage: `Enviando bundle (${(bundleJson.length / 1024).toFixed(0)} KB) a Azure DevOps...`,
        hydrateProgress: undefined,
      };

      const headers = await this.buildAuthHeaders();

      await this.dispatchAzure(bundle, headers, run.executionId);
    } catch (err: any) {
      this.state = { phase: 'error', error: err?.message || 'Error desconocido' };
      throw err;
    }
  }

  private async dispatchAzure(bundle: any, headers: HttpHeaders, executionId?: string): Promise<void> {
    const startResult = await firstValueFrom(
      this.http.post<any>(this.azApiUrl, { bundle, executionId }, { headers })
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
