import { Component, Inject, PLATFORM_ID, ChangeDetectorRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { HUData, GenerationMode, DetailedTestCase } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { LocalStorageService, TestPlanState } from '../services/local-storage.service';
import { DatabaseService, DbUserStoryWithRelations } from '../services/database.service';
import { catchError, finalize, tap, of } from 'rxjs';
import { saveAs } from 'file-saver';
import { TestCaseGeneratorComponent } from '../test-case-generator/test-case-generator.component';
import { HtmlMatrixExporterComponent } from '../html-matrix-exporter/html-matrix-exporter.component';

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
    HtmlMatrixExporterComponent,
  ],
})
export class TestPlanGeneratorComponent {
  @ViewChild('matrixExporter') matrixExporter!: HtmlMatrixExporterComponent;

  currentGenerationMode: GenerationMode | null = null;
  showTestCaseGenerator: boolean = false;
  isModeSelected: boolean = false;
  formError: string | null = null;
  
  savedUserStoryIds: string[] = [];
  huList: HUData[] = [];
  downloadPreviewHtmlContent: string = '';
  
  notifications: Array<{id: number, message: string, type: 'success' | 'error' | 'warning' | 'info'}> = [];
  private notificationIdCounter = 0;
  
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
    private geminiService: GeminiService,
    public localStorageService: LocalStorageService,
    private databaseService: DatabaseService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.checkForStoredData();
    this.selectInitialMode('text');
  }

  showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration: number = 4000): void {
    const notification = {
      id: this.notificationIdCounter++,
      message,
      type
    };
    
    this.notifications.push(notification);
    
    if (duration > 0) {
      setTimeout(() => {
        this.removeNotification(notification.id);
      }, duration);
    }
  }

  removeNotification(id: number): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
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
      this.showNotification(`Datos cargados exitosamente! ${state.huList.length} Historia(s) de Usuario recuperadas.`, 'success', 3000);
    } else {
      this.showNotification('No se pudieron cargar los datos guardados', 'error', 4000);
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
        this.showNotification('🗑️ Todos los datos han sido eliminados', 'success', 3000);
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
      this.showNotification('Error al importar el archivo. Verifica que sea un archivo de backup válido', 'error', 4000);
    }

    input.value = '';
  }

  public getStorageInfo(): string {
    return this.localStorageService.getStorageSizeFormatted();
  }

  private async saveTestPlanToDatabase(): Promise<string | null> {
    try {
      const testPlanData = {
        id: crypto.randomUUID(),
        title: this.testPlanTitle || 'Plan de Pruebas',
        repository_link: this.repositoryLink || '',
        out_of_scope: this.outOfScopeContent || '',
        strategy: this.strategyContent || '',
        limitations: this.limitationsContent || '',
        assumptions: this.assumptionsContent || '',
        team: this.teamContent || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Convertir HUData[] a DbUserStoryWithRelations[]
      const dbUserStories: DbUserStoryWithRelations[] = this.huList.map((hu, index) => ({
        id: crypto.randomUUID(),
        custom_id: hu.id, // AÑADIDO: Guardar el ID personalizado de la HU
        title: hu.title || `Historia ${index + 1}`,
        sprint: hu.sprint || '',
        description: hu.originalInput.description || '',
        acceptance_criteria: hu.originalInput.acceptanceCriteria || '',
        generation_mode: hu.originalInput.generationMode,
        generated_scope: hu.generatedScope || '',
        generated_test_case_titles: hu.generatedTestCaseTitles || '',
        refinement_technique: hu.refinementTechnique || undefined,
        refinement_context: hu.refinementContext || undefined,
        test_plan_id: testPlanData.id, // Asignar el ID del plan
        position: index + 1, // AÑADIDO: Asignar position basada en índice
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        
        // Convertir casos de prueba
        test_cases: (hu.detailedTestCases || []).map((tc, tcIndex) => ({
          id: crypto.randomUUID(),
          user_story_id: '', // Se asignará en el servicio
          title: tc.title || `Caso ${tcIndex + 1}`,
          preconditions: tc.preconditions || '',
          expected_results: tc.expectedResults || '',
          position: tcIndex + 1,  // CORREGIDO: Asignar position basada en índice
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          
          // Convertir pasos
          test_case_steps: (tc.steps || []).map((step, stepIndex) => ({
            id: crypto.randomUUID(),
            test_case_id: '', // Se asignará en el servicio
            step_number: step.numero_paso || stepIndex + 1,
            action: step.accion || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }))
        })),
        
        images: [] // Por ahora sin imágenes
      }));

      console.log('💾 Datos del plan a guardar:', {
        titulo: testPlanData.title,
        planId: testPlanData.id,
        cantidadHUs: dbUserStories.length,
        totalCasos: dbUserStories.reduce((sum, us) => sum + (us.test_cases?.length || 0), 0)
      });

      // Guardar en la base de datos usando saveCompleteTestPlan
      const planId = await this.databaseService.saveCompleteTestPlan(testPlanData, dbUserStories);
      
      console.log('[DB] Plan guardado con ID:', planId);
      return planId;
      
    } catch (error) {
      console.error('[DB] Error en saveTestPlanToDatabase:', error);
      throw error;
    }
  }

  private escapeHtmlForExport(u: string | undefined | null): string {
    return u
      ? u
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')
      : '';
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
      try {
        console.log('💾 Guardando plan completo en BD con', this.huList.length, 'HU(s)');
        
        const testPlanId = await this.saveTestPlanToDatabase();
        
        if (testPlanId) {
          console.log('[DB] Plan guardado exitosamente en BD con ID:', testPlanId);
          
          // Mostrar notificación de éxito
          this.showNotification(
            `Plan de pruebas guardado exitosamente: ${this.testPlanTitle}`,
            'success',
            2000
          );
          
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
      }        this.showNotification(
          `Plan creado localmente pero no se pudo guardar en BD: ${errorMessage}`,
          'warning',
          6000
        );
      }
    } else {
      console.warn('[DB] Base de datos no configurada, solo guardado local');
      this.showNotification(
        `Plan de pruebas creado localmente con ${this.huList.length} Historia${this.huList.length > 1 ? 's' : ''} de Usuario`,
        'success',
        3000
      );
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
    
    // Mostrar notificación de éxito
    this.showNotification(
      `Historia de Usuario guardada (${this.savedUserStoryIds.length} HU${this.savedUserStoryIds.length > 1 ? 's' : ''} guardada${this.savedUserStoryIds.length > 1 ? 's' : ''})`,
      'success',
      3000
    );
    
    // Mostrar modal de éxito brevemente
    this.showSuccessModal = true;
    setTimeout(() => {
      this.showSuccessModal = false;
      this.cdr.detectChanges();
    }, 2000);
    
    // Cambiar automáticamente a la pestaña de escenarios
    this.activeTab = 'scenarios';
  }

  onGenerationCancelledFromChild() {
    this.resetActiveGeneratorsAndGoToSelection();
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
        this.showNotification("El alcance no es aplicable/editable para este modo", 'warning', 3000);
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
       this.showNotification("La edición de casos de prueba se realiza en el componente de generación antes de añadir al plan", 'info', 4000);
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
      this.showNotification('Alcance solo se regenera para HUs con descripción/criterios', 'warning', 3000);
      return;
    }
    hu.editingScope = false; hu.isScopeDetailsOpen = true; hu.loadingScope = true; hu.errorScope = null;
    this.geminiService.generateTestPlanSections(hu.originalInput.description!, hu.originalInput.acceptanceCriteria!)
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
      this.showNotification('No hay casos de prueba para refinar', 'warning', 3000);
      return;
    }
    
    hu.loadingScope = true;
    hu.errorScope = null;
    
    const technique = hu.originalInput.selectedTechnique || 'Técnicas generales de prueba';
    const userContext = 'Por favor, refina y mejora los siguientes casos de prueba manteniendosu estructura y agregando más detalles donde sea necesario.';
    
    this.geminiService.refineDetailedTestCases(
      hu.originalInput,
      hu.detailedTestCases,
      technique,
      userContext
    )
      .pipe(
        tap((refinedCases: DetailedTestCase[]) => {
          if (refinedCases && refinedCases.length > 0) {
            hu.detailedTestCases = refinedCases;
            hu.errorScope = null;
            this.saveCurrentState();
            this.showNotification('✨ Casos de prueba refinados exitosamente', 'success', 3000);
          } else {
            hu.errorScope = 'No se pudieron refinar los casos de prueba';
          }
        }),
        catchError((error: any) => {
          hu.errorScope = (typeof error === 'string' ? error : error.message) || 'Error refinando casos de prueba';
          return of([]);
        }),
        finalize(() => {
          hu.loadingScope = false;
          this.updatePreview();
          this.cdr.detectChanges();
        })
      ).subscribe();
  }

  public exportExecutionMatrix(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0 || hu.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imágenes no interpretables o técnica no aplicable"  || tc.title === "Refinamiento no posible con el contexto actual")) {
      this.showNotification('No hay casos de prueba válidos para exportar o los casos generados indican un error', 'warning', 4000);
      return;
    }
    const csvHeader = ["ID Caso", "Escenario de Prueba", "Precondiciones", "Paso a Paso", "Resultado Esperado"];
    const csvRows = hu.detailedTestCases.map((tc, index) => {
      const stepsString = Array.isArray(tc.steps) ? tc.steps.map(step => `${step.numero_paso}. ${step.accion}`).join('\n') : 'Pasos no disponibles.';
      return [
        this.escapeCsvField(hu.id + '_CP' + (index + 1)),
        this.escapeCsvField(tc.title),
        this.escapeCsvField(tc.preconditions),
        this.escapeCsvField(stepsString),
        this.escapeCsvField(tc.expectedResults)
      ];
    });
    const csvFullContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    saveAs(new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }), `MatrizEjecucion_${this.escapeFilename(hu.id)}_${new Date().toISOString().split('T')[0]}.csv`);
  }

  public exportExecutionMatrixToHtml(hu: HUData): void {
    if (this.matrixExporter) {
      // Ahora genera y descarga directamente el archivo Excel
      this.matrixExporter.generateMatrixExcel(hu);
    } else {
      console.error('El componente exportador de matriz no está disponible.');
      this.showNotification('Error: El componente para exportar no se ha cargado correctamente', 'error', 4000);
    }
  }

  public isAnyHuTextBased = (): boolean => this.huList.some(hu => hu.originalInput.generationMode === 'text');

  public trackHuById = (i: number, hu: HUData): string => hu.id;

  private escapeCsvField = (f: string | number | undefined | null): string => {
      if (f === null || f === undefined) return '';
      const stringValue = String(f);
      if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
  };

  public getHuSummaryForStaticAI(): string {
    if (this.huList.length === 0) return "No hay Historias de Usuario definidas aún.";
    let summary = this.huList.map(hu => {
      let huDesc = `ID ${hu.id} (${hu.title}): Modo "${hu.originalInput.generationMode}".`;
      if (hu.originalInput.generationMode === 'text' && hu.originalInput.description) {
        huDesc += ` Descripción: ${hu.originalInput.description.substring(0, 70)}...`;
      }
      return `- ${huDesc}`;
    }).join('\n');
    return summary.length > 1500 ? summary.substring(0, 1500) + "\n... (resumen truncado para no exceder límites de prompt)" : summary;
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
    this.geminiService.generateEnhancedStaticSectionContent(sectionNameDisplay, currentContent, this.getHuSummaryForStaticAI())
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
    if (!titles || titles.length === 0) return 'No se generaron escenarios.';
    return titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  }

  public updateTestPlanTitle(): void {
    if (this.huList.length > 0) {
      const relevantHuForTitle = [...this.huList].reverse().find(hu => hu.originalInput.generationMode !== undefined) || this.huList[this.huList.length - 1];
      this.testPlanTitle = `TEST PLAN EVC00057_ ${relevantHuForTitle.id} SPRINT ${relevantHuForTitle.sprint}`;
    } else {
        this.testPlanTitle = 'Plan de Pruebas (Aún sin entradas)';
    }
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
    if(scenarioHUs.length > 0){
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
    if (this.testPlanTitle) { fullPlanHtmlContent += `<p><span class="preview-section-title">Título del Plan de Pruebas:</span> ${this.escapeHtmlForExport(this.testPlanTitle)}</p>\n\n`; }
    const repoLinkUrl = this.repositoryLink.split(' ')[0];
    fullPlanHtmlContent += `<p><span class="preview-section-title">Repositorio pruebas VSTS:</span> <a href="${this.escapeHtmlForExport(repoLinkUrl)}" target="_blank" rel="noopener noreferrer">${this.escapeHtmlForExport(this.repositoryLink)}</a></p>\n\n`;
    if (this.isAnyHuTextBased()) {
        fullPlanHtmlContent += `<p><span class="preview-section-title">ALCANCE:</span></p>\n`;
        this.huList.forEach((hu) => {
          if (hu.originalInput.generationMode === 'text') {
            fullPlanHtmlContent += `<p><span class="preview-hu-title">HU ${this.escapeHtmlForExport(hu.id)}: ${this.escapeHtmlForExport(hu.title)}</span><br>\n`;
            fullPlanHtmlContent += `${this.escapeHtmlForExport(hu.generatedScope) || '<em>Alcance no generado o no aplica.</em>'}</p>\n\n`;
          }
        });
    }
    fullPlanHtmlContent += `<p><span class="preview-section-title">FUERA DEL ALCANCE:</span><br>\n${this.escapeHtmlForExport(this.outOfScopeContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">ESTRATEGIA:</span><br>\n${this.escapeHtmlForExport(this.strategyContent)}</p>\n\n`;
    const scenarioHUs = this.huList.filter(hu => hu.originalInput.generationMode === 'text');
    if(scenarioHUs.length > 0){
        fullPlanHtmlContent += `<p><span class="preview-section-title">CASOS DE PRUEBA (Solo Títulos):</span></p>\n`;
        scenarioHUs.forEach((hu) => {
          fullPlanHtmlContent += `<p><span class="preview-hu-title">ID ${this.escapeHtmlForExport(hu.id)}: ${this.escapeHtmlForExport(hu.title)} (Técnica: ${this.escapeHtmlForExport(hu.originalInput.selectedTechnique)})</span><br>\n`;
          fullPlanHtmlContent += `${this.escapeHtmlForExport(hu.generatedTestCaseTitles) || '<em>Casos no generados o error.</em>'}</p>\n\n`;
        });
    }
    fullPlanHtmlContent += `<p><span class="preview-section-title">LIMITACIONES:</span><br>\n${this.escapeHtmlForExport(this.limitationsContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">SUPUESTOS:</span><br>\n${this.escapeHtmlForExport(this.assumptionsContent)}</p>\n\n`;
    fullPlanHtmlContent += `<p><span class="preview-section-title">Equipo de Trabajo:</span><br>\n${this.escapeHtmlForExport(this.teamContent)}</p>\n\n`;
    return fullPlanHtmlContent;
  }

  public copyPreviewToClipboard(): void {
    const planText = this.generatePlanContentString();
    if (isPlatformBrowser(this.platformId) && navigator.clipboard) {
      navigator.clipboard.writeText(planText)
        .then(() => this.showNotification('Plan de pruebas copiado al portapapeles!', 'success', 3000))
        .catch(err => {
            console.error('Error al copiar al portapapeles:', err);
            this.showNotification('Error al copiar: ' + err, 'error', 4000);
        });
    } else {
      this.showNotification('La API del portapapeles no es compatible con este navegador', 'error', 4000);
    }
  }

  public downloadWord(): void {
    const htmlContent = this.generatePlanContentHtmlString();
    if (htmlContent.includes('Plan de pruebas aún no generado')) {
      this.showNotification('No hay contenido del plan para descargar', 'warning', 3000);
      return;
    }
    // Funcionalidad DOCX deshabilitada temporalmente debido a incompatibilidades con el navegador
    // La librería html-to-docx requiere módulos de Node.js que no están disponibles en el navegador
    this.showNotification('La descarga en formato DOCX no está disponible. Se descargará como HTML', 'info', 4000);
    this.downloadHtmlFallback(htmlContent);
  }

  private downloadHtmlFallback(htmlContent: string): void {
    const blob = new Blob(['\uFEFF', htmlContent], { type: 'text/html;charset=utf-8' });
    saveAs(blob, `${this.escapeFilename(this.testPlanTitle || 'PlanDePruebas')}_Fallback.html`);
  }

  private escapeFilename = (filename: string): string => filename.replace(/[^a-z0-9_.\-]/gi, '_').substring(0, 50);
}