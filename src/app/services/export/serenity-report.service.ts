import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SerenityExportService } from './serenity-export.service';
import { TestRun, PlanExecution } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';

export interface HydrateProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface SerenityReportState {
  phase: 'idle' | 'hydrating' | 'building' | 'uploading' | 'dispatching' | 'polling' | 'downloading' | 'done' | 'error';
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
  private pollTimer: any = null;
  private apiUrl = '/api/serenity-report';

  constructor(
    private http: HttpClient,
    private serenityExport: SerenityExportService,
    private storage: ExecutionStorageService,
  ) {}

  async generateReport(run: TestRun): Promise<void> {
    if (this.state.phase === 'polling' || this.state.phase === 'dispatching' || this.state.phase === 'uploading') return;

    try {
      if (!run.executionId) {
        throw new Error('Esta ejecucion no tiene datos ejecutados todavia.');
      }

      // ── Fase 1: Hidratar evidencias ──
      this.state = { phase: 'hydrating', statusMessage: 'Cargando ejecucion desde BD...' };

      const execution = await this.storage.getExecution(run.executionId);
      if (!execution) {
        throw new Error('No se encontro la ejecucion en la base de datos.');
      }

      this.state = {
        phase: 'hydrating',
        statusMessage: 'Descargando evidencias...',
        hydrateProgress: { current: 0, total: 0, percentage: 0 },
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

      // ── Fase 2: Construir bundle metadata (SIN base64) ──
      this.state = { phase: 'building', statusMessage: 'Construyendo bundle del reporte...' };

      const bundle = this.serenityExport.buildMetadataBundle(execution, run);
      const evidenceUploads = this.serenityExport.getEvidenceUploads(execution, run);

      // ── Fase 3: Crear Gist con metadata ──
      this.state = { phase: 'uploading', statusMessage: 'Creando Gist con metadata...' };

      const startResult = await firstValueFrom(
        this.http.post<any>(`${this.apiUrl}?action=start`, { bundle })
      );

      if (!startResult.success) {
        throw new Error(startResult.error || 'Error al crear el Gist');
      }

      const gistId = startResult.gistId as string;
      const jobId = startResult.jobId as string;

      // ── Fase 4: Subir evidencias al Gist en batches ──
      if (evidenceUploads.length > 0) {
        this.state = {
          phase: 'uploading',
          statusMessage: `Subiendo evidencias al Gist (0/${evidenceUploads.length})...`,
          gistId,
          jobId,
          hydrateProgress: { current: 0, total: evidenceUploads.length, percentage: 0 },
        };

        let uploaded = 0;
        const BATCH_SIZE = 8; // subir de a 8 archivos por PATCH (reduce requests a GitHub)

        for (let i = 0; i < evidenceUploads.length; i += BATCH_SIZE) {
          const batch = evidenceUploads.slice(i, i + BATCH_SIZE);

          const result = await firstValueFrom(
            this.http.post<any>(`${this.apiUrl}?action=evidence`, {
              gistId,
              files: batch.map(ev => ({ name: ev.name, base64: ev.base64 })),
            })
          ).catch(() => null);

          if (!result?.success) {
            // Reintentar archivos individuales si el batch falló
            for (const ev of batch) {
              await firstValueFrom(
                this.http.post<any>(`${this.apiUrl}?action=evidence`, {
                  gistId, name: ev.name, base64: ev.base64,
                })
              ).catch(() => null);
              uploaded++;
            }
          } else {
            uploaded += batch.length;
          }

          this.state = {
            ...this.state,
            phase: 'uploading',
            statusMessage: `Subiendo evidencias (${Math.min(uploaded, evidenceUploads.length)}/${evidenceUploads.length})...`,
            hydrateProgress: {
              current: Math.min(uploaded, evidenceUploads.length),
              total: evidenceUploads.length,
              percentage: Math.round((Math.min(uploaded, evidenceUploads.length) / evidenceUploads.length) * 100),
            },
          };

          // Pequeña pausa entre batches para no saturar la API de GitHub
          if (i + BATCH_SIZE < evidenceUploads.length) {
            await new Promise(r => setTimeout(r, 600));
          }
        }
      }

      // ── Fase 5: Disparar workflow ──
      this.state = {
        phase: 'dispatching',
        statusMessage: 'Disparando workflow en GitHub Actions...',
        gistId,
        jobId,
      };

      const dispatchResult = await firstValueFrom(
        this.http.post<any>(`${this.apiUrl}?action=dispatch`, { gistId, jobId })
      );

      if (!dispatchResult.success) {
        throw new Error(dispatchResult.error || 'Error al disparar el workflow');
      }

      this.state = {
        phase: 'polling',
        statusMessage: 'Generando reporte en GitHub Actions...',
        jobId,
        gistId,
        runId: dispatchResult.runId,
        hydrateProgress: undefined,
      };

      this.startPolling();
    } catch (err: any) {
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

      const result = await firstValueFrom(
        this.http.get<any>(`${this.apiUrl}?${params.toString()}`)
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
          this.downloadArtifact(result.artifactDownloadUrl);
          this.state = {
            ...this.state,
            phase: 'done',
            statusMessage: 'Reporte descargado exitosamente',
            hydrateProgress: undefined,
          };
        } else {
          this.state = {
            ...this.state,
            phase: 'error',
            error: result.message || 'No se encontro el artifact del reporte',
          };
        }
      } else if (result.phase === 'queued') {
        this.state = {
          ...this.state,
          phase: 'polling',
          statusMessage: 'Workflow en cola, esperando runner...',
        };
      } else if (result.status === 'running') {
        this.state = {
          ...this.state,
          phase: 'polling',
          statusMessage: 'Generando reporte Serenity...',
        };
      } else {
        this.stopPolling();
        this.state = {
          ...this.state,
          phase: 'error',
          error: result.message || 'Estado desconocido del workflow',
        };
      }
    } catch (err: any) {
      this.stopPolling();
      this.state = {
        ...this.state,
        phase: 'error',
        error: err?.message || 'Error al consultar el estado del reporte',
      };
    }
  }

  private downloadArtifact(url: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'serenity-report.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  reset(): void {
    this.stopPolling();
    this.state = { phase: 'idle' };
  }
}
