import { Component, Inject, PLATFORM_ID, ChangeDetectorRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { HUData, GenerationMode, DetailedTestCase } from '../models/hu-data.model';
import { AiUnifiedService } from '../services/ai/ai-unified.service';
import { LocalStorageService, TestPlanState } from '../services/core/local-storage.service';
import { DatabaseService, DbUserStoryWithRelations } from '../services/database/database.service';
import { ToastService } from '../services/core/toast.service';
import { TestPlanMapperService } from '../services/database/test-plan-mapper.service';
import { ExportService } from '../services/export/export.service';
import { catchError, finalize, tap, of } from 'rxjs';
import { TestCaseGeneratorComponent } from '../test-case-generator/test-case-generator.component';
import { ExcelMatrixExporterComponent } from '../excel-matrix-exporter/excel-matrix-exporter.component';

type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

@Component({
  selector: 'app-test-plan-generator',
  templateUrl: './test-plan-generator.component.html',
  styleUrls: ['./test-plan-generator.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TestCaseGeneratorComponent,
    ExcelMatrixExporterComponent,
  ],
})
export class TestPlanGeneratorComponent {
  @ViewChild('matrixExporter') matrixExporter!: ExcelMatrixExporterComponent;

  currentGenerationMode: GenerationMode | null = null;
  showTestCaseGenerator: boolean = false;
  isModeSelected: boolean = false;
  formError: string | null = null;

  savedUserStoryIds: string[] = [];
  huList: HUData[] = [];
  downloadPreviewHtmlContent: string = '';

  showConfirmModal: boolean = false;
  confirmModalTitle: string = '';
  confirmModalMessage: string = '';
  private confirmModalCallback: (() => void) | null = null;

  activeTab: 'generate' | 'scenarios' | 'config' = 'generate';

  testPlanTitle: string = '';
  repositoryLink: string = 'https://dev.azure.com/YOUR_ORG/YOUR_PROJECT/_git/NU0139001_SAF_MR_Test - Repos (visualstudio.com)';
  outOfScopeContent: string = 'No se probarán funcionalidades o secciones diferentes a los definidos en el alcance.';
  strategyContent: string = 'Trabajar en coordinación con el equipo de desarrollo para identificar y/o corregir errores en etapas tempranas del proyecto.\nReportar bugs de manera inmediata, con el fin de que sean corregidos lo más pronto posible y no se vean afectadas las fechas planteadas para las entregas que generan valor al cliente.\nEl ambiente de certificación se encuentra estable.';
  limitationsContent: string = 'No tener los permisos requeridos para la aplicación.';
  assumptionsContent: string = 'El equipo de desarrollo ha realizado pruebas unitarias y de aceptación.\nSe cuenta con los insumos necesarios para realizar las pruebas.\nSe cuenta con las herramientas necesarias para la ejecución de las pruebas.\nSe cuenta con los permisos y accesos requeridos para las pruebas.\nEl equipo de desarrollo tendrá disponibilidad para la corrección de errores.';
  teamContent: string = 'Dueño del Producto – Bancolombia: Diego Fernando Giraldo Hincapie\nAnalista de Desarrollo – Pragma: Eddy Johana Cristancho\nAnalista de Desarrollo – Luis Alfredo Chuscano Remolina\nAnalista de Desarrollo - Kevin David Cuadros Estupinan\nAnalista de Pruebas – TCS: Gabriel Ernesto Montoya Henao\nAnalista de Pruebas – TCS: Andrés Antonio Bernal Padilla';

  cellName: string = '';
  cellOptions: string[] = ['BRAINSTORM', 'WAYRA', 'FURY', 'WAKANDA'];
  editingRepositoryLink: boolean = false;
  editingOutOfScope: boolean = false;
  editingStrategy: boolean = false;
  editingLimitations: boolean = false;
  editingAssumptions: boolean = false;
  editingTeam: boolean = false;
  loadingRepositoryLinkAI: boolean = false;
  errorRepositoryLinkAI: string | null = null;
  loadingOutOfScopeAI: boolean = false;
  errorOutOfScopeAI: string | null = null;
  loadingStrategyAI: boolean = false;
  errorStrategyAI: string | null = null;
  loadingLimitationsAI: boolean = false;
  errorLimitationsAI: string | null = null;
  loadingAssumptionsAI: boolean = false;
  errorAssumptionsAI: string | null = null;
  loadingTeamAI: boolean = false;
  errorTeamAI: string | null = null;
  isRepositoryLinkDetailsOpen: boolean = false;
  isOutOfScopeDetailsOpen: boolean = false;
  isStrategyDetailsOpen: boolean = false;
  isLimitationsDetailsOpen: boolean = false;
  isAssumptionsDetailsOpen: boolean = false;
  isTeamDetailsOpen: boolean = false;

  showLoadDataPrompt: boolean = false;
  loadingFromStorage: boolean = false;

  showSuccessModal: boolean = false;

  constructor(
    private aiService: AiUnifiedService,
    public localStorageService: LocalStorageService,
    private databaseService: DatabaseService,
    private router: Router,
    private mapper: TestPlanMapperService,
    private exportService: ExportService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef,
    private toastService: ToastService
  ) { }

  ngOnInit(): void {
    this.checkForStoredData();
    this.selectInitialMode('text');
  }

  showConfirm(title: string, message: string, callback: () => void): void {
    this.confirmModalTitle = title;
    this.confirmModalMessage = message;
    this.confirmModalCallback = callback;
    this.showConfirmModal = true;
  }

  confirmAction(): void {
    if (this.confirmModalCallback) {
      this.confirmModalCallback();
    }
    this.closeConfirmModal();
  }

  closeConfirmModal(): void {
    this.showConfirmModal = false;
    this.confirmModalTitle = '';
    this.confirmModalMessage = '';
    this.confirmModalCallback = null;
  }

  private checkForStoredData(): void {
    if (this.localStorageService.hasStoredState()) {
      const info = this.localStorageService.getStoredStateInfo();
      if (info) {
        this.showLoadDataPrompt = true;
        this.cdr.detectChanges();
      }
    }
  }

  public loadStoredData(): void {
    this.loadingFromStorage = true;
    const state = this.localStorageService.loadTestPlanState();

    if (state) {
      this.testPlanTitle = state.testPlanTitle || this.testPlanTitle;
      this.huList = state.huList || [];
      this.repositoryLink = state.repositoryLink || this.repositoryLink;
      this.outOfScopeContent = state.outOfScopeContent || this.outOfScopeContent;
      this.strategyContent = state.strategyContent || this.strategyContent;
      this.limitationsContent = state.limitationsContent || this.limitationsContent;
      this.assumptionsContent = state.assumptionsContent || this.assumptionsContent;
      this.teamContent = state.teamContent || this.teamContent;

      this.updatePreview();
      this.toastService.success(`Datos cargados exitosamente! ${state.huList.length} Historia(s) de Usuario recuperadas`);
    } else {
      this.toastService.error('No se pudieron cargar los datos guardados');
    }

    this.showLoadDataPrompt = false;
    this.loadingFromStorage = false;
    this.cdr.detectChanges();
  }

  public dismissStoredData(): void {
    this.showLoadDataPrompt = false;
    this.cdr.detectChanges();
  }

  private saveCurrentState(): void {
    const state: TestPlanState = {
      testPlanTitle: this.testPlanTitle,
      huList: this.huList,
      repositoryLink: this.repositoryLink,
      outOfScopeContent: this.outOfScopeContent,
      strategyContent: this.strategyContent,
      limitationsContent: this.limitationsContent,
      assumptionsContent: this.assumptionsContent,
      teamContent: this.teamContent,
      lastUpdated: new Date().toISOString()
    };

    this.localStorageService.autoSaveTestPlanState(state);
  }

  public clearAllData(): void {
    this.showConfirm(
      'Confirmar eliminación',
      '¿Estás seguro de que deseas eliminar todos los datos? Esta acción no se puede deshacer.',
      () => {
        this.huList = [];
        this.testPlanTitle = '';
        this.localStorageService.clearTestPlanState();
        this.updatePreview();
        this.toastService.success('Todos los datos han sido eliminados');
      }
    );
  }

  public exportBackup(): void {
    const state: TestPlanState = {
      testPlanTitle: this.testPlanTitle,
      huList: this.huList,
      repositoryLink: this.repositoryLink,
      outOfScopeContent: this.outOfScopeContent,
      strategyContent: this.strategyContent,
      limitationsContent: this.limitationsContent,
      assumptionsContent: this.assumptionsContent,
      teamContent: this.teamContent,
      lastUpdated: new Date().toISOString()
    };

    this.localStorageService.exportStateAsFile(state);
  }

  /**
   * Importa un estado desde un archivo JSON
   */
  public async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    const state = await this.localStorageService.importStateFromFile(file);

    if (state) {
      this.loadStoredData();
    } else {
      this.toastService.error('Error al importar el archivo. Verifica que sea un archivo de backup válido');
    }

    input.value = '';
  }

  public getStorageInfo(): string {
    return this.localStorageService.getStorageSizeFormatted();
  }

  private async saveTestPlanToDatabase(): Promise<string | null> {
    try {
      const testPlanData = this.mapper.createDbTestPlan(
        this.testPlanTitle,
        this.cellName,
        this.repositoryLink,
        this.outOfScopeContent,
        this.strategyContent,
        this.limitationsContent,
        this.assumptionsContent,
        this.teamContent
      );

      const dbUserStories = this.mapper.mapHUListToDbUserStories(
        this.huList,
        testPlanData.id!
      );

      console.log('💾 Datos del plan a guardar:', {
        titulo: testPlanData.title,
        planId: testPlanData.id,
        cantidadHUs: dbUserStories.length,
        totalCasos: dbUserStories.reduce(
          (sum: number, us: DbUserStoryWithRelations) => sum + (us.test_cases?.length || 0),
          0
        )
      });

      const planId = await this.databaseService.saveCompleteTestPlan(testPlanData, dbUserStories);

      console.log('[DB] Plan guardado con ID:', planId);
      return planId;

    } catch (error) {
      console.error('[DB] Error en saveTestPlanToDatabase:', error);
      throw error;
    }
  }



  selectInitialMode(mode: GenerationMode): void {
    if (mode !== 'text') {
      return;
    }
    this.currentGenerationMode = mode;
    this.isModeSelected = true;
    this.showTestCaseGenerator = true;
    this.cdr.detectChanges();
  }

  private resetActiveGeneratorsAndGoToSelection(): void {
    this.currentGenerationMode = null;
    this.showTestCaseGenerator = false;
    this.isModeSelected = false;
    this.formError = null;
    this.cdr.detectChanges();
  }

  async onHuGeneratedFromChild(huData: HUData) {
    console.log('[PARENT] Recibiendo HU para añadir al plan:', huData.title);
    console.log('[PARENT] HUs en lista antes de agregar:', this.huList.length);

    this.huList.push(huData);

    console.log('[PARENT] HUs en lista después de agregar:', this.huList.length);
    console.log('[PARENT] Iniciando guardado en base de datos...');

    // IMPORTANTE: Actualizar el título del plan antes de guardar
    this.updateTestPlanTitle();

    this.updatePreview();
    this.saveCurrentState();

    if (this.databaseService.isReady()) {
      // Mostrar toast de carga
      const loadingToastId = this.toastService.loading('Guardando plan de pruebas en la base de datos...');

      try {
        console.log('💾 Guardando plan completo en BD con', this.huList.length, 'HU(s)');

        const testPlanId = await this.saveTestPlanToDatabase();

        if (testPlanId) {
          console.log('[DB] Plan guardado exitosamente en BD con ID:', testPlanId);

          // Actualizar toast de loading a éxito
          const planTitle = this.testPlanTitle || 'Plan de Pruebas';
          this.toastService.update(loadingToastId, {
            type: 'success',
            message: `✅ "${planTitle}" guardado con ${this.huList.length} HU(s)`,
            duration: 4500
          });

          // Redirigir al home después de 2 segundos
          setTimeout(() => {
            this.router.navigate(['/']);
          }, 2000);
        } else {
          throw new Error('No se recibió ID del plan guardado');
        }
      } catch (error) {
        console.error('[DB] Error guardando en BD:', error);

        let errorMessage = 'Error desconocido';
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === 'object' && error !== null) {
          const supabaseError = error as any;
          errorMessage = supabaseError.message || supabaseError.error_description || supabaseError.hint || JSON.stringify(error);
        } else if (typeof error === 'string') {
          errorMessage = error;
        }

        // Actualizar toast de loading a error
        this.toastService.update(loadingToastId, {
          type: 'error',
          message: `No se pudo guardar en BD: ${errorMessage}`,
          duration: 6000
        });
      }
    } else {
      console.warn('[DB] Base de datos no configurada, solo guardado local');
      this.toastService.success(`Plan de pruebas creado localmente con ${this.huList.length} Historia${this.huList.length > 1 ? 's' : ''} de Usuario`);
    }

    this.resetActiveGeneratorsAndGoToSelection();
    // Cambiar automáticamente a la pestaña de escenarios
    this.activeTab = 'scenarios';
  }

  /**
   * Maneja el evento cuando una HU es guardada individualmente desde el hijo
   * Recibe el HUData completo y lo agrega a la lista local
   * TODO: Implementar guardado en base de datos cuando esté lista la migración
   */
  onHuSavedFromChild(huData: HUData) {
    // Agregar la HU a la lista local
    this.huList.push(huData);

    // Incrementar contador de HUs guardadas individualmente
    this.savedUserStoryIds.push(huData.id);

    // Actualizar título y preview
    this.updateTestPlanTitle();
    this.updatePreview();
    this.saveCurrentState(); // Guardar en localStorage

    // Mostrar toast de éxito
    this.toastService.success(
      `HU "${huData.title}" guardada (${this.savedUserStoryIds.length} HUs)`,
      4000
    );

    // Cambiar automáticamente a la pestaña de escenarios
    this.activeTab = 'scenarios';
  }

  onGenerationCancelledFromChild() {
    this.resetActiveGeneratorsAndGoToSelection();
  }

  onCellNameChanged(cellName: string) {
    this.cellName = cellName;
  }

  resetToInitialSelection(): void {
    this.resetActiveGeneratorsAndGoToSelection();
  }

  // Método para cambiar de pestaña
  public switchTab(tab: 'generate' | 'scenarios' | 'config'): void {
    this.activeTab = tab;
    this.cdr.detectChanges();
  }

  public toggleEdit(hu: HUData, section: 'scope' | 'scenarios' | 'testCases'): void {
    if (section === 'scope') {
      if (hu.originalInput.generationMode === 'text') {
        hu.editingScope = !hu.editingScope;
        if (hu.editingScope) hu.isScopeDetailsOpen = true;
      } else {
        this.toastService.warning("El alcance no es aplicable/editable para este modo");
      }
    } else if (section === 'testCases') {
      hu.editingTestCases = !hu.editingTestCases;
      if (hu.editingTestCases) {
        // Asegurarnos de que el detail esté abierto al entrar en modo edición
        hu.isScopeDetailsOpen = true;
      }
      if (!hu.editingTestCases) {
        this.updatePreview();
        this.saveCurrentState(); // Guardar cambios
      }
    } else if (section === 'scenarios') {
      this.toastService.info("La edición de casos de prueba se realiza en el componente de generación antes de añadir al plan");
    }
    if (!hu.editingScope && !hu.editingTestCases) {
      this.updatePreview();
      this.saveCurrentState(); // Guardar cambios
    }
    this.cdr.detectChanges();
  }

  // Handlers para el componente TestCaseEditor en la pestaña de configuración
  handleConfigRefineWithAI(hu: HUData, event: { technique: string; context: string }): void {
    hu.refinementTechnique = event.technique;
    hu.refinementContext = event.context;
    this.refineDetailedTestCases(hu);
  }

  handleConfigTestCasesChanged(hu: HUData, testCases: DetailedTestCase[]): void {
    hu.detailedTestCases = testCases;
    this.updatePreview();
    this.saveCurrentState();
    this.cdr.detectChanges();
  }

  // Handlers para el componente TestCaseEditor en la pestaña de escenarios
  toggleScenarioEdit(hu: HUData): void {
    hu.editingScenariosTestCases = !hu.editingScenariosTestCases;
    if (hu.editingScenariosTestCases) {
      hu.isScenariosDetailsOpen = true;
    }
    if (!hu.editingScenariosTestCases) {
      this.saveCurrentState();
    }
    this.cdr.detectChanges();
  }

  handleScenariosRefineWithAI(hu: HUData, event: { technique: string; context: string }): void {
    hu.refinementTechnique = event.technique;
    hu.refinementContext = event.context;
    this.refineDetailedTestCases(hu);
  }

  handleScenariosTestCasesChanged(hu: HUData, testCases: DetailedTestCase[]): void {
    hu.detailedTestCases = testCases;
    this.saveCurrentState();
    this.cdr.detectChanges();
  }

  public toggleStaticEdit(baseName: StaticSectionBaseName): void {
    let editingProp: keyof TestPlanGeneratorComponent;
    let detailsOpenProp: keyof TestPlanGeneratorComponent;
    switch (baseName) {
      case 'repositoryLink': editingProp = 'editingRepositoryLink'; detailsOpenProp = 'isRepositoryLinkDetailsOpen'; break;
      case 'outOfScope': editingProp = 'editingOutOfScope'; detailsOpenProp = 'isOutOfScopeDetailsOpen'; break;
      case 'strategy': editingProp = 'editingStrategy'; detailsOpenProp = 'isStrategyDetailsOpen'; break;
      case 'limitations': editingProp = 'editingLimitations'; detailsOpenProp = 'isLimitationsDetailsOpen'; break;
      case 'assumptions': editingProp = 'editingAssumptions'; detailsOpenProp = 'isAssumptionsDetailsOpen'; break;
      case 'team': editingProp = 'editingTeam'; detailsOpenProp = 'isTeamDetailsOpen'; break;
      default: return;
    }
    const wasEditing = this[editingProp] as boolean;
    (this[editingProp] as any) = !wasEditing;
    if (this[editingProp]) { (this[detailsOpenProp] as any) = true; }
    if (wasEditing && !(this[editingProp] as boolean)) {
      this.updatePreview();
      this.saveCurrentState(); // Guardar cambios
    }
    this.cdr.detectChanges();
  }

  public regenerateScope(hu: HUData): void {
    if (hu.originalInput.generationMode !== 'text' || !hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
      this.toastService.warning('Alcance solo se regenera para HUs con descripción/criterios');
      return;
    }
    hu.editingScope = false; hu.isScopeDetailsOpen = true; hu.loadingScope = true; hu.errorScope = null;
    this.aiService.generateTestPlanSections(hu.originalInput.description!, hu.originalInput.acceptanceCriteria!)
      .pipe(
        tap((scopeText: string) => {
          hu.generatedScope = scopeText;
          hu.errorScope = null;
          this.saveCurrentState(); // Guardar cambios
        }),
        catchError((error: any) => {
          hu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error regenerando alcance.';
          return of('');
        }),
        finalize(() => { hu.loadingScope = false; this.updatePreview(); this.cdr.detectChanges(); })
      ).subscribe();
  }

  public refineDetailedTestCases(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      this.toastService.warning('No hay casos de prueba para refinar');
      return;
    }

    const technique = hu.refinementTechnique || hu.originalInput.selectedTechnique || 'Técnicas generales de prueba';
    const userContext = hu.refinementContext || 'Por favor, refina y mejora los siguientes casos de prueba manteniendo su estructura y agregando más detalles donde sea necesario.';

    console.log('[REFINEMENT] Iniciando refinamiento directo para HU:', hu.id);
    console.log('[REFINEMENT] Técnica:', technique);
    console.log('[REFINEMENT] Contexto:', userContext);

    this.aiService.refineTestCasesDirect(
      hu.originalInput,
      hu.detailedTestCases,
      technique,
      userContext
    ).subscribe({
      next: (result: any) => {
        if (result?.testCases && Array.isArray(result.testCases)) {
          hu.detailedTestCases = result.testCases;
          hu.errorScope = null;
          this.saveCurrentState();
          this.updatePreview();
          this.toastService.success('Casos de prueba refinados exitosamente');
        } else {
          hu.errorScope = 'No se pudieron refinar los casos de prueba';
          this.toastService.error('No se pudieron refinar los casos de prueba');
        }
      },
      error: (error: any) => {
        console.error('[REFINEMENT] Error en refinamiento directo:', error);
        hu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error refinando casos de prueba';
        this.toastService.error(`Error refinando casos de prueba: ${hu.errorScope}`);
        hu.loadingScope = false;
        this.cdr.detectChanges();
      },
      complete: () => {
        console.log('[REFINEMENT] Refinamiento directo completado');
        hu.loadingScope = false;
        this.updatePreview();
        this.cdr.detectChanges();
      }
    });
  }

  public exportExecutionMatrix(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      this.toastService.warning('No hay casos de prueba válidos para exportar');
      return;
    }

    try {
      this.exportService.exportToCSV(hu);
      this.toastService.success('Matriz exportada exitosamente');
    } catch (error) {
      this.toastService.error('Error al exportar la matriz');
    }
  }

  public exportExecutionMatrixToHtml(hu: HUData): void {
    if (this.matrixExporter) {
      // Ahora genera y descarga directamente el archivo Excel
      this.matrixExporter.generateMatrixExcel(hu);
    } else {
      console.error('El componente exportador de matriz no está disponible.');
      this.toastService.error('El componente para exportar no se ha cargado correctamente');
    }
  }

  public isAnyHuTextBased = (): boolean => this.huList.some(hu => hu.originalInput.generationMode === 'text');

  public trackHuById = (i: number, hu: HUData): string => hu.id;



  public getHuSummaryForStaticAI(): string {
    return this.mapper.getHuSummaryForAI(this.huList);
  }

  public regenerateStaticSectionWithAI(section: 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team'): void {
    let sectionNameDisplay = '', currentContent = '', loadingFlag: keyof TestPlanGeneratorComponent | null = null, errorFlag: keyof TestPlanGeneratorComponent | null = null;
    let detailsOpenFlag: keyof TestPlanGeneratorComponent | null = null;
    switch (section) {
      case 'repositoryLink': sectionNameDisplay = 'Repositorio Pruebas VSTS'; currentContent = this.repositoryLink; loadingFlag = 'loadingRepositoryLinkAI'; errorFlag = 'errorRepositoryLinkAI'; detailsOpenFlag = 'isRepositoryLinkDetailsOpen'; break;
      case 'outOfScope': sectionNameDisplay = 'Fuera del Alcance'; currentContent = this.outOfScopeContent; loadingFlag = 'loadingOutOfScopeAI'; errorFlag = 'errorOutOfScopeAI'; detailsOpenFlag = 'isOutOfScopeDetailsOpen'; break;
      case 'strategy': sectionNameDisplay = 'Estrategia'; currentContent = this.strategyContent; loadingFlag = 'loadingStrategyAI'; errorFlag = 'errorStrategyAI'; detailsOpenFlag = 'isStrategyDetailsOpen'; break;
      case 'limitations': sectionNameDisplay = 'Limitaciones'; currentContent = this.limitationsContent; loadingFlag = 'loadingLimitationsAI'; errorFlag = 'errorLimitationsAI'; detailsOpenFlag = 'isLimitationsDetailsOpen'; break;
      case 'assumptions': sectionNameDisplay = 'Supuestos'; currentContent = this.assumptionsContent; loadingFlag = 'loadingAssumptionsAI'; errorFlag = 'errorAssumptionsAI'; detailsOpenFlag = 'isAssumptionsDetailsOpen'; break;
      case 'team': sectionNameDisplay = 'Equipo de Trabajo'; currentContent = this.teamContent; loadingFlag = 'loadingTeamAI'; errorFlag = 'errorTeamAI'; detailsOpenFlag = 'isTeamDetailsOpen'; break;
      default: return;
    }
    if (loadingFlag) (this[loadingFlag] as any) = true; if (errorFlag) (this[errorFlag] as any) = null; if (detailsOpenFlag) (this[detailsOpenFlag] as any) = true;
    this.aiService.generateEnhancedStaticSectionContent(sectionNameDisplay, currentContent, this.getHuSummaryForStaticAI())
      .pipe(
        finalize(() => {
          if (loadingFlag) (this[loadingFlag] as any) = false;
          this.updatePreview();
          this.saveCurrentState(); // Guardar cambios
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (aiResponse: string) => {
          if (aiResponse?.trim()) {
            const isPlaceholder =
              (section === 'outOfScope' && currentContent.trim().toLowerCase().startsWith('no se probarán')) ||
              (section === 'limitations' && currentContent.trim().toLowerCase().startsWith('no tener los permisos')) ||
              currentContent.trim() === '';
            const newContent = isPlaceholder ? aiResponse.trim() : currentContent + '\n\n' + aiResponse.trim();
            switch (section) {
              case 'repositoryLink': this.repositoryLink = newContent; break;
              case 'outOfScope': this.outOfScopeContent = newContent; break;
              case 'strategy': this.strategyContent = newContent; break;
              case 'limitations': this.limitationsContent = newContent; break;
              case 'assumptions': this.assumptionsContent = newContent; break;
              case 'team': this.teamContent = newContent; break;
            }
          } else if (errorFlag) {
            (this[errorFlag] as any) = 'La IA no generó contenido adicional o la respuesta fue vacía.';
          }
        },
        error: (err: any) => {
          if (errorFlag) (this[errorFlag] as any) = err.message || `Error regenerando sección "${sectionNameDisplay}".`;
        }
      });
  }

  public formatSimpleScenarioTitles(titles: string[]): string {
    return this.exportService.formatSimpleScenarioTitles(titles);
  }

  public updateTestPlanTitle(): void {
    this.testPlanTitle = this.mapper.generateTestPlanTitle(this.huList);
    this.cdr.detectChanges();
  }

  public updatePreview(): void {
    this.downloadPreviewHtmlContent = this.generatePlanContentHtmlString();
    this.cdr.detectChanges();
  }

  public generatePlanContentString(): string {
    if (this.huList.length === 0 && !this.testPlanTitle) return 'Plan de pruebas aún no generado. Añade entradas.';
    let fullPlanContent = '';
    if (this.testPlanTitle) fullPlanContent += `Título del Plan de Pruebas: ${this.testPlanTitle}\n\n`;
    fullPlanContent += `Repositorio pruebas VSTS: ${this.repositoryLink}\n\n`;
    if (this.isAnyHuTextBased()) {
      fullPlanContent += `ALCANCE:\n\n`;
      this.huList.forEach(hu => {
        if (hu.originalInput.generationMode === 'text') {
          fullPlanContent += `HU ${hu.id}: ${hu.title}\n${hu.generatedScope || 'Alcance no generado o no aplica.'}\n\n`;
        }
      });
    }
    fullPlanContent += `FUERA DEL ALCANCE:\n\n${this.outOfScopeContent}\n\nESTRATEGIA:\n\n${this.strategyContent}\n\n`;
    const scenarioHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'text');
    if (scenarioHUs.length > 0) {
      fullPlanContent += `CASOS DE PRUEBA (Solo Títulos):\n\n`;
      scenarioHUs.forEach(hu => {
        fullPlanContent += `ID ${hu.id}: ${hu.title} (Técnica: ${hu.originalInput.selectedTechnique})\n${hu.generatedTestCaseTitles || 'Casos no generados o error.'}\n\n`;
      });
    }
    fullPlanContent += `LIMITACIONES:\n\n${this.limitationsContent}\n\nSUPUESTOS:\n\n${this.assumptionsContent}\n\nEquipo de Trabajo:\n\n${this.teamContent}\n\n`;
    return fullPlanContent;
  }

  public generatePlanContentHtmlString(): string {
    if (this.huList.length === 0 && !this.testPlanTitle) { return '<p style="text-align:center; color:#6c757d;">Plan de pruebas aún no generado. Añade entradas.</p>'; }
    let fullPlanHtmlContent = '';
    const currentDateForHtml = new Date().toISOString().split('T')[0];
    if (this.testPlanTitle) { fullPlanHtmlContent += `<p><span class="preview-section-title">Título del Plan de Pruebas:</span> ${this.exportService.escapeHtml(this.testPlanTitle)}</p>\n\n`; }
    const repoLinkUrl = this.repositoryLink.split(' ')[0];
    fullPlanHtmlContent += `<p><span class="preview-section-title">Repositorio pruebas VSTS:</span> <a href="${this.exportService.escapeHtml(repoLinkUrl)}" target="_blank" rel="noopener noreferrer">${this.exportService.escapeHtml(this.repositoryLink)}</a></p>\n\n`;
    if (this.isAnyHuTextBased()) {
      fullPlanHtmlContent += `<p><span class="preview-section-title">ALCANCE:</span></p>\n`;
      this.huList.forEach((hu) => {
        if (hu.originalInput.generationMode === 'text') {
          fullPlanHtmlContent += `<p><span class="preview-hu-title">HU ${this.exportService.escapeHtml(hu.id)}: ${this.exportService.escapeHtml(hu.title)}</span><br>\n`;
          fullPlanHtmlContent += `${this.exportService.escapeHtml(hu.generatedScope) || '<em>Alcance no generado o no aplica.</em>'}</p>\n\n`;
        }
      });
    }
    fullPlanHtmlContent += `<p><span class="preview-section-title">FUERA DEL ALCANCE:</span><br>\n${this.exportService.escapeHtml(this.outOfScopeContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">ESTRATEGIA:</span><br>\n${this.exportService.escapeHtml(this.strategyContent)}</p>\n\n`;
    const scenarioHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'text');
    if (scenarioHUs.length > 0) {
      fullPlanHtmlContent += `<p><span class="preview-section-title">CASOS DE PRUEBA (Solo Títulos):</span></p>\n`;
      scenarioHUs.forEach((hu) => {
        fullPlanHtmlContent += `<p><span class="preview-hu-title">ID ${this.exportService.escapeHtml(hu.id)}: ${this.exportService.escapeHtml(hu.title)} (Técnica: ${this.exportService.escapeHtml(hu.originalInput.selectedTechnique)})</span><br>\n`;
        fullPlanHtmlContent += `${this.exportService.escapeHtml(hu.generatedTestCaseTitles) || '<em>Casos no generados o error.</em>'}</p>\n\n`;
      });
    }
    fullPlanHtmlContent += `<p><span class="preview-section-title">LIMITACIONES:</span><br>\n${this.exportService.escapeHtml(this.limitationsContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">SUPUESTOS:</span><br>\n${this.exportService.escapeHtml(this.assumptionsContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">Equipo de Trabajo:</span><br>\n${this.exportService.escapeHtml(this.teamContent)}</p>\n\n`;
    return fullPlanHtmlContent;
  }

  public copyPreviewToClipboard(): void {
    const planText = this.generatePlanContentString();
    if (isPlatformBrowser(this.platformId) && navigator.clipboard) {
      navigator.clipboard.writeText(planText)
        .then(() => this.toastService.success('Plan de pruebas copiado al portapapeles'))
        .catch(err => {
          console.error('Error al copiar al portapapeles:', err);
          this.toastService.error('Error al copiar: ' + err);
        });
    } else {
      this.toastService.error('La API del portapapeles no es compatible con este navegador');
    }
  }

  public downloadWord(): void {
    const htmlContent = this.generatePlanContentHtmlString();
    if (htmlContent.includes('Plan de pruebas aún no generado')) {
      this.toastService.warning('No hay contenido del plan para descargar');
      return;
    }
    // Funcionalidad DOCX deshabilitada temporalmente debido a incompatibilidades con el navegador
    // La librería html-to-docx requiere módulos de Node.js que no están disponibles en el navegador
    this.toastService.info('La descarga en formato DOCX no está disponible. Se descargará como HTML');
    this.exportService.exportToHTML(htmlContent, this.testPlanTitle || 'PlanDePruebas');
  }
}