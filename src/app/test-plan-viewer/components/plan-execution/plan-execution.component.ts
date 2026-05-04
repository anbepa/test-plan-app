import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import * as XLSX from 'xlsx';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ImageEditorComponent } from '../image-editor/image-editor.component';
import { DataEditorComponent } from '../data-editor/data-editor.component';
import { ConfirmationModalComponent } from '../../../confirmation-modal/confirmation-modal.component';
import { HUData, PlanExecution, AssetEvidence, ExecutionStep, DetailedTestCase, TestCaseExecution } from '../../../models/hu-data.model';
import { ExecutionStorageService } from '../../../services/database/execution-storage-supabase.service';
import { ToastService } from '../../../services/core/toast.service';
import { ExportService } from '../../../services/export/export.service';
import { HuSyncService } from '../../../services/core/hu-sync.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-plan-execution',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageEditorComponent, DataEditorComponent, ConfirmationModalComponent],
  templateUrl: './plan-execution.component.html',
  styleUrls: ['./plan-execution.component.css']
})
export class PlanExecutionComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef;
  @ViewChild('csvInput') csvInput!: ElementRef;
  private readonly EXEC_CONTEXT_KEY = 'execute_plan_context_v2';

  hu: HUData | null = null;
  testPlanId: string = '';
  testPlanTitle: string = '';
  origin: string = 'test-runs';
  private testRunId: string = '';
  execution: PlanExecution | null = null;
  activeTestCaseIndex = 0;
  activeStepIndex = 0;
  selectedImage: AssetEvidence | null = null;
  showImageEditor = false;
  showImageViewer = false;
  showDataEditor = false;
  showDeleteModal = false;
  showUploadMenu = false;
  uploadMenuPos: { top: number; left: number } = { top: 0, left: 0 };

  openUploadMenu(event: MouseEvent): void {
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.uploadMenuPos = { top: rect.bottom + 6, left: rect.right };
    this.showUploadMenu = !this.showUploadMenu;
  }
  editingImageId: string | null = null;
  previewImage: AssetEvidence | null = null;
  pendingImageBase64: string = '';
  pendingOriginalBase64: string = '';
  pendingTabularData: any[][] = [];
  pendingHasHeader: boolean = true;
  pendingAssetType: 'image' | 'csv' = 'image';
  pendingImageNaturalWidth: number = 1280;
  pendingImageNaturalHeight: number = 720;
  isParsingFile = false;
  hasUnsavedChanges = false;
  isLoading = true;
  isHydratingEvidence = false;
  private huSyncSubscription: Subscription | null = null;
  /** Timestamp de cuando el componente terminó de cargar — filtra emits stale del BehaviorSubject */
  private componentLoadedAt: number = 0;

  stats: any = null;

  // ── New accordion / tab state ──
  activeTab: 'test-cases' | 'summary' = 'test-cases';
  statusFilter: string = 'all';
  searchQuery: string = '';
  expandedTestCaseIndex: number = -1;

  get filteredTestCases(): TestCaseExecution[] {
    if (!this.execution) return [];
    return this.execution.testCases.filter(tc => {
      const matchesStatus = this.statusFilter === 'all' || this.getTestCaseStatus(tc) === this.statusFilter;
      const matchesSearch = !this.searchQuery || tc.title.toLowerCase().includes(this.searchQuery.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }

  constructor(
    private router: Router,
    private storageService: ExecutionStorageService,
    private toastService: ToastService,
    private exportService: ExportService,
    private huSyncService: HuSyncService,
    private cdr: ChangeDetectorRef
  ) { }

  async ngOnInit(): Promise<void> {
    this.isLoading = true;
    try {
      const state = this.router.getCurrentNavigation()?.extras.state || history.state;
      const restoredContext = this.restoreExecutionContext();

      if (state?.hu || restoredContext) {
      if (state?.hu) {
        this.hu = state.hu as HUData;
        this.testPlanId = state.testPlanId || '';
        this.testPlanTitle = state.testPlanTitle || '';
        this.origin = state.origin || 'test-runs';
        this.testRunId = state.testRunId || '';
      } else if (restoredContext) {
        this.testPlanId = restoredContext.testPlanId;
        this.testPlanTitle = restoredContext.testPlanTitle;
        this.origin = restoredContext.origin || 'test-runs';
        this.testRunId = restoredContext.testRunId || '';
      }

      const forceNew = state?.forceNewExecution === true;

      if (forceNew && this.hu) {
        // New test run: create a fresh execution from scratch
        await this.createNewExecution();
        if (this.execution) {
          this.storageService.setActiveExecutionId(this.execution.id);
          // Link execution back to the test run
          if (state?.testRunId) {
            this.linkExecutionToTestRun(state.testRunId, this.execution.id);
          }
        }
      } else {
      // Verificar si hay una ejecución existente
      const allExecutions = await this.storageService
        .getExecutionsByHU((this.hu?.id || restoredContext?.huId || ''));

      const existingExecutions = allExecutions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      const preferredExecution = restoredContext?.executionId
        ? existingExecutions.find((exec) => exec.id === restoredContext.executionId)
        : (state?.testRunId
            ? existingExecutions.find((exec) => exec.id === state.testRunId)
            : null);

      if (existingExecutions.length > 0) {
        this.execution = preferredExecution || existingExecutions[0];
        this.storageService.setActiveExecutionId(this.execution.id);

        if (!this.hu || !this.hu.detailedTestCases || this.hu.detailedTestCases.length === 0) {
          this.hu = this.buildHuFromExecution(this.execution);
        }
      } else {
        // Crear nueva ejecución
        await this.createNewExecution();
        if (this.execution) {
          this.storageService.setActiveExecutionId(this.execution.id);
        }
      }
      }

      if (restoredContext) {
        this.activeTestCaseIndex = restoredContext.activeTestCaseIndex;
        this.activeStepIndex = restoredContext.activeStepIndex;
      }
      this.normalizeActiveSelection();

      // Skip HU sync when execution was created with a filtered subset of test cases
      if (!forceNew) {
        // AWAIT para evitar condición de carrera con el debounce de saveExecution
        await this.applyLatestHuSnapshot();
      }

      // Registrar timestamp DESPUÉS de cargar para que subscribeToHuUpdates
      // ignore el emit inmediato del BehaviorSubject (que es la versión stale de hu-scenarios)
      this.componentLoadedAt = Date.now();
      if (!forceNew) {
        this.subscribeToHuUpdates();
      }

      this.persistExecutionContext();

      await this.updateStats();
      // Show UI immediately — images load progressively in background
      this.isLoading = false;
      this.cdr.markForCheck();

      // Lazy load: build storage index once, then load only current step images
      this.storageService.buildStorageIndex().then(() => this.hydrateCurrentStep());
    } else {
      this.toastService.warning('No se encontró la HU seleccionada');
      this.goBack();
    }
    } catch (error) {
      console.error('Error en ngOnInit:', error);
      this.isLoading = false;
      this.toastService.error('Error al cargar la ejecución');
    }
  }

  ngOnDestroy(): void {
    this.huSyncSubscription?.unsubscribe();
  }

  trackByTestCaseId(index: number, testCase: TestCaseExecution): string {
    return testCase.testCaseId;
  }

  isTestCaseFullyCompleted(testCase: TestCaseExecution): boolean {
    if (!testCase?.steps?.length) return false;
    return testCase.steps.every(step => step.status === 'completed');
  }

  getTestCaseStatus(testCase: TestCaseExecution): 'pending' | 'in-progress' | 'completed' | 'failed' {
    if (!testCase?.steps?.length) return 'pending';
    const steps = testCase.steps;
    if (steps.every(s => s.status === 'completed')) return 'completed';
    if (steps.some(s => s.status === 'failed')) return 'failed';
    if (steps.some(s => s.status === 'in-progress' || s.status === 'completed')) return 'in-progress';
    return 'pending';
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

  /** Links an execution ID back to the test_runs table */
  private async linkExecutionToTestRun(testRunId: string, executionId: string): Promise<void> {
    try {
      const { data } = await this.storageService['supabaseClient'].supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (!userId) return;
      this.testRunId = testRunId;
      await this.storageService['supabaseClient'].supabase
        .from('test_runs')
        .update({ execution_id: executionId, updated_at: new Date().toISOString() })
        .eq('id', testRunId)
        .eq('user_id', userId);
    } catch (_) {}
  }

  /** Syncs derived status from execution testCases back to test_runs table */
  private async syncTestRunStatus(): Promise<void> {
    if (!this.testRunId || !this.execution) return;
    try {
      const { data } = await this.storageService['supabaseClient'].supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (!userId) return;

      const tcs = this.execution.testCases || [];
      const total = tcs.length;
      const completed = tcs.filter(tc => tc.status === 'completed').length;
      const hasFailed = tcs.some(tc => tc.status === 'failed');
      const allDone = total > 0 && completed === total;
      const hasInProgress = tcs.some(tc => tc.status === 'in-progress');

      let status = 'Pending';
      if (allDone) status = hasFailed ? 'Failed' : 'Completed';
      else if (hasInProgress || completed > 0) status = 'In Progress';

      await this.storageService['supabaseClient'].supabase
        .from('test_runs')
        .update({
          status,
          completed_test_cases: completed,
          total_test_cases: total,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.testRunId)
        .eq('user_id', userId);
    } catch (_) {}
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
      this.hydrateCurrentStep();
    }
  }

  selectStep(index: number): void {
    if (index >= 0 && index < (this.currentTestCase?.steps.length || 0)) {
      this.activeStepIndex = index;
      this.editingImageId = null;
      this.showImageEditor = false;
      this.persistExecutionContext();
      this.hydrateCurrentStep();
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
    this.hasUnsavedChanges = true;
    await this.autoSaveExecutionState();
    this.hasUnsavedChanges = false;
    
    // Auto-mark test case as completed if all steps are completed
    await this.updateTestCaseStatusIfAllStepsCompleted(this.currentTestCase);
    
    await this.updateStats();
    
    // Force change detection to update the completed class binding
    this.cdr.markForCheck();
  }

  private async updateTestCaseStatusIfAllStepsCompleted(testCase: TestCaseExecution): Promise<void> {
    if (!testCase || !testCase.steps || testCase.steps.length === 0) return;
    
    const allStepsCompleted = testCase.steps.every(step => step.status === 'completed');
    if (allStepsCompleted && testCase.status !== 'completed') {
      testCase.status = 'completed';
      testCase.completedAt = Date.now();
      
      // Guardar ejecución con el nuevo estado del test case
      if (this.execution) {
        this.execution.updatedAt = Date.now();
        await this.storageService.saveExecution(this.execution);
      }
      
      // Pequeño delay para asegurar que BD actualizó
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Forzar change detection en zona segura
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    }
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

  async nextStep(): Promise<void> {
    if (!this.currentTestCase) return;

    // Auto-save before moving to next step
    if (this.hasUnsavedChanges) {
      await this.autoSaveExecutionState();
      this.hasUnsavedChanges = false;
    }

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
      const newImage: AssetEvidence = {
        id: evidenceId,
        stepId: this.currentStep!.stepId,
        fileName: `evidencia_${Date.now()}.png`,
        type: 'image',
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
      this.showImageEditor = false;

      await this.updateStats();
      this.toastService.success(`Imagen guardada automáticamente desde ${source}`);
    };

    img.onerror = () => {
      this.toastService.error('No se pudo procesar la imagen');
    };

    img.src = base64;
  }

  openAssetEditor(asset: AssetEvidence): void {
    this.selectedImage = asset;
    this.editingImageId = asset.id;

    if (asset.type === 'image') {
      this.pendingImageBase64 = asset.base64Data || '';
      this.pendingOriginalBase64 = asset.originalBase64 || asset.base64Data || '';
      this.showImageEditor = true;
    } else if (asset.type === 'csv') {
      this.pendingTabularData = asset.tabularData || [];
      this.pendingHasHeader = asset.csvConfig?.hasHeader ?? true;
      this.showDataEditor = true;
    }
  }

  openImageViewer(asset: AssetEvidence): void {
    if (asset.type === 'image') {
      this.previewImage = asset;
      this.showImageViewer = true;
    } else {
      // Para CSV, el visualizador es el mismo editor en modo lectura o simplemente el editor
      this.openAssetEditor(asset);
    }
  }

  triggerCsvInput(): void {
    this.csvInput.nativeElement.click();
  }

  async onCsvSelected(event: any): Promise<void> {
    const file = event.target.files[0];
    if (!file || !this.currentStep) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.toastService.warning('Por favor selecciona un archivo .csv');
      return;
    }

    this.isParsingFile = true;
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const arrayBuffer = e.target.result as ArrayBuffer;

        // Try decoding as UTF-8 first, with fatal: true to catch errors
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
        } catch (e) {
          // If UTF-8 fails, use Windows-1252 (common in Excel/CSV Latin America)
          text = new TextDecoder('windows-1252').decode(arrayBuffer);
        }

        const workbook = XLSX.read(text, { type: 'string', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Use raw: true to get the numbers, then format them ourselves for consistency
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        // Format numbers and handle dates
        // Get headers first
        const headers = json[0] || [];

        // Format numbers and handle dates
        const formattedData = json.map((row, rIndex) => {
          if (rIndex === 0) return row; // Header row

          return (row || []).map((cell, cIndex) => {
            const header = String(headers[cIndex] || '').toLowerCase();

            if (typeof cell === 'number') {
              // Check if it's a date column but came as a number (Excel serial date)
              const isDateCol = header.includes('date') || header.includes('_at');

              if (isDateCol && cell > 30000) { // Likely an Excel serial date
                cell = new Date(Math.round((cell - 25569) * 86400 * 1000));
              } else {
                // NO format for account_number, nit, product_id, transactional_id, id_reference
                const isIdOrCode = header.includes('account') ||
                  header === 'nit' ||
                  header.includes('product_id') ||
                  header.includes('id_reference') ||
                  header.includes('transactional_id');

                if (isIdOrCode) return String(cell);

                // Format values and generic IDs with commas
                return cell.toLocaleString('en-US', { maximumFractionDigits: 3 });
              }
            }

            if (cell instanceof Date) {
              // Manually format to avoid UTC shifts
              const d = cell;
              const pad = (n: number) => n.toString().padStart(2, '0');
              const ms = d.getMilliseconds().toString().padStart(3, '0');
              const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
              const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
              return `${dateStr} ${timeStr}.${ms}`;
            }

            return cell !== undefined && cell !== null ? String(cell) : '';
          });
        });

        const evidenceId = `csv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newAsset: AssetEvidence = {
          id: evidenceId,
          stepId: this.currentStep!.stepId,
          fileName: file.name,
          type: 'csv',
          tabularData: formattedData,
          csvConfig: { hasHeader: true, delimiter: ',' },
          timestamp: Date.now()
        };

        this.currentStep!.evidences.push(newAsset);
        await this.storageService.saveImage(newAsset);
        await this.autoSaveExecutionState();

        this.pendingTabularData = formattedData;
        this.pendingHasHeader = true;
        this.selectedImage = newAsset;
        this.editingImageId = evidenceId;
        this.showDataEditor = true;

        await this.updateStats();
        this.toastService.success('CSV cargado y listo para editar');
      } catch (err) {
        console.error('Error parsing CSV', err);
        this.toastService.error('Error al procesar el archivo CSV');
      } finally {
        this.isParsingFile = false;
        this.cdr.detectChanges();
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  }

  async onDataSaved(result: { data: any[][], hasHeader: boolean, rowColors?: string[] }): Promise<void> {
    if (!this.currentStep || !this.selectedImage) return;

    const assetIndex = this.currentStep.evidences.findIndex(a => a.id === this.selectedImage!.id);
    if (assetIndex >= 0) {
      const asset = this.currentStep.evidences[assetIndex];
      asset.tabularData = result.data;
      asset.csvConfig = { ...asset.csvConfig, hasHeader: result.hasHeader, delimiter: ',' };
      asset.rowColors = result.rowColors;
      asset.timestamp = Date.now();
      await this.storageService.saveImage(asset);

      this.execution!.updatedAt = Date.now();
      await this.autoSaveExecutionState();

      this.showDataEditor = false;
      this.selectedImage = null;
      this.editingImageId = null;
      this.toastService.success('Datos y anotaciones guardados correctamente');
    }
  }

  async onImageSaved(data: { base64: string, stateJson: string }): Promise<void> {
    if (!this.currentStep || !this.execution) return;

    if (this.editingImageId) {
      // Actualizar imagen existente
      const imageIndex = this.currentStep.evidences.findIndex((img: AssetEvidence) => img.id === this.editingImageId);
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
      const newImage: AssetEvidence = {
        id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        stepId: this.currentStep.stepId,
        fileName: `evidencia_${Date.now()}.png`,
        type: 'image',
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
    await this.updateStats();
  }

  async deleteImage(imageId: string): Promise<void> {
    if (!this.currentStep) return;

    const index = this.currentStep.evidences.findIndex((img: AssetEvidence) => img.id === imageId);
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
      this.toastService.info('Preparando evidencias para descarga...');
      await this.storageService.hydrateAllEvidence(this.execution);
      await this.exportService.exportExecutionToDOCX(this.execution, this.hu);
      this.toastService.success('Ejecución exportada a DOCX exitosamente');
    } catch (error) {
      this.toastService.error('Error al exportar la ejecución');
    }
  }

  async saveExecution(): Promise<void> {
    if (!this.execution) return;

    await this.fastSaveExecutionState();
    this.toastService.success('Ejecución guardada');
  }

  private async autoSaveExecutionState(): Promise<void> {
    if (!this.execution) return;

    await this.syncExecutionImagesToStorage();
    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecution(this.execution);
    this.persistExecutionContext();
    this.syncTestRunStatus();
  }

  /** Guarda solo el JSON de la ejecución (estados/notas) sin re-subir imágenes al Storage. */
  private async fastSaveExecutionState(): Promise<void> {
    if (!this.execution) return;
    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecution(this.execution);
    this.persistExecutionContext();
  }

  private async hydrateExecutionEvidence(): Promise<void> {
    if (!this.execution) return;
    // Kept for export/compatibility — now delegates to full hydration
    await this.storageService.hydrateAllEvidence(this.execution);
  }

  /**
   * Lazy load: descarga solo las imágenes del paso activo.
   * Usa el índice de Storage (buildStorageIndex) para resolver rutas
   * sin re-listar carpetas. Reemplaza a hydrateEvidenceProgressively.
   */
  private hydrateCurrentStep(): void {
    if (!this.execution) return;
    const step = this.currentTestCase?.steps[this.activeStepIndex];
    if (!step?.evidences?.length) return;

    const hasMissingImages = step.evidences.some(
      ev => ev.id && (!ev.base64Data || !this.storageService.getCachedImage(ev.id))
    );
    if (!hasMissingImages) return;

    this.isHydratingEvidence = true;
    this.cdr.detectChanges();

    this.storageService.hydrateStepEvidence(step.evidences).then(hydrated => {
      step.evidences = hydrated;
      this.isHydratingEvidence = false;
      this.cdr.detectChanges();
    }).catch(() => {
      this.isHydratingEvidence = false;
      this.cdr.detectChanges();
    });
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
    this.storageService.setActiveExecutionId(this.execution.id);
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
      this.storageService.setActiveExecutionId(loaded.id);
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
    this.huSyncSubscription = this.huSyncService.watchHuWithTimestamp(this.hu.id).subscribe(async ({ hu: updatedHu, updatedAt }) => {
      // Ignorar emits que ocurrieron ANTES de que este componente terminara de cargar
      // (el BehaviorSubject emite inmediatamente el último valor al suscribirse)
      if (updatedAt <= this.componentLoadedAt) return;
      await this.applyHuChanges(updatedHu, true);
    });
  }

  private async applyHuChanges(updatedHu: HUData, notify: boolean): Promise<void> {
    this.hu = updatedHu;

    // Root Fix: If the update has NO test cases but we already have an execution with test cases,
    // IGNORE the update. This prevents stale/empty sync from clearing your progress.
    if (!updatedHu.detailedTestCases || updatedHu.detailedTestCases.length === 0) {
      if (this.execution && this.execution.testCases.length > 0) {
        return;
      }
    }

    if (!updatedHu.detailedTestCases || !this.execution) {
      return;
    }

    // ── Guard: skip reconciliation if HU structure hasn't changed ──
    // Compare titles+steps of HU against current execution to detect real changes.
    // Only consider HU test cases that already exist in the execution (handles filtered/partial executions)
    const executionTitles = new Set(this.execution.testCases.map(tc => tc.title.trim()));
    const relevantHuCases = updatedHu.detailedTestCases.filter(tc => executionTitles.has(tc.title.trim()));

    // If no overlap at all, skip to avoid wiping the execution
    if (relevantHuCases.length === 0 && this.execution.testCases.length > 0) {
      return;
    }

    const huFingerprint = relevantHuCases
      .map(tc => `${tc.title}|${(tc.steps || []).map(s => s.accion).join(',')}`)
      .join(';;');
    const execFingerprint = this.execution.testCases
      .map(tc => `${tc.title}|${(tc.steps || []).map(s => s.accion).join(',')}`)
      .join(';;');

    if (huFingerprint === execFingerprint) {
      // HU structure is identical — only update title if needed, no reconcile/save
      if (this.execution.huTitle !== updatedHu.title) {
        this.execution.huTitle = updatedHu.title;
        await this.fastSaveExecutionState();
      }
      return;
    }

    this.execution.huTitle = updatedHu.title;
    this.execution.testCases = await this.reconcileExecutionWithHu(
      this.execution.testCases,
      relevantHuCases
    );

    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecution(this.execution);
    this.persistExecutionContext();
    this.normalizeActiveSelection();
    await this.updateStats();
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

    if (this.origin === 'manual-execution') {
      this.router.navigate(['/manual-execution']);
    } else {
      this.router.navigate(['/viewer/test-runs'], {
        state: {
          hu: this.hu,
          testPlanId: this.testPlanId,
          testPlanTitle: this.testPlanTitle
        }
      });
    }
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
        origin: this.origin,
        testRunId: this.testRunId,
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
    origin: string;
    testRunId: string;
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
        activeStepIndex: Number.isFinite(parsed.activeStepIndex) ? parsed.activeStepIndex : 0,
        origin: parsed.origin || 'test-runs',
        testRunId: parsed.testRunId || ''
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
        return 'Completado';
      case 'in-progress':
        return 'En Progreso';
      case 'failed':
        return 'Falló';
      default:
        return 'Pendiente';
    }
  }

  // ── Accordion helpers ──
  toggleAccordion(index: number): void {
    this.expandedTestCaseIndex = this.expandedTestCaseIndex === index ? -1 : index;
  }

  getOriginalIndex(tc: TestCaseExecution): number {
    if (!this.execution) return -1;
    return this.execution.testCases.indexOf(tc);
  }

  selectStepInAccordion(tcIndex: number, stepIndex: number): void {
    this.activeTestCaseIndex = tcIndex;
    this.activeStepIndex = stepIndex;
    this.hydrateCurrentStep();
  }

  /** Allows the user to click on a skeleton placeholder to force-hydrate and then open the image */
  async hydrateAndOpen(ev: AssetEvidence): Promise<void> {
    if (!ev.id) return;
    this.isHydratingEvidence = true;
    this.cdr.markForCheck();
    try {
      const loaded = await this.storageService.getImage(ev.id);
      if (loaded?.base64Data) {
        ev.base64Data = loaded.base64Data;
        ev.originalBase64 = loaded.originalBase64 || loaded.base64Data;
      }
    } catch { /* ignore */ }
    this.isHydratingEvidence = false;
    this.cdr.markForCheck();
  }

  async updateStepStatusInAccordion(tcIndex: number, stepIndex: number, status: string): Promise<void> {
    if (!this.execution) return;
    const step = this.execution.testCases[tcIndex]?.steps[stepIndex];
    if (!step) return;
    step.status = status as any;
    this.execution.testCases[tcIndex].status = this.getTestCaseStatus(this.execution.testCases[tcIndex]);
    this.execution.updatedAt = Date.now();
    await this.fastSaveExecutionState();
    this.cdr.markForCheck();
  }

  async setAllStepsStatus(tcIndex: number, status: 'pending' | 'in-progress' | 'completed' | 'failed'): Promise<void> {
    if (!this.execution) return;
    const tc = this.execution.testCases[tcIndex];
    if (!tc) return;
    tc.steps.forEach(s => s.status = status);
    tc.status = status;
    this.execution.updatedAt = Date.now();
    await this.fastSaveExecutionState();
    this.cdr.markForCheck();
    this.toastService.success('Estado actualizado');
  }

  // ── Summary / stat helpers ──
  getCountByStatus(status: string): number {
    if (!this.execution) return 0;
    return this.execution.testCases.filter(tc => this.getTestCaseStatus(tc) === status).length;
  }

  getOverallCompletion(): number {
    if (!this.execution || !this.execution.testCases.length) return 0;
    const done = this.execution.testCases.filter(tc => {
      const s = this.getTestCaseStatus(tc);
      return s === 'completed' || s === 'failed';
    }).length;
    return Math.round((done / this.execution.testCases.length) * 100);
  }

  getStatusPercent(status: string): number {
    if (!this.execution || !this.execution.testCases.length) return 0;
    return Math.round((this.getCountByStatus(status) / this.execution.testCases.length) * 100);
  }

  getManualPercent(): number {
    return 100;
  }

  getAutomationCoverage(): number {
    return 0;
  }

  getExecutionStatus(): string {
    if (!this.execution) return 'pending';
    const total = this.execution.testCases.length;
    if (!total) return 'pending';
    const failed = this.getCountByStatus('failed');
    const completed = this.getCountByStatus('completed');
    const inProgress = this.getCountByStatus('in-progress');
    if (failed > 0) return 'failed';
    if (completed === total) return 'completed';
    if (inProgress > 0 || completed > 0) return 'in-progress';
    return 'pending';
  }

  getExecutionStatusLabel(): string {
    const s = this.getExecutionStatus();
    switch (s) {
      case 'completed': return 'Completado';
      case 'failed': return 'Fallido';
      case 'in-progress': return 'En Progreso';
      default: return 'Pendiente';
    }
  }

  getSummaryStats(): { passRate: number; failRate: number; executed: number; pending: number } {
    const total = this.execution?.testCases.length ?? 0;
    const passed = this.getCountByStatus('completed');
    const failed = this.getCountByStatus('failed');
    const pending = this.getCountByStatus('pending') + this.getCountByStatus('in-progress');
    return {
      passRate: total ? Math.round((passed / total) * 100) : 0,
      failRate: total ? Math.round((failed / total) * 100) : 0,
      executed: passed + failed,
      pending
    };
  }

  formatDate(timestamp: number | string | undefined): string {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  getStatusDisplayLabel(status: string): string {
    switch (status) {
      case 'completed': return 'Completado';
      case 'failed': return 'Falló';
      case 'in-progress': return 'En Progreso';
      default: return 'Pendiente';
    }
  }
}
