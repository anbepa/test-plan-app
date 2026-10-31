import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ChangeDetectorRef, HostListener, ElementRef } from '@angular/core';
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

  // Edicion inline de caso
  editingTestCaseIndex: number | null = null;
  openActionsMenuIndex: number | null = null;
  private editingBackup: DetailedTestCase | null = null;
  private isCreatingNewCase: boolean = false;

  // Seleccion / eliminacion masiva
  selectedTestCaseIndexes: number[] = [];
  isDeleteModalOpen: boolean = false;
  deleteModalTitle: string = 'Eliminar Caso de Prueba';
  deleteModalMessage: string = '';
  private pendingDeleteTestCaseIndexes: number[] = [];

  /** Paso que se está arrastrando y posición sobre la que se soltaría. */
  dragStep: { tc: number; index: number } | null = null;
  dropStepIndex: number | null = null;

  private componentLoadedAt = Date.now();
  private huSyncSubscription: Subscription | null = null;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private toastService: ToastService,
    private exportService: ExportService,
    private huSyncService: HuSyncService,
    private databaseService: DatabaseService,
    private mapper: TestPlanMapperService,
    private cdr: ChangeDetectorRef,
    private hostRef: ElementRef<HTMLElement>
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
        dbId: tc.id,
        title: tc.title,
        preconditions: tc.preconditions,
        expectedResults: tc.expected_results,
        steps: (tc.test_case_steps || [])
          .sort((a: any, b: any) => (a.step_number || 0) - (b.step_number || 0))
          .map((s: any) => ({
            dbId: s.id,
            numero_paso: s.step_number,
            accion: s.action
          })),
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

  editHuScenarios(): void {
    if (!this.hu) return;
    this.isEditingMode = true;
    this.selectedTestCaseIndexes = [];
    this.editingTestCaseIndex = null;
    this.cdr.detectChanges();
  }

  cancelEditingMode(): void {
    this.isEditingMode = false;
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

  /** Un escenario se considera vacio si no tiene titulo ni pasos con accion. */
  private isTestCaseEmpty(tc: DetailedTestCase): boolean {
    const hasTitle = !!tc.title?.trim();
    const hasSteps = (tc.steps || []).some(s => s.accion?.trim());
    const hasExpected = !!tc.expectedResults?.trim();
    const hasPreconditions = !!tc.preconditions?.trim();
    return !hasTitle && !hasSteps && !hasExpected && !hasPreconditions;
  }

  async saveEditTestCase(index: number): Promise<void> {
    if (!this.hu || !this.hu.detailedTestCases) {
      this.editingTestCaseIndex = null;
      return;
    }

    const wasCreatingNewCase = this.isCreatingNewCase;
    const testCase = this.hu.detailedTestCases[index];

    // ── BUG 3: no permitir guardar un escenario vacio ──
    if (this.isTestCaseEmpty(testCase)) {
      this.toastService.warning('No se puede guardar un escenario vacío. Completa al menos el título o un paso.');
      if (wasCreatingNewCase) {
        // Descartar el caso recien creado para no dejarlo en el listado
        this.hu.detailedTestCases.splice(index, 1);
        this.editingTestCaseIndex = null;
        this.isCreatingNewCase = false;
        this.editingBackup = null;
      }
      // Si NO era nuevo, mantener el modo edicion para que el usuario corrija
      this.cdr.detectChanges();
      return;
    }

    // Ademas exigir titulo (regla minima de negocio)
    if (!testCase.title?.trim()) {
      this.toastService.warning('El escenario debe tener un título para poder guardarse.');
      this.cdr.detectChanges();
      return;
    }

    this.editingTestCaseIndex = null;

    const userStoryId = this.hu?.dbUuid || (this.hu?.id?.length && this.hu.id.length > 20 ? this.hu.id : null);
    if (!userStoryId) {
      this.toastService.error('Error de sistema: ID de HU no válido para guardado');
      return;
    }

    // ── BUG 1: si es un caso nuevo (estaba al inicio), moverlo al FINAL con su consecutivo ──
    let saveIndex = index;
    if (wasCreatingNewCase) {
      const [movedCase] = this.hu.detailedTestCases.splice(index, 1);
      this.hu.detailedTestCases.push(movedCase);
      saveIndex = this.hu.detailedTestCases.length - 1;
    }

    const caseToSave = this.hu.detailedTestCases[saveIndex];

    try {
      // Usar la función optimizada para guardar solo este caso
      const updatedCase = await this.databaseService.saveSingleTestCase(userStoryId, caseToSave, saveIndex);

      // Actualizar el modelo en memoria con el ID (por si era nuevo) y pasos limpios
      this.hu.detailedTestCases[saveIndex] = {
        ...updatedCase,
        steps: (updatedCase.steps || [])
          .filter(s => s.accion?.trim())
          .map((s, sIdx) => ({ ...s, numero_paso: sIdx + 1 }))
      };

      this.isCreatingNewCase = false;
      this.editingBackup = null;
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
    if (this.isCreatingNewCase && this.hu?.detailedTestCases) {
      // Caso recien creado y no guardado: eliminarlo del listado
      this.hu.detailedTestCases.splice(index, 1);
    } else if (this.editingBackup && this.hu) {
      this.hu.detailedTestCases![index] = this.cloneTestCase(this.editingBackup);
    }
    this.editingTestCaseIndex = null;
    this.editingBackup = null;
    this.isCreatingNewCase = false;
    this.cdr.detectChanges();
  }

  addNewTestCase(): void {
    if (!this.hu) return;
    if (!this.hu.detailedTestCases) this.hu.detailedTestCases = [];

    // Evitar crear otro caso si ya hay uno en edicion
    if (this.editingTestCaseIndex !== null) return;

    const newTestCase: DetailedTestCase = {
      title: '',
      preconditions: '',
      expectedResults: '',
      steps: [],
      isExpanded: false
    };

    // BUG 1: insertar al INICIO para evitar el scroll hasta el final.
    // Al guardar se movera al final con su consecutivo.
    this.hu.detailedTestCases.unshift(newTestCase);
    // Ajustar seleccion existente porque todos los indices se desplazan +1
    this.selectedTestCaseIndexes = this.selectedTestCaseIndexes.map(i => i + 1);
    this.startEditTestCase(0);
    this.isCreatingNewCase = true;
    this.cdr.detectChanges();
  }

  addStepToTestCase(index: number): void {
    const tc = this.hu?.detailedTestCases?.[index];
    if (!tc) return;
    this.insertStepAfter(index, (tc.steps?.length || 0) - 1);
  }

  /**
   * Atajos del editor de pasos:
   * Enter crea un paso debajo · Shift+Enter salto de línea · Alt+↑/↓ mueve el paso ·
   * Retroceso en un paso vacío lo elimina y vuelve al anterior.
   */
  onStepKeydown(event: KeyboardEvent, tcIndex: number, stepIndex: number): void {
    const tc = this.hu?.detailedTestCases?.[tcIndex];
    if (!tc?.steps || event.isComposing) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.insertStepAfter(tcIndex, stepIndex);
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.moveStep(tcIndex, stepIndex, event.key === 'ArrowUp' ? -1 : 1);
    } else if (event.key === 'Backspace' && !tc.steps[stepIndex].accion && tc.steps.length > 1) {
      event.preventDefault();
      this.removeStepFromTestCase(tcIndex, stepIndex);
      this.focusStep(tcIndex, Math.max(0, stepIndex - 1));
    }
  }

  private insertStepAfter(tcIndex: number, stepIndex: number): void {
    const tc = this.hu?.detailedTestCases?.[tcIndex];
    if (!tc) return;
    if (!tc.steps) tc.steps = [];
    tc.steps.splice(stepIndex + 1, 0, { numero_paso: 0, accion: '' });
    this.renumberSteps(tc);
    this.cdr.detectChanges();
    this.focusStep(tcIndex, stepIndex + 1);
  }

  /** Mueve un paso `delta` posiciones (−1 sube, +1 baja). */
  moveStep(tcIndex: number, stepIndex: number, delta: number): void {
    this.moveStepTo(tcIndex, stepIndex, stepIndex + delta);
  }

  private moveStepTo(tcIndex: number, from: number, to: number): void {
    const steps = this.hu?.detailedTestCases?.[tcIndex]?.steps;
    if (!steps || from === to || to < 0 || to >= steps.length) return;
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    this.renumberSteps(this.hu!.detailedTestCases![tcIndex]);
    this.cdr.detectChanges();
    this.focusStep(tcIndex, to);
  }

  // ── Arrastrar y soltar pasos ──
  onStepDragStart(event: DragEvent, tcIndex: number, stepIndex: number): void {
    this.dragStep = { tc: tcIndex, index: stepIndex };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(stepIndex));
      const row = (event.target as HTMLElement).closest('.step-editor-row');
      if (row) event.dataTransfer.setDragImage(row, 16, 16);
    }
  }

  onStepDragOver(event: DragEvent, tcIndex: number, stepIndex: number): void {
    if (!this.dragStep || this.dragStep.tc !== tcIndex) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropStepIndex = stepIndex;
  }

  onStepDrop(event: DragEvent, tcIndex: number, stepIndex: number): void {
    if (!this.dragStep || this.dragStep.tc !== tcIndex) return;
    event.preventDefault();
    const from = this.dragStep.index;
    this.onStepDragEnd();
    this.moveStepTo(tcIndex, from, stepIndex);
  }

  onStepDragEnd(): void {
    this.dragStep = null;
    this.dropStepIndex = null;
  }

  /** Indicador de dónde caerá el paso arrastrado: 'above' | 'below' | null. */
  stepDropPosition(tcIndex: number, stepIndex: number): 'above' | 'below' | null {
    if (!this.dragStep || this.dragStep.tc !== tcIndex || this.dropStepIndex !== stepIndex) return null;
    if (this.dragStep.index === stepIndex) return null;
    return this.dragStep.index > stepIndex ? 'above' : 'below';
  }

  private renumberSteps(tc: DetailedTestCase): void {
    (tc.steps || []).forEach((step, idx) => { step.numero_paso = idx + 1; });
  }

  /** Enfoca el textarea de un paso y deja el cursor al final. */
  private focusStep(tcIndex: number, stepIndex: number): void {
    setTimeout(() => {
      const fields = this.hostRef.nativeElement.querySelectorAll<HTMLTextAreaElement>(
        `.steps-editor[data-tc-index="${tcIndex}"] .step-textarea`
      );
      const field = fields[stepIndex];
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
  }

  removeStepFromTestCase(caseIndex: number, stepIndex: number): void {
    if (!this.hu || !this.hu.detailedTestCases) return;
    const tc = this.hu.detailedTestCases[caseIndex];
    if (tc.steps) {
      tc.steps.splice(stepIndex, 1);
      if (!tc.steps.length) {
        tc.steps.push({ numero_paso: 1, accion: '' });
      }
      this.renumberSteps(tc);
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
    const deletedCount = indices.length;
    for (const idx of indices) {
      if (this.hu.detailedTestCases && idx < this.hu.detailedTestCases.length) {
        this.hu.detailedTestCases.splice(idx, 1);
      }
    }
    this.selectedTestCaseIndexes = [];
    this.pendingDeleteTestCaseIndexes = [];
    // BUG 2: mensaje que refleja cuantos se eliminaron, no el total guardado.
    const msg = deletedCount === 1
      ? 'Escenario eliminado correctamente'
      : `${deletedCount} escenarios eliminados correctamente`;
    this.saveData(msg);
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

  exportMatrix(format: 'docx' | 'xlsx' | 'pdf', event: Event): void {
    event.stopPropagation();
    if (!this.hu) return;

    if (format === 'docx') {
      this.exportService.exportToDOCX(this.hu);
    } else if (format === 'xlsx') {
      this.matrixExporter.generateMatrixExcel(this.hu);
    } else if (format === 'pdf') {
      try {
        // Solo los escenarios de ESTA HU, no los del plan completo.
        this.exportService.exportScenariosToPDF(this.hu, this.testPlanTitle);
        this.toastService.success('Escenarios PDF descargados exitosamente');
      } catch (error: any) {
        console.error('Error generando escenarios PDF:', error);
        this.toastService.error(error?.message || 'Error al generar el PDF de escenarios');
      }
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

  private async saveData(successMessage?: string): Promise<boolean> {
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
      // BUG 2: usar mensaje personalizado si se provee (ej. al eliminar),
      // en lugar del generico "N escenarios guardados en base de datos".
      this.toastService.success(successMessage ?? `${cases.length} escenarios guardados en base de datos`);

      // ── Recargar desde BD para obtener los dbIds reales ──
      // Esto asegura que la sincronización con PlanExecution (reconciliation) funcione correctamente
      const fullHuDb = await this.databaseService.getUserStoryWithTestCases(userStoryId);

      if (fullHuDb && this.hu) {
        this.hu.detailedTestCases = (fullHuDb.test_cases || []).map((tc: any) => ({
          dbId: tc.id,
          title: tc.title,
          preconditions: tc.preconditions,
          expectedResults: tc.expected_results,
          steps: (tc.test_case_steps || [])
            .sort((a: any, b: any) => (a.step_number || 0) - (b.step_number || 0))
            .map((s: any) => ({
              dbId: s.id,
              numero_paso: s.step_number,
              accion: s.action
            })),
          isExpanded: false
        }));
      } else if (this.hu) {
        // Fallback si falla el re-fetch (no ideal)
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
}
