import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { DatabaseService, DbTestPlanWithRelations, DbTestPlan, DbUserStoryWithRelations } from '../services/database/database.service';
import { AiUnifiedService } from '../services/ai/ai-unified.service';
import { ToastService } from '../services/core/toast.service';
import { HUData, DetailedTestCase } from '../models/hu-data.model';
import { ExcelMatrixExporterComponent } from '../excel-matrix-exporter/excel-matrix-exporter.component';

import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import { TestPlanMapperService } from '../services/database/test-plan-mapper.service';
import { ExportService } from '../services/export/export.service';
import { catchError, finalize, tap, of } from 'rxjs';

import { StaticSectionName, RiskStrategyData } from './components/general-sections/general-sections.component';

@Component({
  selector: 'app-test-plan-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ExcelMatrixExporterComponent, ConfirmationModalComponent],
  templateUrl: './test-plan-viewer.component.html',
  styleUrls: ['./test-plan-viewer.component.css']
})
export class TestPlanViewerComponent implements OnInit, OnDestroy {
  @ViewChild('matrixExporter') matrixExporter!: ExcelMatrixExporterComponent;

  Math = Math;

  testPlans: Partial<DbTestPlanWithRelations>[] = [];
  filteredTestPlans: Partial<DbTestPlanWithRelations>[] = [];
  selectedTestPlan: DbTestPlanWithRelations | null = null;
  isLoading: boolean = true;
  errorMessage: string = '';

  searchQuery: string = '';
  selectedSprintFilter: string = 'all';
  selectedCellFilter: string = 'all';
  selectedPlanIds: string[] = [];
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

  loadingRepositoryLinkAI: boolean = false;
  loadingOutOfScopeAI: boolean = false;
  loadingStrategyAI: boolean = false;
  loadingLimitationsAI: boolean = false;
  loadingAssumptionsAI: boolean = false;
  loadingTeamAI: boolean = false;
  loadingRiskAI: boolean = false;

  // Modal de confirmación
  isDeleteModalOpen: boolean = false;
  testPlanToDelete: Partial<DbTestPlanWithRelations> | null = null;
  testPlansToDelete: Partial<DbTestPlanWithRelations>[] = [];
  deleteModalMessage: string = '';
  isDeleteHuModalOpen: boolean = false;
  huToDelete: HUData | null = null;
  husToDelete: HUData[] = [];
  deleteHuModalMessage: string = '';

  errorRepositoryLinkAI: string | null = null;
  errorOutOfScopeAI: string | null = null;
  errorStrategyAI: string | null = null;
  errorLimitationsAI: string | null = null;
  errorAssumptionsAI: string | null = null;
  errorTeamAI: string | null = null;
  errorRiskAI: string | null = null;

  riskScenarioOptions: string[] = [];
  riskStrategyData: RiskStrategyData = this.createDefaultRiskStrategyData();

  huList: HUData[] = [];
  paginatedHuList: HUData[] = [];
  huCurrentPage: number = 1;
  huItemsPerPage: number = 5;
  huTotalPages: number = 1;
  selectedHuIds: string[] = [];
  huActionsMenuOpenId: string | null = null;

  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSavePromise: Promise<void> | null = null;
  private autoSaveQueued = false;
  private riskSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private riskSavePromise: Promise<void> | null = null;
  private riskSaveQueued = false;

  private metadataChanged = false;
  private structureChanged = false;

  constructor(
    private databaseService: DatabaseService,
    private aiService: AiUnifiedService,
    private router: Router,
    private route: ActivatedRoute,
    private mapper: TestPlanMapperService,
    private exportService: ExportService,
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
    if (this.riskSaveTimer) {
      clearTimeout(this.riskSaveTimer);
      this.riskSaveTimer = null;
    }
  }

  async loadTestPlans(showLoading: boolean = true) {
    if (showLoading) {
      this.isLoading = true;
    }
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
      if (showLoading) {
        this.isLoading = false;
      }
    }
  }

  applyFilters(): void {
    const availableSprints = new Set<string>();
    const availableCells = new Set<string>();

    this.testPlans.forEach(tp => {
      const normalizedCell = this.normalizeCell(tp.cell_name);
      if (normalizedCell) {
        availableCells.add(normalizedCell);
      }
      tp.user_stories?.forEach((us: any) => {
        const normalizedSprint = this.normalizeSprint(us.sprint);
        if (normalizedSprint) {
          availableSprints.add(normalizedSprint);
        }
      });
    });

    if (this.selectedSprintFilter !== 'all' && !availableSprints.has(this.normalizeSprint(this.selectedSprintFilter))) {
      this.selectedSprintFilter = 'all';
    }

    if (this.selectedCellFilter !== 'all' && !availableCells.has(this.normalizeCell(this.selectedCellFilter))) {
      this.selectedCellFilter = 'all';
    }

    let filtered = [...this.testPlans];

    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(tp =>
        tp.title?.toLowerCase().includes(query) ||
        tp.user_stories?.some((us: any) =>
          us.title?.toLowerCase().includes(query) ||
          this.normalizeSprint(us.sprint).toLowerCase().includes(query)
        )
      );
    }

    if (this.selectedSprintFilter && this.selectedSprintFilter !== 'all') {
      const normalizedSelectedSprint = this.normalizeSprint(this.selectedSprintFilter);
      filtered = filtered.filter(tp =>
        tp.user_stories?.some((us: any) =>
          this.normalizeSprint(us.sprint) === normalizedSelectedSprint
        )
      );
    }

    if (this.selectedCellFilter && this.selectedCellFilter !== 'all') {
      const normalizedSelectedCell = this.normalizeCell(this.selectedCellFilter);
      filtered = filtered.filter(tp =>
        this.normalizeCell(tp.cell_name) === normalizedSelectedCell
      );
    }

    this.filteredTestPlans = filtered;
    this.selectedPlanIds = this.selectedPlanIds.filter(id =>
      this.filteredTestPlans.some(tp => tp.id === id)
    );

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

  private normalizeSprint(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private normalizeCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  getAvailableSprints(): string[] {
    const sprints = new Set<string>();
    this.testPlans.forEach(tp => {
      tp.user_stories?.forEach((us: any) => {
        const normalizedSprint = this.normalizeSprint(us.sprint);
        if (normalizedSprint) {
          sprints.add(normalizedSprint);
        }
      });
    });
    return Array.from(sprints).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  getAvailableCells(): string[] {
    const cells = new Set<string>();
    this.testPlans.forEach(tp => {
      const normalizedCell = this.normalizeCell(tp.cell_name);
      if (normalizedCell) {
        cells.add(normalizedCell);
      }
    });
    return Array.from(cells).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  onCellFilterChange(): void {
    this.applyFilters();
  }

  getMainSprint(testPlan: Partial<DbTestPlanWithRelations>): string {
    const sprints = testPlan.user_stories?.map((us: any) => us.sprint).filter(Boolean) || [];
    const sprintCounts = sprints.reduce((acc: any, sprint: string) => {
      acc[sprint] = (acc[sprint] || 0) + 1;
      return acc;
    }, {});

    return Object.keys(sprintCounts).length > 0
      ? Object.keys(sprintCounts).reduce((a, b) => sprintCounts[a] > sprintCounts[b] ? a : b)
      : 'Sin Sprint';
  }

  isPlanSelected(testPlan: Partial<DbTestPlanWithRelations>): boolean {
    if (!testPlan.id) return false;
    return this.selectedPlanIds.includes(testPlan.id);
  }

  onPlanSelectionChange(testPlan: Partial<DbTestPlanWithRelations>, checked: boolean): void {
    if (!testPlan.id) return;

    if (checked) {
      if (!this.selectedPlanIds.includes(testPlan.id)) {
        this.selectedPlanIds = [...this.selectedPlanIds, testPlan.id];
      }
      return;
    }

    this.selectedPlanIds = this.selectedPlanIds.filter(id => id !== testPlan.id);
  }

  areAllVisiblePlansSelected(): boolean {
    const visibleIds = this.paginatedTestPlans
      .map(tp => tp.id)
      .filter((id): id is string => !!id);

    if (visibleIds.length === 0) return false;
    return visibleIds.every(id => this.selectedPlanIds.includes(id));
  }

  onToggleSelectAllVisible(checked: boolean): void {
    const visibleIds = this.paginatedTestPlans
      .map(tp => tp.id)
      .filter((id): id is string => !!id);

    if (!checked) {
      this.selectedPlanIds = this.selectedPlanIds.filter(id => !visibleIds.includes(id));
      return;
    }

    const currentSelection = new Set(this.selectedPlanIds);
    visibleIds.forEach(id => currentSelection.add(id));
    this.selectedPlanIds = Array.from(currentSelection);
  }

  getSelectedPlans(): Partial<DbTestPlanWithRelations>[] {
    return this.filteredTestPlans.filter(tp => !!tp.id && this.selectedPlanIds.includes(tp.id));
  }

  viewSelectedPlan(): void {
    const selectedPlans = this.getSelectedPlans();
    if (selectedPlans.length !== 1) {
      this.toastService.warning('Selecciona un solo registro para ver detalle');
      return;
    }

    this.selectTestPlan(selectedPlans[0]);
  }

  deleteSelectedPlans(): void {
    const selectedPlans = this.getSelectedPlans();
    if (selectedPlans.length === 0) {
      this.toastService.warning('Selecciona al menos un registro para eliminar');
      return;
    }

    if (selectedPlans.length === 1) {
      this.deleteTestPlan(selectedPlans[0]);
      return;
    }

    this.testPlansToDelete = selectedPlans;
    this.testPlanToDelete = null;
    this.deleteModalMessage = `¿Estás seguro de eliminar ${selectedPlans.length} test plans?\n\nEsta acción no se puede deshacer.`;
    this.isDeleteModalOpen = true;
    this.cdr.detectChanges();
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
        return b.sprint.localeCompare(a.sprint);
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
      this.riskStrategyData = this.createDefaultRiskStrategyData();
      this.errorRiskAI = null;
      this.loadingRiskAI = false;
      await this.loadRiskStrategyFromDatabase(fullTestPlan.id || '');

      // Generate preview

    } catch (error) {
      console.error('❌ Error al seleccionar test plan:', error);
      this.toastService.error('Ocurrió un error al cargar el plan de pruebas.');
    } finally {
      this.isLoading = false;
    }
  }

  convertDbTestPlanToHUList(testPlan: DbTestPlanWithRelations) {
    this.huList = this.mapper.mapDbTestPlanToHUList(testPlan);
    this.huCurrentPage = 1;
    this.updateHuPagination();
    this.selectedHuIds = [];
    this.riskScenarioOptions = this.buildScenarioOptionsForRisk();
  }

  backToList() {
    this.selectedTestPlan = null;
    this.huList = [];
    this.paginatedHuList = [];
    this.huCurrentPage = 1;
    this.huTotalPages = 1;
    this.selectedHuIds = [];
    this.riskScenarioOptions = [];
    this.riskStrategyData = this.createDefaultRiskStrategyData();

    if (this.riskSaveTimer) {
      clearTimeout(this.riskSaveTimer);
      this.riskSaveTimer = null;
    }

  }

  goToCurrentDetail(): void {
    if (!this.selectedTestPlan?.id) return;

    this.router.navigate(['/viewer'], {
      queryParams: { id: this.selectedTestPlan.id }
    });
  }

  toggleHUExpansion(targetHu: HUData): void {
    const shouldExpand = !targetHu.isExpanded;
    this.huList.forEach(hu => hu.isExpanded = false);
    targetHu.isExpanded = shouldExpand;
  }

  getHuTechnique(hu: HUData): string {
    return hu.originalInput?.selectedTechnique || 'N/A';
  }

  isHuSelected(hu: HUData): boolean {
    return this.selectedHuIds.includes(hu.id);
  }

  onHuSelectionChange(hu: HUData, checked: boolean): void {
    if (checked) {
      if (!this.selectedHuIds.includes(hu.id)) {
        this.selectedHuIds = [...this.selectedHuIds, hu.id];
      }
      return;
    }

    this.selectedHuIds = this.selectedHuIds.filter(id => id !== hu.id);
  }

  areAllVisibleHusSelected(): boolean {
    const visibleIds = this.paginatedHuList.map(hu => hu.id);
    if (visibleIds.length === 0) return false;
    return visibleIds.every(id => this.selectedHuIds.includes(id));
  }

  onToggleSelectAllVisibleHus(checked: boolean): void {
    const visibleIds = this.paginatedHuList.map(hu => hu.id);

    if (!checked) {
      this.selectedHuIds = this.selectedHuIds.filter(id => !visibleIds.includes(id));
      return;
    }

    const currentSelection = new Set(this.selectedHuIds);
    visibleIds.forEach(id => currentSelection.add(id));
    this.selectedHuIds = Array.from(currentSelection);
  }

  getSelectedHus(): HUData[] {
    return this.huList.filter(hu => this.selectedHuIds.includes(hu.id));
  }

  canDeleteSelectedHu(): boolean {
    return this.selectedHuIds.length > 0;
  }

  canViewSelectedScenarios(): boolean {
    return this.selectedHuIds.length === 1;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.huActionsMenuOpenId = null;
  }

  private getHuMenuKey(hu: HUData, index: number): string {
    return hu.dbUuid || `${hu.id}-${index}`;
  }

  isHuActionsMenuOpen(hu: HUData, index: number): boolean {
    return this.huActionsMenuOpenId === this.getHuMenuKey(hu, index);
  }

  toggleHuActionsMenu(hu: HUData, index: number, event: Event): void {
    event.stopPropagation();
    const menuKey = this.getHuMenuKey(hu, index);
    this.huActionsMenuOpenId = this.huActionsMenuOpenId === menuKey ? null : menuKey;
  }

  openHUScenarios(hu: HUData, event?: Event): void {
    event?.stopPropagation();
    this.huActionsMenuOpenId = null;

    if (!this.selectedTestPlan?.id) {
      this.toastService.warning('No hay un plan de pruebas seleccionado.');
      return;
    }

    this.router.navigate(['/viewer/hu-scenarios'], {
      state: {
        hu,
        testPlanId: this.selectedTestPlan.id,
        testPlanTitle: this.testPlanTitle || ''
      }
    });
  }

  showSelectedHUScenarios(): void {
    const selectedHus = this.getSelectedHus();
    if (selectedHus.length !== 1) {
      this.toastService.warning('Selecciona una HU para ver escenarios de prueba');
      return;
    }

    this.router.navigate(['/viewer/hu-scenarios'], {
      state: {
        hu: selectedHus[0],
        testPlanId: this.selectedTestPlan?.id || '',
        testPlanTitle: this.testPlanTitle || ''
      }
    });
  }

  openGeneralSectionsView(): void {
    if (!this.selectedTestPlan?.id) {
      this.toastService.warning('No hay un plan de pruebas seleccionado.');
      return;
    }

    this.router.navigate(['/viewer/general-sections', this.selectedTestPlan.id], {
      state: {
        testPlanTitle: this.testPlanTitle || ''
      }
    });
  }

  openRiskStrategyView(): void {
    if (!this.selectedTestPlan?.id) {
      this.toastService.warning('No hay un plan de pruebas seleccionado.');
      return;
    }

    this.router.navigate(['/viewer/risk-strategy', this.selectedTestPlan.id], {
      state: {
        testPlanTitle: this.testPlanTitle || ''
      }
    });
  }

  requestDeleteSelectedHU(): void {
    const selectedHus = this.getSelectedHus();
    if (selectedHus.length === 0) {
      this.toastService.warning('Selecciona al menos una HU para borrar');
      return;
    }

    this.husToDelete = [...selectedHus];
    this.huToDelete = selectedHus[0] || null;
    this.deleteHuModalMessage = selectedHus.length === 1
      ? `¿Deseas borrar la HU "${selectedHus[0].id}: ${selectedHus[0].title}"?\n\nEsta acción eliminará también sus casos y pasos.`
      : `¿Deseas borrar ${selectedHus.length} HUs seleccionadas?\n\nEsta acción eliminará también sus casos y pasos.`;
    this.isDeleteHuModalOpen = true;
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
    // Navegar al componente dedicado de refinamiento
    this.router.navigate(['/refiner'], {
      state: {
        hu: hu,
        testPlanId: this.selectedTestPlan?.id || ''
      }
    });
  }

  openPreview(): void {
    if (!this.selectedTestPlan?.id) {
      this.toastService.warning('No hay un plan de pruebas seleccionado.');
      return;
    }
    this.router.navigate(['/preview', this.selectedTestPlan.id]);
  }

  addNewHU(): void {
    if (!this.selectedTestPlan?.id) {
      this.toastService.warning('No hay un plan de pruebas seleccionado.');
      return;
    }

    this.router.navigate(['/generator'], {
      state: {
        appendToTestPlanId: this.selectedTestPlan.id,
        testPlanTitle: this.testPlanTitle,
        repositoryLink: this.repositoryLink,
        outOfScopeContent: this.outOfScopeContent,
        strategyContent: this.strategyContent,
        limitationsContent: this.limitationsContent,
        assumptionsContent: this.assumptionsContent,
        teamContent: this.teamContent,
        cellName: this.selectedTestPlan.cell_name || '',
        initialSprint: this.huList[this.huList.length - 1]?.sprint || '',
        huList: this.huList
      }
    });
  }

  async deleteHU(hu: HUData, event: Event): Promise<void> {
    event.stopPropagation();

    if (!this.selectedTestPlan?.id) {
      this.toastService.warning('No hay un plan de pruebas seleccionado.');
      return;
    }

    this.huToDelete = hu;
    this.husToDelete = [hu];
    this.deleteHuModalMessage = `¿Deseas borrar la HU "${hu.id}: ${hu.title}"?\n\nEsta acción eliminará también sus casos y pasos.`;
    this.isDeleteHuModalOpen = true;
  }

  async onConfirmDeleteHU(): Promise<void> {
    if (!this.selectedTestPlan?.id) {
      return;
    }

    const husToDelete = this.husToDelete.length > 0
      ? [...this.husToDelete]
      : (this.huToDelete ? [this.huToDelete] : []);

    if (husToDelete.length === 0) {
      return;
    }

    this.isDeleteHuModalOpen = false;
    this.huToDelete = null;
    this.husToDelete = [];

    const previousHuList = [...this.huList];
    const previousSelectedHuIds = [...this.selectedHuIds];
    const previousUserStories = this.selectedTestPlan.user_stories
      ? [...this.selectedTestPlan.user_stories]
      : undefined;
    const planId = this.selectedTestPlan.id!;

    this.syncDetailViewAfterDelete(husToDelete);

    this.structureChanged = true;
    this.cdr.detectChanges();

    const loadingToastId = this.toastService.loading(
      husToDelete.length === 1
        ? 'Borrando HU y sincronizando cambios...'
        : 'Borrando HUs y sincronizando cambios...'
    );
    try {
      await this.autoSaveToDatabase(true);
      // Recargar header desde BD para que sprint/contadores sean exactos
      await this.refreshPlanHeaderInList(planId);
      this.toastService.update(loadingToastId, {
        type: 'success',
        message: husToDelete.length === 1
          ? `HU "${husToDelete[0].id}" borrada correctamente`
          : `${husToDelete.length} HUs borradas correctamente`,
        duration: 4000
      });
    } catch (error) {
      this.huList = previousHuList;
      this.updateHuPagination();
      this.selectedHuIds = previousSelectedHuIds;
      if (this.selectedTestPlan) {
        this.selectedTestPlan.user_stories = previousUserStories;
      }
      // Recargar header para revertir también la vista de lista
      await this.refreshPlanHeaderInList(planId).catch(() => {});
      this.structureChanged = true;
      this.cdr.detectChanges();

      this.toastService.update(loadingToastId, {
        type: 'error',
        message: husToDelete.length === 1
          ? 'No se pudo borrar la HU en base de datos'
          : 'No se pudieron borrar las HUs en base de datos',
        duration: 5000
      });
      console.error('❌ Error al borrar HU:', error);
    }
  }

  private syncDetailViewAfterDelete(husToDelete: HUData[]): void {
    const huIdsToDeleteSet = new Set(husToDelete.map(hu => hu.id));
    this.huList = this.huList.filter(hu => !huIdsToDeleteSet.has(hu.id));
    this.updateHuPagination();
    this.selectedHuIds = this.selectedHuIds.filter(id => !huIdsToDeleteSet.has(id));

    if (this.selectedTestPlan?.user_stories) {
      this.selectedTestPlan.user_stories = this.selectedTestPlan.user_stories.filter(us => {
        return !husToDelete.some(removedHu => {
          const sameDbId = removedHu.dbUuid && us.id === removedHu.dbUuid;
          const sameCustomId = us.custom_id && us.custom_id === removedHu.id;
          return sameDbId || sameCustomId;
        });
      });
    }
  }

  private async refreshPlanHeaderInList(planId: string): Promise<void> {
    try {
      const freshHeader = await this.databaseService.getTestPlanHeaderById(planId);
      if (freshHeader) {
        this.testPlans = this.testPlans.map(tp => tp.id === planId ? freshHeader : tp);
      }
    } catch (error) {
      console.warn('⚠️ No se pudo refrescar header del plan, recargando lista completa:', error);
      await this.loadTestPlans(false);
    }
    this.applyFilters();
    this.cdr.detectChanges();
  }

  onCancelDeleteHU(): void {
    this.isDeleteHuModalOpen = false;
    this.huToDelete = null;
    this.husToDelete = [];
  }

  // === EDICIÓN DE SECCIONES ESTÁTICAS ===

  handleSectionChange(event: { section: StaticSectionName, content: string }): void {
    switch (event.section) {
      case 'repositoryLink':
        this.repositoryLink = event.content;
        break;
      case 'outOfScope':
        this.outOfScopeContent = event.content;
        break;
      case 'strategy':
        this.strategyContent = event.content;
        break;
      case 'limitations':
        this.limitationsContent = event.content;
        break;
      case 'assumptions':
        this.assumptionsContent = event.content;
        break;
      case 'team':
        this.teamContent = event.content;
        break;
    }
    this.metadataChanged = true;
    this.autoSaveToDatabase();

    this.cdr.detectChanges();
  }

  handleRiskDataChange(riskData: RiskStrategyData): void {
    this.riskStrategyData = {
      ...riskData,
      positiveScenarios: [...riskData.positiveScenarios],
      alternateScenarios: [...riskData.alternateScenarios]
    };
    void this.autoSaveRiskStrategy().catch(error => {
      console.warn('⚠️ No se pudo auto-guardar el riesgo:', error);
    });
    this.cdr.detectChanges();
  }

  generateRiskStrategyWithAI(): void {
    if (!this.selectedTestPlan || this.huList.length === 0) {
      this.riskStrategyData = this.createDefaultRiskStrategyData();
      this.riskScenarioOptions = [];
      this.cdr.detectChanges();
      return;
    }

    const huSummary = this.mapper.getHuSummaryForAI(this.huList);
    this.riskScenarioOptions = this.buildScenarioOptionsForRisk();

    this.loadingRiskAI = true;
    this.errorRiskAI = null;
    this.cdr.detectChanges();

    this.aiService.generateRiskStrategy(huSummary, this.riskScenarioOptions)
      .pipe(
        tap((response: any) => {
          this.riskStrategyData = this.mapRiskAiResponse(response);
          void this.autoSaveRiskStrategy(true).catch(error => {
            console.warn('⚠️ No se pudo guardar el riesgo generado por IA:', error);
          });
          this.toastService.success('Riesgo para estrategia de pruebas generado con IA');
        }),
        catchError(err => {
          const errorMsg = err?.message || 'Error desconocido al generar riesgo con IA';
          this.errorRiskAI = errorMsg;
          this.toastService.error(`No se pudo generar el riesgo: ${errorMsg}`);
          return of(null);
        }),
        finalize(() => {
          this.loadingRiskAI = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe();
  }

  regenerateStaticSectionWithAI(section: StaticSectionName): void {
    if (!this.selectedTestPlan || this.huList.length === 0) {
      this.toastService.warning('No hay un test plan seleccionado o no hay HUs para proporcionar contexto');
      return;
    }

    // Mapeo de nombres de secciones a nombres amigables
    const sectionNameMap: Record<StaticSectionName, string> = {
      'repositoryLink': 'Repositorio Pruebas VSTS',
      'outOfScope': 'Fuera del Alcance',
      'strategy': 'Estrategia',
      'limitations': 'Limitaciones',
      'assumptions': 'Supuestos',
      'team': 'Equipo de Trabajo'
    };

    // Obtener el contenido existente de la sección
    const existingContentMap: Record<StaticSectionName, string> = {
      'repositoryLink': this.repositoryLink,
      'outOfScope': this.outOfScopeContent,
      'strategy': this.strategyContent,
      'limitations': this.limitationsContent,
      'assumptions': this.assumptionsContent,
      'team': this.teamContent
    };

    const existingContent = existingContentMap[section] || '';
    const sectionName = sectionNameMap[section];

    // Crear contexto consolidado de HUs + escenarios para IA
    const huSummary = this.mapper.getHuSummaryForAI(this.huList);

    // Mapeo de propiedades de loading y error
    const loadingMap: Record<StaticSectionName, string> = {
      'repositoryLink': 'loadingRepositoryLinkAI',
      'outOfScope': 'loadingOutOfScopeAI',
      'strategy': 'loadingStrategyAI',
      'limitations': 'loadingLimitationsAI',
      'assumptions': 'loadingAssumptionsAI',
      'team': 'loadingTeamAI'
    };

    const errorMap: Record<StaticSectionName, string> = {
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

    this.aiService.generateEnhancedStaticSectionContent(sectionName, existingContent, huSummary)
      .pipe(
        tap(enhancedContent => {
          if (!enhancedContent || enhancedContent.trim() === '') {
            this.toastService.info(`La sección "${sectionName}" ya está completa. No se sugirieron mejoras adicionales`);
            return;
          }

          // Reemplazar por completo el contenido de la sección con salida compacta
          const newContent = this.compactStaticSectionContent(enhancedContent);

          // Actualizar el contenido de la sección
          switch (section) {
            case 'repositoryLink':
              this.repositoryLink = newContent;
              break;
            case 'outOfScope':
              this.outOfScopeContent = newContent;
              break;
            case 'strategy':
              this.strategyContent = newContent;
              break;
            case 'limitations':
              this.limitationsContent = newContent;
              break;
            case 'assumptions':
              this.assumptionsContent = newContent;
              break;
            case 'team':
              this.teamContent = newContent;
              break;
          }

          this.autoSaveToDatabase();

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

  async exportExecutionMatrixToDOXC(hu: HUData): Promise<void> {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      this.toastService.warning('No hay casos de prueba válidos para exportar');
      return;
    }

    try {
      await this.exportService.exportToDOXC(hu);
      this.toastService.success('Matriz (.doxc) exportada exitosamente');
    } catch (error) {
      this.toastService.error('Error al exportar la matriz (.doxc)');
    }
  }

  exportExecutionMatrixToExcel(hu: HUData): void {
    if (this.matrixExporter) {
      this.matrixExporter.generateMatrixExcel(hu);
    } else {
      this.toastService.error('El componente para exportar no se ha cargado correctamente');
    }
  }

  exportExecutionMatrixToHtml(hu: HUData): void {
    if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
      this.toastService.warning('No hay casos de prueba para exportar');
      return;
    }

    try {
      // Generar contenido HTML básico para la matriz
      let htmlContent = `
        <html>
        <head>
          <style>
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid black; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>Matriz de Ejecución - ${hu.id}</h1>
          <table>
            <thead>
              <tr>
                <th>ID Caso</th>
                <th>Escenario</th>
                <th>Precondiciones</th>
                <th>Pasos</th>
                <th>Resultado Esperado</th>
              </tr>
            </thead>
            <tbody>
      `;

      hu.detailedTestCases.forEach((tc, index) => {
        const stepsHtml = tc.steps.map(s => `${s.numero_paso}. ${s.accion}`).join('<br>');
        htmlContent += `
          <tr>
            <td>${hu.id}_CP${index + 1}</td>
            <td>${tc.title}</td>
            <td>${tc.preconditions}</td>
            <td>${stepsHtml}</td>
            <td>${tc.expectedResults}</td>
          </tr>
        `;
      });

      htmlContent += `
            </tbody>
          </table>
        </body>
        </html>
      `;

      this.exportService.exportToHTML(htmlContent, `Matriz_${hu.id}`);
      this.toastService.success('Matriz exportada a HTML exitosamente');
    } catch (error) {
      console.error('Error exportando a HTML:', error);
      this.toastService.error('Error al exportar la matriz a HTML');
    }
  }

  // === GUARDAR EN BD ===

  private async performDatabaseSave(): Promise<void> {
    if (!this.selectedTestPlan?.id) {
      return;
    }

    // Optimización: Si solo cambiaron metadatos, usar actualización ligera
    if (this.metadataChanged && !this.structureChanged) {
      const updates: Partial<DbTestPlan> = {
        title: this.testPlanTitle,
        repository_link: this.repositoryLink,
        out_of_scope: this.outOfScopeContent,
        strategy: this.strategyContent,
        limitations: this.limitationsContent,
        assumptions: this.assumptionsContent,
        team: this.teamContent
      };

      await this.databaseService.updateTestPlan(this.selectedTestPlan.id, updates);
      console.log('✅ Metadatos actualizados (Optimizado)');

      this.metadataChanged = false;
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
      id: hu.dbUuid, // Pasar el ID de BD si existe para que smartUpdate lo reconozca
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

    await this.databaseService.smartUpdateTestPlan(this.selectedTestPlan.id, testPlanData, userStories);
    console.log('✅ Auto-guardado exitoso en BD con custom_ids:', userStories.map(us => us.custom_id));

    this.metadataChanged = false;
    this.structureChanged = false;
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
      let riskSaveWarning = false;
      try {
        await this.autoSaveRiskStrategy(true);
      } catch (riskError) {
        riskSaveWarning = true;
        console.warn('⚠️ El plan se guardó, pero el riesgo no se pudo persistir:', riskError);
      }

      // Actualizar el toast de loading a success con el título del plan
      const planTitle = this.testPlanTitle || 'Test Plan';
      this.toastService.update(loadingToastId, {
        type: 'success',
        message: riskSaveWarning
          ? `✅ "${planTitle}" guardado. Riesgos pendientes de persistir en BD`
          : `✅ "${planTitle}" guardado exitosamente`,
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

  onDeleteButtonPointerDown(event: PointerEvent, testPlan: Partial<DbTestPlanWithRelations>): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this.deleteTestPlan(testPlan);
  }

  deleteTestPlan(testPlan: Partial<DbTestPlanWithRelations>) {
    this.testPlansToDelete = [testPlan];
    this.testPlanToDelete = testPlan;
    this.deleteModalMessage = `¿Estás seguro de eliminar "${testPlan.title}"?\n\nEsta acción no se puede deshacer.`;
    this.isDeleteModalOpen = true;
    this.cdr.detectChanges();
  }

  onCancelDeleteTestPlan(): void {
    this.isDeleteModalOpen = false;
    this.testPlanToDelete = null;
    this.testPlansToDelete = [];
  }

  async onConfirmDelete() {
    const plansToDelete = this.testPlansToDelete.length > 0
      ? [...this.testPlansToDelete]
      : (this.testPlanToDelete ? [this.testPlanToDelete] : []);

    if (plansToDelete.length === 0) return;

    this.isDeleteModalOpen = false;
    this.testPlanToDelete = null;
    this.testPlansToDelete = [];

    const loadingToastId = this.toastService.loading(
      plansToDelete.length === 1 ? 'Eliminando test plan...' : `Eliminando ${plansToDelete.length} test plans...`
    );

    try {
      let deletedCount = 0;
      const deletedIds: string[] = [];

      for (const plan of plansToDelete) {
        if (!plan.id) continue;

        const success = await this.databaseService.deleteTestPlan(plan.id);
        if (success) {
          deletedCount++;
          deletedIds.push(plan.id);
        }
      }

      this.toastService.dismiss(loadingToastId);

      if (deletedCount > 0) {
        if (deletedCount === plansToDelete.length) {
          this.toastService.success(
            deletedCount === 1
              ? 'Test plan eliminado exitosamente'
              : `${deletedCount} test plans eliminados exitosamente`
          );
        } else {
          this.toastService.warning(
            `Se eliminaron ${deletedCount} de ${plansToDelete.length} test plans`
          );
        }

        await this.loadTestPlans(false);

        this.selectedPlanIds = this.selectedPlanIds.filter(id => !deletedIds.includes(id));

        if (this.selectedTestPlan?.id && deletedIds.includes(this.selectedTestPlan.id)) {
          this.selectedTestPlan = null;
        }
      } else {
        this.toastService.error('Error al eliminar el test plan');
      }
    } catch (error) {
      console.error('❌ Error:', error);
      this.toastService.dismiss(loadingToastId);
      this.toastService.error('Error al eliminar el test plan');
    }
  }

  trackHuById(index: number, hu: HUData): string {
    return hu.dbUuid || `${hu.id}-${index}`;
  }

  updateHuPagination(): void {
    this.huTotalPages = Math.ceil(this.huList.length / this.huItemsPerPage);

    if (this.huCurrentPage > this.huTotalPages && this.huTotalPages > 0) {
      this.huCurrentPage = this.huTotalPages;
    }

    if (this.huTotalPages === 0) {
      this.huCurrentPage = 1;
      this.paginatedHuList = [];
      return;
    }

    const startIndex = (this.huCurrentPage - 1) * this.huItemsPerPage;
    const endIndex = startIndex + this.huItemsPerPage;
    this.paginatedHuList = this.huList.slice(startIndex, endIndex);
  }

  goToHuPage(page: number): void {
    if (page >= 1 && page <= this.huTotalPages) {
      this.huCurrentPage = page;
      this.updateHuPagination();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  nextHuPage(): void {
    this.goToHuPage(this.huCurrentPage + 1);
  }

  previousHuPage(): void {
    this.goToHuPage(this.huCurrentPage - 1);
  }

  getHuPageNumbers(): number[] {
    const pages: number[] = [];
    const maxPagesToShow = 5;

    if (this.huTotalPages <= maxPagesToShow) {
      for (let i = 1; i <= this.huTotalPages; i++) {
        pages.push(i);
      }
    } else {
      if (this.huCurrentPage <= 3) {
        pages.push(1, 2, 3, 4, -1, this.huTotalPages);
      } else if (this.huCurrentPage >= this.huTotalPages - 2) {
        pages.push(1, -1, this.huTotalPages - 3, this.huTotalPages - 2, this.huTotalPages - 1, this.huTotalPages);
      } else {
        pages.push(1, -1, this.huCurrentPage - 1, this.huCurrentPage, this.huCurrentPage + 1, -1, this.huTotalPages);
      }
    }

    return pages;
  }

  private compactStaticSectionContent(content: string): string {
    if (!content) return '';

    const lines = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^[-•\d.)\s]+/, '').trim())
      .slice(0, 4)
      .map(line => line.slice(0, 110));

    const compact = lines.join('\n');
    return compact.slice(0, 420).trim();
  }

  private createDefaultRiskStrategyData(): RiskStrategyData {
    return {
      probabilidadDe: '',
      puedeOcurrir: '',
      loQuePodriaOcasionar: '',
      impacto: '',
      probabilidad: '',
      positiveScenarios: ['', ''],
      alternateScenarios: ['']
    };
  }

  private buildScenarioOptionsForRisk(): string[] {
    const scenarios = this.huList
      .flatMap(hu => {
        const detailed = (hu.detailedTestCases || [])
          .map(tc => tc.title?.trim())
          .filter((title): title is string => Boolean(title));

        if (detailed.length > 0) {
          return detailed.map(title => `${hu.id} - ${title}`);
        }

        return (hu.generatedTestCaseTitles || '')
          .split(/\r?\n|\|/)
          .map(line => line.trim())
          .filter(Boolean)
          .map(title => `${hu.id} - ${title}`);
      })
      .filter(Boolean);

    return Array.from(new Set(scenarios)).slice(0, 40);
  }

  private mapRiskAiResponse(response: any): RiskStrategyData {
    const impactOption = this.mapImpactFromAi(response?.impactLevel);
    const probabilityOption = this.mapProbabilityFromAi(response?.probabilityLevel);

    const positiveScenarios = this.normalizeScenarioSelection(response?.positiveScenarios, 2, 2);
    const alternateScenarios = this.normalizeScenarioSelection(response?.alternateScenarios, 1, 1);

    return {
      probabilidadDe: (response?.probabilidadDe || '').toString().trim(),
      puedeOcurrir: (response?.puedeOcurrir || '').toString().trim(),
      loQuePodriaOcasionar: (response?.loQuePodriaOcasionar || '').toString().trim(),
      impacto: impactOption,
      probabilidad: probabilityOption,
      positiveScenarios,
      alternateScenarios
    };
  }

  private mapImpactFromAi(value: unknown): string {
    const impactMap: Record<number, string> = {
      1: '1 - Ninguno',
      2: '2 - Bajo',
      3: '3 - Moderado',
      4: '4 - Alto',
      5: '5 - Crítico'
    };

    const numeric = Number(value);
    return impactMap[numeric] || '';
  }

  private mapProbabilityFromAi(value: unknown): string {
    const probabilityMap: Record<number, string> = {
      25: '25% - Poca posibilidad de ocurrir',
      50: '50% - Puede ocurrir',
      75: '75% - Gran posibilidad de ocurrir',
      100: '100% - Ocurrido (Issue)'
    };

    const numeric = Number(value);
    return probabilityMap[numeric] || '';
  }

  private normalizeScenarioSelection(rawScenarios: unknown, minItems: number, maxItems: number): string[] {
    const aiScenarios = Array.isArray(rawScenarios)
      ? rawScenarios.map(item => (item ?? '').toString().trim()).filter(Boolean)
      : [];

    const normalizedFromOptions = aiScenarios.map(aiScenario => {
      const exact = this.riskScenarioOptions.find(option => option === aiScenario);
      if (exact) {
        return exact;
      }

      const partial = this.riskScenarioOptions.find(option =>
        option.toLowerCase().includes(aiScenario.toLowerCase()) ||
        aiScenario.toLowerCase().includes(option.toLowerCase())
      );

      return partial || aiScenario;
    });

    const merged = [...normalizedFromOptions];
    this.riskScenarioOptions.forEach(option => {
      if (merged.length >= maxItems) {
        return;
      }
      if (!merged.includes(option)) {
        merged.push(option);
      }
    });

    while (merged.length < minItems) {
      merged.push('');
    }

    return merged.slice(0, maxItems);
  }

  private async loadRiskStrategyFromDatabase(testPlanId: string): Promise<void> {
    if (!testPlanId) {
      return;
    }

    const savedRisk = await this.databaseService.getRiskStrategyByTestPlanId(testPlanId);
    if (!savedRisk?.risk_data) {
      return;
    }

    const riskData = savedRisk.risk_data;
    this.riskStrategyData = {
      probabilidadDe: (riskData?.probabilidadDe || '').toString().trim(),
      puedeOcurrir: (riskData?.puedeOcurrir || '').toString().trim(),
      loQuePodriaOcasionar: (riskData?.loQuePodriaOcasionar || '').toString().trim(),
      impacto: (riskData?.impacto || '').toString().trim(),
      probabilidad: (riskData?.probabilidad || '').toString().trim(),
      positiveScenarios: Array.isArray(riskData?.positiveScenarios)
        ? riskData.positiveScenarios.map((item: any) => (item ?? '').toString().trim()).filter((item: string) => item.length > 0)
        : ['', ''],
      alternateScenarios: Array.isArray(riskData?.alternateScenarios)
        ? riskData.alternateScenarios.map((item: any) => (item ?? '').toString().trim()).filter((item: string) => item.length > 0)
        : ['']
    };

    while (this.riskStrategyData.positiveScenarios.length < 2) {
      this.riskStrategyData.positiveScenarios.push('');
    }
    while (this.riskStrategyData.alternateScenarios.length < 1) {
      this.riskStrategyData.alternateScenarios.push('');
    }
  }

  private async persistRiskStrategy(): Promise<void> {
    if (!this.selectedTestPlan?.id) {
      return;
    }

    const success = await this.databaseService.upsertRiskStrategy(this.selectedTestPlan.id, this.riskStrategyData);
    if (!success) {
      throw new Error('No se pudo guardar el riesgo en base de datos');
    }
  }

  private scheduleRiskSaveProcessing(): Promise<void> {
    this.riskSaveQueued = true;

    if (this.riskSavePromise) {
      return this.riskSavePromise;
    }

    this.riskSavePromise = (async () => {
      try {
        do {
          this.riskSaveQueued = false;
          await this.persistRiskStrategy();
        } while (this.riskSaveQueued);
      } finally {
        this.riskSavePromise = null;
        this.riskSaveQueued = false;
      }
    })();

    return this.riskSavePromise;
  }

  async autoSaveRiskStrategy(force: boolean = false): Promise<void> {
    if (!this.selectedTestPlan?.id) {
      return;
    }

    if (this.riskSaveTimer) {
      clearTimeout(this.riskSaveTimer);
      this.riskSaveTimer = null;
    }

    if (force) {
      await this.scheduleRiskSaveProcessing();
      return;
    }

    this.riskSaveTimer = setTimeout(() => {
      this.riskSaveTimer = null;
      this.scheduleRiskSaveProcessing().catch(error => {
        console.error('⚠️ Error en auto-guardado diferido de riesgo:', error);
      });
    }, 800);
  }
}
