import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HUData, DetailedTestCase, TestRun, TestRunStatus } from '../models/hu-data.model';
import { DbTestPlanWithRelations } from '../models/database.model';
import { ToastService } from '../services/core/toast.service';
import { DatabaseService } from '../services/database/database.service';
import { TestPlanMapperService } from '../services/database/test-plan-mapper.service';
import { ExecutionStorageService } from '../services/database/execution-storage-supabase.service';
import { SupabaseClientService } from '../services/database/supabase-client.service';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';

interface PlanNode {
  id: string;
  title: string;
  expanded: boolean;
  hus: HuNode[];
}

interface HuNode {
  id: string;
  dbUuid: string;
  title: string;
  hu: HUData;
  testPlanId: string;
  testPlanTitle: string;
}

@Component({
  selector: 'app-manual-execution',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationModalComponent],
  templateUrl: './manual-execution.component.html',
  styleUrls: ['./manual-execution.component.css']
})
export class ManualExecutionComponent implements OnInit, OnDestroy {

  // Test runs data
  testRuns: TestRun[] = [];
  filteredRuns: TestRun[] = [];
  paginatedRuns: TestRun[] = [];
  isLoading = true;

  // Search & filters
  searchQuery = '';
  statusFilter: TestRunStatus | 'all' = 'all';
  sortOrder: 'newest' | 'oldest' = 'newest';

  // Pagination
  currentPage = 1;
  itemsPerPage = 6;
  totalPages = 1;

  // Create modal
  showCreateModal = false;
  createModalTab: 'run' | 'notes' = 'run';
  newRunName = '';
  newRunTags: string[] = [];
  tagInput = '';
  newRunStatus: TestRunStatus = 'Pending';
  newRunNotes = '';
  newRunIncludeAll = false;
  newRunSelectedTestCaseIds: string[] = [];
  showTestCaseSelector = false;
  testCaseSelectorSearch = '';
  isCreating = false;

  // Plan/HU tree for selector
  planTree: PlanNode[] = [];
  selectedHuNode: HuNode | null = null;
  isLoadingPlans = false;

  // Selection
  selectedRunIds: string[] = [];

  // Delete modal
  showDeleteModal = false;
  runToDelete: TestRun | null = null;
  runsToDelete: TestRun[] = [];
  deleteModalMessage = '';

  readonly statusOptions: TestRunStatus[] = ['Pending', 'In Progress', 'Completed', 'Failed', 'Blocked'];
  readonly predefinedTags: string[] = ['Regresión', 'Smoke', 'Funcional', 'Integración', 'UAT', 'E2E', 'Sprint', 'Hotfix', 'Exploratoria'];

  Math = Math;

  constructor(
    private router: Router,
    private toastService: ToastService,
    private databaseService: DatabaseService,
    private mapperService: TestPlanMapperService,
    private storageService: ExecutionStorageService,
    private supabaseClient: SupabaseClientService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadTestRuns();
  }

  ngOnDestroy(): void {}

  @HostListener('document:click')
  onDocumentClick(): void {}

  // ── Data Loading ──

  async loadTestRuns(): Promise<void> {
    this.isLoading = true;
    this.testRuns = [];
    this.filteredRuns = [];
    this.paginatedRuns = [];
    this.cdr.detectChanges();

    try {
      const userId = await this.getCurrentUserId();

      // 1. Load from test_runs table
      let newRuns: TestRun[] = [];
      try {
        const { data, error } = await this.supabaseClient.supabase
          .from('test_runs')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          newRuns = data.map((row: any) => this.rowToTestRun(row));
        }
      } catch (_) {}

      // 2. Load legacy executions from plan_executions
      let legacyRuns: TestRun[] = [];
      let allExecutions: any[] = [];
      try {
        allExecutions = await this.storageService.getAllExecutions();
        const newRunExecutionIds = new Set(newRuns.map(r => r.executionId).filter(Boolean));

        legacyRuns = allExecutions
          .filter(exec => !newRunExecutionIds.has(exec.id))
          .map(exec => this.executionToTestRun(exec));
      } catch (_) {}

      // 3. Sync status of test_runs that have an associated execution
      if (allExecutions.length > 0) {
        const execMap = new Map(allExecutions.map(e => [e.id, e]));
        for (const run of newRuns) {
          if (run.executionId && execMap.has(run.executionId)) {
            const exec = execMap.get(run.executionId);
            const totalCases = exec.testCases?.length || 0;
            const completedCases = exec.testCases?.filter((tc: any) => tc.status === 'completed').length || 0;
            const hasFailed = exec.testCases?.some((tc: any) => tc.status === 'failed');
            const allCompleted = totalCases > 0 && completedCases === totalCases;
            const hasInProgress = exec.testCases?.some((tc: any) => tc.status === 'in-progress');

            let derivedStatus: TestRunStatus = 'Pending';
            if (allCompleted) derivedStatus = hasFailed ? 'Failed' : 'Completed';
            else if (hasInProgress || completedCases > 0) derivedStatus = 'In Progress';

            run.status = derivedStatus;
            run.completedTestCases = completedCases;
            run.totalTestCases = totalCases > 0 ? totalCases : run.totalTestCases;
          }
        }
      }

      this.testRuns = [...newRuns, ...legacyRuns];
      this.applyFilters();
    } catch (err) {
      console.error('Error loading test runs:', err);
      this.testRuns = [];
      this.applyFilters();
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  private executionToTestRun(exec: any): TestRun {
    const totalCases = exec.testCases?.length || 0;
    const completedCases = exec.testCases?.filter((tc: any) => tc.status === 'completed').length || 0;
    const hasFailed = exec.testCases?.some((tc: any) => tc.status === 'failed');
    const allCompleted = totalCases > 0 && completedCases === totalCases;
    const hasInProgress = exec.testCases?.some((tc: any) => tc.status === 'in-progress');

    let status: TestRunStatus = 'Pending';
    if (allCompleted) status = hasFailed ? 'Failed' : 'Completed';
    else if (hasInProgress || completedCases > 0) status = 'In Progress';

    return {
      id: exec.id,
      name: exec.huTitle || 'Ejecución',
      huId: exec.huId || '',
      huTitle: exec.huTitle || '',
      testPlanId: '',
      testPlanTitle: '',
      status,
      notes: '',
      tags: [],
      milestone: '',
      selectedTestCaseIds: [],
      includeAllTestCases: true,
      totalTestCases: totalCases,
      completedTestCases: completedCases,
      executionId: exec.id,
      createdAt: exec.createdAt || Date.now(),
      updatedAt: exec.updatedAt || Date.now()
    };
  }

  private rowToTestRun(row: any): TestRun {
    return {
      id: row.id,
      name: row.name || '',
      huId: row.hu_id || '',
      huTitle: row.hu_title || '',
      testPlanId: row.test_plan_id || '',
      testPlanTitle: row.test_plan_title || '',
      status: row.status || 'Pending',
      notes: row.notes || '',
      tags: row.tags || [],
      milestone: row.milestone || '',
      selectedTestCaseIds: row.selected_test_case_ids || [],
      includeAllTestCases: row.include_all_test_cases ?? true,
      totalTestCases: row.total_test_cases || 0,
      completedTestCases: row.completed_test_cases || 0,
      executionId: row.execution_id || undefined,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime()
    };
  }

  private async getCurrentUserId(): Promise<string> {
    // Try session first
    const { data } = await this.supabaseClient.supabase.auth.getSession();
    if (data?.session?.user?.id) return data.session.user.id;

    // Session might not be ready yet on first navigation, wait briefly and retry
    await new Promise(r => setTimeout(r, 300));
    const { data: retry } = await this.supabaseClient.supabase.auth.getSession();
    if (retry?.session?.user?.id) return retry.session.user.id;

    const { data: userData } = await this.supabaseClient.supabase.auth.getUser();
    if (userData?.user?.id) return userData.user.id;
    throw new Error('No authenticated user');
  }

  // ── Load Plan Tree ──

  async loadPlanTree(): Promise<void> {
    if (this.planTree.length > 0) return; // already loaded
    this.isLoadingPlans = true;

    try {
      const result = await this.databaseService.getAllTestPlansWithRelations(1, 500);
      const plans = result.data || [];

      this.planTree = plans.map(plan => {
        const hus = this.mapperService.mapDbTestPlanToHUList(plan);
        return {
          id: plan.id || '',
          title: plan.title || 'Sin título',
          expanded: false,
          hus: hus.map(hu => ({
            id: hu.id,
            dbUuid: hu.dbUuid || '',
            title: hu.title,
            hu,
            testPlanId: plan.id || '',
            testPlanTitle: plan.title || ''
          }))
        };
      });
    } catch (err) {
      console.error('Error loading plan tree:', err);
      this.toastService.error('Error al cargar los planes de prueba');
    } finally {
      this.isLoadingPlans = false;
      this.cdr.detectChanges();
    }
  }

  // ── Filters & Pagination ──

  applyFilters(): void {
    let runs = [...this.testRuns];

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      runs = runs.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.huTitle.toLowerCase().includes(q) ||
        r.testPlanTitle.toLowerCase().includes(q) ||
        r.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (this.statusFilter !== 'all') {
      runs = runs.filter(r => r.status === this.statusFilter);
    }

    runs.sort((a, b) => this.sortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);

    this.filteredRuns = runs;
    this.totalPages = Math.max(1, Math.ceil(runs.length / this.itemsPerPage));
    if (this.currentPage > this.totalPages) this.currentPage = 1;
    this.paginateRuns();
  }

  paginateRuns(): void {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    this.paginatedRuns = this.filteredRuns.slice(start, start + this.itemsPerPage);
  }

  onSearchChange(): void { this.currentPage = 1; this.applyFilters(); }
  onStatusFilterChange(): void { this.currentPage = 1; this.applyFilters(); }
  onSortChange(): void { this.applyFilters(); }

  // ── Pagination controls ──

  previousPage(): void { if (this.currentPage > 1) { this.currentPage--; this.paginateRuns(); } }
  nextPage(): void { if (this.currentPage < this.totalPages) { this.currentPage++; this.paginateRuns(); } }
  goToPage(page: number): void { this.currentPage = page; this.paginateRuns(); }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 3) pages.push(-1);
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (current < total - 2) pages.push(-1);
      pages.push(total);
    }
    return pages;
  }

  // ── Create Test Run ──

  openCreateModal(): void {
    this.showCreateModal = true;
    this.createModalTab = 'run';
    this.newRunName = '';
    this.newRunTags = [];
    this.tagInput = '';
    this.newRunStatus = 'Pending';
    this.newRunNotes = '';
    this.newRunIncludeAll = false;
    this.newRunSelectedTestCaseIds = [];
    this.showTestCaseSelector = false;
    this.testCaseSelectorSearch = '';
    this.selectedHuNode = null;
    this.loadPlanTree();
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
    this.showTestCaseSelector = false;
  }

  addTag(): void {
    const tag = this.tagInput.trim();
    if (tag && !this.newRunTags.includes(tag) && this.newRunTags.length < 10) {
      this.newRunTags.push(tag);
      this.tagInput = '';
    }
  }

  removeTag(index: number): void { this.newRunTags.splice(index, 1); }

  togglePredefinedTag(tag: string): void {
    const idx = this.newRunTags.indexOf(tag);
    if (idx >= 0) {
      this.newRunTags.splice(idx, 1);
    } else if (this.newRunTags.length < 10) {
      this.newRunTags.push(tag);
    }
  }

  onTagKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') { event.preventDefault(); this.addTag(); }
  }

  openTestCaseSelector(): void {
    this.showTestCaseSelector = true;
    this.testCaseSelectorSearch = '';
    this.loadPlanTree();
  }

  closeTestCaseSelector(): void { this.showTestCaseSelector = false; }

  togglePlanNode(plan: PlanNode): void {
    plan.expanded = !plan.expanded;
  }

  selectHuNode(huNode: HuNode): void {
    this.selectedHuNode = huNode;
    this.newRunSelectedTestCaseIds = [];
  }

  get selectedHuTestCases(): DetailedTestCase[] {
    return this.selectedHuNode?.hu?.detailedTestCases || [];
  }

  get filteredTestCasesForSelector(): DetailedTestCase[] {
    const cases = this.selectedHuTestCases;
    if (!this.testCaseSelectorSearch.trim()) return cases;
    const q = this.testCaseSelectorSearch.toLowerCase();
    return cases.filter(tc =>
      tc.title.toLowerCase().includes(q) ||
      (tc.dbId && tc.dbId.toLowerCase().includes(q))
    );
  }

  isTestCaseSelected(tc: DetailedTestCase): boolean {
    const id = tc.dbId || tc.title;
    return this.newRunSelectedTestCaseIds.includes(id);
  }

  toggleTestCaseSelection(tc: DetailedTestCase): void {
    const id = tc.dbId || tc.title;
    const idx = this.newRunSelectedTestCaseIds.indexOf(id);
    if (idx >= 0) {
      this.newRunSelectedTestCaseIds.splice(idx, 1);
    } else {
      this.newRunSelectedTestCaseIds.push(id);
    }
  }

  selectAllTestCases(): void {
    this.newRunSelectedTestCaseIds = this.filteredTestCasesForSelector.map(tc => tc.dbId || tc.title);
  }

  getTestCaseShortId(tc: DetailedTestCase, index: number): string {
    if (tc.dbId) return 'tc-' + tc.dbId.substring(0, 8);
    return 'tc-' + index;
  }

  async createTestRun(): Promise<void> {
    if (!this.newRunName.trim() || !this.selectedHuNode) {
      this.toastService.warning('Selecciona un plan/HU y asigna un nombre');
      return;
    }
    this.isCreating = true;
    this.cdr.detectChanges();

    try {
      const userId = await this.getCurrentUserId();
      const hu = this.selectedHuNode.hu;
      const includeAll = this.newRunSelectedTestCaseIds.length === 0;
      const totalCases = includeAll
        ? (hu.detailedTestCases?.length || 0)
        : this.newRunSelectedTestCaseIds.length;

      const runId = 'tr-' + crypto.randomUUID().replace(/-/g, '').substring(0, 12);

      const { error } = await this.supabaseClient.supabase
        .from('test_runs')
        .insert({
          id: runId,
          user_id: userId,
          hu_id: hu.dbUuid || hu.id,
          hu_title: hu.title,
          test_plan_id: this.selectedHuNode.testPlanId,
          test_plan_title: this.selectedHuNode.testPlanTitle,
          name: this.newRunName.trim(),
          status: this.newRunStatus,
          notes: this.newRunNotes,
          tags: this.newRunTags,
          include_all_test_cases: includeAll,
          selected_test_case_ids: this.newRunSelectedTestCaseIds,
          total_test_cases: totalCases,
          completed_test_cases: 0
        });

      if (error) throw error;

      this.toastService.success('Ejecución creada exitosamente');
      this.closeCreateModal();
      await this.loadTestRuns();
    } catch (err) {
      console.error('Error creating test run:', err);
      this.toastService.error('Error al crear la ejecución');
    } finally {
      this.isCreating = false;
      this.cdr.detectChanges();
    }
  }

  // ── Selection ──

  isRunSelected(run: TestRun): boolean { return this.selectedRunIds.includes(run.id); }

  areAllVisibleSelected(): boolean {
    return this.paginatedRuns.length > 0 && this.paginatedRuns.every(r => this.selectedRunIds.includes(r.id));
  }

  onToggleSelectAll(checked: boolean): void {
    if (checked) {
      const visibleIds = this.paginatedRuns.map(r => r.id);
      this.selectedRunIds = [...new Set([...this.selectedRunIds, ...visibleIds])];
    } else {
      const visibleIds = new Set(this.paginatedRuns.map(r => r.id));
      this.selectedRunIds = this.selectedRunIds.filter(id => !visibleIds.has(id));
    }
  }

  onRunSelectionChange(run: TestRun, checked: boolean): void {
    if (checked) {
      if (!this.selectedRunIds.includes(run.id)) this.selectedRunIds.push(run.id);
    } else {
      this.selectedRunIds = this.selectedRunIds.filter(id => id !== run.id);
    }
  }

  clearSelection(): void { this.selectedRunIds = []; }

  // ── Actions ──

  async executeRun(run: TestRun): Promise<void> {
    // Find the HU from planTree if loaded
    let huForExecution: HUData | null = null;

    // Ensure planTree is loaded to find the full HU
    if (this.planTree.length === 0) {
      await this.loadPlanTree();
    }

    for (const plan of this.planTree) {
      for (const huNode of plan.hus) {
        const huId = huNode.hu.dbUuid || huNode.hu.id;
        if (huId === run.huId || huNode.hu.id === run.huId) {
          huForExecution = huNode.hu;
          break;
        }
      }
      if (huForExecution) break;
    }

    if (!huForExecution) {
      // Build a minimal HU — plan-execution will reconstruct from stored execution
      huForExecution = {
        id: run.huId,
        title: run.huTitle,
        sprint: '',
        originalInput: { generationMode: 'text' as const, description: '', acceptanceCriteria: '' },
        detailedTestCases: [],
        isScopeDetailsOpen: false,
        isScenariosDetailsOpen: false,
        editingScope: false,
        editingTestCases: false,
        loadingScope: false,
        errorScope: null
      };
    }

    if (!run.includeAllTestCases && run.selectedTestCaseIds.length > 0 && huForExecution.detailedTestCases) {
      const selectedIds = new Set(run.selectedTestCaseIds);
      const filteredCases = huForExecution.detailedTestCases.filter(tc => {
        const id = tc.dbId || tc.title;
        return selectedIds.has(id);
      });
      huForExecution = { ...huForExecution, detailedTestCases: filteredCases };
    }

    this.router.navigate(['/viewer/execute-plan'], {
      state: {
        hu: huForExecution,
        testPlanId: run.testPlanId || '',
        testPlanTitle: run.testPlanTitle || '',
        testRunId: run.executionId || run.id,
        testRunName: run.name,
        forceNewExecution: !run.executionId,
        origin: 'manual-execution'
      }
    });
  }

  confirmDeleteRun(run: TestRun): void {
    this.runsToDelete = [run];
    this.deleteModalMessage = `¿Estás seguro de que deseas eliminar la ejecución "${run.name}"? Esta acción no se puede deshacer.`;
    this.showDeleteModal = true;
  }

  deleteSelectedRuns(): void {
    this.runsToDelete = this.testRuns.filter(r => this.selectedRunIds.includes(r.id));
    const count = this.runsToDelete.length;
    this.deleteModalMessage = `¿Estás seguro de que deseas eliminar ${count} ejecución${count !== 1 ? 'es' : ''}? Esta acción no se puede deshacer.`;
    this.showDeleteModal = true;
  }

  cancelDelete(): void {
    this.showDeleteModal = false;
    this.runsToDelete = [];
    this.deleteModalMessage = '';
  }

  async deleteRun(): Promise<void> {
    if (this.runsToDelete.length === 0) return;

    try {
      const userId = await this.getCurrentUserId();

      for (const run of this.runsToDelete) {
        if (run.executionId) {
          try { await this.storageService.deleteExecution(run.executionId); } catch (_) {}
        }
        try {
          await this.supabaseClient.supabase
            .from('test_runs')
            .delete()
            .eq('id', run.id)
            .eq('user_id', userId);
        } catch (_) {}
      }

      const count = this.runsToDelete.length;
      this.toastService.success(`${count} ejecución${count !== 1 ? 'es' : ''} eliminada${count !== 1 ? 's' : ''}`);
      this.showDeleteModal = false;
      this.runsToDelete = [];
      this.selectedRunIds = [];
      await this.loadTestRuns();
    } catch (err) {
      console.error('Error deleting test runs:', err);
      this.toastService.error('Error al eliminar las ejecuciones');
    }
  }

  // ── Helpers ──

  getProgressPercent(run: TestRun): number {
    if (!run.totalTestCases) return 0;
    return Math.round((run.completedTestCases / run.totalTestCases) * 100);
  }

  getStatusClass(status: TestRunStatus): string {
    const map: Record<TestRunStatus, string> = {
      'Pending': 'status-pending',
      'In Progress': 'status-in-progress',
      'Completed': 'status-completed',
      'Failed': 'status-failed',
      'Blocked': 'status-blocked'
    };
    return map[status] || 'status-pending';
  }

  getStatusLabel(status: TestRunStatus): string {
    const map: Record<TestRunStatus, string> = {
      'Pending': 'Pendiente',
      'In Progress': 'En Progreso',
      'Completed': 'Completado',
      'Failed': 'Fallido',
      'Blocked': 'Bloqueado'
    };
    return map[status] || status;
  }

  formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    return d.toLocaleDateString('es-CO', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'justo ahora';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `hace ${days}d`;
  }

  goToPlansList(): void {
    this.router.navigate(['/viewer']);
  }
}
