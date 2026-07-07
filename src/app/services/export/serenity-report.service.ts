import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SerenityExportService } from './serenity-export.service';
import { TestRun } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';

export interface HydrateProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface SerenityReportState {
  phase: 'idle' | 'hydrating' | 'building' | 'compressing' | 'dispatching' | 'polling' | 'downloading' | 'done' | 'error';
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

      this.state = { phase: 'building', statusMessage: 'Construyendo bundle...' };

      const fullBundle = this.serenityExport.buildFullBundle(execution, run);
      const bundleJson = JSON.stringify(fullBundle);
      const rawSize = bundleJson.length;

      this.state = {
        phase: 'compressing',
        statusMessage: `Comprimiendo bundle (${(rawSize / 1024 / 1024).toFixed(1)} MB)...`,
      };

      const compressed = await this.gzip(bundleJson);
      const compressedSize = compressed.byteLength;

      this.state = {
        phase: 'dispatching',
        statusMessage: `Enviando bundle comprimido (${(compressedSize / 1024).toFixed(0)} KB)...`,
        hydrateProgress: undefined,
      };

      const startResult = await firstValueFrom(
        this.http.post<any>(this.apiUrl, compressed, {
          headers: { 'Content-Type': 'application/octet-stream' },
          params: { action: 'start', rawSize: rawSize.toString(), compressedSize: compressedSize.toString() },
        })
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
  private async gzip(data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const compressed = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(data));
        controller.close();
      },
    }).pipeThrough(new CompressionStream('gzip'));

    const reader = compressed.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result;
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
