import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ChangeDetectorRef, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ExcelMatrixExporterComponent } from '../../excel-matrix-exporter/excel-matrix-exporter.component';
import { ConfirmationModalComponent } from '../../confirmation-modal/confirmation-modal.component';
import { HUData, DetailedTestCase, TestCaseStep } from '../../models/hu-data.model';
import { ToastService } from '../../services/core/toast.service';
import { ExportService } from '../../services/export/export.service';
import { HuSyncService } from '../../services/core/hu-sync.service';
import { DatabaseService } from '../../services/database/database.service';
import { AiUnifiedService } from '../../services/ai/ai-unified.service';
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
    private toastService: ToastService,
    private exportService: ExportService,
    private huSyncService: HuSyncService,
    private databaseService: DatabaseService,
    private aiService: AiUnifiedService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    const state = this.router.getCurrentNavigation()?.extras.state || history.state;

    if (state?.hu) {
      this.hu = state.hu as HUData;
      this.testPlanId = state.testPlanId || '';
      this.testPlanTitle = state.testPlanTitle || '';

      const latestHu = this.huSyncService.getLatestHu(this.hu.id);
      const sameRecord = latestHu?.dbUuid && this.hu.dbUuid && latestHu.dbUuid === this.hu.dbUuid;
      if (sameRecord && latestHu!.detailedTestCases && latestHu!.detailedTestCases.length > 0) {
        this.hu = latestHu!;
      }

      // Clear stale test cases to avoid flash of old data while loading from DB
      this.hu.detailedTestCases = [];
      this.loadScenariosFromDb();
      this.subscribeToHuUpdates();
      return;
    }

    this.toastService.warning('No se encontró la HU seleccionada');
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
            test_case_steps (
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

    this.huSyncSubscription = this.huSyncService.watchHu(this.hu.id).subscribe((updatedHu: HUData) => {
      this.hu = updatedHu;
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
                  this.toastService.error('No se pudo guardar la regeneración en base de datos');
                } else {
                  this.huSyncService.publishHuUpdate(this.hu!, this.testPlanId, 'viewer' as any);
                  this.toastService.success(`${result.testCases.length} casos regenerados y guardados con éxito`);
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
    await this.saveData();
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

  private async saveData(): Promise<boolean> {
    if (!this.hu || !this.hu.dbUuid) return false;

    const userStoryId = this.hu.dbUuid;

    try {
      // 1. Get existing test case IDs to delete their steps first
      const { data: existingTCs } = await this.databaseService.supabase
        .from('test_cases')
        .select('id')
        .eq('user_story_id', userStoryId);

      if (existingTCs && existingTCs.length > 0) {
        const ids = existingTCs.map((tc: any) => tc.id);
        await this.databaseService.supabase
          .from('test_case_steps')
          .delete()
          .in('test_case_id', ids);
        await this.databaseService.supabase
          .from('test_cases')
          .delete()
          .eq('user_story_id', userStoryId);
      }

      // 2. Insert all test cases fresh
      const cases = this.hu.detailedTestCases || [];
      if (cases.length === 0) return true;

      const tcPayload = cases.map((tc: DetailedTestCase, idx: number) => ({
        user_story_id: userStoryId,
        title: tc.title,
        preconditions: tc.preconditions || '',
        expected_results: tc.expectedResults || '',
        position: idx
      }));

      const { data: insertedTCs, error: insertErr } = await this.databaseService.supabase
        .from('test_cases')
        .insert(tcPayload)
        .select();

      if (insertErr) throw insertErr;

      // 3. Insert all steps
      if (insertedTCs) {
        const stepsPayload: any[] = [];
        insertedTCs.forEach((inserted: any, idx: number) => {
          const original = cases[idx];
          (original.steps || []).forEach((s: TestCaseStep, sIdx: number) => {
            if (s.accion && s.accion.trim()) {
              stepsPayload.push({
                test_case_id: inserted.id,
                step_number: sIdx + 1,
                action: s.accion
              });
            }
          });
        });

        if (stepsPayload.length > 0) {
          const { error: stepsErr } = await this.databaseService.supabase
            .from('test_case_steps')
            .insert(stepsPayload);
          if (stepsErr) throw stepsErr;
        }
      }

      this.huSyncService.publishHuUpdate(this.hu, this.testPlanId, 'viewer');

      // 4. Reload from DB to get dbIds and ensure consistency
      await this.loadScenariosFromDb();

      return true;
    } catch (error) {
      console.error('Error saving test cases:', error);
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
