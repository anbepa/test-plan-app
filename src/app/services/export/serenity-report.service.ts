import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

      // ── Fase 1: Hidratar evidencias ──
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

      // ── Fase 2: Construir metadata bundle + subir a Supabase ──
      this.state = { phase: 'building', statusMessage: 'Construyendo bundle del reporte...' };

      const { data: sessionData } = await this.supabaseClient.supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) throw new Error('No se pudo obtener el usuario autenticado');

      const jobId = `serenity-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const metadataBundle = this.serenityExport.buildMetadataBundle(execution, run, userId);
      const bundleJson = JSON.stringify(metadataBundle);
      const storagePath = `${userId}/temp/${jobId}.json`;

      // Subir metadata bundle (pequeño, sin base64) a Supabase Storage
      const { error: uploadError } = await this.supabaseClient.supabase.storage
        .from('execution-evidence')
        .upload(storagePath, new Blob([bundleJson], { type: 'application/json' }), {
          upsert: true,
          cacheControl: '3600',
        });

      if (uploadError) {
        throw new Error(`Error al subir bundle: ${uploadError.message}`);
      }

      // ── Fase 3: Enviar a Vercel → signed URL → dispatch ──
      this.state = {
        phase: 'dispatching',
        statusMessage: 'Enviando datos al workflow...',
        hydrateProgress: undefined,
      };

      const startResult = await firstValueFrom(
        this.http.post<any>(`${this.apiUrl}?action=start`, {
          jobId,
          storagePath,
          executionId: execution.id,
        })
      );

      if (!startResult.success) {
        throw new Error(startResult.error || 'Error al iniciar el reporte');
      }

      this.state = {
        phase: 'polling',
        statusMessage: 'Generando reporte en GitHub Actions...',
        jobId: startResult.jobId || jobId,
        gistId: startResult.gistId,
        runId: startResult.runId,
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
