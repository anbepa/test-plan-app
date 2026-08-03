/**
 * Servicio orquestador del flujo completo de gestión de evidencias
 * Coordina validación, generación Serenity, compresión, carga y vinculación
 */

import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  EvidenceUploadState,
  EvidenceUploadProgress,
  ValidatedPlanInfo,
  RetryableStep,
  RetryAttempt
} from '../../models/azure-devops-evidence.model';
import { AzureDevOpsEvidenceService } from '../integrations/azure-devops-evidence.service';
import { EvidenceCompressionService } from './evidence-compression.service';
import { SerenityReportService } from '../export/serenity-report.service';
import { TestRun } from '../../models/hu-data.model';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';

export interface EvidenceExtraFile {
  /** Nombre del archivo dentro del ZIP, ej: "Ejecucion.docx" */
  name: string;
  /** Contenido en base64 (sin prefijo data:) */
  base64: string;
}

export interface EvidenceUploadOptions {
  formats: { serenity: boolean; docx: boolean; pdf: boolean };
  extraFiles: EvidenceExtraFile[];
}

@Injectable({
  providedIn: 'root'
})
export class EvidenceUploadOrchestrator {
  private progressSubject = new BehaviorSubject<EvidenceUploadProgress>({
    state: EvidenceUploadState.IDLE
  });
  public progress$ = this.progressSubject.asObservable();

  private cancelSubject = new Subject<void>();
  private isCancelled = false;

  private currentValidatedPlan: ValidatedPlanInfo | null = null;
  private currentAttachmentUrl: string | null = null;
  private currentAttachmentId: string | null = null;
  private currentArtifactUrl: string | null = null;
  private currentFileName: string | null = null;
  private currentCompressionResult: { zipBlob: Blob; fileName: string; fileSize: number } | null = null;
  private retryAttempts: Map<RetryableStep, RetryAttempt> = new Map();
  private MAX_RETRY_ATTEMPTS = 3;
  private SERENITY_POLL_TIMEOUT = 600000; // 10 minutos
  private SERENITY_POLL_INTERVAL = 2000; // 2 segundos

  private readonly baseUrl = '/api/integrations/azure-devops';

  constructor(
    private azureEvidence: AzureDevOpsEvidenceService,
    private compressionService: EvidenceCompressionService,
    private serenityReportService: SerenityReportService,
    private http: HttpClient,
    private supabaseClient: SupabaseClientService,
    private ngZone: NgZone
  ) {
    this.cancelSubject.subscribe(() => {
      this.isCancelled = true;
    });
  }

  /**
   * Obtiene el estado actual del progreso
   */
  getCurrentProgress(): EvidenceUploadProgress {
    return this.progressSubject.value;
  }

  /**
   * Observable de cambios de estado
   */
  watchProgress(): Observable<EvidenceUploadProgress> {
    return this.progress$;
  }

  /**
   * Inicia el flujo completo de carga de evidencias
   */
  async executeFlow(
    planId: string,
    testRun: TestRun,
    zipNameTemplate?: string,
    options?: EvidenceUploadOptions
  ): Promise<void> {
    const formats = options?.formats || { serenity: true, docx: false, pdf: false };
    const extraFiles = options?.extraFiles || [];

    try {
      this.isCancelled = false;
      this.retryAttempts.clear();
      this.currentArtifactUrl = null;

      // Paso 1: Validar plan
      await this.step1ValidatePlan(planId);

      if (this.isCancelled) {
        this.setState(EvidenceUploadState.CANCELLED, 'Operación cancelada por el usuario');
        return;
      }

      // Resolver nombre del archivo ZIP
      this.currentFileName = this.resolveFileName(zipNameTemplate);

      // Paso 2: Generar Serenity (solo si el usuario lo seleccionó)
      if (formats.serenity) {
        await this.step2GenerateSerenity(testRun);

        if (this.isCancelled) {
          this.setState(EvidenceUploadState.CANCELLED, 'Operación cancelada por el usuario');
          return;
        }
      }

      // Paso 3: Empaquetar evidencias seleccionadas, subir a Azure DevOps y vincular
      await this.stepUploadAndLinkEvidence(extraFiles);

      // Éxito
      this.setState(
        EvidenceUploadState.COMPLETED,
        `Las evidencias se generaron, cargaron y vincularon correctamente al plan de pruebas ${this.currentValidatedPlan?.planId}.`
      );
    } catch (error: any) {
      const errorMsg = error?.message || 'Error desconocido durante la carga de evidencias';
      console.error('Evidence upload flow error:', error);
      this.setState(EvidenceUploadState.FAILED, errorMsg);
    }
  }

  private resolveFileName(zipNameTemplate?: string): string {
    if (!this.currentValidatedPlan) return 'Evidencia.zip';
    const context = this.compressionService.createResolutionContext(
      this.currentValidatedPlan.planId,
      this.currentValidatedPlan.planTitle
    );
    return this.compressionService.resolveZipName(context, zipNameTemplate);
  }

  /**
   * Reintenta un paso específico
   */
  async retryStep(step: RetryableStep): Promise<void> {
    if (!this.currentValidatedPlan) {
      throw new Error('No hay plan validado para reintentar');
    }

    const attempt = this.getOrCreateRetryAttempt(step);
    if (attempt.attempt > this.MAX_RETRY_ATTEMPTS) {
      throw new Error(`Máximo de reintentos alcanzado para ${step}`);
    }

    attempt.attempt++;
    attempt.timestamp = Date.now();

    try {
      switch (step) {
        case RetryableStep.ATTACHMENT_LINKING:
          if (!this.currentAttachmentUrl) {
            throw new Error('No hay URL de adjunto para reintentar vinculación');
          }
          await this.step5LinkAttachment();
          break;
        default:
          throw new Error(`No se puede reintentar el paso ${step}`);
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Error durante el reintento';
      this.setState(EvidenceUploadState.FAILED, errorMsg);
      throw error;
    }
  }

  /**
   * Cancela la operación
   */
  cancel(): void {
    this.cancelSubject.next();
  }

  /**
   * Resetea el estado del orquestador
   */
  reset(): void {
    this.progressSubject.next({ state: EvidenceUploadState.IDLE });
    this.currentValidatedPlan = null;
    this.currentAttachmentUrl = null;
    this.currentAttachmentId = null;
    this.currentCompressionResult = null;
    this.retryAttempts.clear();
    this.isCancelled = false;
  }

  // ─────────────────────────────────────────
  // Paso 1: Validar plan
  // ─────────────────────────────────────────

  private async step1ValidatePlan(planId: string): Promise<void> {
    this.setState(EvidenceUploadState.VALIDATING_PLAN, 'Validando plan de pruebas...');

    try {
      const validatedPlan = await this.azureEvidence.validateTestPlan(planId);
      this.currentValidatedPlan = validatedPlan;
      
      this.setState(EvidenceUploadState.PLAN_VALIDATED, 'Plan de pruebas validado correctamente');
    } catch (error: any) {
      throw new Error(`Validación de plan fallida: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────
  // Paso 2: Generar Serenity
  // ─────────────────────────────────────────

  private async step2GenerateSerenity(testRun: TestRun): Promise<void> {
    this.setState(EvidenceUploadState.GENERATING_SERENITY, 'Iniciando generación de evidencia Serenity...');

    return new Promise((resolve, reject) => {
      if (!testRun.executionId) {
        reject(new Error('La ejecución no tiene datos ejecutados'));
        return;
      }

      const pollStartTime = Date.now();
      let pollInterval: any = null;

      const cleanup = () => {
        if (pollInterval) clearInterval(pollInterval);
        this.serenityReportService.stopPolling();
      };

      try {
        // Evitar descarga automática en el navegador (solo queremos la URL del artifact)
        this.serenityReportService.suppressAutoDownload = true;

        // Iniciar generación en el servicio Serenity
        this.serenityReportService.generateReport(testRun).then(() => {
          // Monitor estado cada 500ms
          pollInterval = setInterval(() => {
            if (this.isCancelled) {
              cleanup();
              reject(new Error('Generación de Serenity cancelada'));
              return;
            }

            const state = this.serenityReportService.state;

            // Actualizar progreso UI
            this.updateProgress(progress => ({
              ...progress,
              state: EvidenceUploadState.WAITING_FOR_SERENITY,
              serenityProgress: {
                phase: state.phase,
                statusMessage: state.statusMessage,
                percentage: state.hydrateProgress?.percentage
              }
            }));

            if (state.phase === 'done') {
              cleanup();
              this.serenityReportService.suppressAutoDownload = false;
              if (!state.artifactDownloadUrl) {
                reject(new Error('Serenity finalizó pero no se obtuvo la URL del reporte'));
                return;
              }
              this.currentArtifactUrl = state.artifactDownloadUrl;
              resolve();
            }

            if (state.phase === 'error') {
              cleanup();
              this.serenityReportService.suppressAutoDownload = false;
              reject(new Error(state.error || 'Error desconocido en Serenity'));
            }

            // Timeout
            if (Date.now() - pollStartTime > this.SERENITY_POLL_TIMEOUT) {
              cleanup();
              this.serenityReportService.suppressAutoDownload = false;
              reject(new Error('Tiempo máximo de espera agotado para generación de Serenity (10 minutos)'));
            }
          }, 500);

          // Timeout general
          setTimeout(() => {
            if (pollInterval) {
              cleanup();
              this.serenityReportService.suppressAutoDownload = false;
              reject(new Error('Timeout esperando Serenity'));
            }
          }, this.SERENITY_POLL_TIMEOUT + 5000);
        }).catch((err: any) => {
          cleanup();
          this.serenityReportService.suppressAutoDownload = false;
          reject(new Error(`Error iniciando Serenity: ${err.message}`));
        });
      } catch (error: any) {
        cleanup();
        this.serenityReportService.suppressAutoDownload = false;
        reject(error);
      }
    });
  }

  // ─────────────────────────────────────────
  // Paso 3: Empaquetar evidencias, subir a Azure DevOps y vincular
  // ─────────────────────────────────────────

  private async stepUploadAndLinkEvidence(extraFiles: EvidenceExtraFile[]): Promise<void> {
    if (!this.currentValidatedPlan) {
      throw new Error('No hay plan validado para cargar evidencia');
    }
    if (!this.currentArtifactUrl && (!extraFiles || extraFiles.length === 0)) {
      throw new Error('No hay evidencias seleccionadas para cargar');
    }

    // Validar tamaño total de extraFiles (máximo 4MB para Vercel free tier)
    const maxTotalSize = 4 * 1024 * 1024; // 4MB
    let totalSize = 0;
    if (extraFiles && extraFiles.length > 0) {
      for (const file of extraFiles) {
        const fileSize = Buffer.byteLength(file.base64, 'base64');
        totalSize += fileSize;
      }
      if (totalSize > maxTotalSize) {
        throw new Error(
          `Los archivos a cargar (${(totalSize / 1024 / 1024).toFixed(2)}MB) exceden el límite de 4MB. ` +
          `Por favor, reduce el tamaño de los documentos (DOCX/PDF) o selecciona menos archivos.`
        );
      }
    }

    this.setState(EvidenceUploadState.UPLOADING_ATTACHMENT, 'Subiendo evidencias a Azure DevOps...');

    try {
      const headers = await this.buildAuthHeaders();

      const response = await firstValueFrom(
        this.http.post<any>(
          `${this.baseUrl}/work-items?workItemId=${encodeURIComponent(this.currentValidatedPlan.planId)}&action=upload-evidence`,
          {
            artifactDownloadUrl: this.currentArtifactUrl,
            extraFiles: extraFiles,
            projectId: this.currentValidatedPlan.projectId,
            areaPath: this.currentValidatedPlan.areaPath,
            planTitle: this.currentValidatedPlan.planTitle,
            fileName: this.currentFileName || 'Evidencia.zip'
          },
          { headers }
        )
      );

      if (!response || !response.success) {
        throw new Error(response?.error || 'Respuesta inválida del servidor al cargar evidencia');
      }

      this.currentAttachmentId = response.attachmentId;
      this.currentAttachmentUrl = response.attachmentUrl;

      this.updateProgress(p => ({
        ...p,
        state: EvidenceUploadState.LINKING_ATTACHMENT,
        attachmentUrl: response.attachmentUrl,
        attachmentId: response.attachmentId
      }));
    } catch (error: any) {
      throw new Error(`Error cargando evidencia: ${error?.error?.message || error.message}`);
    }
  }

  // ─────────────────────────────────────────
  // (Legacy) Paso 3: Comprimir evidencia — sin uso en el flujo actual
  // ─────────────────────────────────────────

  private async step3CompressEvidence(
    zipNameTemplate: string | undefined,
    testRun: TestRun
  ): Promise<void> {
    this.setState(EvidenceUploadState.COMPRESSING_EVIDENCE, 'Preparando evidencia para compresión...');

    if (!this.currentValidatedPlan) {
      throw new Error('No hay plan validado para comprimir evidencia');
    }

    try {
      // Crear contexto de resolución de nombre
      const context = this.compressionService.createResolutionContext(
        this.currentValidatedPlan.planId,
        this.currentValidatedPlan.planTitle,
        testRun.executionId
      );

      // Resolver nombre del ZIP
      const zipName = this.compressionService.resolveZipName(context, zipNameTemplate);

      // Crear estructura de archivos Serenity (placeholder)
      // En una implementación real, esto vendría del output de Serenity
      const files = new Map<string, Blob>();
      files.set('index.html', new Blob(['<html><body>Serenity Report</body></html>'], { type: 'text/html' }));

      // Comprimir
      const result = await this.compressionService.compressFiles(
        files,
        zipName,
        (progress) => {
          this.updateProgress(p => ({
            ...p,
            state: EvidenceUploadState.COMPRESSING_EVIDENCE,
            compressionProgress: progress
          }));
        }
      );

      // Guardar en memoria para el paso de carga
      this.currentCompressionResult = result;
    } catch (error: any) {
      throw new Error(`Error comprimiendo evidencia: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────
  // Paso 4: Cargar archivo
  // ─────────────────────────────────────────

  private async step4UploadAttachment(): Promise<void> {
    this.setState(EvidenceUploadState.UPLOADING_ATTACHMENT, 'Subiendo archivo a Azure DevOps...');

    if (!this.currentValidatedPlan) {
      throw new Error('No hay plan validado para cargar');
    }

    const compressionResult = this.currentCompressionResult;
    if (!compressionResult) {
      throw new Error('No hay archivo comprimido disponible');
    }

    try {
      const headers = await this.buildAuthHeaders();
      const fileBlobBase64 = await this.blobToBase64(compressionResult.zipBlob);

      const response = await firstValueFrom(
        this.http.post<any>(
          `${this.baseUrl}/work-items?workItemId=${encodeURIComponent(this.currentValidatedPlan.planId)}&action=attachments`,
          {
            fileName: compressionResult.fileName,
            areaPath: this.currentValidatedPlan.areaPath,
            fileBlob: fileBlobBase64
          },
          { headers }
        )
      );

      if (!response || !response.url) {
        throw new Error('Respuesta inválida del servidor al cargar archivo');
      }

      this.currentAttachmentId = response.id;
      this.currentAttachmentUrl = response.url;

      this.updateProgress(p => ({
        ...p,
        attachmentUrl: response.url,
        attachmentId: response.id
      }));
    } catch (error: any) {
      throw new Error(`Error cargando archivo: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────
  // Paso 5: Vincular evidencia
  // ─────────────────────────────────────────

  private async step5LinkAttachment(): Promise<void> {
    this.setState(EvidenceUploadState.LINKING_ATTACHMENT, 'Vinculando evidencia al plan...');

    if (!this.currentValidatedPlan) {
      throw new Error('No hay plan validado para vincular');
    }

    if (!this.currentAttachmentUrl) {
      throw new Error('No hay URL de adjunto para vincular');
    }

    try {
      const headers = await this.buildAuthHeaders();
      
      const response = await firstValueFrom(
        this.http.patch<any>(
          `${this.baseUrl}/work-items?workItemId=${encodeURIComponent(this.currentValidatedPlan.planId)}&action=link-attachment`,
          {
            attachmentUrl: this.currentAttachmentUrl,
            planTitle: this.currentValidatedPlan.planTitle
          },
          { headers }
        )
      );

      if (!response || !response.success) {
        throw new Error(response?.error || 'Error al vincular');
      }
    } catch (error: any) {
      throw new Error(`Error vinculando archivo: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────
  // Utilidades
  // ─────────────────────────────────────────

  private setState(state: EvidenceUploadState, resultMessage: string): void {
    this.ngZone.run(() => {
      this.updateProgress(p => ({
        ...p,
        state,
        resultMessage,
        error: undefined
      }));
    });
  }

  private updateProgress(updater: (prev: EvidenceUploadProgress) => EvidenceUploadProgress): void {
    this.ngZone.run(() => {
      const current = this.progressSubject.value;
      const updated = updater(current);
      this.progressSubject.next(updated);
    });
  }

  private getOrCreateRetryAttempt(step: RetryableStep): RetryAttempt {
    if (!this.retryAttempts.has(step)) {
      this.retryAttempts.set(step, {
        step,
        attempt: 0,
        timestamp: Date.now()
      });
    }
    return this.retryAttempts.get(step)!;
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('No fue posible convertir el archivo ZIP a base64'));
      reader.readAsDataURL(blob);
    });
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
      throw new Error('Sesión inválida o expirada.');
    }

    return new HttpHeaders({ Authorization: `Bearer ${session.access_token}` });
  }
}
