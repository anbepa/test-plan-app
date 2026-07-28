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

export interface SerenityReportState {
  phase: 'idle' | 'hydrating' | 'building' | 'dispatching' | 'polling' | 'downloading' | 'done' | 'error';
  jobId?: string;
  gistId?: string;
  runId?: string;
  artifactDownloadUrl?: string;
  error?: string;
  hydrateProgress?: HydrateProgress;
  statusMessage?: string;
}

@Injectable({ providedIn: 'root' })
export class SerenityReportService {
  state: SerenityReportState = { phase: 'idle' };
  /** Cuando es true, no dispara la descarga automática del artifact en el navegador (usado por el flujo de subida a Azure) */
  suppressAutoDownload = false;
  private pollTimer: any = null;
  private apiUrl = '/api/serenity-report';

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
        statusMessage: `Enviando bundle (${(bundleJson.length / 1024).toFixed(0)} KB)...`,
        hydrateProgress: undefined,
      };

      const headers = await this.buildAuthHeaders();
      const startResult = await firstValueFrom(
        this.http.post<any>(this.apiUrl, { bundle }, { headers })
      );

      if (!startResult.success) {
        throw new Error(startResult.error || 'Error al iniciar el reporte');
      }

      this.state = {
        phase: 'polling',
        statusMessage: 'Generando reporte en GitHub Actions...',
        jobId: startResult.jobId,
        gistId: startResult.gistId,
        runId: startResult.runId,
      };

      this.startPolling();
    } catch (err: any) {
      this.state = { phase: 'error', error: err?.message || 'Error desconocido' };
      throw err;
    }
  }

  /** Gzip-compress a string using the browser's CompressionStream API. */
  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll(), 5000);
    this.poll();
  }

  private async poll(): Promise<void> {
    const { jobId, gistId, runId } = this.state;

    try {
      const params = new URLSearchParams();
      if (runId) params.set('runId', runId);
      if (gistId) params.set('gistId', gistId);
      if (jobId) params.set('jobId', jobId);

      if (!jobId) {
        this.state = { ...this.state, phase: 'error', error: 'Falta jobId.' };
        this.stopPolling();
        return;
      }

      const headers = await this.buildAuthHeaders();
      const result = await firstValueFrom(
        this.http.get<any>(`${this.apiUrl}?${params.toString()}`, { headers })
      );

      if (result.runId && !this.state.runId) {
        this.state = { ...this.state, runId: result.runId };
      }

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
        } else {
          this.state = { ...this.state, phase: 'error', error: result.message || 'No se encontro el artifact' };
        }
      } else if (result.phase === 'queued') {
        this.state = { ...this.state, phase: 'polling', statusMessage: 'Workflow en cola...' };
      } else if (result.status === 'running') {
        this.state = { ...this.state, phase: 'polling', statusMessage: 'Generando reporte...' };
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
}
