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
import { DatabaseService } from '../../../services/database/database.service';
import { ToastService } from '../../../services/core/toast.service';
import { ExportService } from '../../../services/export/export.service';
import { SerenityReportService, SerenityReportState } from '../../../services/export/serenity-report.service';
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

  Math = Math;

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
  showDeleteTestCaseModal = false;
  testCaseToDelete: TestCaseExecution | null = null;
  showUploadMenu = false;
  showReportSettings = false;
  uploadMenuPos: { top: number; left: number } = { top: 0, left: 0 };
  reportSettingsPos: { top: number; left: number } = { top: 0, left: 0 };

  openUploadMenu(event: MouseEvent): void {
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.uploadMenuPos = { top: rect.bottom + 6, left: rect.right };
    this.showUploadMenu = !this.showUploadMenu;
    this.showReportSettings = false;
  }

  openReportSettings(event: MouseEvent): void {
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.reportSettingsPos = { top: rect.bottom + 6, left: rect.right };
    this.showReportSettings = !this.showReportSettings;
    this.showUploadMenu = false;
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
  loadingText = 'Procesando archivo... por favor espera';
  hasUnsavedChanges = false;
  isLoading = true;
  isHydratingEvidence = false;
  /** Estado de progreso de exportación DOCX */
  isExporting = false;
  exportProgress = 0;      // casos procesados
  exportTotal = 0;         // total de casos
  /** Estado de exportación PDF */
  isExportingPdf = false;
  /** Estado de generacion de reporte Serenity remoto */
  isExportingSerenity = false;
  serenityReportPhase: string = '';
  serenityProgressPct = 0;
  private huSyncSubscription: Subscription | null = null;
  /** Timestamp de cuando el componente terminó de cargar — filtra emits stale del BehaviorSubject */
  private componentLoadedAt: number = 0;

  stats: any = null;

  // ── New accordion / tab state ──
  activeTab: 'test-cases' | 'summary' = 'test-cases';
  statusFilter: string = 'all';
  searchQuery: string = '';
  expandedTestCaseIndex: number = -1;

  // Pagination
  currentPage: number = 1;
  pageSize: number = 10;

  get filteredTestCases(): TestCaseExecution[] {
    if (!this.execution) return [];
    return this.execution.testCases.filter(tc => {
      const matchesStatus = this.statusFilter === 'all' || this.getTestCaseStatus(tc) === this.statusFilter;
      const matchesSearch = !this.searchQuery || tc.title.toLowerCase().includes(this.searchQuery.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }

  get totalPages(): number {
    return Math.ceil(this.filteredTestCases.length / this.pageSize);
  }

  get paginatedTestCases(): TestCaseExecution[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.filteredTestCases.slice(startIndex, startIndex + this.pageSize);
  }

  get visiblePages(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    const pages: number[] = [];

    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      if (current <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push(-1); // ellipsis
        pages.push(total);
      } else if (current >= total - 3) {
        pages.push(1);
        pages.push(-1);
        for (let i = total - 4; i <= total; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push(-1);
        for (let i = current - 1; i <= current + 1; i++) pages.push(i);
        pages.push(-1);
        pages.push(total);
      }
    }
    return pages;
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.goToPage(this.currentPage + 1);
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.goToPage(this.currentPage - 1);
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  draggedStepIndex: number | null = null;
  draggedTestCaseIndex: number | null = null;
  editingTestCaseId: string | null = null;
  editingStepId: string | null = null;

  constructor(
    private router: Router,
    private storageService: ExecutionStorageService,
    private databaseService: DatabaseService,
    private toastService: ToastService,
    private exportService: ExportService,
    private serenityReportService: SerenityReportService,
    private huSyncService: HuSyncService,
    private cdr: ChangeDetectorRef
  ) { }

  async ngOnInit(): Promise<void> {
    this.isLoading = true;
    try {
      const state = this.router.getCurrentNavigation()?.extras.state || history.state;
      const restoredContext = this.restoreExecutionContext();
      const hasExplicitNavigationTarget = !!(state?.testRunId || state?.executionId || state?.hu);

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

      // Determinación de la ejecución a cargar
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
        // --- 1. Intentar cargar por executionId explícito de navegación ---
        const navigationExecutionId = typeof state?.executionId === 'string' ? state.executionId : '';
        if (navigationExecutionId) {
          console.log(`[EXEC] Intentando carga directa por executionId (state): ${navigationExecutionId}`);
          const directExec = await this.storageService.getExecution(navigationExecutionId);
          if (directExec) {
            this.execution = directExec;
            this.storageService.setActiveExecutionId(this.execution.id);
          }
        }

        // --- 2. Si no hay destino explícito, usar executionId del contexto restaurado ---
        if (!this.execution && !hasExplicitNavigationTarget && restoredContext?.executionId) {
          console.log(`[EXEC] Intentando carga directa por executionId (contexto): ${restoredContext.executionId}`);
          const directExec = await this.storageService.getExecution(restoredContext.executionId);
          if (directExec) {
            this.execution = directExec;
            this.storageService.setActiveExecutionId(this.execution.id);
          }
        }

        // --- 3. Si no se cargó, intentar resolver desde testRunId ---
        if (!this.execution && this.testRunId) {
          let executionIdToLoad = this.testRunId;

          // Si el ID no empieza por 'exec_', asumimos que es un ID de la tabla 'test_runs'
          if (!this.testRunId.startsWith('exec_')) {
            console.log(`[EXEC] Resolviendo execution_id desde testRunId: ${this.testRunId}`);
            try {
              const { data: runData } = await this.storageService['supabaseClient'].supabase
                .from('test_runs')
                .select('execution_id')
                .eq('id', this.testRunId)
                .single();

              if (runData?.execution_id) {
                executionIdToLoad = runData.execution_id;
              }
            } catch (e) {
              console.error('Error al obtener execution_id del test_run:', e);
            }
          }

          const directExecution = await this.storageService.getExecution(executionIdToLoad);
          if (directExecution) {
            this.execution = directExecution;
            this.storageService.setActiveExecutionId(this.execution.id);
          }
        }

        // --- 4. Fallback: buscar por HU ID (último recurso) ---
        if (!this.execution) {
          const huId = this.hu?.id || restoredContext?.huId || '';
          console.log(`[EXEC] Fallback: buscando ejecuciones para HU: ${huId}`);
          const allExecutions = await this.storageService.getExecutionsByHU(huId);

          if (allExecutions.length > 0) {
            const existingExecutions = allExecutions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            this.execution = existingExecutions[0];
            this.storageService.setActiveExecutionId(this.execution.id);
          }
        }

        // Garantizar que this.hu esté poblado para la reconciliación
        if (this.execution && (!this.hu || !this.hu.detailedTestCases || this.hu.detailedTestCases.length === 0)) {
          this.hu = this.buildHuFromExecution(this.execution);
        }

        // Si aún no hay ejecución, crear una nueva
        if (!this.execution && this.hu) {
          await this.createNewExecution();
        }
      }

      const canRestoreSelectionFromContext =
        !!restoredContext &&
        (
          !hasExplicitNavigationTarget ||
          (!!this.execution?.id && restoredContext.executionId === this.execution.id) ||
          (!!this.testRunId && restoredContext.testRunId === this.testRunId)
        );

      if (canRestoreSelectionFromContext && restoredContext) {
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

    // Almacenar el UUID de la base de datos para facilitar re-sincronizaciones
    if (this.hu.dbUuid) {
      this.execution.huDbUuid = this.hu.dbUuid;
    }

    await this.storageService.saveExecutionNow(this.execution);
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

      // Detectar si el ID es un test_run_id o un execution_id y filtrar en consecuencia
      let query = this.storageService['supabaseClient'].supabase
        .from('test_runs')
        .update({
          status,
          completed_test_cases: completed,
          total_test_cases: total,
          updated_at: new Date().toISOString()
        });

      if (this.testRunId.startsWith('exec_')) {
        query = query.eq('execution_id', this.testRunId);
      } else {
        query = query.eq('id', this.testRunId);
      }

      const { error } = await query.eq('user_id', userId);

      if (error) {
        console.warn('⚠️ No se pudo sincronizar el estado en test_runs:', error);
      }
    } catch (e) {
      console.error('Error en syncTestRunStatus:', e);
    }
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
        await this.storageService.saveExecutionNow(this.execution);
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
      this.loadingText = 'Leyendo archivo... por favor espera';
      this.isParsingFile = true;
      this.cdr.detectChanges();

      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        this.addEvidenceAndOpenEditor(base64, 'archivo').catch(() => {
          this.isParsingFile = false;
          this.cdr.detectChanges();
        });
      };
      reader.onerror = () => {
        this.isParsingFile = false;
        this.toastService.error('Error al leer el archivo');
        this.cdr.detectChanges();
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

      this.loadingText = 'Obteniendo imagen del portapapeles... por favor espera';
      this.isParsingFile = true;
      this.cdr.detectChanges();

      const clipboardItems = await navigator.clipboard.read();

      for (const item of clipboardItems) {
        const imageType = item.types.find((type: string) => type.startsWith('image/'));
        if (!imageType) continue;

        const blob = await item.getType(imageType);
        const base64 = await this.blobToDataURL(blob);
        await this.addEvidenceAndOpenEditor(base64, 'portapapeles');
        return;
      }

      this.isParsingFile = false;
      this.toastService.warning('No se encontró ninguna imagen en el portapapeles');
    } catch (error) {
      this.isParsingFile = false;
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

  private addEvidenceAndOpenEditor(base64: string, source: 'archivo' | 'portapapeles'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.currentStep || !this.execution) {
        this.toastService.warning('No hay un paso activo para guardar la evidencia');
        resolve();
        return;
      }

      this.loadingText = 'Guardando evidencia... por favor espera';
      this.isParsingFile = true;
      this.cdr.detectChanges();

      const img = new Image();
      img.onload = async () => {
        try {
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
          this.showImageEditor = true;

          await this.updateStats();
          this.toastService.success(`Imagen guardada automáticamente desde ${source}`);
          resolve();
        } catch (err) {
          console.error('Error saving image:', err);
          this.toastService.error('Error al guardar la evidencia');
          reject(err);
        } finally {
          this.isParsingFile = false;
          this.cdr.detectChanges();
        }
      };

      img.onerror = () => {
        this.isParsingFile = false;
        this.toastService.error('No se pudo procesar la imagen');
        this.cdr.detectChanges();
        reject(new Error('Image processing failed'));
      };

      img.src = base64;
    });
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

    this.loadingText = 'Procesando archivo CSV... por favor espera';
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

    this.loadingText = 'Guardando cambios de la imagen... por favor espera';
    this.isParsingFile = true;
    this.cdr.detectChanges();

    try {
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
      this.toastService.success('Imagen guardada correctamente');
    } catch (error) {
      console.error('Error onImageSaved:', error);
      this.toastService.error('Error al guardar los cambios de la imagen');
    } finally {
      this.isParsingFile = false;
      this.cdr.detectChanges();
    }
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
    if (!this.execution || this.isExporting) return;

    try {
      this.isExporting = true;
      this.exportProgress = 0;
      this.exportTotal = this.execution.testCases.length;
      this.cdr.markForCheck();

      await this.exportService.exportExecutionToDOCX(
        this.execution,
        this.hu,
        (current, total) => {
          this.exportProgress = current;
          this.exportTotal = total;
          this.cdr.markForCheck();
        }
      );

      this.toastService.success('Ejecución exportada a DOCX exitosamente');
    } catch (error) {
      this.toastService.error('Error al exportar la ejecución');
    } finally {
      this.isExporting = false;
      this.exportProgress = 0;
      this.exportTotal = 0;
      this.cdr.markForCheck();
    }
  }

  async exportToPDF(): Promise<void> {
    if (!this.execution || this.isExportingPdf) return;

    try {
      this.isExportingPdf = true;
      this.exportProgress = 0;
      this.exportTotal = this.execution.testCases.length;
      this.cdr.markForCheck();

      await this.exportService.exportExecutionToPDF(
        this.execution,
        this.hu,
        (current, total) => {
          this.exportProgress = current;
          this.exportTotal = total;
          this.cdr.markForCheck();
        }
      );

      this.toastService.success('Ejecución exportada a PDF exitosamente');
    } catch (error) {
      this.toastService.error('Error al exportar la ejecución a PDF');
    } finally {
      this.isExportingPdf = false;
      this.exportProgress = 0;
      this.exportTotal = 0;
      this.cdr.markForCheck();
    }
  }

  async downloadSerenityReport(): Promise<void> {
    if (!this.execution || this.isExportingSerenity) return;

    try {
      this.isExportingSerenity = true;
      this.serenityReportPhase = 'Iniciando...';
      this.cdr.markForCheck();

      const run = {
        id: this.testRunId || this.execution.id,
        executionId: this.execution.id,
        name: this.execution.huTitle || 'Reporte Serenity',
        huTitle: this.execution.huTitle || '',
        testPlanTitle: this.testPlanTitle || '',
        status: '',
        completedTestCases: 0,
        totalTestCases: 0,
        createdAt: new Date().toISOString(),
      };

      // Monitorear estado en paralelo mientras generateReport se ejecuta
      const monitorInterval = setInterval(() => {
        const state = this.serenityReportService.state;
        const phaseLabels: Record<string, string> = {
          hydrating: state.statusMessage || 'Descargando evidencias...',
          building: state.statusMessage || 'Construyendo bundle...',
          dispatching: 'Enviando a workflow...',
          polling: 'Generando reporte...',
          downloading: 'Descargando...',
          done: 'Completado',
          error: state.error || 'Error',
        };
        this.serenityReportPhase = phaseLabels[state.phase] || state.statusMessage || state.phase;
        this.serenityProgressPct = state.hydrateProgress?.percentage ?? 0;
        this.cdr.markForCheck();

        if (state.phase === 'done' || state.phase === 'error') {
          clearInterval(monitorInterval);
        }
      }, 500);

      await this.serenityReportService.generateReport(run as any);

      const checkInterval = setInterval(() => {
        const state = this.serenityReportService.state;
        if (state.phase === 'done') {
          clearInterval(checkInterval);
          this.isExportingSerenity = false;
          this.serenityReportPhase = '';
          this.serenityProgressPct = 0;
          this.toastService.success('Reporte Serenity descargado');
          this.cdr.markForCheck();
        }
        if (state.phase === 'error') {
          clearInterval(checkInterval);
          this.isExportingSerenity = false;
          this.serenityReportPhase = '';
          this.serenityProgressPct = 0;
          this.toastService.error(state.error || 'Error al generar reporte Serenity');
          this.cdr.markForCheck();
        }
      }, 1000);

      setTimeout(() => {
        clearInterval(checkInterval);
        if (this.isExportingSerenity) {
          this.isExportingSerenity = false;
          this.serenityReportPhase = '';
          this.serenityReportService.stopPolling();
          this.toastService.warning('Timeout: el reporte esta tardando demasiado');
          this.cdr.markForCheck();
        }
      }, 600000);
    } catch (err: any) {
      this.isExportingSerenity = false;
      this.serenityReportPhase = '';
      this.toastService.error(err?.message || 'Error al iniciar reporte Serenity');
      this.cdr.markForCheck();
    }
  }

  async saveExecution(): Promise<void> {
    if (!this.execution) return;

    await this.fastSaveExecutionState();
    this.toastService.success('Ejecución guardada');
  }

  private async autoSaveExecutionState(): Promise<void> {
    if (!this.execution) return;

    // Deshabilitado para evitar subidas redundantes concurrentes que causan race conditions.
    // Las evidencias ya se suben de manera individual e inmediata al crearse/modificarse.
    // await this.syncExecutionImagesToStorage();
    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecutionNow(this.execution);
    this.persistExecutionContext();
    this.syncTestRunStatus();
  }

  /** Guarda solo el JSON de la ejecución (estados/notas) sin re-subir imágenes al Storage. */
  private async fastSaveExecutionState(): Promise<void> {
    if (!this.execution) return;
    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecutionNow(this.execution);
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
      ev => ev.id && (
        ev.type === 'csv'
          ? (!ev.tabularData && !this.storageService.getCachedImage(ev.id))
          : (!ev.base64Data && !this.storageService.getCachedImage(ev.id))
      )
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

    // Calcular localmente para evitar esperar al debounce del storage service y DB roundtrips
    let totalSteps = 0;
    let executedSteps = 0;
    let totalImages = 0;

    this.execution.testCases.forEach(tc => {
      tc.steps.forEach(step => {
        totalSteps++;
        if (step.status === 'completed' || step.status === 'failed') executedSteps++;
        totalImages += (step.evidences || []).length;
      });
    });

    this.stats = {
      totalTestCases: this.execution.testCases.length,
      totalSteps,
      completedSteps: executedSteps,
      completionPercentage: totalSteps > 0 ? (executedSteps / totalSteps) * 100 : 0,
      totalImages
    };

    this.cdr.detectChanges();
  }

  private async applyLatestHuSnapshot(): Promise<void> {
    if (!this.hu?.id) return;

    // 1. Intentar obtener del servicio de sincronización (cache rápido)
    let latestHu = this.huSyncService.getLatestHu(this.hu.id);

    // 2. Si no hay datos detallados o faltan IDs de BD, forzar descarga desde la base de datos (Fuente de Verdad)
    const hasDetailedData = latestHu &&
                            latestHu.detailedTestCases &&
                            latestHu.detailedTestCases.length > 0 &&
                            latestHu.detailedTestCases.every(tc => !!tc.dbId);

    if (!hasDetailedData) {
      try {
        // Prioridad para encontrar el UUID de la HU: dbUuid -> execution.huDbUuid -> id (si es UUID)
        const huUuid = this.hu.dbUuid || this.execution?.huDbUuid || (this.hu.id.length > 30 ? this.hu.id : null);

        if (huUuid) {
          console.log(`[SYNC] Forzando descarga de HU ${huUuid} desde DB para asegurar todos los escenarios...`);
          const fullHuDb = await this.databaseService.getUserStoryWithTestCases(huUuid);
          if (fullHuDb) {
            latestHu = {
              id: fullHuDb.custom_id || fullHuDb.id,
              dbUuid: fullHuDb.id,
              title: fullHuDb.title,
              sprint: fullHuDb.sprint || '',
              originalInput: {
                generationMode: fullHuDb.generation_mode || 'text',
                description: fullHuDb.description || '',
                acceptanceCriteria: fullHuDb.acceptance_criteria || ''
              },
              detailedTestCases: (fullHuDb.test_cases || []).map((tc: any) => ({
                dbId: tc.id,
                title: tc.title,
                preconditions: tc.preconditions,
                steps: (tc.test_case_steps || []).map((step: any) => ({
                  dbId: step.id,
                  numero_paso: step.step_number,
                  accion: step.action
                })),
                expectedResults: tc.expected_results
              }))
            };

            // Si el execution no tenía el UUID, asignárselo ahora
            if (this.execution && !this.execution.huDbUuid) {
              this.execution.huDbUuid = fullHuDb.id;
              await this.storageService.saveExecutionNow(this.execution);
            }

            // Actualizar el servicio de sincronización con la verdad de la DB
            this.huSyncService.publishHuUpdate(latestHu, this.testPlanId, 'execution');
          }
        }
      } catch (err) {
        console.error('Error al descargar HU desde DB para sincronización:', err);
      }
    }

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

    // ── Guard: Si la ejecución ya fue creada y tiene casos, NUNCA sincronizamos con la HU original. ──
    // Según la regla de negocio: una ejecución (Test Run) es un snapshot estático en el tiempo.
    // Una vez en "manual-execution", se desvincula de los cambios en tiempo real de la HU (/viewer/hu-scenarios).
    if (this.execution && this.execution.testCases && this.execution.testCases.length > 0) {
      if (this.execution.huTitle !== updatedHu.title) {
        this.execution.huTitle = updatedHu.title;
        await this.fastSaveExecutionState();
      }
      return;
    }
    
    // Si llegamos aquí, es porque la ejecución AÚN no tiene casos (recién creada o en blanco).
    // En este caso excepcional sí copiamos la estructura inicial de la HU.
    this.execution.huTitle = updatedHu.title;
    this.execution.testCases = await this.reconcileExecutionWithHu(
      this.execution.testCases,
      updatedHu.detailedTestCases || []
    );

    this.execution.updatedAt = Date.now();
    await this.storageService.saveExecutionNow(this.execution);
    this.persistExecutionContext();
    this.normalizeActiveSelection();
    await this.updateStats();
  }

  private async reconcileExecutionWithHu(
    currentCases: TestCaseExecution[],
    updatedCases: DetailedTestCase[]
  ): Promise<TestCaseExecution[]> {
    const evidenceIdsToKeep = new Set<string>();
    const reconciledCases: TestCaseExecution[] = [];

    // Asegurar que las listas de eliminados existen
    const deletedDbIds = new Set(this.execution?.deletedTestCaseDbIds || []);
    const deletedTitles = new Set((this.execution?.deletedTestCaseTitles || []).map(t => t.toLowerCase().trim()));

    console.log(`[SYNC] Iniciando reconciliación. Casos actuales: ${currentCases.length}, Casos HU: ${updatedCases.length}`);
    console.log(`[SYNC] Escenarios eliminados registrados: IDs=${deletedDbIds.size}, Títulos=${deletedTitles.size}`);

    // Mapear casos actuales por dbId y por título para búsquedas rápidas
    const currentByDbId = new Map(currentCases.filter(c => !!c.dbId).map(c => [c.dbId!, c]));
    const currentByTitle = new Map(currentCases.map(c => [c.title.trim().toLowerCase(), c]));

    for (let tcIndex = 0; tcIndex < (updatedCases || []).length; tcIndex++) {
      const tc = updatedCases[tcIndex];
      const normalizedTcTitle = tc.title.trim().toLowerCase();

      // 1. SI EL CASO ESTÁ MARCADO COMO ELIMINADO (por ID o por TÍTULO), SALTARLO
      if (tc.dbId && deletedDbIds.has(tc.dbId)) {
        console.log(`[SYNC] 🚫 Saltando caso '${tc.title}' (ID: ${tc.dbId}) porque fue eliminado intencionalmente.`);
        continue;
      }

      if (deletedTitles.has(normalizedTcTitle)) {
        console.log(`[SYNC] 🚫 Saltando caso '${tc.title}' (Título) porque fue eliminado intencionalmente.`);
        continue;
      }

      // 2. Intentar buscar por dbId (Fuente de Verdad más estable)
      let currentTc = tc.dbId ? currentByDbId.get(tc.dbId) : null;

      // 3. Si no hay dbId o no se encontró, intentar por título exacto
      if (!currentTc) {
        currentTc = currentByTitle.get(normalizedTcTitle);
      }

      // 4. Fallback al índice SOLO si el número de casos coincide exactamente
      if (!currentTc && currentCases.length === updatedCases.length) {
        currentTc = currentCases[tcIndex];
      }

      // IMPORTANTE: Si la ejecución ya tiene casos y NO encontramos este caso del HU en ella
      if (!currentTc && currentCases.length > 0) {
        const titleExistsSomewhere = currentCases.some(c => c.title.trim().toLowerCase() === normalizedTcTitle);
        const dbIdExistsSomewhere = tc.dbId && currentCases.some(c => c.dbId === tc.dbId);

        if (!titleExistsSomewhere && !dbIdExistsSomewhere && (tc.dbId || tcIndex < currentCases.length)) {
          console.log(`[SYNC] Saltando caso '${tc.title}' porque no está en la ejecución actual y parece eliminado.`);
          continue;
        }
      }

      const currentSteps = currentTc?.steps || [];
      const reconciledSteps: ExecutionStep[] = (tc.steps || []).map((step, stepIndex) => {
        const matchedStep = this.matchStep(currentSteps, step, stepIndex);

        const stepResult: ExecutionStep = {
          stepId: matchedStep?.stepId || `${tc.title.replace(/\s+/g, '_')}_step_${stepIndex}`,
          dbId: step.dbId,
          numero_paso: step.numero_paso,
          accion: matchedStep ? matchedStep.accion : step.accion,
          status: matchedStep?.status || 'pending',
          notes: matchedStep?.notes || '',
          evidences: matchedStep?.evidences || [],
          evidenceColumns: matchedStep?.evidenceColumns,
          evidenceRows: matchedStep?.evidenceRows
        };

        if (stepResult.evidences) {
          stepResult.evidences.forEach(ev => evidenceIdsToKeep.add(ev.id));
        }

        return stepResult;
      });

      reconciledCases.push({
        testCaseId: currentTc?.testCaseId || `tc_${tcIndex}`,
        dbId: tc.dbId || currentTc?.dbId,
        title: currentTc ? currentTc.title : tc.title,
        preconditions: currentTc ? currentTc.preconditions : tc.preconditions,
        steps: reconciledSteps,
        expectedResults: currentTc ? currentTc.expectedResults : tc.expectedResults,
        startedAt: currentTc?.startedAt,
        completedAt: currentTc?.completedAt,
        notes: currentTc?.notes,
        status: currentTc?.status || 'pending'
      });
    }

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

  private matchStep(currentSteps: ExecutionStep[], targetStep: any, stepIndex: number): ExecutionStep | null {
    if (!currentSteps || currentSteps.length === 0) return null;

    // 1. Coincidencia por dbId
    if (targetStep.dbId) {
      const byDbId = currentSteps.find(s => s.dbId === targetStep.dbId);
      if (byDbId) return byDbId;
    }

    const normalize = (value: string) => (value || '').trim().toLowerCase();
    const targetAction = normalize(targetStep.accion);

    // 2. Coincidencia exacta por acción
    const byAction = currentSteps.find((step) => normalize(step.accion) === targetAction);
    if (byAction) return byAction;

    // 3. Coincidencia difusa
    const fuzzyMatch = currentSteps.find(step => {
      const stepAction = normalize(step.accion);
      return stepAction.includes(targetAction) || targetAction.includes(stepAction);
    });
    if (fuzzyMatch) return fuzzyMatch;

    // 4. Fallback por índice si es razonable
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
      dbUuid: execution.huDbUuid,
      title: execution.huTitle,
      sprint: '',
      originalInput: {
        generationMode: 'text',
        description: '',
        acceptanceCriteria: ''
      },
      detailedTestCases: (execution.testCases || []).map((tc) => ({
        dbId: tc.dbId,
        title: tc.title,
        preconditions: tc.preconditions,
        steps: (tc.steps || []).map((step) => ({
          dbId: step.dbId,
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
    await this.updateStats(); // Recalcular stats para actualizar las barras de progreso
    this.cdr.detectChanges(); // Forzar re-render inmediato (markForCheck no garantiza esto tras await)
  }

  async setAllStepsStatus(tcIndex: number, status: 'pending' | 'in-progress' | 'completed' | 'failed'): Promise<void> {
    if (!this.execution) return;
    const tc = this.execution.testCases[tcIndex];
    if (!tc) return;
    tc.steps.forEach(s => s.status = status);
    tc.status = status;
    this.execution.updatedAt = Date.now();
    await this.fastSaveExecutionState();
    await this.updateStats(); // Recalcular stats para actualizar las barras de progreso
    this.cdr.detectChanges(); // Forzar re-render inmediato
    this.toastService.success('Estado actualizado');
  }

  // ── Summary / stat helpers ──
  getCountByStatus(status: string): number {
    if (!this.execution) return 0;
    return this.execution.testCases.filter(tc => this.getTestCaseStatus(tc) === status).length;
  }

  getOverallCompletion(): number {
    return Math.round(this.stats?.completionPercentage || 0);
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

  getSummaryStats(): { passRate: number; failRate: number; executed: number; inProgress: number; pending: number } {
    const total = this.execution?.testCases.length ?? 0;
    const passed = this.getCountByStatus('completed');
    const failed = this.getCountByStatus('failed');
    const inProgress = this.getCountByStatus('in-progress');
    const pending = this.getCountByStatus('pending');

    return {
      passRate: total ? Math.round((passed / total) * 100) : 0,
      failRate: total ? Math.round((failed / total) * 100) : 0,
      executed: passed + failed,
      inProgress,
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

  deleteTestCase(tc: TestCaseExecution, event: MouseEvent): void {
    event.stopPropagation();
    this.testCaseToDelete = tc;
    this.showDeleteTestCaseModal = true;
  }

  async confirmDeleteTestCase(): Promise<void> {
    if (!this.execution || !this.testCaseToDelete) return;

    try {
      // 1. Collect all evidence IDs inside this test case to delete them from storage
      const evidenceIds: string[] = [];
      this.testCaseToDelete.steps.forEach(step => {
        if (step.evidences) {
          step.evidences.forEach(ev => evidenceIds.push(ev.id));
        }
      });

      // 2. Delete evidences from Supabase storage
      if (evidenceIds.length > 0) {
        await this.storageService.cleanupOrphanedImages(evidenceIds);
      }

      // 3. Mark as deleted in the execution object to prevent re-sync
      if (!this.execution.deletedTestCaseDbIds) this.execution.deletedTestCaseDbIds = [];
      if (!this.execution.deletedTestCaseTitles) this.execution.deletedTestCaseTitles = [];

      if (this.testCaseToDelete.dbId) {
        if (!this.execution.deletedTestCaseDbIds.includes(this.testCaseToDelete.dbId)) {
          this.execution.deletedTestCaseDbIds.push(this.testCaseToDelete.dbId);
        }
      }

      // Siempre guardar el título como fallback de eliminación
      const normalizedTitle = this.testCaseToDelete.title.trim().toLowerCase();
      if (!this.execution.deletedTestCaseTitles.includes(normalizedTitle)) {
        this.execution.deletedTestCaseTitles.push(normalizedTitle);
      }

      // 4. Remove from local execution object
      const index = this.execution.testCases.findIndex(tc =>
        (this.testCaseToDelete?.dbId && tc.dbId === this.testCaseToDelete.dbId) ||
        tc.testCaseId === this.testCaseToDelete?.testCaseId
      );

      if (index >= 0) {
        this.execution.testCases.splice(index, 1);

        // Adjust active indexes if necessary
        if (this.activeTestCaseIndex >= this.execution.testCases.length) {
          this.activeTestCaseIndex = Math.max(0, this.execution.testCases.length - 1);
        }
        this.activeStepIndex = 0;
      }

      // 5. Save updated execution to Supabase IMMEDIATELY (bypass debounce)
      this.execution.updatedAt = Date.now();
      await this.storageService.saveExecutionNow(this.execution);

      // 6. Update UI stats and state
      this.persistExecutionContext();
      await this.updateStats();
      this.syncTestRunStatus();

      this.toastService.success('Escenario eliminado de la ejecución');
    } catch (error) {
      console.error('Error al eliminar escenario:', error);
      this.toastService.error('Error al eliminar el escenario');
    } finally {
      this.testCaseToDelete = null;
      this.showDeleteTestCaseModal = false;
      this.cdr.markForCheck();
    }
  }

  startEditingTitle(tc: TestCaseExecution, event: MouseEvent, el: HTMLElement): void {
    event.stopPropagation();
    this.editingTestCaseId = tc.testCaseId;
    setTimeout(() => {
      el.focus();
      // Seleccionar todo el texto para facilitar la edición
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 0);
  }

  async finishEditingTitle(tc: TestCaseExecution, event: any): Promise<void> {
    this.editingTestCaseId = null;
    const newTitle = event.target.innerText.trim();
    if (newTitle && newTitle !== tc.title) {
      tc.title = newTitle;
      this.execution!.updatedAt = Date.now();
      await this.storageService.saveExecutionNow(this.execution!);
      this.persistExecutionContext();
      this.toastService.success('Título actualizado');
    } else {
      // Restaurar el texto original si se dejó vacío o no cambió
      event.target.innerText = tc.title;
    }
  }

  startEditingStepAction(step: ExecutionStep, event: MouseEvent, el: HTMLElement): void {
    event.stopPropagation();
    this.editingStepId = step.stepId;
    setTimeout(() => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }, 0);
  }

  async finishEditingStepAction(step: ExecutionStep, event: any): Promise<void> {
    this.editingStepId = null;
    const newAction = event.target.innerText.trim();
    if (newAction && newAction !== step.accion) {
      step.accion = newAction;
      this.execution!.updatedAt = Date.now();
      await this.storageService.saveExecutionNow(this.execution!);
      this.persistExecutionContext();
      this.toastService.success('Paso actualizado');
    } else {
      event.target.innerText = step.accion;
    }
  }

  async updateStepAction(step: ExecutionStep, event: any): Promise<void> {
    const newAction = event.target.innerText.trim();
    if (newAction && newAction !== step.accion) {
      step.accion = newAction;
      await this.autoSaveExecutionState();
      this.toastService.success('Paso actualizado');
    }
  }

  async deleteStep(tcIndex: number, stepIndex: number, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    if (!this.execution) return;
    const tc = this.execution.testCases[tcIndex];
    if (!tc || tc.steps.length <= 1) {
      this.toastService.warning('Un escenario debe tener al menos un paso');
      return;
    }

    const step = tc.steps[stepIndex];

    // Cleanup evidence from storage
    if (step.evidences && step.evidences.length > 0) {
      const evidenceIds = step.evidences.map(ev => ev.id);
      await this.storageService.cleanupOrphanedImages(evidenceIds);
    }

    tc.steps.splice(stepIndex, 1);

    // Re-number steps
    tc.steps.forEach((s, idx) => s.numero_paso = idx + 1);

    if (this.activeTestCaseIndex === tcIndex && this.activeStepIndex >= tc.steps.length) {
      this.activeStepIndex = tc.steps.length - 1;
    }

    await this.autoSaveExecutionState();
    await this.updateStats();
    this.toastService.success('Paso eliminado');
  }

  // --- Drag & Drop Steps ---
  onStepDragStart(tcIndex: number, stepIndex: number): void {
    this.draggedTestCaseIndex = tcIndex;
    this.draggedStepIndex = stepIndex;
  }

  onStepDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  async onStepDrop(tcIndex: number, targetStepIndex: number): Promise<void> {
    if (this.draggedTestCaseIndex !== tcIndex ||
        this.draggedStepIndex === null ||
        this.draggedStepIndex === targetStepIndex ||
        !this.execution) return;

    const tc = this.execution.testCases[tcIndex];
    const movedStep = tc.steps.splice(this.draggedStepIndex, 1)[0];
    tc.steps.splice(targetStepIndex, 0, movedStep);

    // Re-number
    tc.steps.forEach((s, idx) => s.numero_paso = idx + 1);

    this.activeStepIndex = targetStepIndex;
    this.draggedStepIndex = null;
    this.draggedTestCaseIndex = null;

    await this.autoSaveExecutionState();
    this.toastService.success('Pasos reordenados');
  }
}
