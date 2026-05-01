import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HUData, DetailedTestCase, TestCaseStep } from '../models/hu-data.model';
import { DatabaseService } from '../services/database/database.service';
import { AiUnifiedService } from '../services/ai/ai-unified.service';
import { ToastService } from '../services/core/toast.service';
import { DbTestCaseWithRelations } from '../models/database.model';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import { firstValueFrom } from 'rxjs';
import { HuSyncService } from '../services/core/hu-sync.service';

@Component({
  selector: 'app-test-case-refiner',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationModalComponent],
  templateUrl: './test-case-refiner.component.html',
  styleUrls: ['./test-case-refiner.component.css']
})
export class TestCaseRefinerComponent implements OnInit, OnDestroy {
  hu: HUData | null = null;
  testPlanId: string = '';
  isContextPage: boolean = false;
  isLoading: boolean = false;
  isRefining: boolean = false;
  isLoadingDb: boolean = true;

  editedHuId: string = '';
  editedTitle: string = '';
  editedDescription: string = '';
  editedAcceptanceCriteria: string = '';
  editedSprint: string = '';
  editedCellName: string = '';
  editedSelectedTechnique: string = '';
  editedContext: string = '';
  formError: string | null = null;

  editingTestCaseIndex: number | null = null;
  openActionsMenuIndex: number | null = null;
  private editingBackup: DetailedTestCase | null = null;
  private isCreatingNewCase: boolean = false;
  isDeleteModalOpen: boolean = false;
  deleteModalMessage: string = '';
  private pendingDeleteTestCaseIndex: number | null = null;
  private aiProgressInterval: ReturnType<typeof setInterval> | null = null;
  private aiProgressIndex = 0;

  readonly cellOptions: string[] = ['BRAINSTORM', 'WAYRA', 'FURY', 'WAKANDA'];
  readonly techniqueOptions = [
    { value: 'Equivalent Partitioning', label: 'Partición Equivalente' },
    { value: 'Boundary Value Analysis', label: 'Análisis de Valor Límite' },
    { value: 'Decision Table Testing', label: 'Tabla de Decisión' },
    { value: 'State Transition Testing', label: 'Pruebas de Transición de Estados' }
  ];

  private userStoryDbId: string | null = null;
  private existingDbTestCases: DbTestCaseWithRelations[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private databaseService: DatabaseService,
    private aiService: AiUnifiedService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef,
    private huSyncService: HuSyncService
  ) { }

  ngOnInit(): void {
    this.isContextPage = this.route.snapshot.routeConfig?.path === 'refiner/context';

    const navigation = this.router.getCurrentNavigation();
    const state = navigation?.extras?.state || history.state;

    if (state && state['hu']) {
      this.hu = state['hu'];
      this.testPlanId = state['testPlanId'] || '';
      this.editedHuId = this.hu?.id || '';
      this.editedTitle = this.hu?.title || '';
      this.editedDescription = this.hu?.originalInput?.description || '';
      this.editedAcceptanceCriteria = this.hu?.originalInput?.acceptanceCriteria || '';
      this.editedSprint = this.hu?.sprint || '';
      this.editedSelectedTechnique = this.hu?.originalInput?.selectedTechnique || this.hu?.refinementTechnique || '';
      this.editedContext = this.hu?.refinementContext || '';
      this.initializeData();
    } else {
      this.toastService.error('No se encontraron datos para editar');
      this.router.navigate(['/viewer']);
    }
  }

  ngOnDestroy(): void {
    this.stopAiProgress();
  }

  get isAiBusy(): boolean {
    return this.isRefining;
  }

  get aiProgressTitle(): string {
    const provider = this.aiService.getActiveProviderName().replace('(por defecto)', '').trim();
    return this.isContextPage ? `Regenerando con ${provider}` : `Refinando con ${provider}`;
  }

  get aiProgressMessage(): string {
    const id = this.editedHuId ? `${this.editedHuId} · ` : '';
    const title = this.editedTitle
      ? (this.editedTitle.length > 50 ? this.editedTitle.slice(0, 50) + '…' : this.editedTitle)
      : 'Procesando solicitud…';
    return `${id}${title}`;
  }

  get aiProgressStep(): string {
    const shortTech = this.shortTechniqueName(this.editedSelectedTechnique);

    const regenerateSteps = [
      'Analizando contexto y descripción…',
      shortTech ? `Regenerando escenarios con técnica ${shortTech}…` : 'Regenerando escenarios de prueba…',
      'Validando resultados…'
    ];

    const refineSteps = [
      'Leyendo casos de prueba actuales…',
      shortTech ? `Refinando casos con técnica ${shortTech}…` : 'Aplicando ajustes solicitados…',
      'Validando escenarios…'
    ];

    const steps = this.isContextPage ? regenerateSteps : refineSteps;
    return steps[this.aiProgressIndex % steps.length];
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

  private shortTechniqueName(technique: string): string {
    const map: Record<string, string> = {
      'Equivalent Partitioning': 'Partición Equiv.',
      'Boundary Value Analysis': 'Val. Límite',
      'Decision Table Testing': 'Tabla Decisión',
      'State Transition Testing': 'Trans. Estado'
    };
    return map[technique] || '';
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

    try {
      this.isLoading = true;
      this.isRefining = true;
      this.startAiProgress();
      this.cdr.detectChanges();

      let result: any;

      // Si estamos en la página de contexto Y hay contexto del analista, usar refinamiento
      // para que el userRequest/editedContext sea efectivamente enviado a la IA
      if (this.isContextPage && this.editedContext?.trim()) {
        result = await firstValueFrom(this.aiService.refineTestCasesDirect(
          this.hu!.originalInput,
          this.hu!.detailedTestCases || [],
          this.editedSelectedTechnique,
          this.editedContext.trim()
        ));
      } else {
        // Sin contexto: regeneración completa desde cero
        result = await firstValueFrom(this.aiService.generateTestCasesSmart(
          this.editedDescription,
          this.editedAcceptanceCriteria,
          this.editedSelectedTechnique
        ));
      }

      if (!result?.testCases || !this.hu) {
        this.toastService.error('La IA no devolvió escenarios válidos');
        return;
      }

      // Reemplazar en memoria los escenarios anteriores por los nuevos
      this.hu.detailedTestCases = result.testCases;

      // Guardar en BD para persistencia inmediata y evitar pérdida de datos al recargar
      const saved = await this.saveData();
      if (!saved) {
        this.toastService.error('No se pudo guardar la regeneración en base de datos');
        return;
      }

      // Publicar los cambios en el caché
      this.huSyncService.publishHuUpdate(this.hu, this.testPlanId, 'refiner');

      this.toastService.success(`${result.testCases.length} casos regenerados y guardados con éxito`);

      if (this.isContextPage) {
        this.goToRefinerPage();
      }
    } catch (error) {
      console.error('Error al iniciar regeneración:', error);
      this.toastService.error('Error al iniciar regeneración');
    } finally {
      this.isLoading = false;
      this.isRefining = false;
      this.stopAiProgress();
      this.cdr.detectChanges();
    }
  }

  async save(): Promise<void> {
    const success = await this.saveData();
    if (success) this.toastService.success('Cambios guardados correctamente');
  }

  goToPlansList(): void {
    this.router.navigate(['/viewer']);
  }

  goToPlanDetail(): void {
    if (this.hu && this.testPlanId) {
      this.router.navigate(['/viewer'], {
        queryParams: { id: this.testPlanId },
        state: { updatedHU: this.hu, testPlanId: this.testPlanId }
      });
      return;
    }

    this.location.back();
  }

  goToCurrentPage(): void {
    if (!this.hu) return;

    this.router.navigate([this.isContextPage ? '/refiner/context' : '/refiner'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId
      }
    });
  }

  goBack(): void {
    this.goToPlanDetail();
  }

  openContextRegeneratorPage(): void {
    if (!this.hu) return;

    this.router.navigate(['/refiner/context'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId
      }
    });
  }

  goToScenariosTable(): void {
    if (!this.hu) return;

    this.router.navigate(['/viewer/hu-scenarios'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId
      }
    });
  }

  goToRefinerPage(): void {
    if (!this.hu) return;

    this.router.navigate(['/refiner'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId
      }
    });
  }

  isEditingTestCase(index: number): boolean {
    return this.editingTestCaseIndex === index;
  }

  isActionsMenuOpen(index: number): boolean {
    return this.openActionsMenuIndex === index;
  }

  toggleActionsMenu(index: number, event: MouseEvent): void {
    event.stopPropagation();
    this.openActionsMenuIndex = this.openActionsMenuIndex === index ? null : index;
  }

  handleMenuEdit(index: number, event: MouseEvent): void {
    event.stopPropagation();
    this.openActionsMenuIndex = null;
    this.openEditTestCase(index);
  }

  handleMenuDelete(index: number, event: MouseEvent): void {
    event.stopPropagation();
    this.openActionsMenuIndex = null;
    this.requestDeleteTestCase(index);
  }

  @HostListener('document:click')
  closeActionsMenu(): void {
    this.openActionsMenuIndex = null;
  }

  openEditTestCase(index: number): void {
    if (!this.hu?.detailedTestCases || !this.hu.detailedTestCases[index]) return;
    this.openActionsMenuIndex = null;
    this.editingTestCaseIndex = index;
    this.isCreatingNewCase = false;
    this.editingBackup = this.cloneTestCase(this.hu.detailedTestCases[index]);
  }

  async saveEditTestCase(index: number): Promise<void> {
    if (!this.hu?.detailedTestCases || !this.hu.detailedTestCases[index]) return;

    const snapshotBeforeSave = this.hu.detailedTestCases.map(tc => this.cloneTestCase(tc));

    const testCase = this.hu.detailedTestCases[index];
    testCase.steps = (testCase.steps || [])
      .map((step, stepIndex) => ({
        ...step,
        numero_paso: stepIndex + 1,
        accion: (step.accion || '').trim()
      }))
      .filter(step => step.accion.length > 0);

    if (!testCase.steps.length) {
      testCase.steps = [{ numero_paso: 1, accion: 'Paso 1' }];
    }

    testCase.title = (testCase.title || '').trim() || `Caso de prueba ${index + 1}`;
    testCase.preconditions = (testCase.preconditions || '').trim();
    testCase.expectedResults = (testCase.expectedResults || '').trim();

    this.editingTestCaseIndex = null;
    this.openActionsMenuIndex = null;
    this.editingBackup = null;
    this.isCreatingNewCase = false;

    // Refresca de inmediato en UI
    this.cdr.detectChanges();

    const saved = await this.saveData();
    if (saved) {
      this.toastService.success('Caso actualizado y guardado en base de datos');
      return;
    }

    // Rollback local si falla persistencia
    this.hu.detailedTestCases = snapshotBeforeSave;
    this.cdr.detectChanges();
    this.toastService.error('No se pudo guardar la edición en base de datos. Se restauró la versión anterior.');
  }

  cancelEditTestCase(index: number): void {
    if (!this.hu?.detailedTestCases) return;

    if (this.isCreatingNewCase) {
      this.hu.detailedTestCases.splice(index, 1);
    } else if (this.editingBackup) {
      this.hu.detailedTestCases[index] = this.cloneTestCase(this.editingBackup);
    }

    this.editingTestCaseIndex = null;
    this.openActionsMenuIndex = null;
    this.editingBackup = null;
    this.isCreatingNewCase = false;
  }

  addNewTestCase(): void {
    if (!this.hu) return;

    if (!this.hu.detailedTestCases) {
      this.hu.detailedTestCases = [];
    }

    const newCase: DetailedTestCase = {
      title: 'Nuevo caso de prueba',
      preconditions: '',
      steps: [{ numero_paso: 1, accion: '' }],
      expectedResults: ''
    };

    this.hu.detailedTestCases.unshift(newCase);
    this.editingTestCaseIndex = 0;
    this.editingBackup = null;
    this.isCreatingNewCase = true;
  }

  requestDeleteTestCase(index: number): void {
    if (!this.hu?.detailedTestCases || index < 0 || index >= this.hu.detailedTestCases.length) return;

    const testCase = this.hu.detailedTestCases[index];
    this.pendingDeleteTestCaseIndex = index;
    this.deleteModalMessage = `¿Eliminar el caso "${testCase.title || 'Sin título'}"?`;
    this.isDeleteModalOpen = true;
  }

  async onConfirmDeleteTestCase(): Promise<void> {
    if (!this.hu?.detailedTestCases || this.pendingDeleteTestCaseIndex === null) {
      this.onCancelDeleteTestCase();
      return;
    }

    const index = this.pendingDeleteTestCaseIndex;
    if (index < 0 || index >= this.hu.detailedTestCases.length) {
      this.onCancelDeleteTestCase();
      return;
    }

    const deletedCase = this.cloneTestCase(this.hu.detailedTestCases[index]);
    this.hu.detailedTestCases.splice(index, 1);

    // Refresca de inmediato la vista (eliminación en línea)
    this.cdr.detectChanges();

    if (this.editingTestCaseIndex === index) {
      this.editingTestCaseIndex = null;
      this.editingBackup = null;
      this.isCreatingNewCase = false;
    } else if (this.editingTestCaseIndex !== null && this.editingTestCaseIndex > index) {
      this.editingTestCaseIndex = this.editingTestCaseIndex - 1;
    }

    this.onCancelDeleteTestCase();

    const saved = await this.saveData();
    if (saved) {
      this.toastService.success('Caso de prueba eliminado y guardado en base de datos');
      return;
    }

    // Rollback local si falla persistencia
    this.hu.detailedTestCases.splice(index, 0, deletedCase);
    this.cdr.detectChanges();
    this.toastService.error('No se pudo guardar la eliminación en base de datos. Se restauró el caso.');
  }

  onCancelDeleteTestCase(): void {
    this.isDeleteModalOpen = false;
    this.pendingDeleteTestCaseIndex = null;
    this.deleteModalMessage = '';
  }

  addStepToTestCase(testCaseIndex: number): void {
    const testCase = this.hu?.detailedTestCases?.[testCaseIndex];
    if (!testCase) return;

    if (!testCase.steps) testCase.steps = [];
    testCase.steps.push({ numero_paso: testCase.steps.length + 1, accion: '' });
  }

  removeStepFromTestCase(testCaseIndex: number, stepIndex: number): void {
    const testCase = this.hu?.detailedTestCases?.[testCaseIndex];
    if (!testCase?.steps) return;

    testCase.steps.splice(stepIndex, 1);
    if (!testCase.steps.length) testCase.steps.push({ numero_paso: 1, accion: '' });

    testCase.steps.forEach((step, idx) => {
      step.numero_paso = idx + 1;
    });
  }

  private cloneTestCase(testCase: DetailedTestCase): DetailedTestCase {
    return {
      ...testCase,
      steps: (testCase.steps || []).map((step: TestCaseStep) => ({ ...step }))
    };
  }

  private async saveData(): Promise<boolean> {
    if (!this.hu || !this.testPlanId) return false;

    try {
      this.isLoading = true;

      console.log(`[Refiner saveData] 💾 Iniciando guardado. testPlanId=${this.testPlanId}, hu.id=${this.hu.id}, hu.dbUuid=${this.hu.dbUuid}`);

      // Try loading metadata. If not found, we'll try to create it.
      try {
        await this.loadUserStoryData(false);
      } catch (loadError: any) {
        console.error(`[Refiner saveData] ⚠️  Error al cargar HU existente:`, loadError.message);
        console.log(`[Refiner saveData] Procediendo a crear HU nueva...`);
        this.userStoryDbId = null; // Reset to allow creation
      }

      console.log(`[Refiner saveData] Después loadUserStoryData: userStoryDbId=${this.userStoryDbId}`);

      this.normalizeDetailedTestCasesForPersistence();

      // If still no DB ID, it means this HU hasn't been saved to Supabase yet.
      // We'll create it now.
      if (!this.userStoryDbId) {
        console.log(`[Refiner saveData] ⚠️  userStoryDbId es null. Creando HU nueva.`);
        await this.createUserStoryInDb();
      } else {
        // If it exists, update metadata first
        console.log(`[Refiner saveData] ✅ HU ya existe. Actualizando metadatos. userStoryDbId=${this.userStoryDbId}`);
        await this.updateUserStoryMetadata(this.userStoryDbId);
      }

      if (!this.userStoryDbId) throw new Error('No se pudo establecer o crear el User Story en la base de datos');

      await this.syncTestCasesWithDatabase(this.userStoryDbId);
      this.huSyncService.publishHuUpdate(this.hu, this.testPlanId, 'refiner');

      this.isLoading = false;
      return true;
    } catch (error) {
      console.error('Error al guardar:', error);
      this.toastService.error('Error al guardar los cambios en la base de datos');
      this.isLoading = false;
      return false;
    }
  }

  /** Creates the user story in Supabase if it doesn't exist yet. */
  private async createUserStoryInDb(): Promise<void> {
    if (!this.hu || !this.testPlanId) return;

    console.log(`[Refiner createUserStoryInDb] 🆕 Creando nueva HU en BD: custom_id=${this.editedHuId || this.hu.id}`);

    const payload = {
      test_plan_id: this.testPlanId,
      custom_id: this.editedHuId || this.hu.id,
      title: this.editedTitle || this.hu.title,
      sprint: this.editedSprint || this.hu.sprint || '',
      description: this.editedDescription || this.hu.originalInput?.description || '',
      acceptance_criteria: this.editedAcceptanceCriteria || this.hu.originalInput?.acceptanceCriteria || '',
      generation_mode: this.hu.originalInput?.generationMode || 'text',
      refinement_technique: this.editedSelectedTechnique || this.hu.refinementTechnique || '',
      refinement_context: this.editedContext || this.hu.refinementContext || ''
    };

    const { data, error } = await this.databaseService.supabase
      .from('user_stories')
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    if (data) {
      this.userStoryDbId = data.id;
      this.hu.dbUuid = data.id;
      console.log(`[Refiner createUserStoryInDb] ✅ HU creada exitosamente. userStoryDbId=${this.userStoryDbId}`);
    }
  }

  private normalizeDetailedTestCasesForPersistence(): void {
    if (!this.hu?.detailedTestCases) return;

    this.hu.detailedTestCases = this.hu.detailedTestCases.map((tc, tcIndex) => {
      const normalizedSteps = (tc.steps || [])
        .map((step, stepIndex) => ({
          ...step,
          numero_paso: stepIndex + 1,
          accion: (step.accion || '').trim() || `Paso ${stepIndex + 1}`
        }));

      return {
        ...tc,
        title: (tc.title || '').trim() || `Caso de prueba ${tcIndex + 1}`,
        preconditions: (tc.preconditions || '').trim(),
        expectedResults: (tc.expectedResults || '').trim(),
        position: tcIndex + 1,
        steps: normalizedSteps
      };
    });
  }

  private async initializeData(): Promise<void> {
    try {
      this.isLoadingDb = true;
      this.cdr.detectChanges();
      await Promise.all([this.loadUserStoryData(true), this.loadCellName()]);
    } catch (error) {
      console.error('Error al inicializar datos del refinador:', error);
    } finally {
      this.isLoadingDb = false;
      this.cdr.detectChanges();
    }
  }

  private async loadUserStoryData(syncCasesFromDb: boolean = true): Promise<void> {
    if (!this.hu || !this.testPlanId) return;

    const searchBy = this.hu.dbUuid ? 'dbUuid' : 'custom_id+test_plan_id';
    console.log(`[Refiner loadUserStoryData] Buscando HU por ${searchBy}: hu.id=${this.hu.id}, hu.dbUuid=${this.hu.dbUuid}, testPlanId=${this.testPlanId}`);

    let query = this.databaseService.supabase
      .from('user_stories')
      .select(`
        id,
        custom_id,
        description,
        acceptance_criteria,
        title,
        sprint,
        generation_mode,
        refinement_technique,
        refinement_context,
        test_cases (
          id,
          user_story_id,
          title,
          preconditions,
          expected_results,
          position,
          test_case_steps (
            id,
            test_case_id,
            step_number,
            action
          )
        )
      `);

    if (this.hu.dbUuid) {
      console.log(`[Refiner loadUserStoryData] Usando dbUuid: ${this.hu.dbUuid}`);
      query = query.eq('id', this.hu.dbUuid);
    } else {
      console.log(`[Refiner loadUserStoryData] Usando custom_id (${this.hu.id}) + test_plan_id (${this.testPlanId})`);
      query = query.eq('test_plan_id', this.testPlanId).eq('custom_id', this.hu.id);
    }

    let userStory: any = null;
    try {
      const { data, error } = await query.limit(1).single();

      if (error) {
        // PGRST116: Resource not found (normal case - HU doesn't exist yet)
        if (error.code === 'PGRST116') {
          console.warn(`[Refiner loadUserStoryData] ✅ HU no encontrada en BD (PGRST116). Será creada nueva.`);
          this.userStoryDbId = null;
          return;
        }
        
        // Any other error (406, 401, etc.) is an API/authentication issue
        console.error(`[Refiner loadUserStoryData] ❌ Error en consulta a BD. Código: ${error.code}, Mensaje: ${error.message}`);
        throw new Error(`Error consultando HU de BD: ${error.code} - ${error.message}`);
      }

      userStory = data;
      this.userStoryDbId = userStory?.id || null;
      if (this.hu && this.userStoryDbId) this.hu.dbUuid = this.userStoryDbId;
      console.log(`[Refiner loadUserStoryData] ✅ HU encontrada en BD. userStoryDbId=${this.userStoryDbId}`);
    } catch (err: any) {
      console.error(`[Refiner loadUserStoryData] ❌ Excepción capturada:`, err?.message || err);
      // Re-throw to prevent silent failures and duplicate HU creation
      throw err;
    }

    if (userStory?.custom_id) this.editedHuId = userStory.custom_id;
    if (userStory?.title) this.editedTitle = userStory.title;
    if (userStory?.sprint) this.editedSprint = userStory.sprint;

    if (userStory?.description != null) {
      this.editedDescription = userStory.description;
      if (this.hu) this.hu.originalInput.description = userStory.description;
    }

    if (userStory?.acceptance_criteria != null) {
      this.editedAcceptanceCriteria = userStory.acceptance_criteria;
      if (this.hu) this.hu.originalInput.acceptanceCriteria = userStory.acceptance_criteria;
    }

    if (userStory?.refinement_technique) {
      this.editedSelectedTechnique = userStory.refinement_technique;
      if (this.hu) this.hu.refinementTechnique = userStory.refinement_technique;
    }

    if (userStory?.refinement_context) {
      this.editedContext = userStory.refinement_context;
      if (this.hu) this.hu.refinementContext = userStory.refinement_context;
    }

    this.existingDbTestCases = this.sortTestCasesByPosition(userStory?.test_cases || []);

    if (syncCasesFromDb && this.hu) {
      this.hu.detailedTestCases = this.existingDbTestCases.map((dbTc) => {
        const sortedSteps = (dbTc.test_case_steps || [])
          .sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0));

        return {
          dbId: dbTc.id,
          position: dbTc.position ?? undefined,
          title: dbTc.title || 'Sin título',
          preconditions: dbTc.preconditions || '',
          steps: sortedSteps.map((step, stepIdx) => ({
            dbId: step.id,
            numero_paso: step.step_number ?? (stepIdx + 1),
            accion: step.action || ''
          })),
          expectedResults: dbTc.expected_results || ''
        };
      });
    }

    this.alignLocalTestCasesWithDb();
  }

  private sortTestCasesByPosition(testCases: DbTestCaseWithRelations[]): DbTestCaseWithRelations[] {
    return [...(testCases || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  private alignLocalTestCasesWithDb(): void {
    if (!this.hu?.detailedTestCases?.length || !this.existingDbTestCases.length) return;

    this.hu.detailedTestCases.forEach((tc, tcIdx) => {
      const dbTc = this.existingDbTestCases[tcIdx];
      if (!dbTc) return;

      tc.dbId = tc.dbId || dbTc.id || undefined;
      tc.position = tc.position ?? dbTc.position ?? undefined;

      const sortedSteps = (dbTc.test_case_steps || []).sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0));
      tc.steps?.forEach((step, stepIdx) => {
        const dbStep = sortedSteps[stepIdx];
        if (dbStep) step.dbId = step.dbId || dbStep.id || undefined;
      });
    });
  }

  private async updateUserStoryMetadata(userStoryId: string): Promise<void> {
    const { error: updateError } = await this.databaseService.supabase
      .from('user_stories')
      .update({
        custom_id: this.editedHuId || null,
        title: this.editedTitle || null,
        sprint: this.editedSprint || null,
        description: this.editedDescription || null,
        acceptance_criteria: this.editedAcceptanceCriteria || null,
        refinement_technique: this.editedSelectedTechnique || null,
        refinement_context: this.editedContext || null
      })
      .eq('id', userStoryId);

    if (updateError) throw updateError;

    if (this.editedCellName && this.testPlanId) {
      await this.databaseService.supabase
        .from('test_plans')
        .update({ cell_name: this.editedCellName })
        .eq('id', this.testPlanId);
    }
  }

  private async loadCellName(): Promise<void> {
    if (!this.testPlanId) return;

    const { data, error } = await this.databaseService.supabase
      .from('test_plans')
      .select('cell_name')
      .eq('id', this.testPlanId)
      .single();

    if (!error && data?.cell_name) this.editedCellName = data.cell_name;
  }

  private async syncTestCasesWithDatabase(userStoryId: string): Promise<void> {
    if (!this.hu?.detailedTestCases) return;

    this.hu.detailedTestCases.forEach(tc => {
      tc.steps = tc.steps || [];
      tc.steps.forEach((step, idx) => {
        step.numero_paso = idx + 1;
        if (!step.accion?.trim()) step.accion = `Paso ${idx + 1}`;
      });
    });

    await this.databaseService.smartUpdateUserStoryTestCases(userStoryId, this.hu.detailedTestCases);
    await this.loadUserStoryData();
  }
}

