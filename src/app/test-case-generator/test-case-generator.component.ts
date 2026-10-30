import { Component, OnInit, OnDestroy, ViewChild, ElementRef, Inject, PLATFORM_ID, Output, EventEmitter, Input, ChangeDetectorRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { DetailedTestCase as OriginalDetailedTestCase, TestCaseStep, HUData as OriginalHUData, GenerationMode } from '../models/hu-data.model';
import { AiUnifiedService } from '../services/ai/ai-unified.service';
import { ToastService } from '../services/core/toast.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Observable, of, forkJoin, Subscription, firstValueFrom } from 'rxjs';
import { saveAs } from 'file-saver';
import { TestCaseEditorComponent, UIDetailedTestCase as EditorUIDetailedTestCase } from '../test-case-editor/test-case-editor.component';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import { AzureDevOpsIntegrationService } from '../services/integrations/azure-devops-integration.service';
import { AzureDevOpsImportedUserStory } from '../models/azure-devops.model';
import { CellsConfigService } from '../services/core/cells-config.service';
import { AzureReposService } from '../services/integrations/azure-repos.service';
import { CodeExplorerAgentService } from '../services/ai/code-explorer-agent.service';
import { CriteriaNormalizerService } from '../services/ai/criteria-normalizer.service';
import { criteriaIds, uncoveredCriteria } from '../services/ai/criteria-normalizer';
import { AzureRepoBranch, AzureRepoProject, AzureRepository, ContextSource, CriterionCodeStatus, WorkItemChangeGroup, WorkItemChanges, changeGroupKey } from '../models/code-agent.model';

interface CoverageRow {
  id: string;
  criterion: string;
  status: CriterionCodeStatus;
  detail: string;
}
import { MarkdownLitePipe } from '../shared/pipes/markdown-lite.pipe';

interface UIDetailedTestCase extends OriginalDetailedTestCase {
  isExpanded?: boolean;
}

interface UIHUData extends OriginalHUData {
  detailedTestCases: UIDetailedTestCase[];
}

type ComponentState = 'initialForm' | 'previewingGenerated' | 'editingForRefinement' | 'submitting';

/** Pasos del flujo de generación, en el orden en que se alimentan entre sí. */
type FlowStepId = 'hu' | 'criteria' | 'code' | 'context' | 'generate';
type FlowStepStatus = 'pending' | 'running' | 'done' | 'stale' | 'optional';

interface FlowStep {
  id: FlowStepId;
  num: number;
  title: string;
  status: FlowStepStatus;
  statusLabel: string;
  summary: string;
}

const FLOW_STATUS_LABELS: Record<FlowStepStatus, string> = {
  pending: 'Pendiente', running: 'En curso', done: 'Listo', stale: 'Desactualizado', optional: 'Opcional'
};

@Component({
  selector: 'app-test-case-generator',
  standalone: true,
  imports: [FormsModule, CommonModule, TestCaseEditorComponent, ConfirmationModalComponent, MarkdownLitePipe],
  templateUrl: './test-case-generator.component.html',
  styleUrls: ['./test-case-generator.component.css']
})
export class TestCaseGeneratorComponent implements OnInit, OnDestroy {
  private readonly AUTO_TECHNIQUE = 'Automática';

  @Input() initialGenerationMode: GenerationMode = 'text';
  @Input() initialSprint: string = '';
  @Input() initialCellName: string = '';
  @Input() accumulatedHUsCount: number = 0;
  @Output() huGenerated = new EventEmitter<OriginalHUData>();
  @Output() huSaved = new EventEmitter<OriginalHUData>();
  @Output() generationCancelled = new EventEmitter<void>();
  @Output() cellNameChanged = new EventEmitter<string>();

  componentState: ComponentState = 'initialForm';
  currentGenerationMode: GenerationMode = 'text';

  currentHuId: string = '';
  currentHuTitle: string = '';
  currentSprint: string = '';
  currentDescription: string = '';
  currentAcceptanceCriteria: string = '';

  // ---- Fuente de contexto: criterios y/o código fuente (Azure Repos) ----
  readonly contextSourceOptions: { value: ContextSource; label: string; hint: string }[] = [
    { value: 'criteria', label: 'Solo criterios', hint: 'Genera con la HU y los criterios de aceptación (flujo actual).' },
    { value: 'criteria-code', label: 'Criterios + código', hint: 'Los criterios mandan; el agente explora la rama para complementar con reglas del código.' },
    { value: 'code', label: 'Repositorio + rama', hint: 'El código es la fuente principal; los criterios son opcionales.' }
  ];
  contextSource: ContextSource = 'criteria';
  codeProjects: AzureRepoProject[] = [];
  codeRepositories: AzureRepository[] = [];
  codeBranches: AzureRepoBranch[] = [];
  codeProject: string = '';
  codeRepositoryId: string = '';
  codeBranch: string = '';
  codeLoadingTarget: boolean = false;
  /** Consultando los PRs/commits vinculados a la HU. */
  codeLoadingHuChanges: boolean = false;
  /** El usuario prefiere elegir otra rama aunque la HU tenga PRs/commits vinculados. */
  codeManualOverride: boolean = false;
  codeTargetError: string | null = null;
  codeLinkedBranchHint: string | null = null;
  /** PRs/commits vinculados a la HU: si existen, el agente analiza exactamente esos cambios. */
  codeHuChanges: WorkItemChanges | null = null;
  /** Grupos de cambios de la HU que el usuario desmarcó (changeGroupKey). */
  codeExcludedGroups = new Set<string>();
  codeExploring: boolean = false;
  codeAgentLog: string[] = [];
  codeAgentError: string | null = null;
  codeContextText: string = '';
  codeFilesReviewed: string[] = [];
  /** Vista markdown (false) o edición en texto (true). */
  criteriaEditing: boolean = true;
  codeContextEditing: boolean = false;
  private codeAgentSub?: Subscription;

  /** Criterios interpretados como lista numerada (CA-xx): cada uno tendrá un escenario propio. */
  normalizedCriteria: string = '';
  /** Criterios originales a los que corresponde normalizedCriteria. */
  private normalizedCriteriaFor: string = '';
  normalizingCriteria: boolean = false;
  normalizedCriteriaEditing: boolean = false;
  /** CA-xx que quedaron sin escenario en la última generación. */
  criteriaCoverageGap: string[] = [];
  /** Criterios y descripción con los que se exploró el código: si cambian, el contexto queda desactualizado. */
  private codeContextBasis: string = '';
  /** Por qué un paso se limpió o rehízo solo (p. ej. al importar otra HU): se muestra en el paso. */
  flowNotices: Partial<Record<FlowStepId, string>> = {};

  // ---- Flujo de trabajo: HU → criterios → código → contexto técnico → generación ----

  get flowSteps(): FlowStep[] {
    const ids: FlowStepId[] = this.usesCodeContext ? ['hu', 'criteria', 'code', 'context', 'generate'] : ['hu', 'criteria', 'generate'];
    return ids.map((id, index) => {
      const { title, status, summary } = this.describeFlowStep(id);
      return { id, num: index + 1, title, status, statusLabel: FLOW_STATUS_LABELS[status], summary };
    });
  }

  flowStep(id: FlowStepId): FlowStep {
    return this.flowSteps.find((step) => step.id === id)!;
  }

  private describeFlowStep(id: FlowStepId): { title: string; status: FlowStepStatus; summary: string } {
    switch (id) {
      case 'hu': {
        const ready = !!(this.currentHuId.trim() && this.currentHuTitle.trim() && this.currentDescription.trim() && this.cellName && this.currentSprint.trim());
        return {
          title: 'Historia de usuario',
          status: this.azureImportLoading ? 'running' : ready ? 'done' : 'pending',
          summary: this.azureImportLoading ? 'Importando desde Azure…' : this.currentHuId.trim() ? `HU ${this.currentHuId.trim()}` : 'Importa o escribe la HU'
        };
      }
      case 'criteria': {
        const raw = this.currentAcceptanceCriteria.trim();
        if (this.normalizingCriteria) return { title: 'Criterios', status: 'running', summary: 'Interpretando criterios…' };
        if (!raw) return { title: 'Criterios', status: this.contextSource === 'code' ? 'optional' : 'pending', summary: this.contextSource === 'code' ? 'El código define las reglas' : 'Sin criterios' };
        if (this.needsCriteriaNormalization) return { title: 'Criterios', status: this.normalizedCriteria ? 'stale' : 'pending', summary: 'Se interpretan al salir del campo' };
        return { title: 'Criterios', status: 'done', summary: this.normalizedCriteriaCount ? `${this.normalizedCriteriaCount} criterios (CA)` : 'Se usan tal cual' };
      }
      case 'code': {
        const loading = this.codeLoadingHuChanges || this.codeLoadingTarget;
        let summary = 'Elige el código a analizar';
        if (this.usesHuChangeset) {
          const groups = this.codeHuChangeGroups.filter((group) => this.isChangeGroupSelected(group));
          summary = `${groups.length} repo(s) · ${groups.reduce((total, group) => total + group.files.length, 0)} archivos`;
        } else if (this.isManualCodeTargetReady) {
          summary = this.codeBranch;
        }
        return { title: 'Código de la HU', status: loading ? 'running' : this.isCodeTargetReady ? 'done' : 'pending', summary: loading ? 'Buscando PRs y commits…' : summary };
      }
      case 'context': {
        if (this.codeExploring) return { title: 'Contexto técnico', status: 'running', summary: 'El agente está explorando…' };
        if (!this.codeContextText.trim()) return { title: 'Contexto técnico', status: 'pending', summary: 'Se explora al generar si no lo haces antes' };
        if (this.isCodeContextStale) return { title: 'Contexto técnico', status: 'stale', summary: 'Los criterios cambiaron' };
        return { title: 'Contexto técnico', status: 'done', summary: this.codeCoverageRows.length ? `${this.codeCoverageRows.length} criterios evaluados` : 'Listo para generar' };
      }
      case 'generate':
        return {
          title: 'Generar matriz',
          status: this.loadingScope || this.loadingScenarios ? 'running' : 'pending',
          summary: this.loadingScope || this.loadingScenarios ? 'Generando escenarios…' : 'Revisa y genera'
        };
    }
  }

  /** El contexto técnico se exploró con otros criterios o descripción. */
  get isCodeContextStale(): boolean {
    return !!this.codeContextText.trim() && !!this.codeContextBasis && this.codeContextBasis !== this.currentCodeContextBasis;
  }

  private get currentCodeContextBasis(): string {
    return `${this.currentDescription.trim()}\n${this.effectiveCriteria.trim()}`;
  }

  /** Texto del botón principal: indica qué paso del flujo se ejecutará o está en curso. */
  get generateButtonLabel(): string {
    if (this.normalizingCriteria) return 'Interpretando criterios…';
    if (this.codeExploring) return 'Explorando código…';
    if (this.loadingScope || this.loadingScenarios) return 'Generando…';
    if (this.usesCodeContext && !this.codeContextText.trim()) return 'Explorar código y generar casos';
    return 'Generar casos de prueba';
  }

  scrollToFlowStep(id: FlowStepId): void {
    this.elRef.nativeElement.querySelector(`#flow-step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  flowNotice(id: FlowStepId): string | undefined {
    return this.flowNotices[id];
  }

  dismissFlowNotice(id: FlowStepId): void {
    delete this.flowNotices[id];
  }

  private setFlowNotice(id: FlowStepId, message: string): void {
    this.flowNotices = { ...this.flowNotices, [id]: message };
  }

  /** Criterios que reciben el agente y la generación: la lista numerada si existe. */
  get effectiveCriteria(): string {
    const raw = this.currentAcceptanceCriteria.trim();
    return raw && this.normalizedCriteriaFor === raw && this.normalizedCriteria.trim() ? this.normalizedCriteria.trim() : this.currentAcceptanceCriteria;
  }

  get normalizedCriteriaCount(): number {
    return criteriaIds(this.normalizedCriteria).length;
  }

  private get needsCriteriaNormalization(): boolean {
    const raw = this.currentAcceptanceCriteria.trim();
    return !!raw && this.normalizedCriteriaFor !== raw;
  }

  /** Interpreta los criterios del funcional; si falla, se usan tal cual. */
  async refreshNormalizedCriteria(): Promise<void> {
    if (!this.needsCriteriaNormalization || this.normalizingCriteria) return;
    const raw = this.currentAcceptanceCriteria.trim();
    if (this.normalizedCriteria.trim()) {
      this.setFlowNotice('criteria', 'Cambiaron los criterios originales: la lista de criterios a cubrir se volvió a interpretar y reemplaza la anterior (incluidas tus ediciones).');
    }
    this.normalizingCriteria = true;
    this.normalizedCriteriaEditing = false;
    this.cdr.markForCheck();
    let text = '';
    try {
      text = await this.criteriaNormalizer.normalize(this.currentDescription, raw);
    } catch (error) {
      console.warn('[CRITERIA] No se pudieron interpretar los criterios; se usan tal cual.', error);
    }
    this.normalizingCriteria = false;
    if (raw === this.currentAcceptanceCriteria.trim()) {
      this.normalizedCriteria = text;
      this.normalizedCriteriaFor = raw;
    }
    this.cdr.markForCheck();
  }

  editNormalizedCriteria(): void {
    this.normalizedCriteriaEditing = true;
    this.growAndFocus('tcNormalizedCriteria');
  }

  get usesCodeContext(): boolean {
    return this.contextSource !== 'criteria';
  }

  get isManualCodeTargetReady(): boolean {
    return !!(this.codeProject && this.codeRepositoryId && this.codeBranch);
  }

  get hasHuChangeset(): boolean {
    return String(this.codeHuChanges?.workItemId) === String(this.currentHuId).trim()
      && !!this.codeHuChanges?.groups.some((group) => group.files.length > 0);
  }

  /** Se analizan los PRs/commits de la HU (no la rama elegida a mano) y hay al menos un repo marcado. */
  get usesHuChangeset(): boolean {
    return this.hasHuChangeset && !this.codeManualOverride && this.codeHuChangeGroups.some((group) => this.isChangeGroupSelected(group));
  }

  /** Vista previa activa: la HU tiene cambios y no se eligió rama a mano (aunque se desmarquen todos). */
  get showsHuChangeset(): boolean {
    return this.hasHuChangeset && !this.codeManualOverride;
  }

  isChangeGroupSelected(group: WorkItemChangeGroup): boolean {
    return !this.codeExcludedGroups.has(changeGroupKey(group));
  }

  changeGroupPrs(group: WorkItemChangeGroup): string {
    return `PR ${group.prs.map((pr) => pr.id).join(', ')}`;
  }

  toggleChangeGroup(group: WorkItemChangeGroup): void {
    const key = changeGroupKey(group);
    if (this.codeExcludedGroups.has(key)) this.codeExcludedGroups.delete(key);
    else this.codeExcludedGroups.add(key);
    this.clearCodeContext('cambiaste los repositorios a analizar');
  }

  get isCodeTargetReady(): boolean {
    return this.usesHuChangeset || this.isManualCodeTargetReady;
  }

  /** La HU se consultó y no tiene PRs/commits con archivos. */
  get huHasNoChangeset(): boolean {
    return String(this.codeHuChanges?.workItemId) === String(this.currentHuId).trim() && !this.hasHuChangeset;
  }

  get codeHuChangeGroups() {
    return (this.codeHuChanges?.groups || []).filter((group) => group.files.length > 0);
  }

  /** Último commit de la rama elegida a mano. */
  get codeSelectedCommit(): string {
    return this.codeBranches.find((branch) => branch.name === this.codeBranch)?.commitId || '';
  }

  /**
   * Rama contra la que se aíslan los cambios cuando se elige la rama a mano:
   * la rama principal del repositorio (develop/main/trunk), salvo que sea la misma.
   */
  get codeEffectiveBaseBranch(): string {
    const repository = this.codeRepositories.find((repo) => repo.id === this.codeRepositoryId);
    const base = repository?.defaultBranch || '';
    return base && base !== this.codeBranch && this.codeBranches.some((branch) => branch.name === base) ? base : '';
  }

  /** Conteo de estados por criterio a partir de la matriz de cobertura del contexto técnico. */
  get codeCoverageSummary(): { label: string; count: number; css: string }[] {
    if (!this.codeContextText || this.contextSource !== 'criteria-code') return [];
    const statuses = [
      { key: 'IMPLEMENTADO', label: 'Implementados', css: 'is-ok' },
      { key: 'PARCIAL', label: 'Parciales', css: 'is-partial' },
      { key: 'DIFERENTE', label: 'Diferentes', css: 'is-diff' },
      { key: 'SIN EVIDENCIA', label: 'Sin evidencia', css: 'is-missing' }
    ];
    const lines = this.codeContextText.split('\n').filter((line) => /\[CA-\d+\]/.test(line));
    return statuses
      .map((status) => ({
        label: status.label,
        css: status.css,
        count: lines.filter((line) => new RegExp(`→\\s*${status.key}\\b`, 'i').test(line)).length
      }))
      .filter((item) => item.count > 0);
  }

  readonly coverageStatuses: CriterionCodeStatus[] = ['IMPLEMENTADO', 'PARCIAL', 'DIFERENTE', 'SIN EVIDENCIA'];
  private coverageCache: { text: string; rows: CoverageRow[] } = { text: '', rows: [] };

  /** Matriz CA del contexto técnico (memoizada: el selector no se re-renderiza en cada ciclo). */
  get codeCoverageRows(): CoverageRow[] {
    if (this.coverageCache.text !== this.codeContextText) {
      const rows = this.codeContextText.split('\n').map((line) => {
        const match = line.match(/^\s*[-*]\s*\[(CA-\d+)\]\s*"?(.*?)"?\s*→\s*(IMPLEMENTADO|PARCIAL|DIFERENTE|SIN EVIDENCIA)\b\.?\s*(.*)$/i);
        if (!match) return null;
        const detail = match[4].replace(/^Detalle:\s*/i, '').replace(/\s*\(?\bFuentes?:.*$/i, '').trim();
        return { id: match[1], criterion: match[2], status: match[3].toUpperCase() as CriterionCodeStatus, detail };
      }).filter((row): row is CoverageRow => !!row);
      this.coverageCache = { text: this.codeContextText, rows };
    }
    return this.coverageCache.rows;
  }

  /** Corrige el estado de un criterio: el cambio va al texto que se envía a la generación. */
  setCoverageStatus(id: string, status: CriterionCodeStatus): void {
    const pattern = new RegExp(`(\\[${id}\\][^\\n]*?→\\s*)(IMPLEMENTADO|PARCIAL|DIFERENTE|SIN EVIDENCIA)`, 'i');
    this.codeContextText = this.codeContextText.replace(pattern, `$1${status}`);
  }

  trackCoverageRow(_: number, row: CoverageRow): string {
    return row.id;
  }

  coverageStatusCss(status: CriterionCodeStatus): string {
    return { 'IMPLEMENTADO': 'md-status-ok', 'PARCIAL': 'md-status-partial', 'DIFERENTE': 'md-status-diff', 'SIN EVIDENCIA': 'md-status-none' }[status];
  }

  /** Pasa a edición y ajusta la altura del textarea cuando ya es visible. */
  editCriteria(): void {
    this.criteriaEditing = true;
    this.growAndFocus('tcCurrentAcceptanceCriteria');
  }

  editCodeContext(): void {
    this.codeContextEditing = true;
    this.growAndFocus('tcCodeContext');
  }

  private growAndFocus(id: string): void {
    setTimeout(() => {
      const textarea = this.elRef.nativeElement.querySelector(`#${id}`) as HTMLTextAreaElement | null;
      if (!textarea) return;
      this.autoGrowTextarea(textarea);
      textarea.focus();
    }, 0);
  }
  currentSelectedTechnique: string = this.AUTO_TECHNIQUE;
  refinementTechnique: string = this.AUTO_TECHNIQUE;
  userRefinementContext: string = '';
  azureUserStoryIdInput: string = '';
  azureImportLoading: boolean = false;
  azureImportSuccessMessage: string | null = null;
  azureImportErrorMessage: string | null = null;
  azureNodeNameWarning: string | null = null;

  get currentHuDataForModal() {
    return {
      huId: this.currentHuId,
      huTitle: this.currentHuTitle,
      huDescription: this.currentDescription,
      acceptanceCriteria: this.currentAcceptanceCriteria
    };
  }

  cellName: string = '';
  cellOptions: string[] = CellsConfigService.DEFAULT_CELLS.slice();
  private cellsSub?: Subscription;
  private aiStreamSub?: Subscription;

  generatedHUData: UIHUData | null = null;

  formError: string | null = null;
  loadingScope: boolean = false;
  loadingScenarios: boolean = false;
  errorScope: string | null = null;
  errorScenarios: string | null = null;

  /** Tokens de razonamiento (CoT) acumulados durante el stream */
  streamingReasoning: string = '';
  /** Tokens de contenido JSON acumulados durante el stream */
  streamingContent: string = '';

  draggedTestCaseStep: TestCaseStep | null = null;
  dragOverTestCaseStepId: string | null = null;

  /** Fase de aceptación visual de escenarios */
  acceptedScenarioIndices: number[] = [];
  isAcceptancePhase: boolean = false;

  isCancelModalOpen: boolean = false;
  cancelModalTitle: string = 'Cancelar generación';
  cancelModalMessage: string = '¿Deseas guardar esta HU antes de cancelar? Si no guardas, se perderán los casos de prueba generados.';

  @ViewChild('huForm') huFormDirective!: NgForm;

  private aiProgressInterval: ReturnType<typeof setInterval> | null = null;
  private aiProgressIndex = 0;

  private readonly macTemplateId = '1FVRJav4D93FeWVq8GqcmYqaVSFBegamT';
  private readonly windowsTemplateId = '1sJ_zIcabBfKmxEgaOWX6_5oq5xol6CkU';

  constructor(
    private aiService: AiUnifiedService,
    @Inject(PLATFORM_ID) private platformId: Object,
    private cdr: ChangeDetectorRef,
    private elRef: ElementRef,
    private toastService: ToastService,
    private azureDevOpsIntegrationService: AzureDevOpsIntegrationService,
    private cellsConfigService: CellsConfigService,
    private azureReposService: AzureReposService,
    private codeExplorerAgent: CodeExplorerAgentService,
    private criteriaNormalizer: CriteriaNormalizerService
  ) { }

  ngOnInit(): void {
    this.currentGenerationMode = this.initialGenerationMode;
    this.currentSprint = this.initialSprint;
    this.cellName = this.initialCellName;
    this.resetToInitialForm();

    // Lista de "Nombre Célula" configurable por usuario (Configuración -> BD).
    this.cellsSub = this.cellsConfigService.cells$.subscribe((cells) => {
      this.cellOptions = cells && cells.length ? cells : CellsConfigService.DEFAULT_CELLS.slice();
      // Si la selección actual ya no existe en la lista, se limpia.
      if (this.cellName && !this.cellOptions.includes(this.cellName)) {
        this.cellName = '';
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.stopAiProgress();
    this.aiStreamSub?.unsubscribe();
    this.cellsSub?.unsubscribe();
    this.codeAgentSub?.unsubscribe();
  }

  get isAiBusy(): boolean {
    return this.loadingScope || this.loadingScenarios || this.isAcceptancePhase;
  }

  get aiProgressTitle(): string {
    if (this.isAcceptancePhase) {
      return 'Escenarios identificados';
    }
    const provider = this.aiService.getActiveProviderName().replace('(por defecto)', '').trim();
    if (this.componentState === 'editingForRefinement') {
      return `Refinando con ${provider}`;
    }
    return `Generando con ${provider}`;
  }

  get aiProgressMessage(): string {
    const id = this.currentHuId ? `${this.currentHuId} · ` : '';
    const title = this.currentHuTitle
      ? (this.currentHuTitle.length > 50 ? this.currentHuTitle.slice(0, 50) + '…' : this.currentHuTitle)
      : 'Procesando solicitud…';
    return `${id}${title}`;
  }

  get aiProgressStep(): string {
    const shortTech = this.shortTechniqueName(this.currentSelectedTechnique);

    const generationSteps = [
      'Analizando descripción y criterios de aceptación…',
      shortTech ? `Generando escenarios con técnica ${shortTech}…` : 'Generando escenarios de prueba…',
      'Validando resultados…'
    ];

    const refinementSteps = [
      'Leyendo casos de prueba actuales…',
      shortTech ? `Refinando casos con técnica ${shortTech}…` : 'Aplicando ajustes solicitados…',
      'Validando escenarios…'
    ];

    const steps = this.componentState === 'editingForRefinement' ? refinementSteps : generationSteps;
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

  /** Cancela la generación/refinamiento en curso desde el modal de progreso. */
  cancelAiGeneration(): void {
    this.aiStreamSub?.unsubscribe();
    this.aiStreamSub = undefined;
    this.stopAiProgress();
    this.loadingScope = false;
    this.loadingScenarios = false;
    this.isAcceptancePhase = false;
    this.acceptedScenarioIndices = [];
    this.streamingReasoning = '';
    this.streamingContent = '';
    this.cdr.detectChanges();
  }

  private finalizeAfterAcceptance(): void {
    this.loadingScenarios = false;
    this.streamingReasoning = '';
    this.streamingContent = '';
    this.isAcceptancePhase = false;
    this.acceptedScenarioIndices = [];
    this.componentState = 'previewingGenerated';
    this.cdr.detectChanges();

    setTimeout(() => {
      const textareas = document.querySelectorAll('.test-case-steps-table textarea.table-input');
      textareas.forEach(ta => this.autoGrowTextarea(ta as HTMLTextAreaElement));
    }, 0);
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

  resetToInitialForm(): void {
    this.stopAiProgress();
    this.componentState = 'initialForm';
    this.formError = null;
    const keptSprint = this.currentSprint || this.initialSprint;
    const keptTechnique = this.currentSelectedTechnique || this.AUTO_TECHNIQUE;
    const keptMode = this.currentGenerationMode || this.initialGenerationMode;
    this.currentHuId = '';
    this.currentHuTitle = '';
    this.currentDescription = '';
    this.currentAcceptanceCriteria = '';
    this.criteriaEditing = true;
    this.normalizedCriteria = '';
    this.normalizedCriteriaFor = '';
    this.criteriaCoverageGap = [];
    this.flowNotices = {};
    this.generatedHUData = null;
    this.userRefinementContext = '';
    this.refinementTechnique = this.AUTO_TECHNIQUE;
    this.loadingScope = false;
    this.loadingScenarios = false;
    this.errorScope = null;
    this.errorScenarios = null;
    this.azureImportLoading = false;
    this.azureImportSuccessMessage = null;
    this.azureImportErrorMessage = null;
    this.azureNodeNameWarning = null;
    this.cancelCodeExploration();
    this.clearCodeContext();
    this.codeLinkedBranchHint = null;

    this.huFormDirective?.resetForm();
    this.currentGenerationMode = keptMode;
    this.currentSprint = keptSprint;
    this.currentSelectedTechnique = keptTechnique;
    setTimeout(() => {
      if (this.huFormDirective?.form) {
        this.huFormDirective.form.patchValue({
          cellName: this.cellName,
          currentSprint: this.currentSprint,
          currentHuId: '',
          currentHuTitle: '',
          currentDescription: '',
          currentAcceptanceCriteria: ''
        });
        this.huFormDirective.form.updateValueAndValidity();
      }
      this.cdr.detectChanges();
    }, 0);
  }

  onCellNameChange(cellName: string): void {
    this.cellNameChanged.emit(cellName);
  }

  importFromAzureDevOps(): void {
    this.azureImportSuccessMessage = null;
    this.azureImportErrorMessage = null;
    this.azureNodeNameWarning = null;

    // Campo híbrido: el ID se toma del campo "ID de la HU"; se mantiene compatibilidad con azureUserStoryIdInput.
    const rawId = (this.currentHuId && this.currentHuId.trim()) || this.azureUserStoryIdInput.trim();
    const trimmedId = rawId.trim();
    const numericId = Number(trimmedId);

    if (!trimmedId || !Number.isInteger(numericId) || numericId <= 0) {
      this.azureImportErrorMessage = 'Ingresa un ID de HU válido (número entero positivo).';
      return;
    }

    this.azureImportLoading = true;

    // Cambios de código de la HU en paralelo con la importación: no se espera a la HU.
    this.resetCodeTargetForNewHu();
    this.currentHuId = String(numericId);
    if (this.usesCodeContext) {
      this.loadHuCodeChanges(numericId);
    }

    this.azureDevOpsIntegrationService.importUserStory(numericId)
      .pipe(
        finalize(() => {
          this.azureImportLoading = false;
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (importedHu: AzureDevOpsImportedUserStory) => {
          const previousCriteria = this.currentAcceptanceCriteria.trim();
          this.currentHuId = String(importedHu.id);
          this.currentHuTitle = importedHu.title || '';
          this.currentSprint = importedHu.sprint || '';
          this.currentDescription = importedHu.description || '';
          this.currentAcceptanceCriteria = importedHu.acceptanceCriteria || '';
          if (previousCriteria && previousCriteria !== this.currentAcceptanceCriteria.trim()) {
            this.setFlowNotice('criteria', `Se reemplazaron los criterios por los de la HU ${importedHu.id} importada desde Azure.`);
          }
          this.criteriaEditing = !this.currentAcceptanceCriteria.trim();
          this.refreshNormalizedCriteria();

          const matchedCell = this.resolveCellFromAzureNodeName(importedHu.nodeName);
          if (matchedCell) {
            this.cellName = matchedCell;
            this.onCellNameChange(this.cellName);
          } else if (importedHu.nodeName?.trim()) {
            this.azureNodeNameWarning = `No se encontró coincidencia para "${importedHu.nodeName}" en el selector de Nombre Célula. Selecciónala manualmente.`;
          }

          this.azureImportSuccessMessage = `HU ${importedHu.id} importada correctamente desde Azure DevOps.`;
          this.azureImportErrorMessage = null;
          this.toastService.success(`HU ${importedHu.id} importada correctamente desde Azure DevOps.`);
          setTimeout(() => this.autoGrowFormTextareas(), 0);
        },
        error: (error: unknown) => {
          this.azureImportErrorMessage = this.getAzureImportErrorMessage(error);
          this.azureImportSuccessMessage = null;
          this.toastService.error(this.azureImportErrorMessage);
        }
      });
  }

  private resolveCellFromAzureNodeName(nodeName: string): string | null {
    const normalizedNode = nodeName.trim().toLowerCase();
    if (!normalizedNode) {
      return null;
    }

    const exactMatch = this.cellOptions.find((option) => option.trim().toLowerCase() === normalizedNode);
    if (exactMatch) {
      return exactMatch;
    }

    const suffixMatch = this.cellOptions.find((option) => {
      const normalizedOption = option.trim().toLowerCase();
      return normalizedNode.endsWith(`- ${normalizedOption}`) || normalizedNode.endsWith(normalizedOption);
    });

    return suffixMatch ?? null;
  }

  private getAzureImportErrorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error && typeof error === 'object') {
      const anyError = error as Record<string, any>;
      const backendMessage = anyError['error']?.['message'] || anyError['message'] || anyError['userMessage'];
      if (typeof backendMessage === 'string' && backendMessage.trim()) {
        return backendMessage;
      }
    }

    return 'No fue posible importar la HU desde Azure DevOps. Verifica la conexión e intenta nuevamente.';
  }

  /** Ajusta la altura de los textareas del formulario inicial (descripcion, criterios, contexto). */
  public autoGrowFormTextareas(): void {
    const ids = ['tcCurrentDescription', 'tcCurrentAcceptanceCriteria', 'tcCodeContext'];
    ids.forEach(id => {
      const ta = this.elRef.nativeElement.querySelector(`#${id}`) as HTMLTextAreaElement | null;
      if (ta) this.autoGrowTextarea(ta);
    });
  }

  public autoGrowTextarea(element: any): void {
    if (element && element instanceof HTMLTextAreaElement) {
      // Altura maxima permitida (debe coincidir con max-height de .auto-grow en el CSS)
      const MAX_HEIGHT = 480;
      element.style.height = 'auto';
      element.scrollTop = element.scrollTop;
      const contentHeight = element.scrollHeight;
      if (contentHeight > MAX_HEIGHT) {
        // El contenido excede el maximo: fijar altura y habilitar scroll interno
        element.style.height = MAX_HEIGHT + 'px';
        element.style.overflowY = 'auto';
      } else {
        // El contenido cabe: crecer con el contenido y ocultar el scroll
        element.style.height = contentHeight + 'px';
        element.style.overflowY = 'hidden';
      }
    }
  }

  private autoGrowTextareasInCardByIndex(tcIndex: number): void {
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases ||
      !this.generatedHUData.detailedTestCases[tcIndex] ||
      !this.generatedHUData.detailedTestCases[tcIndex].isExpanded) {
      return;
    }
    const cardId = `test-case-card-${this.generatedHUData.id || 'temp'}-${tcIndex}`;
    const cardElement = this.elRef.nativeElement.querySelector(`#${cardId}`);
    if (cardElement) {
      const textareas = cardElement.querySelectorAll(
        '.form-group textarea.form-control, .test-case-steps-table textarea.table-input'
      );
      textareas.forEach((ta: HTMLTextAreaElement) => {
        if (ta.offsetParent !== null) {
          this.autoGrowTextarea(ta);
        }
      });
    }
  }

  private normalizeSteps(rawSteps: any): TestCaseStep[] {
    const normalizeAction = (value: any): string => {
      if (typeof value === 'string') return value.trim();
      if (value === null || value === undefined) return '';
      return String(value).trim();
    };

    const fromArray = (stepsArray: any[]): TestCaseStep[] => {
      const normalized = stepsArray
        .map((step: any, index: number) => {
          if (typeof step === 'string') {
            const cleanText = step.replace(/^\s*\d+[\.)-]?\s*/, '').trim();
            if (!cleanText) return null;
            return {
              numero_paso: index + 1,
              accion: cleanText
            };
          }

          if (step && typeof step === 'object') {
            const action = normalizeAction(
              step.accion ?? step.action ?? step.paso ?? step.step ?? step.description ?? step.descripcion
            );
            if (!action) return null;
            const stepNumber = Number(step.numero_paso ?? step.step_number ?? step.number ?? (index + 1));

            return {
              numero_paso: Number.isFinite(stepNumber) && stepNumber > 0 ? stepNumber : index + 1,
              accion: action
            };
          }

          return null;
        })
        .filter((s: TestCaseStep | null): s is TestCaseStep => !!s && !!s.accion && s.accion.trim().length > 0);

      return normalized.map((step, index) => ({
        numero_paso: index + 1,
        accion: step.accion
      }));
    };

    if (Array.isArray(rawSteps)) {
      const parsed = fromArray(rawSteps);
      return parsed.length > 0 ? parsed : [{ numero_paso: 1, accion: 'Paso no descrito' }];
    }

    if (typeof rawSteps === 'string') {
      const lines = rawSteps
        .split(/\r?\n|;+/)
        .map(line => line.trim())
        .filter(Boolean);

      if (lines.length > 0) {
        return fromArray(lines);
      }
    }

    if (rawSteps && typeof rawSteps === 'object') {
      if (Array.isArray(rawSteps.steps)) {
        const parsed = fromArray(rawSteps.steps);
        return parsed.length > 0 ? parsed : [{ numero_paso: 1, accion: 'Paso no descrito' }];
      }

      const values = Object.values(rawSteps).filter(v => typeof v === 'string' || typeof v === 'object');
      if (values.length > 0) {
        const parsed = fromArray(values);
        return parsed.length > 0 ? parsed : [{ numero_paso: 1, accion: 'Paso no descrito' }];
      }
    }

    return [{ numero_paso: 1, accion: 'Paso no descrito' }];
  }

  // ---------------------------------------------------------------------------
  // Contexto desde código fuente (Azure Repos + agente de exploración)
  // ---------------------------------------------------------------------------

  /** Al cambiar de HU, la rama y los cambios de la HU anterior no deben quedar seleccionados. */
  private resetCodeTargetForNewHu(): void {
    if (this.codeHuChanges || this.isManualCodeTargetReady) {
      this.setFlowNotice('code', 'Cambiaste de HU: se descartó el código de la HU anterior y se buscan los PRs y commits de la nueva.');
    }
    this.clearCodeContext('cambiaste de HU');
    this.codeHuChanges = null;
    this.codeExcludedGroups = new Set<string>();
    this.codeManualOverride = false;
    this.codeLinkedBranchHint = null;
    this.codeRepositoryId = '';
    this.codeBranch = '';
    this.codeBranches = [];
  }

  /** Elegir otra rama aunque la HU tenga PRs: arranca con el repo/rama de la HU. */
  useManualCodeTarget(): void {
    this.codeManualOverride = true;
    this.clearCodeContext('cambiaste el origen del código');
    const primary = this.codeHuChangeGroups[0];
    if (primary && !this.isManualCodeTargetReady) {
      this.preselectCodeTarget(primary.projectId, primary.repositoryId, primary.sourceBranches[0] || primary.targetBranch);
    }
  }

  useHuChangeset(): void {
    this.codeManualOverride = false;
    this.clearCodeContext('cambiaste el origen del código');
  }

  private async preselectCodeTarget(projectId: string, repositoryId: string, branch: string): Promise<void> {
    if (this.codeProjects.length === 0) {
      this.codeProjects = await firstValueFrom(this.azureReposService.listProjects()).catch(() => []);
    }
    const project = this.codeProjects.find((p) => p.id === projectId);
    if (project) {
      this.onCodeProjectChange(project.name, { repositoryId, branch });
    }
  }

  onContextSourceChange(source: ContextSource): void {
    this.contextSource = source;
    this.codeAgentError = null;
    if (this.usesCodeContext && this.codeProjects.length === 0 && !this.codeLoadingTarget) {
      this.loadCodeProjects();
    }
    const huId = Number(this.currentHuId);
    if (this.usesCodeContext && !this.isCodeTargetReady && Number.isInteger(huId) && huId > 0) {
      this.loadHuCodeChanges(huId);
    }
  }

  loadCodeProjects(): void {
    this.codeLoadingTarget = true;
    this.codeTargetError = null;
    this.azureReposService.listProjects()
      .pipe(finalize(() => { this.codeLoadingTarget = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (projects) => {
          this.codeProjects = projects;
          if (projects.length === 1 && !this.codeProject) {
            this.onCodeProjectChange(projects[0].name);
          }
        },
        error: (error) => this.codeTargetError = this.getCodeErrorMessage(error)
      });
  }

  onCodeProjectChange(project: string, preselect?: { repositoryId: string; branch: string }): void {
    this.codeProject = project;
    this.codeRepositories = [];
    this.codeBranches = [];
    this.codeRepositoryId = '';
    this.codeBranch = '';
    this.clearCodeContext('cambiaste el proyecto');
    if (!project) return;

    this.codeLoadingTarget = true;
    this.codeTargetError = null;
    this.azureReposService.listRepositories(project)
      .pipe(finalize(() => { this.codeLoadingTarget = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (repositories) => {
          this.codeRepositories = repositories;
          const target = preselect && repositories.find((repo) => repo.id === preselect.repositoryId);
          if (target) {
            this.onCodeRepositoryChange(target.id, preselect!.branch);
          } else if (repositories.length === 1) {
            this.onCodeRepositoryChange(repositories[0].id);
          }
        },
        error: (error) => this.codeTargetError = this.getCodeErrorMessage(error)
      });
  }

  onCodeRepositoryChange(repositoryId: string, preferredBranch?: string): void {
    this.codeRepositoryId = repositoryId;
    this.codeBranches = [];
    this.codeBranch = '';
    this.clearCodeContext('cambiaste el repositorio');
    if (!repositoryId) return;

    const repository = this.codeRepositories.find((repo) => repo.id === repositoryId);
    this.codeLoadingTarget = true;
    this.codeTargetError = null;
    this.azureReposService.listBranches(this.codeProject, repositoryId)
      .pipe(finalize(() => { this.codeLoadingTarget = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (branches) => {
          this.codeBranches = branches;
          const wanted = [preferredBranch, repository?.defaultBranch].find((name) => name && branches.some((b) => b.name === name));
          this.codeBranch = wanted || '';
        },
        error: (error) => this.codeTargetError = this.getCodeErrorMessage(error)
      });
  }

  onCodeBranchChange(branch: string): void {
    this.codeBranch = branch;
    this.clearCodeContext('cambiaste la rama');
  }

  /**
   * Consulta los PRs/commits vinculados a la HU. Si hay cambios, el agente los
   * usa directamente (no hace falta elegir rama); si no, sugiere la rama vinculada.
   */
  private loadHuCodeChanges(workItemId: number): void {
    this.codeLinkedBranchHint = null;
    this.codeLoadingHuChanges = true;
    const isCurrent = () => String(workItemId) === String(this.currentHuId).trim();
    this.azureReposService.getWorkItemChanges(workItemId)
      .pipe(finalize(() => { if (isCurrent()) this.codeLoadingHuChanges = false; this.cdr.markForCheck(); }))
      .subscribe({
        next: (changes) => {
          if (!isCurrent()) return;
          this.codeHuChanges = changes;
          // Con PRs/commits no hace falta cargar repositorios ni ramas: se analizan esos cambios.
          if (!changes.groups.some((group) => group.files.length > 0)) {
            this.suggestLinkedBranch(workItemId);
          }
        },
        error: () => { if (isCurrent()) this.suggestLinkedBranch(workItemId); }
      });
  }

  /** Autosugiere repo + rama a partir de las ramas vinculadas a la HU en Azure Boards. */
  private suggestLinkedBranch(workItemId: number): void {
    this.codeLinkedBranchHint = null;
    this.azureReposService.getLinkedBranches(workItemId).subscribe({
      next: async (links) => {
        if (links.length === 0 || String(workItemId) !== String(this.currentHuId).trim()) return;
        const link = links[0];
        await this.preselectCodeTarget(link.projectId, link.repositoryId, link.branch);
        this.codeLinkedBranchHint = links.length > 1
          ? `La HU tiene ${links.length} ramas vinculadas; se preseleccionó "${link.branch}".`
          : `Rama vinculada a la HU preseleccionada: "${link.branch}".`;
        this.cdr.markForCheck();
      },
      // Sugerencia opcional: si falla, el usuario elige manualmente.
      error: () => { }
    });
  }

  exploreCode(onDone?: () => void): void {
    if (!this.isCodeTargetReady || this.codeExploring) return;
    if (!this.currentDescription.trim()) {
      this.codeAgentError = 'Escribe la descripción de la HU antes de explorar el código.';
      return;
    }
    // El juez evalúa la misma lista numerada que luego cubre la generación.
    if (this.needsCriteriaNormalization) {
      this.refreshNormalizedCriteria().then(() => this.exploreCode(onDone));
      return;
    }

    const repository = this.codeRepositories.find((repo) => repo.id === this.codeRepositoryId);

    this.dismissFlowNotice('context');
    this.codeExploring = true;
    this.codeAgentError = null;
    this.codeAgentLog = [];
    this.cdr.detectChanges();

    const workItemId = Number(this.currentHuId);
    this.codeAgentSub = this.codeExplorerAgent.explore({
      workItemId: this.usesHuChangeset && Number.isInteger(workItemId) ? workItemId : undefined,
      excludedGroups: this.usesHuChangeset ? Array.from(this.codeExcludedGroups) : undefined,
      target: this.usesHuChangeset || !this.isManualCodeTargetReady ? null : {
        project: this.codeProject,
        repositoryId: this.codeRepositoryId,
        repositoryName: repository?.name || this.codeRepositoryId,
        branch: this.codeBranch,
        commitId: this.codeSelectedCommit,
        scopePath: '/',
        baseBranch: this.codeEffectiveBaseBranch
      },
      mode: this.contextSource,
      description: this.currentDescription,
      acceptanceCriteria: this.effectiveCriteria,
      userRequest: ''
    }).subscribe({
      next: (event) => {
        this.codeAgentLog = [...this.codeAgentLog, event.message].slice(-40);
        if (event.type === 'done' && event.context) {
          this.codeContextText = event.context;
          this.codeFilesReviewed = event.filesReviewed || [];
          this.codeContextBasis = this.currentCodeContextBasis;
          this.codeContextEditing = false;
        }
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.codeExploring = false;
        this.codeAgentError = this.getCodeErrorMessage(error);
        this.toastService.error(this.codeAgentError);
        this.cdr.detectChanges();
      },
      complete: () => {
        this.codeExploring = false;
        this.cdr.detectChanges();
        setTimeout(() => this.autoGrowFormTextareas(), 0);
        if (this.codeContextText.trim() && onDone) onDone();
      }
    });
  }

  cancelCodeExploration(): void {
    if (this.codeAgentSub) {
      this.codeAgentSub.unsubscribe();
      this.codeAgentSub = undefined;
    }
    if (this.codeExploring) {
      this.codeExploring = false;
      this.codeAgentLog = [...this.codeAgentLog, 'Exploración cancelada.'];
    }
  }

  /** reason: por qué se descarta, para explicarlo en el paso "Contexto técnico". */
  clearCodeContext(reason?: string): void {
    if (reason && this.codeContextText.trim()) {
      this.setFlowNotice('context', `Se descartó el contexto técnico porque ${reason}. Vuelve a explorar o se explorará al generar.`);
    }
    this.codeContextBasis = '';
    this.codeContextText = '';
    this.codeFilesReviewed = [];
    this.codeAgentLog = [];
    this.codeAgentError = null;
  }

  private getCodeErrorMessage(error: any): string {
    return error?.error?.message || error?.message || 'No fue posible consultar el código fuente.';
  }

  isFormInvalidForGeneration(): boolean {
    if (!this.huFormDirective?.form || !this.currentGenerationMode) return true;
    const commonRequired = !this.currentSprint || !this.currentHuTitle;
    // En modo "Repositorio + rama" los criterios son opcionales: el código es la fuente principal.
    const criteriaMissing = this.contextSource !== 'code' && !this.currentAcceptanceCriteria;
    const codeTargetMissing = this.usesCodeContext && !this.isCodeTargetReady;
    return !this.currentHuId || !this.currentDescription || criteriaMissing || codeTargetMissing || commonRequired || this.codeExploring;
  }

  private parseFileNameForSorting(fileName: string): { main: number, sub: number } {
    const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    const parts = nameWithoutExtension.split(/[^0-9]+/g).filter(Boolean).map(p => parseInt(p, 10));
    return {
      main: parts.length > 0 && !isNaN(parts[0]) ? parts[0] : Infinity,
      sub: parts.length > 1 && !isNaN(parts[1]) ? parts[1] : (parts.length > 0 && !isNaN(parts[0]) ? 0 : Infinity)
    };
  }



  generateIdFromTitle(title: string, mode: GenerationMode): string {
    if (!title || !mode) return '';
    const prefix = "HU_";
    const sanitizedTitle = title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
    return `${prefix}${sanitizedTitle.substring(0, 20)}_${Date.now().toString().slice(-4)}`;
  }

  generateInitialHuAndCases(): void {
    this.formError = null; this.errorScope = null; this.errorScenarios = null;
    if (this.isFormInvalidForGeneration()) {
      this.formError = "Por favor, completa todos los campos requeridos.";
      this.huFormDirective?.form.markAllAsTouched(); return;
    }
    // Con código como fuente: si aún no hay contexto técnico, el agente explora
    // primero y al terminar continúa automáticamente con la generación.
    if (this.needsCriteriaNormalization) {
      this.refreshNormalizedCriteria().then(() => this.generateInitialHuAndCases());
      return;
    }
    if (this.usesCodeContext && !this.codeContextText.trim()) {
      this.exploreCode(() => this.generateInitialHuAndCases());
      return;
    }
    this.criteriaCoverageGap = [];
    const codeContext = this.usesCodeContext ? this.codeContextText.trim() : '';
    const huData: UIHUData = {
      originalInput: {
        generationMode: this.currentGenerationMode,
        description: this.currentDescription,
        acceptanceCriteria: this.effectiveCriteria,
        selectedTechnique: this.currentSelectedTechnique || this.AUTO_TECHNIQUE,
        userRequest: '',
        codeContext: codeContext || undefined,
        contextSource: codeContext ? this.contextSource : undefined,
      },
      id: this.currentHuId.trim(), title: this.currentHuTitle.trim(), sprint: this.currentSprint.trim(),
      generatedScope: '',
      detailedTestCases: [],
      generatedTestCaseTitles: '',
      refinementTechnique: this.currentSelectedTechnique || this.AUTO_TECHNIQUE,
      refinementContext: '',
      editingScope: false,
      loadingScope: false, errorScope: null,
      isScopeDetailsOpen: this.currentGenerationMode === 'text'
    };
    this.generatedHUData = huData;
    this.refinementTechnique = this.currentSelectedTechnique || this.AUTO_TECHNIQUE;
    this.cdr.detectChanges();

    // GENERACIÓN EN MODO STREAM (deepseek-flash)
    if (huData.originalInput.generationMode === 'text') {
      this.loadingScenarios = true;
      this.errorScenarios = null;
      this.streamingReasoning = '';
      this.streamingContent = '';
      this.startAiProgress();

      console.log('[GENERATION] Iniciando generación con STREAMING...');

      this.aiStreamSub = this.aiService.generateTestCasesSmartStream(
        huData.originalInput.description!,
        huData.originalInput.acceptanceCriteria!,
        this.currentSelectedTechnique || this.AUTO_TECHNIQUE,
        '',
        codeContext,
        this.contextSource
      ).subscribe({
        next: (event: any) => {
          this.streamingReasoning = event.reasoning || '';
          this.streamingContent = event.content || '';
          this.cdr.detectChanges();

          if (event.done) {
            // Parsear el JSON completo una vez terminado el stream
            const result = this.parseStreamResult(event.content);
            if (result && result.testCases && this.generatedHUData) {
              console.log('[GENERATION] Stream completado. Casos generados:', result.testCases.length);
              this.generatedHUData.generatedScope = result.scope || 'Scope no generado';

              const rawTestCases = result.testCases || [];
              this.generatedHUData.detailedTestCases = rawTestCases.map((tc: any, index: number) => {
                const detailedTc: UIDetailedTestCase = {
                  ...tc,
                  steps: this.normalizeSteps(
                    tc.steps ?? tc.stepByStep ?? tc.step_by_step ?? tc.pasoAPaso ?? tc.pasos ?? tc.procedure
                  ),
                  isExpanded: index === 0
                };
                return detailedTc;
              });

              this.generatedHUData.generatedTestCaseTitles = this.formatSimpleScenarioTitles(
                rawTestCases.map((tc: any) => tc.title)
              );
              this.criteriaCoverageGap = uncoveredCriteria(huData.originalInput.acceptanceCriteria || '', rawTestCases, codeContext);
            } else {
              console.error('[GENERATION] Stream finalizado sin casos parseables. Longitud content:', (event.content || '').length);
              this.errorScenarios = 'La respuesta de la IA llegó incompleta o con formato inválido. Vuelve a intentar la generación.';
            }
          }
        },
        error: (e: any) => {
          console.error('[GENERATION] Error en streaming:', e);
          this.loadingScenarios = false;
          this.streamingReasoning = '';
          this.streamingContent = '';
          this.errorScope = 'Error durante la generación.';
          this.errorScenarios = 'Error durante la generación.';
          this.stopAiProgress();
          this.cdr.detectChanges();
        },
        complete: () => {
          this.stopAiProgress();
          this.isAcceptancePhase = true;
          this.acceptedScenarioIndices = [];
          this.cdr.detectChanges();

          // Animar la aceptación secuencial de cada escenario
          const totalCases = this.generatedHUData?.detailedTestCases?.length || 0;
          if (totalCases > 0) {
            const delay = Math.min(400, 2000 / totalCases); // max 2s total
            let idx = 0;
            const acceptInterval = setInterval(() => {
              this.acceptedScenarioIndices = [...this.acceptedScenarioIndices, idx];
              this.cdr.detectChanges();
              idx++;
              if (idx >= totalCases) {
                clearInterval(acceptInterval);
                // Breve pausa final antes de transicionar
                setTimeout(() => this.finalizeAfterAcceptance(), 500);
              }
            }, delay);
          } else {
            this.finalizeAfterAcceptance();
          }
        }
      });
    }
  }

  /** Parsea el contenido JSON del stream final */
  private parseStreamResult(content: string): any {
    if (!content) return null;
    const clean = content.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    try {
      return JSON.parse(clean);
    } catch { /* continuar con estrategias de recuperación */ }

    // Extraer el bloque JSON más externo
    const start = clean.indexOf('{');
    if (start === -1) {
      console.warn('[GENERATION] No se encontró JSON en el stream');
      return null;
    }
    const candidate = clean.slice(start);
    try {
      return JSON.parse(candidate);
    } catch { /* posible JSON truncado */ }

    const repaired = this.repairTruncatedJson(candidate);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired);
        console.warn('[GENERATION] JSON truncado recuperado parcialmente');
        return parsed;
      } catch { /* no recuperable */ }
    }

    console.warn('[GENERATION] No se pudo parsear JSON del stream');
    return null;
  }

  /**
   * Intenta cerrar un JSON truncado (stream cortado) descartando el último
   * fragmento incompleto y balanceando llaves/corchetes.
   */
  private repairTruncatedJson(text: string): string | null {
    let inString = false;
    let escaped = false;
    const stack: string[] = [];
    let lastSafeIndex = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') { inString = true; continue; }
      if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); continue; }
      if (ch === '}' || ch === ']') {
        stack.pop();
        lastSafeIndex = i;
        continue;
      }
    }

    if (stack.length === 0) return null;
    if (lastSafeIndex === -1) return null;

    // Cortar después del último elemento completo y cerrar lo que falte
    const truncated = text.slice(0, lastSafeIndex + 1);

    // Recalcular el stack sobre el texto recortado
    const closers: string[] = [];
    inString = false;
    escaped = false;
    for (let i = 0; i < truncated.length; i++) {
      const ch = truncated[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') { closers.push('}'); continue; }
      if (ch === '[') { closers.push(']'); continue; }
      if (ch === '}' || ch === ']') { closers.pop(); continue; }
    }

    return truncated + closers.reverse().join('');
  }



  startRefinementMode(): void {
    if (this.generatedHUData && this.generatedHUData.detailedTestCases) {
      this.componentState = 'editingForRefinement';
      this.refinementTechnique = this.generatedHUData.originalInput.selectedTechnique || this.AUTO_TECHNIQUE;
      this.generatedHUData.detailedTestCases.forEach((tc, index) => {
        tc.isExpanded = index === 0;
      });
      this.cdr.detectChanges();
      setTimeout(() => {
        if (this.generatedHUData && this.generatedHUData.detailedTestCases.length > 0 && this.generatedHUData.detailedTestCases[0].isExpanded) {
          this.autoGrowTextareasInCardByIndex(0);
        }
      }, 0);
    }
  }

  toggleTestCaseExpansion(tc: UIDetailedTestCase, tcIndex: number): void {
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases) return;
    tc.isExpanded = !tc.isExpanded;
    this.cdr.detectChanges();
    if (tc.isExpanded) {
      setTimeout(() => this.autoGrowTextareasInCardByIndex(tcIndex), 0);
    }
  }

  refineHuCasesWithAI(): void {
    if (!this.generatedHUData) {
      this.formError = "No hay datos generados para refinar.";
      return;
    }
    this.refinementTechnique = this.refinementTechnique || this.AUTO_TECHNIQUE;
    this.generatedHUData.detailedTestCases.forEach(tc => {
      if (tc.steps) {
        tc.steps.forEach(step => {
          if (!step.accion || step.accion.trim() === '') {
            step.accion = "Acción no definida por el usuario.";
          }
        });
      }
    });
    // Refinamiento en modo STREAM
    this.loadingScenarios = true;
    this.cdr.detectChanges();
    this.errorScenarios = null;
    this.streamingReasoning = '';
    this.streamingContent = '';
    this.startAiProgress();

    // Preparar casos para envío (quitar propiedades UI)
    const casesToRefine = this.generatedHUData.detailedTestCases.map(uiTc => {
      const { isExpanded, ...originalTc } = uiTc;
      return originalTc as OriginalDetailedTestCase;
    });

    this.aiService.refineTestCasesDirectStream(
      this.generatedHUData.originalInput,
      casesToRefine,
      this.refinementTechnique || this.AUTO_TECHNIQUE,
      this.userRefinementContext
    ).subscribe({
      next: (event: any) => {
        this.streamingReasoning = event.reasoning || '';
        this.streamingContent = event.content || '';
        this.cdr.detectChanges();

        if (event.done) {
          const result = this.parseStreamResult(event.content);
          if (result && result.testCases && this.generatedHUData) {
            const existingExpansionStates = new Map<string, boolean>();
            this.generatedHUData.detailedTestCases.forEach(existingTc => {
              existingExpansionStates.set(existingTc.title, existingTc.isExpanded || false);
            });

            this.generatedHUData.detailedTestCases = result.testCases.map((tc: any, index: number) => {
              const detailedTc: UIDetailedTestCase = {
                ...tc,
                steps: this.normalizeSteps(
                  tc.steps ?? tc.stepByStep ?? tc.step_by_step ?? tc.pasoAPaso ?? tc.pasos ?? tc.procedure
                ),
                isExpanded: existingExpansionStates.get(tc.title) || (index === 0)
              };
              return detailedTc;
            });

            this.generatedHUData.generatedTestCaseTitles = this.formatSimpleScenarioTitles(
              result.testCases.map((tc: any) => tc.title)
            );
          }
        }
      },
      error: (e: any) => {
        console.error('[REFINEMENT] Error en streaming:', e);
        this.loadingScenarios = false;
        this.streamingReasoning = '';
        this.streamingContent = '';
        this.stopAiProgress();
        this.formError = 'Error durante el refinamiento.';
        this.cdr.detectChanges();
      },
      complete: () => {
        this.loadingScenarios = false;
        this.streamingReasoning = '';
        this.streamingContent = '';
        this.stopAiProgress();
        this.componentState = 'editingForRefinement';
        this.cdr.detectChanges();
        setTimeout(() => {
          if (this.generatedHUData && this.generatedHUData.detailedTestCases) {
            this.generatedHUData.detailedTestCases.forEach((tc, index) => {
              if (tc.isExpanded) {
                this.autoGrowTextareasInCardByIndex(index);
              }
            });
          }
        }, 0);
      }
    });
  }

  cancelRefinementEditing(): void {
    this.componentState = 'previewingGenerated';
    this.cdr.detectChanges();
  }

  // Handlers para el nuevo componente TestCaseEditor
  handleRefineWithAI(event: { technique: string; context: string }): void {
    this.refinementTechnique = event.technique || this.AUTO_TECHNIQUE;
    this.userRefinementContext = event.context;
    this.refineHuCasesWithAI();
  }

  handleTestCasesChanged(testCases: EditorUIDetailedTestCase[]): void {
    if (this.generatedHUData) {
      // Guardar la posición actual del scroll antes de actualizar
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      this.generatedHUData.detailedTestCases = testCases;

      // Usar markForCheck en lugar de detectChanges para evitar scroll jumps
      this.cdr.markForCheck();

      // Restaurar la posición del scroll
      setTimeout(() => {
        window.scrollTo(scrollX, scrollY);
      }, 0);
    }
  }

  formatSimpleScenarioTitles(titles: string[]): string {
    if (!titles?.length) return 'No se generaron escenarios.';
    return titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  }

  handleCancelGeneration() {
    // Si hay datos generados, preguntar si quiere guardarlos
    if (this.generatedHUData &&
      this.generatedHUData.detailedTestCases &&
      this.generatedHUData.detailedTestCases.length > 0 &&
      !this.generatedHUData.detailedTestCases[0].title.startsWith('Error')) {
      this.cancelModalMessage = `¿Deseas guardar la HU "${this.generatedHUData.title}" antes de cancelar? Si no guardas, se perderán los casos de prueba generados.`;
      this.isCancelModalOpen = true;
    } else {
      // No hay datos que guardar, cancelar directamente
      this.resetToInitialForm();
      this.generationCancelled.emit();
    }
  }

  confirmSaveOnCancel(): void {
    this.saveCurrentHU();
    this.generationCancelled.emit();
    this.isCancelModalOpen = false;
  }

  discardOnCancel(): void {
    this.resetToInitialForm();
    this.generationCancelled.emit();
    this.isCancelModalOpen = false;
  }

  addTestCaseStep(testCase: UIDetailedTestCase): void {
    if (!testCase.steps) testCase.steps = [];
    testCase.steps.push({ numero_paso: testCase.steps.length + 1, accion: '' });
    this.cdr.detectChanges();
    setTimeout(() => {
      const tcIndex = this.generatedHUData?.detailedTestCases.indexOf(testCase);
      if (tcIndex !== undefined && tcIndex !== -1) {
        const cardId = `test-case-card-${this.generatedHUData!.id || 'temp'}-${tcIndex}`;
        const cardElement = this.elRef.nativeElement.querySelector(`#${cardId}`);
        if (cardElement) {
          const textareas = cardElement.querySelectorAll('.test-case-steps-table textarea.table-input');
          if (textareas.length > 0) {
            this.autoGrowTextarea(textareas[textareas.length - 1] as HTMLTextAreaElement);
          }
        }
      }
    }, 0);
  }

  deleteTestCaseStep(testCase: UIDetailedTestCase, stepIndex: number): void {
    if (testCase.steps) {
      testCase.steps.splice(stepIndex, 1);
      testCase.steps.forEach((step: TestCaseStep, idx: number) => step.numero_paso = idx + 1);
      this.cdr.detectChanges();
    }
  }

  getTestCaseStepDragId(testCase: UIDetailedTestCase, step: TestCaseStep): string {
    const stepIndex = testCase.steps.indexOf(step);
    return `tc-${this.generatedHUData?.id || 'temp'}-step-${stepIndex}`;
  }

  onTestCaseStepDragStart(event: DragEvent, step: TestCaseStep, testCase: UIDetailedTestCase): void {
    this.draggedTestCaseStep = step;
    if (event.dataTransfer) {
      const stepIndex = testCase.steps.indexOf(step);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', stepIndex.toString());
      const targetEl = event.target as HTMLElement;
      const rowEl = targetEl.closest('tr');
      if (rowEl) rowEl.style.opacity = '0.4';
    }
  }

  onTestCaseStepDragOver(event: DragEvent, targetStep: TestCaseStep | undefined, testCase: UIDetailedTestCase): void {
    event.preventDefault();
    if (this.draggedTestCaseStep && event.dataTransfer && targetStep) {
      event.dataTransfer.dropEffect = 'move';
      this.dragOverTestCaseStepId = this.getTestCaseStepDragId(testCase, targetStep);
    } else if (!targetStep && event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
      this.dragOverTestCaseStepId = `tc-${this.generatedHUData?.id || 'temp'}-dropzone-end-tc-${testCase.title.replace(/\s/g, '')}`;
    }
  }

  onTestCaseStepDragLeave(event: DragEvent): void {
    this.dragOverTestCaseStepId = null;
  }

  onTestCaseStepDrop(event: DragEvent, targetStep: TestCaseStep | undefined, testCase: UIDetailedTestCase): void {
    event.preventDefault(); this.dragOverTestCaseStepId = null;
    document.querySelectorAll('.test-case-steps-table tbody tr[style*="opacity: 0.4"]')
      .forEach(el => (el as HTMLElement).style.opacity = '1');
    if (!this.draggedTestCaseStep || !testCase.steps) {
      this.draggedTestCaseStep = null; return;
    }
    const fromIndex = testCase.steps.indexOf(this.draggedTestCaseStep);
    let toIndex = -1;
    if (targetStep) {
      if (this.draggedTestCaseStep === targetStep) { this.draggedTestCaseStep = null; return; }
      toIndex = testCase.steps.indexOf(targetStep);
    } else {
      toIndex = testCase.steps.length;
    }
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      const itemToMove = testCase.steps.splice(fromIndex, 1)[0];
      if (targetStep || toIndex < testCase.steps.length) {
        testCase.steps.splice(toIndex, 0, itemToMove);
      } else {
        testCase.steps.push(itemToMove);
      }
      testCase.steps.forEach((s: TestCaseStep, i: number) => s.numero_paso = i + 1);
      this.cdr.detectChanges();
    }
    this.draggedTestCaseStep = null;
  }

  onTestCaseStepDragEnd(event: DragEvent): void {
    document.querySelectorAll('.test-case-steps-table tbody tr[style*="opacity: 0.4"]')
      .forEach(el => (el as HTMLElement).style.opacity = '1');
    this.draggedTestCaseStep = null; this.dragOverTestCaseStepId = null;
  }

  /**
 * Guarda la HU actual individualmente (sin salir del formulario)
 * Este método permite acumular múltiples HUs antes de confirmar el plan completo
 */
  saveCurrentHU() {
    if (this.generatedHUData &&
      this.generatedHUData.detailedTestCases &&
      this.generatedHUData.detailedTestCases.length > 0 &&
      !this.generatedHUData.detailedTestCases[0].title.startsWith('Error')) {

      // Preparar datos usando el mismo método que confirmAndEmitHUDataToPlan
      const dataToEmit: OriginalHUData = this.prepareHUDataForEmit();

      console.log('💾 GUARDANDO HU INDIVIDUAL (sin crear plan):', dataToEmit.title);
      console.log('📊 HUs acumuladas antes:', this.accumulatedHUsCount);

      // Emitir al padre para que acumule en memoria
      this.huSaved.emit(dataToEmit);

      console.log('📊 HUs acumuladas después:', this.accumulatedHUsCount + 1);

      // Nota: El toast de confirmación se muestra en el componente padre (test-plan-generator)
      // para evitar duplicados

      // Resetear formulario para permitir agregar otra HU
      setTimeout(() => {
        this.resetToInitialForm();
        this.componentState = 'initialForm';
      }, 100);
    } else {
      this.toastService.warning('No hay datos válidos para guardar. Por favor genera casos de prueba primero');
    }
  }

  /**
   * Confirma y envía señal al padre para crear el plan de pruebas
   * Siempre guarda la HU actual (si existe) antes de crear el plan
   */
  confirmAndEmitHUDataToPlan() {
    // Calcular el número total de HUs que se guardarán
    const totalHUs = this.generatedHUData ? this.accumulatedHUsCount + 1 : this.accumulatedHUsCount;

    if (totalHUs === 0) {
      this.toastService.warning('No hay HUs para guardar');
      return;
    }

    if (this.generatedHUData) {
      this.componentState = 'submitting';

      // Preparar datos de la HU actual
      const dataToEmit: OriginalHUData = this.prepareHUDataForEmit();

      console.log('📤 CONFIRMANDO Y AÑADIENDO AL PLAN - HU actual:', dataToEmit.title);
      console.log('📊 Contador de HUs acumuladas antes:', this.accumulatedHUsCount);

      // Emitir al padre - esto guardará la HU y creará el plan con toasts
      this.huGenerated.emit(dataToEmit);

      // Resetear el formulario después de emitir
      setTimeout(() => {
        this.resetToInitialForm();
      }, 500);

    } else {
      // Si no hay HU actual, mostrar mensaje
      console.warn('[WARNING] No hay HU generada para añadir al plan');
      console.log('[INFO] HUs acumuladas disponibles:', this.accumulatedHUsCount);

      // Si hay HUs guardadas previamente, el plan se puede crear igual
      if (this.accumulatedHUsCount > 0) {
        console.log('[PLAN] Creando plan con HUs guardadas previamente');

        // Emitir evento vacío para indicar que se debe crear el plan con las HUs existentes
        this.huGenerated.emit({} as any);

        // Resetear el formulario
        setTimeout(() => {
          this.resetToInitialForm();
        }, 500);
      } else {
        this.toastService.warning('No hay HUs guardadas para crear un plan');
      }
    }
  }

  /**
   * Prepara los datos de la HU para emitir al padre
   * Centraliza la lógica de limpieza y formato
   */
  private prepareHUDataForEmit(): OriginalHUData {
    const dataToEmit: OriginalHUData = {
      ...this.generatedHUData!,
      detailedTestCases: (this.generatedHUData!.detailedTestCases || []).map(uiTc => {
        uiTc.title = (uiTc.title || "").trim() || "Caso de prueba sin título";
        uiTc.preconditions = (uiTc.preconditions || "").trim() || "N/A";
        uiTc.expectedResults = (uiTc.expectedResults || "").trim() || "N/A";
        if (uiTc.steps) {
          uiTc.steps.forEach(step => {
            step.accion = (step.accion || "").trim() || "Acción no definida.";
          });
        } else {
          uiTc.steps = [{ numero_paso: 1, accion: "Pasos no definidos." }];
        }
        if (uiTc.steps.length === 0) {
          uiTc.steps.push({ numero_paso: 1, accion: "Pasos no definidos." });
        }
        const { isExpanded, ...originalTc } = uiTc;
        return originalTc as OriginalDetailedTestCase;
      })
    };

    dataToEmit.generatedTestCaseTitles = this.formatSimpleScenarioTitles(
      (dataToEmit.detailedTestCases || []).map(tc => tc.title)
    );

    dataToEmit.originalInput.selectedTechnique = dataToEmit.originalInput.selectedTechnique || this.AUTO_TECHNIQUE;

    if (this.refinementTechnique && dataToEmit.originalInput.selectedTechnique !== this.refinementTechnique) {
      dataToEmit.originalInput.selectedTechnique = this.refinementTechnique;
    }

    return dataToEmit;
  }

  exportExecutionMatrixLocal(): void {
    if (!this.generatedHUData || !this.generatedHUData.detailedTestCases || this.generatedHUData.detailedTestCases.length === 0 || this.generatedHUData.detailedTestCases.some(tc => tc.title.startsWith("Error") || tc.title === "Información Insuficiente" || tc.title === "Imágenes no interpretables o técnica no aplicable" || tc.title === "Refinamiento no posible con el contexto actual")) {
      this.toastService.warning('No hay casos de prueba válidos para exportar o los casos generados indican un error');
      return;
    }
    const hu = this.generatedHUData;
    const csvHeader = ["ID Caso", "Escenario de Prueba", "Precondiciones", "Paso a Paso", "Resultado Esperado"];
    const csvRows = hu.detailedTestCases.map((tc, index) => {
      const stepsString = Array.isArray(tc.steps) ? tc.steps.map(step => `${step.numero_paso}. ${step.accion}`).join('\n') : 'Pasos no disponibles.';
      return [
        `"${(hu.id + '_CP' + (index + 1)).replace(/"/g, '""')}"`,
        `"${(tc.title || "").replace(/"/g, '""')}"`,
        `"${(tc.preconditions || "").replace(/"/g, '""')}"`,
        `"${stepsString.replace(/"/g, '""')}"`,
        `"${(tc.expectedResults || "").replace(/"/g, '""')}"`
      ];
    });
    const csvFullContent = [csvHeader.join(','), ...csvRows.map(row => row.join(','))].join('\r\n');
    saveAs(new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }), `MatrizEjecucion_${hu.id}_${new Date().toISOString().split('T')[0]}.csv`);
  }

  downloadTemplate(os: 'mac' | 'windows'): void {
    let fileId = '';
    if (os === 'mac') {
      fileId = this.macTemplateId;
    } else if (os === 'windows') {
      fileId = this.windowsTemplateId;
    }
    if (!fileId) return;
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}