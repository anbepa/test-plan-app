import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { DatabaseService, DbTestPlanWithRelations, DbTestPlan, DbUserStoryWithRelations } from '../services/database.service';
import { GeminiService } from '../services/gemini.service';
import { HUData, DetailedTestCase } from '../models/hu-data.model';
import { TestCaseEditorComponent, UIDetailedTestCase } from '../test-case-editor/test-case-editor.component';
import { HtmlMatrixExporterComponent } from '../html-matrix-exporter/html-matrix-exporter.component';
import { WordExporterComponent } from '../word-exporter/word-exporter.component';
import { ToastService } from '../services/toast.service';
import { catchError, finalize, tap, of } from 'rxjs';
import { saveAs } from 'file-saver';

type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

@Component({
  selector: 'app-test-plan-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TestCaseEditorComponent, HtmlMatrixExporterComponent, WordExporterComponent],
  templateUrl: './test-plan-viewer.component.html',
  styleUrls: ['./test-plan-viewer.component.css']
})
export class TestPlanViewerComponent implements OnInit, OnDestroy {
  @ViewChild('matrixExporter') matrixExporter!: HtmlMatrixExporterComponent;

  Math = Math;

  testPlans: Partial<DbTestPlanWithRelations>[] = [];
  filteredTestPlans: Partial<DbTestPlanWithRelations>[] = [];
  selectedTestPlan: DbTestPlanWithRelations | null = null;
  isLoading: boolean = true;
  errorMessage: string = '';

  searchQuery: string = '';
  selectedSprintFilter: string = 'all';
  selectedCellFilter: string = 'all';
  savingToDatabase: boolean = false;

  currentPage: number = 1;
  itemsPerPage: number = 6;
  totalPages: number = 1;
  paginatedTestPlans: Partial<DbTestPlanWithRelations>[] = [];

  testPlanTitle: string = '';
  repositoryLink: string = '';
  outOfScopeContent: string = '';
  strategyContent: string = '';
  limitationsContent: string = '';
  assumptionsContent: string = '';
  teamContent: string = '';

  editingRepositoryLink: boolean = false;
  editingOutOfScope: boolean = false;
  editingStrategy: boolean = false;
  editingLimitations: boolean = false;
  editingAssumptions: boolean = false;
  editingTeam: boolean = false;

  loadingRepositoryLinkAI: boolean = false;
  loadingOutOfScopeAI: boolean = false;
  loadingStrategyAI: boolean = false;
  loadingLimitationsAI: boolean = false;
  loadingAssumptionsAI: boolean = false;
  loadingTeamAI: boolean = false;

  errorRepositoryLinkAI: string | null = null;
  errorOutOfScopeAI: string | null = null;
  errorStrategyAI: string | null = null;
  errorLimitationsAI: string | null = null;
  errorAssumptionsAI: string | null = null;
  errorTeamAI: string | null = null;

  isRepositoryLinkDetailsOpen: boolean = false;
  isOutOfScopeDetailsOpen: boolean = false;
  isStrategyDetailsOpen: boolean = false;
  isLimitationsDetailsOpen: boolean = false;
  isAssumptionsDetailsOpen: boolean = false;
  isTeamDetailsOpen: boolean = false;

  huList: HUData[] = [];

  downloadPreviewHtmlContent: string = '';

  isEditModalOpen: boolean = false;
  editingHU: HUData | null = null;

  isPreviewModalOpen: boolean = false;

  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSavePromise: Promise<void> | null = null;
  private autoSaveQueued = false;

  constructor(
    private databaseService: DatabaseService,
    private geminiService: GeminiService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private toastService: ToastService
  ) { }

  async ngOnInit() {
    await this.loadTestPlans();

    this.route.queryParams.subscribe(async params => {
      const id = params['id'];
      if (id && this.testPlans.length > 0) {
        const testPlan = this.testPlans.find(tp => tp.id === id);
        if (testPlan) {
          this.selectTestPlan(testPlan);
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  async loadTestPlans() {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      console.log('🔍 Cargando test plans desde Supabase...');
      this.testPlans = await this.databaseService.getTestPlanHeaders();
      console.log('✅ Test plans cargados:', this.testPlans.length);

      if (this.testPlans.length === 0) {
        this.errorMessage = 'No hay test plans guardados en la base de datos.';
      }

      this.applyFilters();
    } catch (error) {
      console.error('❌ Error cargando test plans:', error);
      this.errorMessage = 'Error al cargar los test plans. Verifica la consola para más detalles.';
    } finally {
      this.isLoading = false;
    }
  }

  applyFilters(): void {
    let filtered = [...this.testPlans];

    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(tp =>
        tp.title?.toLowerCase().includes(query) ||
        tp.user_stories?.some((us: any) =>
          us.title?.toLowerCase().includes(query) ||
          us.sprint?.toLowerCase().includes(query)
        )
      );
    }

    if (this.selectedSprintFilter && this.selectedSprintFilter !== 'all') {
      filtered = filtered.filter(tp =>
        tp.user_stories?.some((us: any) =>
          us.sprint === this.selectedSprintFilter
        )
      );
    }

    if (this.selectedCellFilter && this.selectedCellFilter !== 'all') {
      filtered = filtered.filter(tp =>
        tp.cell_name === this.selectedCellFilter
      );
    }

    this.filteredTestPlans = filtered;

    this.currentPage = 1;
    this.updatePagination();
  }

  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredTestPlans.length / this.itemsPerPage);

    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }

    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;

    this.paginatedTestPlans = this.filteredTestPlans.slice(startIndex, endIndex);
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePagination();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxPagesToShow = 5;

    if (this.totalPages <= maxPagesToShow) {
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Mostrar páginas con elipsis
      if (this.currentPage <= 3) {
        pages.push(1, 2, 3, 4, -1, this.totalPages);
      } else if (this.currentPage >= this.totalPages - 2) {
        pages.push(1, -1, this.totalPages - 3, this.totalPages - 2, this.totalPages - 1, this.totalPages);
      } else {
        pages.push(1, -1, this.currentPage - 1, this.currentPage, this.currentPage + 1, -1, this.totalPages);
      }
    }

    return pages;
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  onSprintFilterChange(): void {
    this.applyFilters();
  }

  getAvailableSprints(): string[] {
    const sprints = new Set<string>();
    this.testPlans.forEach(tp => {
      tp.user_stories?.forEach((us: any) => {
        if (us.sprint) {
          sprints.add(us.sprint);
        }
      });
    });
    return Array.from(sprints).sort();
  }

  getAvailableCells(): string[] {
    const cells = new Set<string>();
    this.testPlans.forEach(tp => {
      if (tp.cell_name) {
        cells.add(tp.cell_name);
      }
    });
    return Array.from(cells).sort();
  }

  onCellFilterChange(): void {
    this.applyFilters();
  }

  // Agrupar test plans por sprint
  getGroupedTestPlans(): { sprint: string; plans: Partial<DbTestPlanWithRelations>[] }[] {
    const grouped = new Map<string, Partial<DbTestPlanWithRelations>[]>();

    // Usar paginatedTestPlans en lugar de filteredTestPlans
    this.paginatedTestPlans.forEach(tp => {
      // Obtener el sprint más común en las HUs del test plan
      const sprints = tp.user_stories?.map((us: any) => us.sprint).filter(Boolean) || [];
      const sprintCounts = sprints.reduce((acc: any, sprint: string) => {
        acc[sprint] = (acc[sprint] || 0) + 1;
        return acc;
      }, {});

      const mainSprint = Object.keys(sprintCounts).length > 0
        ? Object.keys(sprintCounts).reduce((a, b) => sprintCounts[a] > sprintCounts[b] ? a : b)
        : 'Sin Sprint';

      if (!grouped.has(mainSprint)) {
        grouped.set(mainSprint, []);
      }
      grouped.get(mainSprint)?.push(tp);
    });

    // Convertir a array y ordenar
    return Array.from(grouped.entries())
      .map(([sprint, plans]) => ({ sprint, plans }))
      .sort((a, b) => {
        if (a.sprint === 'Sin Sprint') return 1;
        if (b.sprint === 'Sin Sprint') return -1;
        return a.sprint.localeCompare(b.sprint);
      });
  }

  async selectTestPlan(testPlan: Partial<DbTestPlanWithRelations>) {
    this.isLoading = true;
    try {
      console.log('📋 Test plan seleccionado (header):', testPlan);

      // Siempre obtener la versión completa desde la base de datos para garantizar que
      // las secciones de detalle (alcance, estrategia, supuestos, etc.) estén presentes.
      // Los headers traen información parcial y pueden dejar la vista vacía.
      let fullTestPlan: DbTestPlanWithRelations | null = null;
      try {
        console.log('📥 Cargando detalles completos del test plan...');
        fullTestPlan = await this.databaseService.getTestPlanById(testPlan.id!);
      } catch (error) {
        console.error('❌ No se pudo obtener el detalle desde la BD, usando header parcial:', error);
        fullTestPlan = testPlan as DbTestPlanWithRelations;
      }

      if (!fullTestPlan) {
        this.toastService.error('No se pudo cargar el detalle del plan de pruebas.');
        return;
      }

      this.selectedTestPlan = fullTestPlan;
      console.log('📋 Test plan completo cargado:', this.selectedTestPlan);

      // Load editable data
      this.testPlanTitle = fullTestPlan.title || '';
      this.repositoryLink = fullTestPlan.repository_link || '';
      this.outOfScopeContent = fullTestPlan.out_of_scope || '';
      this.strategyContent = fullTestPlan.strategy || '';
      this.limitationsContent = fullTestPlan.limitations || '';
      this.assumptionsContent = fullTestPlan.assumptions || '';
      this.teamContent = fullTestPlan.team || '';

      // Convert user stories to HUData
      this.convertDbTestPlanToHUList(fullTestPlan);

      // Generate preview
      this.updatePreview();
    } catch (error) {
      console.error('❌ Error al seleccionar test plan:', error);
      this.toastService.error('Ocurrió un error al cargar el plan de pruebas.');
    } finally {
      this.isLoading = false;
    }
  }

  convertDbTestPlanToHUList(testPlan: DbTestPlanWithRelations) {
    this.huList = (testPlan.user_stories || []).map((us: any, index: number) => {
      console.log(`🔍 VIEWER cargando HU ${index}:`, {
        custom_id: us.custom_id,
        db_id: us.id,
        title: us.title,
        generated_scope: us.generated_scope
      });

      // Usar el custom_id si existe, sino generar uno temporal basado en el índice
      // NUNCA usar us.id (UUID de BD) como fallback para evitar sobrescribir el custom_id original
      const customId = us.custom_id || `HU_${index + 1}_${testPlan.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}`;

      console.log(`✅ ID seleccionado para HU ${index}: ${customId}`);

      const huData: HUData = {
        id: customId, // Usar el ID personalizado guardado en la BD
        title: us.title || '',
        sprint: us.sprint || '',
        generatedScope: us.generated_scope || '',
        generatedTestCaseTitles: us.generated_test_case_titles || '',
        detailedTestCases: (us.test_cases || []).map((tc: any, tcIdx: number) => ({
          title: tc.title || '',
          preconditions: tc.preconditions || '',
          steps: (tc.test_case_steps || []).map((step: any, idx: number) => ({
            numero_paso: idx + 1,
            accion: step.action || ''
          })),
          expectedResults: tc.expected_results || ''
        })),
        originalInput: {
          generationMode: (us.generation_mode as any) || 'text',
          description: us.description || '',
          acceptanceCriteria: us.acceptance_criteria || '',
          selectedTechnique: us.refinement_technique || undefined
        },
        refinementTechnique: us.refinement_technique || '',
        refinementContext: us.refinement_context || '',
        isScopeDetailsOpen: !!(us.generated_scope && us.generated_scope.trim()), // Abrir automáticamente si hay alcance
        isScenariosDetailsOpen: false,
        editingScope: false,
        editingTestCases: false,
        editingScenariosTestCases: false,
        loadingScope: false,
        errorScope: null
      };
      return huData;
    });
  }

  backToList() {
    this.selectedTestPlan = null;
    this.huList = [];
    this.downloadPreviewHtmlContent = '';
  }

  formatDate(dateString: string | undefined): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getTestCaseCount(testPlan: Partial<DbTestPlanWithRelations>): number {
    return testPlan.user_stories?.reduce((total: number, us: any) => {
      return total + (us.test_cases?.length || 0);
    }, 0) || 0;
  }

  getTotalStepsCount(testPlan: Partial<DbTestPlanWithRelations>): number {
    return testPlan.user_stories?.reduce((total: number, us: any) => {
      return total + (us.test_cases?.reduce((tcTotal: number, tc: any) => {
        return tcTotal + (tc.test_case_steps?.length || 0);
      }, 0) || 0);
    }, 0) || 0;
  }

  // === EDICIÓN Y REFINAMIENTO CON IA ===

  toggleEdit(hu: HUData, section: 'scope' | 'testCases'): void {
    if (section === 'scope') {
      hu.editingScope = !hu.editingScope;
      if (hu.editingScope) hu.isScopeDetailsOpen = true;
    } else if (section === 'testCases') {
      // Abrir modal en lugar de editar inline
      this.openEditModal(hu);
    }
    this.cdr.detectChanges();
  }

  openEditModal(hu: HUData): void {
    this.editingHU = hu;
    this.isEditModalOpen = true;
    hu.editingScenariosTestCases = true;
    hu.isScopeDetailsOpen = true;
    // Prevenir scroll en el body
    document.body.style.overflow = 'hidden';
    this.cdr.detectChanges();
  }

  closeEditModal(): void {
    if (this.editingHU) {
      this.editingHU.editingScenariosTestCases = false;
    }
    this.editingHU = null;
    this.isEditModalOpen = false;
    // Restaurar scroll en el body
    document.body.style.overflow = '';
    this.cdr.detectChanges();
  }

  openPreviewModal(): void {
    this.isPreviewModalOpen = true;
    // Prevenir scroll en el body
    document.body.style.overflow = 'hidden';
    this.cdr.detectChanges();
  }

  closePreviewModal(): void {
    this.isPreviewModalOpen = false;
    // Restaurar scroll en el body
    document.body.style.overflow = '';
    this.cdr.detectChanges();
  }

  handleConfigTestCasesChanged(hu: HUData, updatedTestCases: UIDetailedTestCase[]): void {
    hu.detailedTestCases = updatedTestCases.map(tc => ({
      title: tc.title,
      preconditions: tc.preconditions,
      steps: tc.steps.map((step, idx) => ({
        numero_paso: idx + 1,
        accion: step.accion
      })),
      expectedResults: tc.expectedResults,
      isExpanded: tc.isExpanded // Preservar estado del acordeón
    }));
    this.updatePreview();
    this.autoSaveToDatabase();
  }

  handleConfigRefineWithAI(hu: HUData, refinementData: { technique: string; context: string }): void {
    hu.refinementTechnique = refinementData.technique;
    hu.refinementContext = refinementData.context;
    this.refineDetailedTestCases(hu);
  }

  public refineDetailedTestCases(hu: HUData): void {
    if (!hu.refinementTechnique || !hu.refinementContext) {
      this.toastService.warning('Debes seleccionar una técnica y proporcionar contexto para refinar');
      return;
    }

    hu.loadingScope = true;
    hu.errorScope = null;
    this.cdr.detectChanges();

    this.geminiService.refineDetailedTestCases(
      hu.originalInput,
      hu.detailedTestCases || [],
      hu.refinementTechnique,
      hu.refinementContext
    ).pipe(
      tap((refined: DetailedTestCase[]) => {
        hu.detailedTestCases = refined;
        hu.loadingScope = false;
        this.updatePreview();
        this.autoSaveToDatabase();
      }),
      catchError((error) => {
        console.error('Error refinando:', error);
        hu.errorScope = 'Error al refinar con IA. Intenta de nuevo.';
        hu.loadingScope = false;
        this.cdr.detectChanges();
        return of([]);
      }),
      finalize(() => {
        this.cdr.detectChanges();
      })
    ).subscribe();
  }

  // === EDICIÓN DE SECCIONES ESTÁTICAS ===

  toggleStaticEdit(section: StaticSectionBaseName): void {
    switch (section) {
      case 'repositoryLink':
        this.editingRepositoryLink = !this.editingRepositoryLink;
        if (!this.editingRepositoryLink) this.autoSaveToDatabase();
        break;
      case 'outOfScope':
        this.editingOutOfScope = !this.editingOutOfScope;
        if (!this.editingOutOfScope) this.autoSaveToDatabase();
        break;
      case 'strategy':
        this.editingStrategy = !this.editingStrategy;
        if (!this.editingStrategy) this.autoSaveToDatabase();
        break;
      case 'limitations':
        this.editingLimitations = !this.editingLimitations;
        if (!this.editingLimitations) this.autoSaveToDatabase();
        break;
      case 'assumptions':
        this.editingAssumptions = !this.editingAssumptions;
        if (!this.editingAssumptions) this.autoSaveToDatabase();
        break;
      case 'team':
        this.editingTeam = !this.editingTeam;
        if (!this.editingTeam) this.autoSaveToDatabase();
        break;
    }
    this.updatePreview();
    this.cdr.detectChanges();
  }

  regenerateStaticSectionWithAI(section: StaticSectionBaseName): void {
    if (!this.selectedTestPlan || this.huList.length === 0) {
      this.toastService.warning('No hay un test plan seleccionado o no hay HUs para proporcionar contexto');
      return;
    }

    // Mapeo de nombres de secciones a nombres amigables
    const sectionNameMap: Record<StaticSectionBaseName, string> = {
      'repositoryLink': 'Repositorio Pruebas VSTS',
      'outOfScope': 'Fuera del Alcance',
      'strategy': 'Estrategia',
      'limitations': 'Limitaciones',
      'assumptions': 'Supuestos',
      'team': 'Equipo de Trabajo'
    };

    // Obtener el contenido existente de la sección
    const existingContentMap: Record<StaticSectionBaseName, string> = {
      'repositoryLink': this.repositoryLink,
      'outOfScope': this.outOfScopeContent,
      'strategy': this.strategyContent,
      'limitations': this.limitationsContent,
      'assumptions': this.assumptionsContent,
      'team': this.teamContent
    };

    const existingContent = existingContentMap[section] || '';
    const sectionName = sectionNameMap[section];

    // Crear resumen de HUs para contexto
    const huSummary = this.huList.map((hu, idx) =>
      `HU ${idx + 1} (${hu.id}): ${hu.title} - Técnica: ${hu.originalInput.selectedTechnique || 'N/A'}`
    ).join('\n');

    // Mapeo de propiedades de loading y error
    const loadingMap: Record<StaticSectionBaseName, string> = {
      'repositoryLink': 'loadingRepositoryLinkAI',
      'outOfScope': 'loadingOutOfScopeAI',
      'strategy': 'loadingStrategyAI',
      'limitations': 'loadingLimitationsAI',
      'assumptions': 'loadingAssumptionsAI',
      'team': 'loadingTeamAI'
    };

    const errorMap: Record<StaticSectionBaseName, string> = {
      'repositoryLink': 'errorRepositoryLinkAI',
      'outOfScope': 'errorOutOfScopeAI',
      'strategy': 'errorStrategyAI',
      'limitations': 'errorLimitationsAI',
      'assumptions': 'errorAssumptionsAI',
      'team': 'errorTeamAI'
    };

    // Activar loading
    (this as any)[loadingMap[section]] = true;
    (this as any)[errorMap[section]] = null;
    this.cdr.detectChanges();

    // Llamar al servicio de Gemini
    this.geminiService.generateEnhancedStaticSectionContent(sectionName, existingContent, huSummary)
      .pipe(
        tap(enhancedContent => {
          if (!enhancedContent || enhancedContent.trim() === '') {
            this.toastService.info(`La sección "${sectionName}" ya está completa. No se sugirieron mejoras adicionales`);
            return;
          }

          // Añadir el contenido mejorado al existente
          const newContent = existingContent
            ? `${existingContent}\n\n${enhancedContent}`
            : enhancedContent;

          // Actualizar el contenido de la sección
          switch (section) {
            case 'repositoryLink':
              this.repositoryLink = newContent;
              this.isRepositoryLinkDetailsOpen = true;
              break;
            case 'outOfScope':
              this.outOfScopeContent = newContent;
              this.isOutOfScopeDetailsOpen = true;
              break;
            case 'strategy':
              this.strategyContent = newContent;
              this.isStrategyDetailsOpen = true;
              break;
            case 'limitations':
              this.limitationsContent = newContent;
              this.isLimitationsDetailsOpen = true;
              break;
            case 'assumptions':
              this.assumptionsContent = newContent;
              this.isAssumptionsDetailsOpen = true;
              break;
            case 'team':
              this.teamContent = newContent;
              this.isTeamDetailsOpen = true;
              break;
          }

          this.autoSaveToDatabase();
          this.updatePreview();
          this.cdr.detectChanges();
          this.toastService.success(`Sección "${sectionName}" mejorada con IA exitosamente`);
        }),
        catchError(err => {
          const errorMsg = err?.message || 'Error desconocido al mejorar con IA';
          (this as any)[errorMap[section]] = errorMsg;
          this.toastService.error(`Error al mejorar "${sectionName}": ${errorMsg}`);
          return of(null);
        }),
        finalize(() => {
          (this as any)[loadingMap[section]] = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe();
  }

  // === EXPORTACIÓN ===

  exportExecutionMatrix(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      this.toastService.warning('No hay casos de prueba para exportar');
      return;
    }

    let csvContent = 'ID Caso,Escenario de Prueba,Precondiciones,Pasos,Resultado Esperado\n';

    hu.detailedTestCases.forEach((tc, index) => {
      const id = `${hu.id}_CP${index + 1}`;
      const steps = tc.steps.map((s, i) => `${i + 1}. ${s.accion}`).join(' | ');
      const row = [
        id,
        tc.title,
        tc.preconditions || '',
        steps,
        tc.expectedResults || ''
      ].map(cell => `"${cell.replace(/"/g, '""')}"`).join(',');

      csvContent += row + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `matriz_ejecucion_${hu.id}.csv`);
    this.toastService.success('Matriz exportada en formato CSV');
  }

  exportExecutionMatrixToHtml(hu: HUData): void {
    if (!this.matrixExporter) {
      this.toastService.error('Componente de exportación no disponible');
      return;
    }

    // Llamar al método generateMatrixExcel que está implementado
    try {
      this.matrixExporter.generateMatrixExcel(hu);
      // El toast de éxito se muestra dentro de generateMatrixExcel
    } catch (error) {
      console.error('Error al exportar matriz Excel:', error);
      this.toastService.error('Error al generar el archivo Excel');
    }
  }

  // === PREVISUALIZACIÓN Y DESCARGA ===

  updatePreview(): void {
    console.log('🔍 updatePreview() llamado');
    console.log('📊 HU List:', this.huList.length);

    if (this.huList.length === 0) {
      console.warn('⚠️ No hay HUs para generar preview');
      this.downloadPreviewHtmlContent = '';
      return;
    }

    let html = `<h1>Plan de Pruebas: ${this.testPlanTitle}</h1>\n\n`;

    // Repositorio al inicio (sin título de sección)
    html += `<p><strong>Repositorio:</strong> ${this.repositoryLink || 'No especificado'}</p>\n\n`;

    // 1. ALCANCE - Lista de HUs con su alcance
    html += `<h2>1. ALCANCE</h2>\n`;
    this.huList.forEach(hu => {
      html += `<p><strong>HU ${hu.id}</strong></p>\n`;
      if (hu.generatedScope) {
        html += `<p>${hu.generatedScope}</p>\n`;
      } else {
        html += `<p>No se generó alcance para esta HU.</p>\n`;
      }
      html += `\n`;
    });

    // 2. Fuera de Alcance
    html += `<h2>2. Fuera de Alcance</h2>\n`;
    html += `<p>${this.outOfScopeContent || 'No especificado'}</p>\n\n`;

    // 3. Estrategia
    html += `<h2>3. Estrategia</h2>\n`;
    html += `<p>${this.strategyContent || 'No especificada'}</p>\n\n`;

    // 4. Casos de Prueba - Por HU, solo nombre del escenario
    html += `<h2>4. Casos de Prueba</h2>\n`;
    this.huList.forEach(hu => {
      html += `<h3>ID ${hu.id}: ${hu.title}</h3>\n`;

      if (hu.detailedTestCases && hu.detailedTestCases.length > 0) {
        html += `<ul>\n`;
        hu.detailedTestCases.forEach((tc) => {
          html += `<li>${tc.title}</li>\n`;
        });
        html += `</ul>\n`;
      } else {
        html += `<p>No hay casos de prueba para esta HU.</p>\n`;
      }
      html += `\n`;
    });

    // 5. Limitaciones
    html += `<h2>5. Limitaciones</h2>\n`;
    html += `<p>${this.limitationsContent || 'No especificadas'}</p>\n\n`;

    // 6. Supuestos
    html += `<h2>6. Supuestos</h2>\n`;
    html += `<p>${this.assumptionsContent || 'No especificados'}</p>\n\n`;

    // 7. Equipo de trabajo
    html += `<h2>7. Equipo de trabajo</h2>\n`;
    html += `<p>${this.teamContent || 'No especificado'}</p>\n\n`;

    this.downloadPreviewHtmlContent = html;
    console.log('✅ Preview HTML generado, longitud:', html.length);
  }

  async downloadWord(): Promise<void> {
    console.log('🔍 downloadWord() llamado');
    console.log('📄 HTML Content:', this.downloadPreviewHtmlContent);
    console.log('📝 HU List length:', this.huList.length);

    if (!this.downloadPreviewHtmlContent) {
      console.error('❌ No hay contenido HTML para descargar');
      this.toastService.warning('No hay contenido para descargar. Intenta seleccionar un test plan primero');
      return;
    }

    try {
      console.log('🔄 Generando documento HTML...');

      // Crear un documento HTML completo con estilos modernos inspirados en Apple
      const fullHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plan de Pruebas - ${this.testPlanTitle}</title>
  <style>
    /* Estilo Apple moderno y sobrio */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1d1d1f;
      background: #ffffff;
      padding: 40px 60px;
      max-width: 1400px;
      margin: 0 auto;
    }
    
    h1 {
      font-size: 48px;
      font-weight: 700;
      color: #1d1d1f;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      padding-bottom: 24px;
      border-bottom: 1px solid #d2d2d7;
    }
    
    h2 {
      font-size: 32px;
      font-weight: 600;
      color: #1d1d1f;
      letter-spacing: -0.01em;
      margin-top: 48px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e8e8ed;
    }
    
    h3 {
      font-size: 24px;
      font-weight: 600;
      color: #424245;
      letter-spacing: -0.01em;
      margin-top: 32px;
      margin-bottom: 16px;
    }
    
    h4 {
      font-size: 19px;
      font-weight: 600;
      color: #1d1d1f;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    
    p {
      font-size: 17px;
      line-height: 1.7;
      color: #1d1d1f;
      margin: 12px 0;
    }
    
    strong {
      font-weight: 600;
      color: #1d1d1f;
    }
    
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin: 24px 0;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.06);
    }
    
    th {
      background: linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%);
      color: #1d1d1f;
      padding: 16px 20px;
      text-align: left;
      font-weight: 600;
      font-size: 15px;
      letter-spacing: -0.01em;
      border-bottom: 1px solid #d2d2d7;
    }
    
    td {
      padding: 16px 20px;
      border-bottom: 1px solid #f5f5f7;
      font-size: 15px;
      color: #1d1d1f;
      vertical-align: top;
    }
    
    tr:last-child td {
      border-bottom: none;
    }
    
    tr:hover {
      background-color: #fafafa;
    }
    
    /* Estilo para listas */
    ul, ol {
      margin: 16px 0;
      padding-left: 28px;
    }
    
    li {
      font-size: 17px;
      line-height: 1.7;
      color: #1d1d1f;
      margin: 8px 0;
    }
    
    /* Estilo para secciones importantes */
    .section {
      margin: 32px 0;
      padding: 24px;
      background: #f5f5f7;
      border-radius: 12px;
    }
    
    /* Estilo para código o elementos técnicos */
    code {
      font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
      font-size: 14px;
      background: #f5f5f7;
      padding: 2px 6px;
      border-radius: 4px;
      color: #0071e3;
    }
    
    /* Footer */
    footer {
      margin-top: 64px;
      padding-top: 32px;
      border-top: 1px solid #d2d2d7;
      text-align: center;
      color: #86868b;
      font-size: 14px;
    }
    
    /* Responsive para impresión */
    @media print {
      body {
        padding: 20px;
        max-width: 100%;
      }
      
      h1 {
        font-size: 36px;
        page-break-after: avoid;
      }
      
      h2 {
        font-size: 28px;
        page-break-after: avoid;
      }
      
      h3 {
        font-size: 20px;
        page-break-after: avoid;
      }
      
      table {
        page-break-inside: avoid;
        box-shadow: none;
      }
      
      tr {
        page-break-inside: avoid;
      }
    }
    
    /* Mejoras adicionales */
    a {
      color: #0071e3;
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    blockquote {
      border-left: 3px solid #0071e3;
      padding-left: 20px;
      margin: 20px 0;
      color: #424245;
      font-style: italic;
    }
  </style>
</head>
<body>
${this.downloadPreviewHtmlContent}
<footer>
  <p>Documento generado el ${new Date().toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}</p>
</footer>
</body>
</html>`;

      console.log('✅ HTML generado, descargando...');
      const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
      saveAs(blob, `plan_pruebas_${this.testPlanTitle || 'documento'}.html`);
      this.toastService.success('Documento HTML descargado exitosamente. Puedes abrirlo con cualquier navegador y guardarlo como PDF');
    } catch (error) {
      console.error('❌ Error al generar el documento:', error);
      this.toastService.error('Error al generar el documento. Revisa la consola para más detalles');
    }
  }

  copyPreviewToClipboard(): void {
    // Convertir HTML a texto con formato APA
    let textContent = this.downloadPreviewHtmlContent
      // Convertir encabezados h1 a formato APA Nivel 1 (centrado, negrilla, mayúscula inicial)
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, (match, title) => {
        // Capitalizar solo primera letra de cada palabra (título propio)
        const formattedTitle = title.replace(/\b\w/g, (l: string) => l.toUpperCase());
        // Centrar el título con espacios
        const spaces = ' '.repeat(Math.max(0, Math.floor((80 - formattedTitle.length) / 2)));
        return `\n\n${spaces}${formattedTitle}\n\n`;
      })
      // Convertir encabezados h2 a formato APA Nivel 2 (izquierda, negrilla)
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, (match, title) => {
        // Capitalizar solo primera letra de cada palabra
        const formattedTitle = title.replace(/\b\w/g, (l: string) => l.toUpperCase());
        return `\n\n${formattedTitle}\n\n`;
      })
      // Convertir encabezados h3 a formato APA Nivel 3 (izquierda, negrilla + cursiva)
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, (match, title) => {
        // Capitalizar solo primera letra de cada palabra
        const formattedTitle = title.replace(/\b\w/g, (l: string) => l.toUpperCase());
        return `\n\n${formattedTitle}\n\n`;
      })
      // Convertir listas <ul><li> a viñetas organizadas (para elementos no secuenciales)
      .replace(/<ul[^>]*>/gi, '\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '     • $1\n')
      // Convertir listas numeradas <ol><li> (para pasos o secuencia lógica)
      .replace(/<ol[^>]*>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, (match, content, offset, string) => {
        // Contar elementos li anteriores para numeración secuencial
        const beforeText = string.substring(0, offset);
        const liCount = (beforeText.match(/<li[^>]*>/g) || []).length + 1;
        return `     ${liCount}. ${content}\n`;
      })
      // Convertir párrafos con sangría en primera línea e interlineado doble (estilo formal APA)
      .replace(/<p[^>]*>(.*?)<\/p>/gi, (match, content) => {
        const cleanContent = content.trim();
        if (cleanContent) {
          // Sangría de 5 espacios en primera línea, redacción clara y tono formal
          return `     ${cleanContent}\n\n`;
        }
        return '\n';
      })
      // Convertir <br> a saltos de línea dobles
      .replace(/<br\s*\/?>/gi, '\n\n')
      // Eliminar formato de negrilla para compatibilidad con editores de texto plano
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '$1')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '$1')
      // Eliminar cualquier otra etiqueta HTML restante
      .replace(/<[^>]+>/g, '')
      // Reemplazar entidades HTML
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Aplicar estructura de formato APA con interlineado doble
      .replace(/\n{3,}/g, '\n\n')
      // Limpiar espacios en blanco al inicio/final de cada línea manteniendo sangría
      .split('\n').map(line => {
        // Mantener sangría intencional, solo limpiar espacios finales
        return line.trimEnd();
      }).join('\n')
      // Limpiar espacios al inicio y final del documento
      .trim();

    navigator.clipboard.writeText(textContent).then(() => {
      this.toastService.success('Texto del plan copiado al portapapeles con formato APA');
    }).catch(err => {
      console.error('Error al copiar:', err);
      this.toastService.error('Error al copiar al portapapeles');
    });
  }

  // === GUARDAR EN BD ===

  private async performDatabaseSave(): Promise<void> {
    if (!this.selectedTestPlan?.id) {
      return;
    }

    const testPlanData: DbTestPlan = {
      title: this.testPlanTitle,
      repository_link: this.repositoryLink,
      out_of_scope: this.outOfScopeContent,
      strategy: this.strategyContent,
      limitations: this.limitationsContent,
      assumptions: this.assumptionsContent,
      team: this.teamContent
    };

    const userStories: DbUserStoryWithRelations[] = this.huList.map((hu, index) => ({
      test_plan_id: this.selectedTestPlan!.id!,
      custom_id: hu.id,
      title: hu.title,
      description: hu.originalInput.description || '',
      acceptance_criteria: hu.originalInput.acceptanceCriteria || '',
      generated_scope: hu.generatedScope || '',
      generated_test_case_titles: hu.generatedTestCaseTitles || '',
      generation_mode: hu.originalInput.generationMode || 'text',
      sprint: hu.sprint || '',
      refinement_technique: hu.refinementTechnique,
      refinement_context: hu.refinementContext,
      position: index,
      test_cases: (hu.detailedTestCases || []).map((tc, tcIndex) => ({
        user_story_id: '',
        title: tc.title,
        preconditions: tc.preconditions || '',
        expected_results: tc.expectedResults || '',
        position: tcIndex + 1,
        test_case_steps: tc.steps
          .filter(step => step.accion && step.accion.trim() !== '')
          .map((step, stepIndex) => ({
            test_case_id: '',
            step_number: stepIndex + 1,
            action: step.accion
          }))
      })),
      images: []
    }));

    await this.databaseService.updateCompleteTestPlan(this.selectedTestPlan.id, testPlanData, userStories);
    console.log('✅ Auto-guardado exitoso en BD con custom_ids:', userStories.map(us => us.custom_id));
  }

  private scheduleAutoSaveProcessing(): Promise<void> {
    this.autoSaveQueued = true;

    if (this.autoSavePromise) {
      return this.autoSavePromise;
    }

    this.autoSavePromise = (async () => {
      try {
        do {
          this.autoSaveQueued = false;
          await this.performDatabaseSave();
        } while (this.autoSaveQueued);
      } finally {
        this.autoSavePromise = null;
        this.autoSaveQueued = false;
      }
    })();

    return this.autoSavePromise;
  }

  async autoSaveToDatabase(force: boolean = false): Promise<void> {
    if (!this.selectedTestPlan?.id) {
      return;
    }

    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    if (force) {
      await this.scheduleAutoSaveProcessing();
      return;
    }

    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      this.scheduleAutoSaveProcessing().catch(error => {
        console.error('⚠️ Error en auto-guardado diferido:', error);
      });
    }, 800);
  }

  async saveToDatabase(): Promise<void> {
    if (!this.selectedTestPlan?.id) {
      this.toastService.warning('No hay test plan seleccionado');
      return;
    }

    // Mostrar toast de carga
    const loadingToastId = this.toastService.loading('Guardando cambios en la base de datos...');
    this.savingToDatabase = true;
    this.cdr.detectChanges();

    try {
      await this.autoSaveToDatabase(true);

      // Actualizar el toast de loading a success con el título del plan
      const planTitle = this.testPlanTitle || 'Test Plan';
      this.toastService.update(loadingToastId, {
        type: 'success',
        message: `✅ "${planTitle}" guardado exitosamente`,
        duration: 4500
      });
    } catch (error) {
      console.error('❌ Error al guardar:', error);

      // Actualizar el toast de loading a error
      this.toastService.update(loadingToastId, {
        type: 'error',
        message: 'Error al guardar en la base de datos. Verifica la consola para más detalles',
        duration: 5000
      });
    } finally {
      this.savingToDatabase = false;
      this.cdr.detectChanges();
    }
  }



  // === ELIMINAR TEST PLAN ===

  async deleteTestPlan(testPlan: Partial<DbTestPlanWithRelations>) {
    const confirmed = confirm(`¿Estás seguro de eliminar "${testPlan.title}"?\n\nEsta acción no se puede deshacer.`);
    if (!confirmed) return;

    const loadingToastId = this.toastService.loading('Eliminando test plan...');
    this.isLoading = true;

    try {
      const success = await this.databaseService.deleteTestPlan(testPlan.id!);

      this.toastService.dismiss(loadingToastId);

      if (success) {
        this.toastService.success('Test plan eliminado exitosamente');
        await this.loadTestPlans();
        if (this.selectedTestPlan?.id === testPlan.id) {
          this.selectedTestPlan = null;
        }
      } else {
        this.toastService.error('Error al eliminar el test plan');
      }
    } catch (error) {
      console.error('❌ Error:', error);
      this.toastService.dismiss(loadingToastId);
      this.toastService.error('Error al eliminar el test plan');
    } finally {
      this.isLoading = false;
    }
  }

  trackHuById(index: number, hu: HUData): string {
    return hu.id;
  }
}
