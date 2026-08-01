import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SerenityExportService } from './serenity-export.service';
import { TestRun } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
import { SupabaseClientService } from '../database/supabase-client.service';
import { SerenityIntegrationService } from '../integrations/serenity-integration.service';

export interface HydrateProgress {
  current: number;
  total: number;
  percentage: number;
}

export type SerenityBackend = 'github' | 'azure';

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

@Injectable({ providedIn: 'root' })
export class SerenityReportService {
  state: SerenityReportState = { phase: 'idle' };
  suppressAutoDownload = false;
  /**
   * Backend activo. Se resuelve automaticamente en cada generateReport():
   * 'azure' solo si existe una conexion Azure Serenity conectada,
   * en cualquier otro caso se mantiene 'github'.
   *
   * Se puede forzar asignandolo antes de llamar a generateReport(); en ese
   * caso hay que pasar { autoDetectBackend: false }.
   */
  backend: SerenityBackend = 'github';
  private pollTimer: any = null;
  private readonly ghApiUrl = '/api/serenity-report';
  private readonly azApiUrl = '/api/serenity-report-azure';

  constructor(
    private http: HttpClient,
    private serenityExport: SerenityExportService,
    private storage: ExecutionStorageService,
    private supabaseClient: SupabaseClientService,
    private serenityIntegration: SerenityIntegrationService,
  ) {}

  /**
   * Determina que backend usar. Ante cualquier duda o error devuelve
   * 'github', que es el flujo historico y no debe verse afectado.
   */
  private async resolveBackend(): Promise<SerenityBackend> {
    try {
      const azureConfig = await firstValueFrom(
        this.serenityIntegration.getAzureSerenityConfig()
      );
      return azureConfig?.status === 'connected' ? 'azure' : 'github';
    } catch {
      return 'github';
    }
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

      const backendLabel = this.backend === 'azure' ? 'Azure DevOps' : 'GitHub Actions';
      this.state = {
        phase: 'dispatching',
        statusMessage: `Enviando bundle (${(bundleJson.length / 1024).toFixed(0)} KB) a ${backendLabel}...`,
        hydrateProgress: undefined,
      };

      const headers = await this.buildAuthHeaders();

      if (this.backend === 'azure') {
        await this.dispatchAzure(bundle, headers);
      } else {
        await this.dispatchGitHub(bundle, headers);
      }
    } catch (err: any) {
      this.state = { phase: 'error', error: err?.message || 'Error desconocido' };
      throw err;
    }
  }

  private async dispatchGitHub(bundle: any, headers: HttpHeaders): Promise<void> {
    const startResult = await firstValueFrom(
      this.http.post<any>(this.ghApiUrl, { bundle }, { headers })
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
  }

  private async dispatchAzure(bundle: any, headers: HttpHeaders): Promise<void> {
    const startResult = await firstValueFrom(
      this.http.post<any>(this.azApiUrl, { bundle }, { headers })
    );

    if (!startResult.success) {
      throw new Error(startResult.error || 'Error al iniciar el release de Azure DevOps');
    }

    this.state = {
      phase: 'polling',
      statusMessage: 'Generando reporte en Azure DevOps...',
      jobId: startResult.jobId,
      releaseId: startResult.releaseId,
    };

    this.startPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll(), 5000);
    this.poll();
  }

  private async poll(): Promise<void> {
    if (this.backend === 'azure') {
      return this.pollAzure();
    }
    return this.pollGitHub();
  }

  private async pollGitHub(): Promise<void> {
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
        this.http.get<any>(`${this.ghApiUrl}?${params.toString()}`, { headers })
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
}
