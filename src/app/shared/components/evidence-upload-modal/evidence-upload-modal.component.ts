import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlanExecution } from '../../../models/hu-data.model';
import { HUData, TestRun } from '../../../models/hu-data.model';
import { 
  EvidenceUploadProgress, 
  ValidatedPlanInfo, 
  EvidenceUploadState,
  PlanValidationError,
  RetryableStep 
} from '../../../models/azure-devops-evidence.model';
import { EvidenceUploadOrchestrator } from '../../../services/export/evidence-upload-orchestrator.service';
import { AzureDevOpsEvidenceService } from '../../../services/integrations/azure-devops-evidence.service';
import { ToastService } from '../../../services/core/toast.service';
import { ExportService } from '../../../services/export/export.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-evidence-upload-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './evidence-upload-modal.component.html',
  styleUrls: ['./evidence-upload-modal.component.css']
})
export class EvidenceUploadModalComponent implements OnInit, OnDestroy {
  @Input() execution: PlanExecution | null = null;
  @Input() testRun: TestRun | null = null;
  @Input() huData: HUData | null = null;

  @Output() onClose = new EventEmitter<void>();
  @Output() onProcessing = new EventEmitter<{ isProcessing: boolean; message: string }>();

  // Estado del modal
  inputPlanId = '';
  inputFileName = 'Evidencia_EVC00057.zip';
  selectedFormats = { serenity: true, docx: false, pdf: false };
  isValidating = false;
  isUploading = false;
  planValidated = false;
  validatedPlan: ValidatedPlanInfo | null = null;
  validationError: PlanValidationError | null = null;
  uploadCompleted = false;
  uploadError = '';
  currentPhaseMessage = '';
  canRetryStep = false;

  private progress$ = new Subject<EvidenceUploadProgress>();
  private destroy$ = new Subject<void>();
  private lastFailedStep: RetryableStep | null = null;

  // Template variables para estados
  EvidenceUploadState = EvidenceUploadState;

  constructor(
    private orchestrator: EvidenceUploadOrchestrator,
    private evidenceService: AzureDevOpsEvidenceService,
    private toastService: ToastService,
    private exportService: ExportService
  ) {}

  ngOnInit(): void {
    // Monitorear progreso de carga
    this.progress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.updateProgress(progress);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  closeIfClickOutside(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  close(): void {
    if (!this.isValidating && !this.isUploading) {
      this.onClose.emit();
    }
  }

  async validatePlan(): Promise<void> {
    if (!this.inputPlanId.trim()) return;

    this.isValidating = true;
    this.validationError = null;
    this.onProcessing.emit({ isProcessing: true, message: 'Validando plan...' });

    try {
      console.log('[validatePlan] Iniciando validación para plan ID:', this.inputPlanId);
      
      // Llamar al servicio REAL de validación
      const result = await this.evidenceService.validateTestPlan(this.inputPlanId);
      
      console.log('[validatePlan] Plan validado:', result);
      
      this.validatedPlan = result;
      this.planValidated = true;
      this.toastService.success('Plan validado correctamente');
    } catch (error: any) {
      console.error('[validatePlan] Error:', error);
      
      this.validationError = error || {
        code: 'UNKNOWN',
        message: 'Error desconocido al validar el plan'
      };
      this.toastService.error(this.getValidationErrorMessage());
    } finally {
      this.isValidating = false;
      this.onProcessing.emit({ isProcessing: false, message: '' });
    }
  }

  async startUpload(): Promise<void> {
    if (!this.validatedPlan || !this.execution) {
      this.toastService.error('Falta información necesaria para la carga');
      return;
    }

    this.isUploading = true;
    this.uploadError = '';
    this.uploadCompleted = false;
    this.onProcessing.emit({ isProcessing: true, message: 'Generando evidencias...' });

    try {
      console.log('[startUpload] Iniciando carga para plan:', this.validatedPlan.planId);
      
      // Nombre del archivo ZIP indicado por el usuario en el modal
      const zipNameTemplate = (this.inputFileName || 'Evidencia.zip').trim();
      
      console.log('[startUpload] Nombre archivo ZIP:', zipNameTemplate);

      // Generar los documentos seleccionados (DOCX/PDF) como archivos extra
      const extraFiles = await this.buildExtraFiles();
      
      // Suscribirse al progreso
      this.orchestrator
        .watchProgress()
        .pipe(takeUntil(this.destroy$))
        .subscribe(progress => {
          console.log('[startUpload] Progreso:', progress);
          this.progress$.next(progress);
        });

      const effectiveTestRun = this.buildEffectiveTestRun();

      // Ejecutar flujo completo
      await this.orchestrator.executeFlow(
        this.validatedPlan!.planId,
        effectiveTestRun,
        zipNameTemplate,
        {
          formats: { ...this.selectedFormats },
          extraFiles
        }
      );

      console.log('[startUpload] ¡Flujo completado exitosamente!');
      
      this.uploadCompleted = true;
      this.toastService.success('Evidencias subidas y vinculadas correctamente');
    } catch (error: any) {
      console.error('[startUpload] Error:', error);
      
      this.uploadError = error?.message || 'Error desconocido al cargar las evidencias';
      this.toastService.error(this.uploadError);
      this.canRetryStep = true;
    } finally {
      this.isUploading = false;
      this.onProcessing.emit({ isProcessing: false, message: '' });
    }
  }

  private buildEffectiveTestRun(): TestRun {
    if (this.testRun?.executionId) {
      return this.testRun;
    }

    const executionId = this.execution?.id;
    if (!executionId) {
      throw new Error('No se encontró executionId para generar el reporte Serenity.');
    }

    const now = Date.now();
    return {
      id: this.testRun?.id || `adhoc-${executionId}`,
      name: this.testRun?.name || `Ejecución ${this.execution?.huTitle || 'manual'}`,
      huId: this.testRun?.huId || this.execution?.huId || '',
      huTitle: this.testRun?.huTitle || this.execution?.huTitle || 'HU',
      testPlanId: this.testRun?.testPlanId || this.validatedPlan?.planId || '',
      testPlanTitle: this.testRun?.testPlanTitle || this.validatedPlan?.planTitle || 'Plan',
      status: this.testRun?.status || 'In Progress',
      notes: this.testRun?.notes || '',
      tags: this.testRun?.tags || [],
      milestone: this.testRun?.milestone || '',
      selectedTestCaseIds: this.testRun?.selectedTestCaseIds || [],
      includeAllTestCases: this.testRun?.includeAllTestCases ?? true,
      totalTestCases: this.testRun?.totalTestCases || this.execution?.testCases?.length || 0,
      completedTestCases: this.testRun?.completedTestCases || 0,
      executionId,
      createdAt: this.testRun?.createdAt || now,
      updatedAt: this.testRun?.updatedAt || now
    };
  }

  resetToPlantId(): void {
    this.planValidated = false;
    this.validatedPlan = null;
    this.uploadError = '';
    this.uploadCompleted = false;
    this.inputPlanId = '';
  }

  /** Indica si al menos un formato de evidencia está seleccionado */
  hasSelectedFormat(): boolean {
    return this.selectedFormats.serenity || this.selectedFormats.docx || this.selectedFormats.pdf;
  }

  /** Genera los documentos DOCX/PDF seleccionados como archivos base64 para incluir en el ZIP */
  private async buildExtraFiles(): Promise<{ name: string; base64: string }[]> {
    const files: { name: string; base64: string }[] = [];
    if (!this.execution) return files;

    const baseName = (this.execution.huTitle || 'Ejecucion').replace(/[^\w\-]+/g, '_').slice(0, 60);

    if (this.selectedFormats.docx) {
      this.onProcessing.emit({ isProcessing: true, message: 'Generando documento Word...' });
      const blob = await this.exportService.exportExecutionToDOCX(this.execution, this.huData, undefined, true) as Blob;
      files.push({ name: `${baseName}.docx`, base64: await this.blobToBase64(blob) });
    }

    if (this.selectedFormats.pdf) {
      this.onProcessing.emit({ isProcessing: true, message: 'Generando documento PDF...' });
      const blob = await this.exportService.exportExecutionToPDF(this.execution, this.huData, undefined, true) as Blob;
      files.push({ name: `${baseName}.pdf`, base64: await this.blobToBase64(blob) });
    }

    return files;
  }

  /** Convierte un Blob a base64 (sin el prefijo data:) */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async retryLastStep(): Promise<void> {
    if (!this.lastFailedStep) return;

    this.isUploading = true;
    this.uploadError = '';
    this.onProcessing.emit({ isProcessing: true, message: 'Reintentando...' });

    try {
      await this.orchestrator.retryStep(this.lastFailedStep);
      this.uploadCompleted = true;
      this.toastService.success('Reintento exitoso');
    } catch (error: any) {
      this.uploadError = error?.message || 'Error al reintentar';
      this.toastService.error(this.uploadError);
    } finally {
      this.isUploading = false;
      this.onProcessing.emit({ isProcessing: false, message: '' });
    }
  }

  getZipPreview(): string {
    if (!this.inputPlanId && !this.validatedPlan?.planId) return '';
    const planId = this.validatedPlan?.planId || this.inputPlanId;
    const timestamp = new Date().toISOString().replace(/[-:\.Z]/g, '').slice(0, 14);
    return `Evidencia_${planId}_${timestamp}.zip`;
  }

  getValidationErrorMessage(): string {
    if (!this.validationError) return '';
    
    const messages: { [key: string]: string } = {
      'EMPTY_ID': 'El ID del plan no puede estar vacío',
      'INVALID_FORMAT': 'El formato del ID no es válido. Debe ser numérico',
      'NOT_FOUND': 'El plan no existe en Azure DevOps',
      'UNAUTHORIZED': 'No tiene permisos para acceder a este plan',
      'INVALID_RESPONSE': 'La respuesta de Azure DevOps no es válida',
      'NO_AREA_PATH': 'El plan no tiene un área asignada',
      'CANNOT_EXTRACT_PROJECT_ID': 'No se puede extraer el ID del proyecto',
      'INVALID_WORK_ITEM_TYPE': 'El Work Item no es un plan de pruebas válido',
      'NETWORK_ERROR': 'Error de conexión con Azure DevOps'
    };

    return messages[this.validationError.code] || this.validationError.message;
  }

  isStepActive(state: string): boolean {
    // Comparar con estado actual del progreso
    return false; // TODO: Implementar comparación real
  }

  isStepCompleted(state: string): boolean {
    // Verificar si paso ya fue completado
    return false; // TODO: Implementar comparación real
  }

  getProgressPercentage(): number {
    // Calcular basado en estado actual
    return 0; // TODO: Implementar cálculo real
  }

  private updateProgress(progress: EvidenceUploadProgress): void {
    console.log('[updateProgress] Estado:', progress.state);
    
    // Actualizar mensaje de fase
    if (progress.serenityProgress?.phase) {
      this.currentPhaseMessage = `${progress.serenityProgress.phase}... ${progress.serenityProgress.percentage || 0}%`;
    } else if (progress.compressionProgress) {
      this.currentPhaseMessage = `Comprimiendo... ${progress.compressionProgress.filesProcessed || 0}/${progress.compressionProgress.totalFiles || 0}`;
    } else if (progress.uploadProgress) {
      this.currentPhaseMessage = `Cargando... ${progress.uploadProgress.percentage || 0}%`;
    } else {
      this.currentPhaseMessage = progress.state;
    }
    
    if (progress.state === EvidenceUploadState.FAILED) {
      this.uploadError = 'Error en la carga de evidencias';
      this.canRetryStep = true;
    } else if (progress.state === EvidenceUploadState.COMPLETED) {
      this.uploadCompleted = true;
    }
  }
}
