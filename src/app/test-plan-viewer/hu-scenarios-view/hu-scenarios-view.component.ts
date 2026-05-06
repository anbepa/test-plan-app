import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ChangeDetectorRef, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ExcelMatrixExporterComponent } from '../../excel-matrix-exporter/excel-matrix-exporter.component';
import { ConfirmationModalComponent } from '../../confirmation-modal/confirmation-modal.component';
import { HUData, DetailedTestCase, TestCaseStep } from '../../models/hu-data.model';
import { ToastService } from '../../services/core/toast.service';
import { ExportService } from '../../services/export/export.service';
import { HuSyncService } from '../../services/core/hu-sync.service';
import { DatabaseService } from '../../services/database/database.service';
import { TestPlanMapperService } from '../../services/database/test-plan-mapper.service';
import { AiUnifiedService } from '../../services/ai/ai-unified.service';
import { GeminiParserService } from '../../services/ai/gemini-parser.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-hu-scenarios-view',
  standalone: true,
  imports: [CommonModule, FormsModule, ExcelMatrixExporterComponent, ConfirmationModalComponent],
  templateUrl: './hu-scenarios-view.component.html',
  styleUrls: ['./hu-scenarios-view.component.css']
})
export class HuScenariosViewComponent implements OnInit, OnDestroy {
  @ViewChild('matrixExporter') matrixExporter!: ExcelMatrixExporterComponent;

  hu: HUData | null = null;
  testPlanId: string = '';
  testPlanTitle: string = '';
  isLoadingScenarios: boolean = false;
  scopeExpanded: boolean = false;
  exportMenuOpen: boolean = false;
  tcSearch: string = '';

  // Modo edicion / refinamiento
  isEditingMode: boolean = false;
  isLoading: boolean = false;
  isRefining: boolean = false;

  // Edicion inline de caso
  editingTestCaseIndex: number | null = null;
  openActionsMenuIndex: number | null = null;
  private editingBackup: DetailedTestCase | null = null;
  private isCreatingNewCase: boolean = false;

  // Context regenerator panel
  isContextPanelOpen: boolean = false;
  editedDescription: string = '';
  editedAcceptanceCriteria: string = '';
  editedSelectedTechnique: string = '';
  editedContext: string = '';
  editedHuId: string = '';
  editedTitle: string = '';
  editedSprint: string = '';
  editedCellName: string = '';
  formError: string | null = null;
  inputDataCollapsed: boolean = false;

  readonly cellOptions: string[] = ['BRAINSTORM', 'WAYRA', 'FURY', 'WAKANDA'];
  readonly techniqueOptions = [
    { value: 'Equivalent Partitioning', label: 'Partición Equivalente' },
    { value: 'Boundary Value Analysis', label: 'Análisis de Valor Límite' },
    { value: 'Decision Table Testing', label: 'Tabla de Decisión' },
    { value: 'State Transition Testing', label: 'Pruebas de Transición de Estados' }
  ];
  readonly techniqueDescriptions: Record<string, string> = {
    'Equivalent Partitioning': 'La IA generará casos para cada partición válida e inválida, evitando redundancias.',
    'Boundary Value Analysis': 'La IA enfocará los casos en los valores límite (mínimo, máximo y sus adyacentes) de cada parámetro.',
    'Decision Table Testing': 'La IA creará combinaciones de condiciones y acciones para cubrir todas las reglas del negocio.',
    'State Transition Testing': 'La IA modelará los estados del sistema y las transiciones posibles entre ellos.'
  };
  readonly contextQuickTags: string[] = [
    '+ Solo happy path', '+ Casos negativos', '+ Validaciones de frontera',
    '+ Datos inválidos', '+ Solo 5 escenarios', '+ Flujo alternativo'
  ];

  get techniqueDescription(): string {
    return this.editedSelectedTechnique ? (this.techniqueDescriptions[this.editedSelectedTechnique] ?? '') : '';
  }

  get isFormValid(): boolean {
    return !!(this.editedTitle?.trim() && this.editedAcceptanceCriteria?.trim() && this.editedSelectedTechnique?.trim());
  }

  appendContextTag(tag: string): void {
    const clean = tag.replace(/^\+\s*/, '');
    const prefix = this.editedContext?.trim() ? this.editedContext.trimEnd() + '. ' : '';
    this.editedContext = prefix + clean;
  }

  // Seleccion / eliminacion masiva
  selectedTestCaseIndexes: number[] = [];
  isDeleteModalOpen: boolean = false;
  deleteModalTitle: string = 'Eliminar Caso de Prueba';
  deleteModalMessage: string = '';
  private pendingDeleteTestCaseIndexes: number[] = [];

  // AI progress
  streamingReasoning: string = '';
  streamingContent: string = '';
  acceptedScenarioIndices: number[] = [];
  isAcceptancePhase: boolean = false;

  get currentHuDataForModal() {
    if (!this.hu) return null;
    return {
      huId: this.hu.id,
      huTitle: this.hu.title,
      huDescription: this.hu.originalInput?.description || '',
      acceptanceCriteria: this.hu.originalInput?.acceptanceCriteria || ''
    };
  }
  private aiProgressInterval: ReturnType<typeof setInterval> | null = null;
  private aiProgressIndex = 0;
  private lastStepAddAt = new Map<number, number>();

  private componentLoadedAt = Date.now();
  private huSyncSubscription: Subscription | null = null;

  get isAiBusy(): boolean {
    return this.isRefining;
  }

  get aiProgressTitle(): string {
    const provider = this.aiService.getActiveProviderName().replace('(por defecto)', '').trim();
    return this.isContextPanelOpen ? `Regenerando con ${provider}` : `Refinando con ${provider}`;
  }

  get aiProgressMessage(): string {
    const id = this.hu?.id ? `${this.hu.id} - ` : '';
    const title = this.hu?.title
      ? (this.hu.title.length > 50 ? this.hu.title.slice(0, 50) + '...' : this.hu.title)
      : 'Procesando solicitud...';
    return `${id}${title}`;
  }

  get aiProgressStep(): string {
    const steps = this.isContextPanelOpen
      ? ['Analizando contexto y descripción…', 'Regenerando escenarios de prueba…', 'Validando resultados…']
      : ['Leyendo casos de prueba actuales...', 'Aplicando ajustes solicitados...', 'Validando escenarios...'];
    return steps[this.aiProgressIndex % steps.length];
  }

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private toastService: ToastService,
    private exportService: ExportService,
    private huSyncService: HuSyncService,
    private databaseService: DatabaseService,
    private mapper: TestPlanMapperService,
    private aiService: AiUnifiedService,
    private parserService: GeminiParserService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    const state = this.router.getCurrentNavigation()?.extras.state || history.state;

    if (state?.hu) {
      // Initialize with fresh data and clear cases to avoid flash of old data
      const initialHu = state.hu as HUData;
      this.testPlanId = state.testPlanId || '';
      this.testPlanTitle = state.testPlanTitle || '';

      // Check if we have a more recent version in sync service
      const latestHu = this.huSyncService.getLatestHu(initialHu.id);
      const sameRecord = latestHu?.dbUuid && initialHu.dbUuid && latestHu.dbUuid === initialHu.dbUuid;
      const resolvedHu = sameRecord ? latestHu! : initialHu;

      // ── Optimización: si el padre ya envió los test cases, usarlos directamente ──
      // Evita un segundo round-trip a user_stories que el padre ya hizo en
      // getHuWithTestCasesLoaded() → getUserStoryWithTestCases()
      const hasTestCasesFromState = (initialHu.detailedTestCases?.length ?? 0) > 0;

      if (hasTestCasesFromState) {
        // Los datos vienen completos del padre — no hace falta re-fetch
        this.hu = resolvedHu;
      } else {
        // Sin test cases en el state: inicializar vacío y cargar desde BD
        this.hu = { ...resolvedHu, detailedTestCases: [] };
      }

      this.componentLoadedAt = Date.now();

      if (!hasTestCasesFromState) {
        this.loadScenariosFromDb();
      } else {
        this.isLoadingScenarios = false;
      }

      this.subscribeToHuUpdates();
      return;
    }

    // ── Fallback: page refresh — recover from query params ──
    const huId = this.route.snapshot.queryParamMap.get('huId');
    const testPlanId = this.route.snapshot.queryParamMap.get('testPlanId');

    if (huId) {
      this.testPlanId = testPlanId || '';
      this.loadHuFromDatabase(huId);
      return;
    }

    this.toastService.warning('No se encontró la HU seleccionada');
  }

  /**
   * Carga la HU completa desde Supabase cuando se recarga la página (sin state)
   */
  private async loadHuFromDatabase(dbUuid: string): Promise<void> {
    this.isLoadingScenarios = true;
    this.cdr.detectChanges();

    try {
      const fullHuDb = await this.databaseService.getUserStoryWithTestCases(dbUuid);
      if (!fullHuDb) {
        this.toastService.warning('No se encontró la HU en la base de datos');
        this.goBackToHuTable();
        return;
      }

      // Recover test plan title from DB if we have testPlanId
      if (this.testPlanId && !this.testPlanTitle) {
        try {
          const header = await this.databaseService.getTestPlanHeaderById(this.testPlanId);
          this.testPlanTitle = header?.title || '';
        } catch { /* non-critical */ }
      }

      // Map DB data to HUData using the existing mapper
      const mappedList = this.mapper.mapDbTestPlanToHUList({ user_stories: [fullHuDb] });
      if (mappedList && mappedList.length > 0) {
        this.hu = mappedList[0];
        this.componentLoadedAt = Date.now();
        this.subscribeToHuUpdates();
      } else {
        this.toastService.warning('No se pudo procesar la HU desde la base de datos');
        this.goBackToHuTable();
      }
    } catch (error) {
      console.error('Error loading HU from database:', error);
      this.toastService.error('Error al recuperar la HU desde la base de datos');
      this.goBackToHuTable();
    } finally {
      this.isLoadingScenarios = false;
      this.cdr.detectChanges();
    }
  }

  private async loadScenariosFromDb(): Promise<void> {
    if (!this.hu) return;

    try {
      this.isLoadingScenarios = true;
      this.cdr.detectChanges();

      const dbUuid = this.hu.dbUuid;
      const customId = this.hu.id;

      let query = this.databaseService.supabase
        .from('user_stories')
        .select(`
          id,
          test_cases (
            id,
            title,
            preconditions,
            expected_results,
            position,
            test_case_steps!test_case_steps_test_case_id_fkey (
              id,
              step_number,
              action
            )
          )
        `);

      if (dbUuid) {
        query = query.eq('id', dbUuid);
      } else if (this.testPlanId) {
        query = query.eq('test_plan_id', this.testPlanId).eq('custom_id', customId);
      } else {
        return;
      }

      const { data, error } = await query.single();

      if (error) throw error;
      if (!data) return;

      const testCases = (data.test_cases || []).map((tc: any) => ({
        title: tc.title,
        preconditions: tc.preconditions,
        expectedResults: tc.expected_results,
        steps: (tc.test_case_steps || [])
          .sort((a: any, b: any) => (a.step_number || 0) - (b.step_number || 0))
          .map((s: any) => ({ accion: s.action })),
        isExpanded: false
      }));

      if (this.hu) {
        this.hu.detailedTestCases = testCases;
        // CRITICAL: Guardar el UUID real para futuros guardados
        if (data.id) {
          this.hu.dbUuid = data.id;
        }
      }
    } catch (error) {
      console.error('Error loading scenarios:', error);
    } finally {
      this.isLoadingScenarios = false;
      this.cdr.detectChanges();
    }
  }

  private subscribeToHuUpdates(): void {
    if (!this.hu?.id) {
      return;
    }

    // Usar watchHuWithTimestamp para ignorar emisiones de cache previas a la carga del componente
    this.huSyncSubscription = this.huSyncService.watchHuWithTimestamp(this.hu.id).subscribe(({ hu, updatedAt }) => {
      // Ignorar si la actualización es anterior a cuando abrimos esta vista
      if (updatedAt < this.componentLoadedAt) return;

      this.hu = hu;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.huSyncSubscription?.unsubscribe();
    this.stopAiProgress();
  }

  goToPlansList(): void {
    this.router.navigate(['/viewer']);
  }

  goToPlanDetail(): void {
    if (this.testPlanId) {
      this.router.navigate(['/viewer'], { queryParams: { id: this.testPlanId } });
    } else {
      this.router.navigate(['/viewer']);
    }
  }

  goBackToHuTable(): void {
    if (this.testPlanId) {
      this.router.navigate(['/viewer'], { queryParams: { id: this.testPlanId } });
    } else {
      this.router.navigate(['/viewer']);
    }
  }

  openContextRegeneratorPage(): void {
    if (!this.hu) return;
    this.editedDescription = this.hu.originalInput?.description || '';
    this.editedAcceptanceCriteria = this.hu.originalInput?.acceptanceCriteria || '';
    this.editedSelectedTechnique = this.hu.refinementTechnique || '';
    this.editedContext = this.hu.refinementContext || '';
    this.editedHuId = this.hu.id;
    this.editedTitle = this.hu.title;
    this.editedSprint = this.hu.sprint || '';
    this.editedCellName = 'BRAINSTORM';
    this.isContextPanelOpen = true;
    this.inputDataCollapsed = false;
    this.formError = null;
    this.cdr.detectChanges();
  }

  closeContextPanel(): void {
    this.isContextPanelOpen = false;
    this.formError = null;
    this.cdr.detectChanges();
  }

  async regenerateWithAI(): Promise<void> {
    if (!this.hu) return;
    this.formError = null;
    if (!this.editedDescription.trim() || !this.editedAcceptanceCriteria.trim() || !this.editedSelectedTechnique) {
      this.formError = 'Completa la Descripción, los Criterios de Aceptación y la Técnica ISTQB antes de regenerar.';
      return;
    }
    this.hu.id = this.editedHuId || this.hu.id;
    this.hu.title = this.editedTitle || this.hu.title;
    this.hu.sprint = this.editedSprint || this.hu.sprint;
    this.hu.originalInput.description = this.editedDescription;
    this.hu.originalInput.acceptanceCriteria = this.editedAcceptanceCriteria;
    this.hu.originalInput.selectedTechnique = this.editedSelectedTechnique;
    this.hu.refinementTechnique = this.editedSelectedTechnique;
    this.hu.refinementContext = this.editedContext;

    this.isLoading = true;
    this.isRefining = true;
    this.streamingReasoning = '';
    this.streamingContent = '';
    this.startAiProgress();
    this.cdr.detectChanges();

    const stream$ = this.editedContext?.trim()
      ? this.aiService.refineTestCasesDirectStream(
          this.hu.originalInput, this.hu.detailedTestCases || [],
          this.editedSelectedTechnique, this.editedContext.trim()
        )
      : this.aiService.generateTestCasesSmartStream(
          this.editedDescription, this.editedAcceptanceCriteria, this.editedSelectedTechnique
        );

    stream$.subscribe({
      next: (event: any) => {
        this.streamingReasoning = event.reasoning || '';
        this.streamingContent = event.content || '';
        this.cdr.detectChanges();
      },
      error: (error: any) => {
        console.error('Error al regenerar con streaming:', error);
        this.toastService.error(error?.userMessage || 'Error al regenerar casos de prueba');
        this.isLoading = false;
        this.isRefining = false;
        this.streamingReasoning = '';
        this.streamingContent = '';
        this.stopAiProgress();
        this.cdr.detectChanges();
      },
      complete: async () => {
        const result = this.parseStreamResult(this.streamingContent);
        this.streamingReasoning = '';
        // Preservar streamingContent durante la animación de aceptación
        if (!result?.testCases || !this.hu) {
          this.toastService.error('La IA no devolvió escenarios válidos');
          this.isLoading = false;
          this.isRefining = false;
          this.streamingContent = '';
          this.stopAiProgress();
          this.cdr.detectChanges();
          return;
        }
        this.hu.detailedTestCases = result.testCases;
        this.stopAiProgress();
        this.isAcceptancePhase = true;
        this.acceptedScenarioIndices = [];
        this.cdr.detectChanges();

        // Animar la aceptación secuencial de cada escenario
        const totalCases = this.hu.detailedTestCases?.length || 0;
        if (totalCases > 0) {
          const delay = Math.min(400, 2000 / totalCases);
          let idx = 0;
          const acceptInterval = setInterval(() => {
            this.acceptedScenarioIndices = [...this.acceptedScenarioIndices, idx];
            this.cdr.detectChanges();
            idx++;
            if (idx >= totalCases) {
              clearInterval(acceptInterval);
              setTimeout(async () => {
                const saved = await this.saveData();
                if (!saved) {
                  this.toastService.error('Error al persistir cambios en la base de datos');
                } else {
                  this.toastService.success(`${result.length} escenarios guardados permanentemente`);
                }
                this.isLoading = false;
                this.isRefining = false;
                this.isAcceptancePhase = false;
                this.acceptedScenarioIndices = [];
                this.streamingContent = '';
                this.isContextPanelOpen = false;
                this.cdr.detectChanges();
              }, 500);
            }
          }, delay);
        } else {
          const saved = await this.saveData();
          if (!saved) {
            this.toastService.error('No se pudo guardar la regeneración en base de datos');
          } else {
            this.huSyncService.publishHuUpdate(this.hu, this.testPlanId, 'viewer' as any);
            this.toastService.success('Casos regenerados y guardados con éxito');
          }
          this.isLoading = false;
          this.isRefining = false;
          this.isAcceptancePhase = false;
          this.acceptedScenarioIndices = [];
          this.streamingContent = '';
          this.isContextPanelOpen = false;
          this.cdr.detectChanges();
        }
      }
    });
  }

  editHuScenarios(): void {
    if (!this.hu) return;
    this.isContextPanelOpen = false;
    this.isEditingMode = true;
    this.selectedTestCaseIndexes = [];
    this.editingTestCaseIndex = null;
    this.cdr.detectChanges();
  }

  cancelEditingMode(): void {
    this.isEditingMode = false;
    this.isContextPanelOpen = false;
    this.selectedTestCaseIndexes = [];
    this.editingTestCaseIndex = null;
    this.editingBackup = null;
    this.isCreatingNewCase = false;
    this.cdr.detectChanges();
  }

  isEditingTestCase(index: number): boolean {
    return this.editingTestCaseIndex === index;
  }

  startEditTestCase(index: number): void {
    if (this.editingTestCaseIndex !== null) return;
    this.editingBackup = this.cloneTestCase(this.hu!.detailedTestCases![index]);
    this.editingTestCaseIndex = index;
    this.cdr.detectChanges();
  }

  async saveEditTestCase(index: number): Promise<void> {
    this.editingTestCaseIndex = null;
    
    const userStoryId = this.hu?.dbUuid || (this.hu?.id?.length && this.hu.id.length > 20 ? this.hu.id : null);
    if (!userStoryId || !this.hu || !this.hu.detailedTestCases) {
      this.toastService.error('Error de sistema: ID de HU no válido para guardado');
      return;
    }

    const testCase = this.hu.detailedTestCases[index];
    
    try {
      // Usar la función optimizada para guardar solo este caso
      const updatedCase = await this.databaseService.saveSingleTestCase(userStoryId, testCase, index);
      
      // Actualizar el modelo en memoria con el ID (por si era nuevo) y pasos limpios
      this.hu.detailedTestCases[index] = {
        ...updatedCase,
        steps: (updatedCase.steps || [])
          .filter(s => s.accion?.trim())
          .map((s, sIdx) => ({ ...s, numero_paso: sIdx + 1 }))
      };

      this.toastService.success(`Escenario guardado correctamente`);
      
      // Notificar cambios al resto de la app
      this.huSyncService.publishHuUpdate(this.hu, this.testPlanId, 'viewer');
      
    } catch (error) {
      console.error('Error guardando escenario:', error);
      this.toastService.error('Error al guardar el escenario');
    }
    
    this.cdr.detectChanges();
  }

  cancelEditTestCase(index: number): void {
    if (this.editingBackup && this.hu) {
      this.hu.detailedTestCases![index] = this.cloneTestCase(this.editingBackup);
    }
    this.editingTestCaseIndex = null;
    this.editingBackup = null;
    this.cdr.detectChanges();
  }

  addNewTestCase(): void {
    if (!this.hu) return;
    if (!this.hu.detailedTestCases) this.hu.detailedTestCases = [];

    const newTestCase: DetailedTestCase = {
      title: '',
      preconditions: '',
      expectedResults: '',
      steps: [],
      isExpanded: false
    };

    this.hu.detailedTestCases.push(newTestCase);
    this.startEditTestCase(this.hu.detailedTestCases.length - 1);
    this.isCreatingNewCase = true;
    this.cdr.detectChanges();
  }

  addStepToTestCase(index: number): void {
    if (!this.hu || !this.hu.detailedTestCases) return;
    const tc = this.hu.detailedTestCases[index];
    if (!tc.steps) tc.steps = [];
    tc.steps.push({ numero_paso: tc.steps.length + 1, accion: '' });
    this.cdr.detectChanges();
  }

  onStepEnter(event: Event, testCaseIndex: number, _stepIndex: number): void {
    event.preventDefault();
    this.addStepToTestCase(testCaseIndex);
  }

  removeStepFromTestCase(caseIndex: number, stepIndex: number): void {
    if (!this.hu || !this.hu.detailedTestCases) return;
    const tc = this.hu.detailedTestCases[caseIndex];
    if (tc.steps) {
      tc.steps.splice(stepIndex, 1);
      if (!tc.steps.length) {
        tc.steps.push({ numero_paso: 1, accion: '' });
      }
      tc.steps.forEach((step, idx) => {
        step.numero_paso = idx + 1;
      });
      this.cdr.detectChanges();
    }
  }

  onTestCaseSelectionChange(index: number, isChecked: boolean): void {
    if (isChecked) {
      if (!this.selectedTestCaseIndexes.includes(index)) {
        this.selectedTestCaseIndexes.push(index);
      }
    } else {
      this.selectedTestCaseIndexes = this.selectedTestCaseIndexes.filter(i => i !== index);
    }
    this.cdr.detectChanges();
  }

  isTestCaseSelected(index: number): boolean {
    return this.selectedTestCaseIndexes.includes(index);
  }

  areAllTestCasesSelected(): boolean {
    if (!this.hu || !this.hu.detailedTestCases || this.hu.detailedTestCases.length === 0) return false;
    return this.selectedTestCaseIndexes.length === this.hu.detailedTestCases.length;
  }

  onToggleSelectAllTestCases(isChecked: boolean): void {
    if (isChecked) {
      this.selectedTestCaseIndexes = this.hu?.detailedTestCases?.map((_, i) => i) || [];
    } else {
      this.selectedTestCaseIndexes = [];
    }
    this.cdr.detectChanges();
  }

  requestDeleteSelectedTestCases(): void {
    if (this.selectedTestCaseIndexes.length === 0) return;
    this.pendingDeleteTestCaseIndexes = [...this.selectedTestCaseIndexes];
    this.deleteModalTitle = 'Eliminar Casos de Prueba';
    this.deleteModalMessage = `¿Estás seguro de que deseas eliminar ${this.selectedTestCaseIndexes.length} caso(s) de prueba?`;
    this.isDeleteModalOpen = true;
  }

  onConfirmDeleteTestCase(): void {
    if (!this.hu) return;
    const indices = this.pendingDeleteTestCaseIndexes.sort((a, b) => b - a);
    for (const idx of indices) {
      if (this.hu.detailedTestCases && idx < this.hu.detailedTestCases.length) {
        this.hu.detailedTestCases.splice(idx, 1);
      }
    }
    this.selectedTestCaseIndexes = [];
    this.saveData();
    this.isDeleteModalOpen = false;
    this.cdr.detectChanges();
  }

  onCancelDeleteTestCase(): void {
    this.isDeleteModalOpen = false;
    this.pendingDeleteTestCaseIndexes = [];
  }

  handleMenuEdit(index: number, event: Event): void {
    event.stopPropagation();
    this.startEditTestCase(index);
  }

  toggleExportMenu(event: Event): void {
    event.stopPropagation();
    this.exportMenuOpen = !this.exportMenuOpen;
  }

  exportMatrix(format: 'docx' | 'xlsx', event: Event): void {
    event.stopPropagation();
    if (!this.hu) return;

    if (format === 'docx') {
      this.exportService.exportToDOCX(this.hu);
    } else if (format === 'xlsx') {
      this.matrixExporter.generateMatrixExcel(this.hu);
    }

    this.exportMenuOpen = false;
  }

  filteredTestCases(): DetailedTestCase[] {
    const testCases = this.hu?.detailedTestCases ?? [];
    if (!this.tcSearch.trim()) return testCases;

    const q = this.tcSearch.toLowerCase();
    return testCases.filter((tc: DetailedTestCase) =>
      tc.title?.toLowerCase().includes(q) ||
      tc.preconditions?.toLowerCase().includes(q) ||
      tc.expectedResults?.toLowerCase().includes(q)
    );
  }

  getOriginalIndex(tc: any): number {
    return this.hu?.detailedTestCases?.indexOf(tc) ?? 0;
  }

  splitLines(text: string): string[] {
    return text ? text.split('\n').filter(line => line.trim()) : [];
  }

  private parseStreamResult(content: string): any {
    if (!content) return null;
    try {
      const result = this.parserService.cleanAndParseJSONWithMeta(content);
      if (result.possiblyTruncated) {
        this.toastService.warning(`La IA superó el límite de texto. Se rescataron ${result.completedTestCaseCount} casos completos.`);
      }
      return result.parsed;
    } catch (e) {
      console.warn('Falló el parseo con GeminiParserService, intentando fallback.', e);
      // Fallback
      try {
        const clean = content.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
        return JSON.parse(clean);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
    }
  }

  private async saveData(): Promise<boolean> {
    // Intentar usar dbUuid o id (si el id es un UUID)
    const userStoryId = this.hu?.dbUuid || (this.hu?.id?.length && this.hu.id.length > 20 ? this.hu.id : null);
    
    if (!userStoryId) {
      console.error('❌ No se puede guardar: No hay un UUID válido para la HU');
      this.toastService.error('Error de sistema: ID de HU no válido para guardado');
      return false;
    }

    const cases = this.hu!.detailedTestCases || [];

    console.log(`🚀 Intentando guardar HU: ${userStoryId}`, { 
      count: cases.length,
      cases: cases 
    });

    try {
      const result = await this.databaseService.saveHuScenariosTransactional(userStoryId, cases);
      console.log('✅ Guardado exitoso. Registros en BD:', result);
      this.toastService.success(`${cases.length} escenarios guardados en base de datos`);

      // Actualizar modelo en memoria para consistencia (sin re-fetch)
      if (this.hu) {
        this.hu.detailedTestCases = cases.map((tc, idx) => ({
          ...tc,
          steps: (tc.steps || [])
            .filter(s => s.accion?.trim())
            .map((s, sIdx) => ({ ...s, numero_paso: sIdx + 1 }))
        }));
      }

      // Notificar cambios al resto de la app
      if (this.hu) {
        this.huSyncService.publishHuUpdate(this.hu, this.testPlanId, 'viewer');
      }
      
      return true;

    } catch (error: any) {
      console.error('❌ Error crítico al guardar (Transaction failed):', error);
      this.toastService.error(`No se pudo guardar: ${error.message || 'Error de base de datos'}`);
      return false;
    }
  }

  private cloneTestCase(testCase: DetailedTestCase): DetailedTestCase {
    return { ...testCase, steps: (testCase.steps || []).map((step: TestCaseStep) => ({ ...step })) };
  }

  private startAiProgress(): void {
    this.stopAiProgress();
    this.aiProgressIndex = 0;
    this.aiProgressInterval = setInterval(() => {
      this.aiProgressIndex = (this.aiProgressIndex + 1) % 3;
      this.cdr.markForCheck();
    }, 1800);
  }

  private stopAiProgress(): void {
    if (this.aiProgressInterval) {
      clearInterval(this.aiProgressInterval);
      this.aiProgressInterval = null;
    }
    this.aiProgressIndex = 0;
  }
}
