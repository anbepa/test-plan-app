import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SerenityExportService } from './serenity-export.service';
import { TestRun, PlanExecution } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';

export interface SerenityReportState {
  phase: 'idle' | 'building' | 'dispatching' | 'polling' | 'downloading' | 'done' | 'error';
  jobId?: string;
  gistId?: string;
  runId?: string;
  artifactDownloadUrl?: string;
  error?: string;
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
      this.state = { phase: 'building' };

      if (!run.executionId) {
        throw new Error('Esta ejecucion no tiene datos ejecutados todavia.');
      }

      const execution = await this.storage.getExecution(run.executionId);
      if (!execution) {
        throw new Error('No se encontro la ejecucion en la base de datos.');
      }

      await this.storage.hydrateAllEvidence(execution);
      const bundle = this.serenityExport.buildBundleFromExecution(execution, run);

      this.state = { phase: 'dispatching' };

      const startResult = await firstValueFrom(
        this.http.post<any>(this.apiUrl, { bundle })
      );

      if (startResult.success) {
        this.state = {
          phase: 'polling',
          jobId: startResult.jobId,
          gistId: startResult.gistId,
          runId: startResult.runId,
        };
        this.startPolling();
      } else {
        throw new Error(startResult.error || 'Error al iniciar el reporte');
      }
    } catch (err: any) {
      this.state = { phase: 'error', error: err?.message || 'Error desconocido' };
      throw err;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll(), 5000);
    this.poll(); // primera inmediata
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

      // El backend puede devolvernos un runId que no teníamos
      if (result.runId && !this.state.runId) {
        this.state = { ...this.state, runId: result.runId };
      }

      if (result.status === 'done') {
        this.stopPolling();
        if (result.artifactDownloadUrl) {
          this.state = {
            ...this.state,
            phase: 'downloading',
            artifactDownloadUrl: result.artifactDownloadUrl,
          };
          this.downloadArtifact(result.artifactDownloadUrl);
          this.state = { ...this.state, phase: 'done' };
        } else {
          this.state = {
            ...this.state,
            phase: 'error',
            error: result.message || 'No se encontro el artifact del reporte',
          };
        }
      } else if (result.status === 'running') {
        this.state = { ...this.state, phase: 'polling' };
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
