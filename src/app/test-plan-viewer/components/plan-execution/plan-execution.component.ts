import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ImageEditorComponent } from '../image-editor/image-editor.component';
import { ConfirmationModalComponent } from '../../../confirmation-modal/confirmation-modal.component';
import { HUData, PlanExecution, ImageEvidence, ExecutionStep, DetailedTestCase, TestCaseExecution } from '../../../models/hu-data.model';
import { ExecutionStorageService } from '../../../services/core/execution-storage.service';
import { ToastService } from '../../../services/core/toast.service';
import { ExportService } from '../../../services/export/export.service';
import { HuSyncService } from '../../../services/core/hu-sync.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-plan-execution',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageEditorComponent, ConfirmationModalComponent],
  templateUrl: './plan-execution.component.html',
  styleUrls: ['./plan-execution.component.css']
})
export class PlanExecutionComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef;
  private readonly EXEC_CONTEXT_KEY = 'execute_plan_context_v2';

  hu: HUData | null = null;
  testPlanId: string = '';
  testPlanTitle: string = '';
  execution: PlanExecution | null = null;
  activeTestCaseIndex = 0;
  activeStepIndex = 0;
  selectedImage: ImageEvidence | null = null;
  showImageEditor = false;
  showImageViewer = false;
  showDeleteModal = false;
  editingImageId: string | null = null;
  previewImage: ImageEvidence | null = null;
  pendingImageBase64: string = '';
  pendingOriginalBase64: string = '';
  pendingImageNaturalWidth: number = 1280;
  pendingImageNaturalHeight: number = 720;
  private huSyncSubscription: Subscription | null = null;

  stats: any = null;

  constructor(
    private router: Router,
    private storageService: ExecutionStorageService,
    private toastService: ToastService,
    private exportService: ExportService,
    private huSyncService: HuSyncService
  ) { }

  async ngOnInit(): Promise<void> {
    const state = this.router.getCurrentNavigation()?.extras.state || history.state;
    const restoredContext = this.restoreExecutionContext();

    if (state?.hu || restoredContext) {
      if (state?.hu) {
        this.hu = state.hu as HUData;
        this.testPlanId = state.testPlanId || '';
        this.testPlanTitle = state.testPlanTitle || '';
      } else if (restoredContext) {
        this.testPlanId = restoredContext.testPlanId;
        this.testPlanTitle = restoredContext.testPlanTitle;
      }

      // Verificar si hay una ejecución existente
      const allExecutions = await this.storageService
        .getExecutionsByHU((this.hu?.id || restoredContext?.huId || ''));

      const existingExecutions = allExecutions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      const preferredExecution = restoredContext?.executionId
        ? existingExecutions.find((exec) => exec.id === restoredContext.executionId)
        : null;

      if (existingExecutions.length > 0) {
        this.execution = preferredExecution || existingExecutions[0];

        if (!this.hu) {
          this.hu = this.buildHuFromExecution(this.execution);
        }
      } else {
        // Crear nueva ejecución
        await this.createNewExecution();
      }

      if (restoredContext) {
        this.activeTestCaseIndex = restoredContext.activeTestCaseIndex;
        this.activeStepIndex = restoredContext.activeStepIndex;
      }
      this.normalizeActiveSelection();

      // IMPORTANT: Hydrate FIRST, then reconcile and subscribe.
      // This way, reconciliation sees the full image data (base64) instead of empty placeholders.
      await this.hydrateExecutionEvidence();

      this.applyLatestHuSnapshot();
      this.subscribeToHuUpdates();

      this.persistExecutionContext();

      await this.updateStats();
    } else {
      this.toastService.warning('No se encontró la HU seleccionada');
      this.goBack();
    }
  }

  ngOnDestroy(): void {
    this.huSyncSubscription?.unsubscribe();
  }

  private async createNewExecution(): Promise<void> {
    if (!this.hu?.detailedTestCases) return;

    this.execution = this.storageService.createPlanExecution(
      this.hu.id,
      this.hu.title,
      this.hu.detailedTestCases
    );
    await this.storageService.saveExecution(this.execution);
  }

  get currentTestCase() {
    return this.execution?.testCases[this.activeTestCaseIndex];
  }

  get currentStep() {
    return this.currentTestCase?.steps[this.activeStepIndex];
  }

  selectTestCase(index: number): void {
    if (index >= 0 && index < (this.execution?.testCases.length || 0)) {
      this.activeTestCaseIndex = index;
      this.activeStepIndex = 0;
      this.editingImageId = null;
      this.showImageEditor = false;
      this.persistExecutionContext();
    }
  }

  selectStep(index: number): void {
    if (index >= 0 && index < (this.currentTestCase?.steps.length || 0)) {
      this.activeStepIndex = index;
      this.editingImageId = null;
      this.showImageEditor = false;
      this.persistExecutionContext();
    }
  }

  async updateStepStatus(status: 'pending' | 'in-progress' | 'completed' | 'failed'): Promise<void> {
    if (!this.execution || !this.currentTestCase || !this.currentStep) return;

    await this.storageService.updateStepStatus(
      this.execution.id,
      this.currentTestCase.testCaseId,
      this.currentStep.stepId,
      status
    );

    this.currentStep.status = status;
    await this.autoSaveExecutionState();
    await this.updateStats();
  }

  async updateGridConfig(cols: any, rows: any): Promise<void> {
    if (!this.currentStep) return;
    this.currentStep.evidenceColumns = Math.min(10, Math.max(1, Number(cols) || 1));
    this.currentStep.evidenceRows = Math.min(10, Math.max(1, Number(rows) || 1));
    await this.autoSaveExecutionState();
  }

  getGridCells(step: ExecutionStep): number[] {
    const cols = Math.max(1, step.evidenceColumns ?? 1);
    const rows = Math.max(1, step.evidenceRows ?? 1);
    const total = cols * rows;
    return Array.from({ length: total }, (_, i) => i);
  }

  nextStep(): void {
    if (!this.currentTestCase) return;

    if (this.activeStepIndex < this.currentTestCase.steps.length - 1) {
      this.selectStep(this.activeStepIndex + 1);
    } else if (this.activeTestCaseIndex < (this.execution?.testCases.length || 0) - 1) {
      this.selectTestCase(this.activeTestCaseIndex + 1);
    } else {
      this.toastService.success('¡Has completado todos los pasos!');
    }
  }

  previousStep(): void {
    if (this.activeStepIndex > 0) {
      this.selectStep(this.activeStepIndex - 1);
    } else if (this.activeTestCaseIndex > 0) {
      this.selectTestCase(this.activeTestCaseIndex - 1);
      const newTestCase = this.execution?.testCases[this.activeTestCaseIndex];
      if (newTestCase) {
        this.activeStepIndex = newTestCase.steps.length - 1;
      }
    }
  }

  triggerFileInput(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();

      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        this.addEvidenceAndOpenEditor(base64, 'archivo');
      };

      reader.readAsDataURL(file);
    }

    // Limpiar input
    input.value = '';
  }

  async pasteImageFromClipboard(): Promise<void> {
    try {
      if (!navigator?.clipboard?.read) {
        this.toastService.warning('Tu navegador no soporta pegar imágenes desde portapapeles');
        return;
      }

      const clipboardItems = await navigator.clipboard.read();

      for (const item of clipboardItems) {
        const imageType = item.types.find((type: string) => type.startsWith('image/'));
        if (!imageType) continue;

        const blob = await item.getType(imageType);
        const base64 = await this.blobToDataURL(blob);
        this.addEvidenceAndOpenEditor(base64, 'portapapeles');
        return;
      }

      this.toastService.warning('No se encontró ninguna imagen en el portapapeles');
    } catch (error) {
      this.toastService.error('No se pudo leer el portapapeles. Verifica permisos del navegador');
    }
  }

  private blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo convertir la imagen'));
      reader.readAsDataURL(blob);
    });
  }

  private async addEvidenceAndOpenEditor(base64: string, source: 'archivo' | 'portapapeles'): Promise<void> {
    if (!this.currentStep || !this.execution) {
      this.toastService.warning('No hay un paso activo para guardar la evidencia');
      return;
    }

    const img = new Image();
    img.onload = async () => {
      const evidenceId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newImage: ImageEvidence = {
        id: evidenceId,
        stepId: this.currentStep!.stepId,
        fileName: `evidencia_${Date.now()}.png`,
        base64Data: base64,
        originalBase64: base64,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        timestamp: Date.now()
      };

      this.currentStep!.evidences.push(newImage);
      await this.storageService.saveImage(newImage);
      await this.autoSaveExecutionState();

      this.pendingImageBase64 = base64;
      this.pendingOriginalBase64 = base64;
      this.pendingImageNaturalWidth = img.naturalWidth;
      this.pendingImageNaturalHeight = img.naturalHeight;
      this.selectedImage = newImage;
      this.editingImageId = evidenceId;
      this.showImageEditor = true;

      await this.updateStats();
      this.toastService.success(`Imagen guardada automáticamente desde ${source}`);
    };

    img.onerror = () => {
      this.toastService.error('No se pudo procesar la imagen');
    };

    img.src = base64;
  }

  openImageEditor(image: ImageEvidence): void {
    this.pendingImageBase64 = image.base64Data;
    this.pendingOriginalBase64 = image.originalBase64 || image.base64Data;
    this.selectedImage = image;
    this.showImageEditor = true;
    this.editingImageId = image.id;
  }

  openImageViewer(image: ImageEvidence): void {
    this.previewImage = image;
    this.showImageViewer = true;
  }

  async onImageSaved(data: { base64: string, stateJson: string }): Promise<void> {
    if (!this.currentStep || !this.execution) return;

    if (this.editingImageId) {
      // Actualizar imagen existente
      const imageIndex = this.currentStep.evidences.findIndex((img: ImageEvidence) => img.id === this.editingImageId);
      if (imageIndex >= 0) {
        const updatedImage = this.currentStep.evidences[imageIndex];
        updatedImage.base64Data = data.base64;
        updatedImage.originalBase64 = updatedImage.originalBase64 || this.pendingOriginalBase64 || updatedImage.base64Data;
        updatedImage.editorStateJson = data.stateJson;
        updatedImage.timestamp = Date.now();
        await this.storageService.saveImage(updatedImage);
      }
    } else {
      // Crear nueva imagen
      const newImage: ImageEvidence = {
        id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        stepId: this.currentStep.stepId,
        fileName: `evidencia_${Date.now()}.png`,
        base64Data: data.base64,
        originalBase64: this.pendingImageBase64,
        editorStateJson: data.stateJson,
        naturalWidth: this.pendingImageNaturalWidth,
        naturalHeight: this.pendingImageNaturalHeight,
        timestamp: Date.now()
      };
      this.currentStep.evidences.push(newImage);
      await this.storageService.saveImage(newImage);
    }

    this.execution.updatedAt = Date.now();
    await this.autoSaveExecutionState();

    this.showImageEditor = false;
    this.editingImageId = null;
    this.selectedImage = null;
    this.toastService.success('Imagen guardada exitosamente');
    await this.updateStats();
  }

  async deleteImage(imageId: string): Promise<void> {
    if (!this.currentStep) return;

    const index = this.currentStep.evidences.findIndex((img: ImageEvidence) => img.id === imageId);
    if (index >= 0) {
      this.currentStep.evidences.splice(index, 1);
      await this.storageService.deleteImage(imageId);

      if (this.execution) {
        await this.autoSaveExecutionState();
      }

      this.toastService.success('Imagen eliminada');
      await this.updateStats();
    }
  }

  async exportToDOCX(): Promise<void> {
    if (!this.execution) return;

    try {
      await this.exportService.exportExecutionToDOCX(this.execution, this.hu);
      this.toastService.success('Ejecución exportada a DOCX exitosamente');
    } catch (error) {
      this.toastService.error('Error al exportar la ejecución');
    }
  }

  async saveExecution(): Promise<void> {
    if (!this.execution) return;

    await this.autoSaveExecutionState();
    this.toastService.success('Ejecución guardada');
  }

  private async autoSaveExecutionState(): Promise<void> {
    if (!this.execution) return;

    await this.syncExecutionImagesToStorage();
    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecution(this.execution);
    this.persistExecutionContext();
  }

  private async hydrateExecutionEvidence(): Promise<void> {
    if (!this.execution) return;

    for (const testCase of this.execution.testCases) {
      for (const step of testCase.steps) {
        // En lugar de buscar por stepId (que puede cambiar), buscamos cada imagen por su propio ID estable
        const currentEvidences = Array.isArray(step.evidences) ? step.evidences : [];
        const hydratedEvidences: ImageEvidence[] = [];

        for (const evidence of currentEvidences) {
          if (evidence.id) {
            const dbImage = await this.storageService.getImage(evidence.id);
            if (dbImage) {
              hydratedEvidences.push({
                ...evidence,
                base64Data: dbImage.base64Data,
                originalBase64: dbImage.originalBase64 || dbImage.base64Data,
                editorStateJson: dbImage.editorStateJson
              });
            } else {
              // Si no está en DB por alguna razón, conservar lo que tenemos
              hydratedEvidences.push(evidence);
            }
          }
        }

        step.evidences = hydratedEvidences;
      }
    }

    await this.autoSaveExecutionState();
  }

  private async syncExecutionImagesToStorage(): Promise<void> {
    if (!this.execution) return;

    for (const testCase of this.execution.testCases) {
      for (const step of testCase.steps) {
        for (const evidence of (step.evidences || [])) {
          await this.storageService.saveImage(evidence);
        }
      }
    }
  }

  async startFreshExecution(): Promise<void> {
    if (!this.hu?.detailedTestCases) return;

    this.execution = this.storageService.createPlanExecution(
      this.hu.id,
      this.hu.title,
      this.hu.detailedTestCases
    );
    await this.storageService.saveExecution(this.execution);

    this.activeTestCaseIndex = 0;
    this.activeStepIndex = 0;
    this.persistExecutionContext();
    await this.updateStats();
    this.toastService.success('Nueva ejecución iniciada');
  }

  async loadExecution(executionId: string): Promise<void> {
    const loaded = await this.storageService.getExecution(executionId);
    if (loaded) {
      this.execution = loaded;
      this.activeTestCaseIndex = 0;
      this.activeStepIndex = 0;
      this.persistExecutionContext();
      await this.updateStats();
      this.toastService.success('Ejecución cargada');
    }
  }

  deleteExecution(): void {
    if (!this.execution) return;
    this.showDeleteModal = true;
  }

  async confirmDeleteExecution(): Promise<void> {
    if (!this.execution) return;

    await this.storageService.deleteExecution(this.execution.id);
    this.execution = null;
    this.stats = null;
    sessionStorage.removeItem(this.EXEC_CONTEXT_KEY);
    this.showDeleteModal = false;
    this.toastService.success('Ejecución eliminada al 100%');
  }

  private async updateStats(): Promise<void> {
    if (!this.execution) return;
    this.stats = await this.storageService.getExecutionStats(this.execution.id);
  }

  private async applyLatestHuSnapshot(): Promise<void> {
    if (!this.hu?.id) return;

    const latestHu = this.huSyncService.getLatestHu(this.hu.id);
    if (!latestHu) return;

    await this.applyHuChanges(latestHu, false);
  }

  private subscribeToHuUpdates(): void {
    if (!this.hu?.id) return;

    this.huSyncSubscription?.unsubscribe();
    this.huSyncSubscription = this.huSyncService.watchHu(this.hu.id).subscribe(async (updatedHu) => {
      await this.applyHuChanges(updatedHu, true);
    });
  }

  private async applyHuChanges(updatedHu: HUData, notify: boolean): Promise<void> {
    this.hu = updatedHu;

    if (!updatedHu.detailedTestCases || !this.execution) {
      return;
    }

    this.execution.huTitle = updatedHu.title;
    this.execution.testCases = await this.reconcileExecutionWithHu(
      this.execution.testCases,
      updatedHu.detailedTestCases
    );

    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecution(this.execution);
    this.persistExecutionContext();
    this.normalizeActiveSelection();
    await this.updateStats();

    if (notify) {
      this.toastService.info('Ejecución actualizada en línea con los cambios de Editar/Refinar IA');
    }
  }

  private async reconcileExecutionWithHu(
    currentCases: TestCaseExecution[],
    updatedCases: DetailedTestCase[]
  ): Promise<TestCaseExecution[]> {
    const evidenceIdsToKeep = new Set<string>();

    // Primero, construir los nuevos casos reconciliados
    const reconciledCases: TestCaseExecution[] = (updatedCases || []).map((tc, tcIndex) => {
      // Intentar buscar el caso de prueba actual por título para mayor estabilidad si hay reordenamientos
      let currentTc = currentCases.find(c => c.title.trim() === tc.title.trim());

      // Si no hay coincidencia por título (ej: se editó el título), usar el índice como fallback
      if (!currentTc) {
        currentTc = currentCases[tcIndex];
      }

      const currentSteps = currentTc?.steps || [];

      const reconciledSteps: ExecutionStep[] = (tc.steps || []).map((step, stepIndex) => {
        const matchedStep = this.matchStep(currentSteps, step.accion, stepIndex);

        const stepResult: ExecutionStep = {
          stepId: matchedStep?.stepId || `${tc.title.replace(/\s+/g, '_')}_step_${stepIndex}`,
          numero_paso: step.numero_paso,
          accion: step.accion,
          status: matchedStep?.status || 'pending',
          notes: matchedStep?.notes || '',
          evidences: matchedStep?.evidences || [],
          evidenceColumns: matchedStep?.evidenceColumns,
          evidenceRows: matchedStep?.evidenceRows
        };

        // Track evidence IDs that we are keeping
        if (stepResult.evidences) {
          stepResult.evidences.forEach(ev => evidenceIdsToKeep.add(ev.id));
        }

        return stepResult;
      });

      return {
        testCaseId: currentTc?.testCaseId || `tc_${tcIndex}`,
        title: tc.title,
        preconditions: tc.preconditions,
        steps: reconciledSteps,
        expectedResults: tc.expectedResults,
        startedAt: currentTc?.startedAt,
        completedAt: currentTc?.completedAt,
        notes: currentTc?.notes,
        status: currentTc?.status || 'pending'
      };
    });

    // Ahora, identificar evidencias huérfanas
    const orphanedEvidenceIds: string[] = [];
    currentCases.forEach(tc => {
      tc.steps.forEach(step => {
        if (step.evidences) {
          step.evidences.forEach(ev => {
            if (!evidenceIdsToKeep.has(ev.id)) {
              orphanedEvidenceIds.push(ev.id);
            }
          });
        }
      });
    });

    // Limpiar evidencias huérfanas en segundo plano si hay alguna
    if (orphanedEvidenceIds.length > 0) {
      console.log(`🧹 Reconciliador detectó ${orphanedEvidenceIds.length} evidencias huérfanas a eliminar:`, orphanedEvidenceIds);
      void this.storageService.cleanupOrphanedImages(orphanedEvidenceIds).catch(err => {
        console.error('❌ Error limpiando evidencias huérfanas:', err);
      });
    }

    return reconciledCases;
  }

  private matchStep(currentSteps: ExecutionStep[], action: string, stepIndex: number): ExecutionStep | null {
    if (!currentSteps || currentSteps.length === 0) return null;

    const normalize = (value: string) => (value || '').trim().toLowerCase();
    const targetAction = normalize(action);

    // 1. Coincidencia exacta por acción
    const byAction = currentSteps.find((step) => normalize(step.accion) === targetAction);
    if (byAction) return byAction;

    // 2. Coincidencia difusa (si la acción contiene la otra o es muy similar)
    const fuzzyMatch = currentSteps.find(step => {
      const stepAction = normalize(step.accion);
      return stepAction.includes(targetAction) || targetAction.includes(stepAction);
    });
    if (fuzzyMatch) return fuzzyMatch;

    // 3. Fallback por índice si es razonable
    return currentSteps[stepIndex] || null;
  }

  private normalizeActiveSelection(): void {
    if (!this.execution?.testCases?.length) {
      this.activeTestCaseIndex = 0;
      this.activeStepIndex = 0;
      return;
    }

    if (this.activeTestCaseIndex >= this.execution.testCases.length) {
      this.activeTestCaseIndex = this.execution.testCases.length - 1;
    }

    const currentTc = this.execution.testCases[this.activeTestCaseIndex];
    if (!currentTc?.steps?.length) {
      this.activeStepIndex = 0;
      return;
    }

    if (this.activeStepIndex >= currentTc.steps.length) {
      this.activeStepIndex = currentTc.steps.length - 1;
    }
  }

  goBack(): void {
    this.persistExecutionContext();
    this.router.navigate(['/viewer/hu-scenarios'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId,
        testPlanTitle: this.testPlanTitle
      }
    });
  }

  private persistExecutionContext(): void {
    const huId = this.hu?.id || this.execution?.huId;
    if (!huId) return;

    try {
      localStorage.setItem(this.EXEC_CONTEXT_KEY, JSON.stringify({
        huId,
        testPlanId: this.testPlanId,
        testPlanTitle: this.testPlanTitle,
        executionId: this.execution?.id || '',
        activeTestCaseIndex: this.activeTestCaseIndex,
        activeStepIndex: this.activeStepIndex,
        updatedAt: Date.now()
      }));
    } catch {
      // no-op
    }
  }

  private restoreExecutionContext(): {
    huId: string;
    testPlanId: string;
    testPlanTitle: string;
    executionId: string;
    activeTestCaseIndex: number;
    activeStepIndex: number;
  } | null {
    try {
      const raw = localStorage.getItem(this.EXEC_CONTEXT_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed?.huId) return null;

      return {
        huId: parsed.huId,
        testPlanId: parsed.testPlanId || '',
        testPlanTitle: parsed.testPlanTitle || '',
        executionId: parsed.executionId || '',
        activeTestCaseIndex: Number.isFinite(parsed.activeTestCaseIndex) ? parsed.activeTestCaseIndex : 0,
        activeStepIndex: Number.isFinite(parsed.activeStepIndex) ? parsed.activeStepIndex : 0
      };
    } catch {
      return null;
    }
  }

  private buildHuFromExecution(execution: PlanExecution): HUData {
    return {
      id: execution.huId,
      title: execution.huTitle,
      sprint: '',
      originalInput: {
        generationMode: 'text',
        description: '',
        acceptanceCriteria: ''
      },
      detailedTestCases: (execution.testCases || []).map((tc) => ({
        title: tc.title,
        preconditions: tc.preconditions,
        steps: (tc.steps || []).map((step) => ({
          numero_paso: step.numero_paso,
          accion: step.accion
        })),
        expectedResults: tc.expectedResults
      }))
    };
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'in-progress':
        return 'status-in-progress';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-pending';
    }
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'completed':
        return '✓ Completado';
      case 'in-progress':
        return '⟳ En Progreso';
      case 'failed':
        return '✕ Falló';
      default:
        return '◯ Pendiente';
    }
  }
}
