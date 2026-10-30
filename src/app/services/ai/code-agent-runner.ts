import { CODE_AGENT_PROMPTS, CODE_AGENT_TOOLS, CodeEvidenceSource } from '../../config/code-agent-prompts.config';
import type {
  AzureBranchChange,
  AzureBranchDiff,
  AzureFileDiff,
  AzureRepoFile,
  AzureRepoFileRequest,
  AzureRepoSearchResult,
  AzureRepoTree,
  CodeAgentEvent,
  CodeExplorationInput,
  WorkItemChangeGroup,
  WorkItemChanges,
} from '../../models/code-agent.model';

/**
 * Ciclo del Agente de exploración de código, sin dependencias de Angular.
 * Lo usa CodeExplorerAgentService en la app y el arnés de pruebas en Node,
 * así ambos ejecutan exactamente la misma lógica.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /** Razonamiento del modelo (DeepSeek con thinking): debe reenviarse durante el ciclo de herramientas. */
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
}

/** Versión a leer: rama o commit exacto. */
export interface RepoRef {
  project: string;
  repositoryId: string;
  branch?: string;
  commit?: string;
}

export interface CodeAgentGateway {
  llm(messages: ChatMessage[], options: { tools: unknown[]; forceFinish: boolean }): Promise<{ message: ChatMessage; usage?: LlmUsage }>;
  getWorkItemChanges(workItemId: number): Promise<WorkItemChanges>;
  getTree(ref: RepoRef, scopePath: string): Promise<AzureRepoTree>;
  readFiles(ref: RepoRef, files: AzureRepoFileRequest[]): Promise<AzureRepoFile[]>;
  search(ref: RepoRef, terms: string[], paths: string[]): Promise<AzureRepoSearchResult>;
  getBranchDiff(ref: RepoRef, baseBranch: string): Promise<AzureBranchDiff>;
  getFileDiff(ref: RepoRef, change: AzureBranchChange, baseCommit: string, targetCommit: string): Promise<AzureFileDiff>;
}

export interface CodeAgentResult {
  context: string;
  /** Hechos del agente (reglas con código literal) antes del juez. */
  facts?: string;
  filesReviewed: string[];
  /** Commit(s) analizados: sirve como clave de caché. */
  versionKey: string;
  stats: { llmCalls: number; promptTokens: number; completionTokens: number; cachedTokens: number; durationMs: number };
}

/** Presupuesto del agente: mantiene tiempo y tokens acotados. */
export const CODE_AGENT_BUDGET = {
  maxSteps: 8,
  maxFilesRead: 24,
  maxToolOutputChars: 90_000,
  maxToolResultChars: 24_000,
  maxDurationMs: 240_000,
  treeListingLimit: 250,
  branchChangesListingLimit: 80,
  /** Diffs que se envían de entrada (sin gastar pasos del agente). */
  preloadDiffChars: 28_000,
  diffConcurrency: 4,
  /** search_code: archivos por búsqueda (en lotes paralelos del tamaño que acepta el backend). */
  maxSearchFiles: 150,
  searchBatchSize: 30,
  maxSearchMatches: 80,
  /** Jueces en paralelo (criterios ↔ código): el estado de cada criterio se decide por mayoría. */
  judgeVotes: 3,
};

const STOPWORDS = new Set([
  'para', 'como', 'quiero', 'poder', 'desde', 'hasta', 'cuando', 'donde', 'debe', 'deben', 'sistema',
  'usuario', 'usuarios', 'entonces', 'dado', 'que', 'una', 'uno', 'unos', 'unas', 'este', 'esta', 'estos',
  'estas', 'con', 'sin', 'por', 'los', 'las', 'del', 'sus', 'mas', 'más', 'sea', 'ser', 'esto', 'cada',
  'todo', 'todos', 'toda', 'todas', 'otro', 'otra', 'pero', 'tambien', 'también', 'tiene', 'tener', 'hace',
  'dentro', 'sobre', 'entre', 'mediante', 'según', 'segun', 'pantalla', 'opcion', 'opción', 'campo', 'campos',
  'requiere', 'requiero', 'realizar', 'manera', 'forma', 'deben', 'debera', 'deberá', 'momento', 'correspondiente',
  'with', 'that', 'this', 'from', 'when', 'then', 'should', 'user', 'given'
]);

const SOURCE_HINTS = /(controller|service|handler|validator|validation|rule|usecase|use-case|component|model|entity|dto|repository|adapter|resolver|router|routes|api|command|query|schema|policy|guard|spec|test)/i;
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(spec|test)\.|Test\.(java|kt|cs)$|Tests?\.(cs|py)$/i;
const BUILD_FILE = /(^|\/)(build\.gradle|settings\.gradle|pom\.xml|package\.json|.*\.csproj|.*\.ya?ml|.*\.properties|dockerfile|.*\.sh)$/i;

interface Workspace {
  name: string;
  ref: RepoRef;
  files: { path: string; changeType: string; baseCommit: string; targetCommit: string }[];
  group: WorkItemChangeGroup;
}

export class CodeAgentRunner {
  /** Diffs vistos en la corrida (precargados o pedidos con diff_file), por ruta. */
  private seenDiffs = new Map<string, string>();
  private changedPaths: string[] = [];

  constructor(private gateway: CodeAgentGateway) {}

  async run(
    input: CodeExplorationInput,
    emit: (event: CodeAgentEvent) => void,
    isCancelled: () => boolean = () => false
  ): Promise<CodeAgentResult | null> {
    const startedAt = Date.now();
    this.seenDiffs.clear();
    const stats = { llmCalls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, durationMs: 0 };
    const keywords = this.extractKeywords(`${input.description}\n${input.acceptanceCriteria}\n${input.userRequest}`);

    // 1) Fuente de evidencia más precisa disponible: PRs/commits de la HU → diff de rama → rama completa.
    const workspaces = await this.loadWorkItemWorkspaces(input.workItemId, emit);
    let source: CodeEvidenceSource;
    let primaryRef: RepoRef;
    let repoLabel: string;
    let changesBlock: string;
    let branchDiff: AzureBranchDiff | null = null;
    let versionKey: string;

    if (workspaces.length > 0) {
      source = 'changeset';
      primaryRef = workspaces[0].ref;
      repoLabel = workspaces.map((ws) => ws.name).join(', ');
      versionKey = workspaces.map((ws) => ws.ref.commit).join(',');
      changesBlock = await this.buildChangesetBlock(workspaces, keywords, emit);
    } else {
      const target = input.target;
      if (!target) {
        throw new Error('La HU no tiene PRs/commits vinculados. Selecciona repositorio y rama para explorar.');
      }
      primaryRef = { project: target.project, repositoryId: target.repositoryId, branch: target.branch };
      repoLabel = `${target.repositoryName} (rama ${target.branch}${target.scopePath && target.scopePath !== '/' ? `, alcance ${target.scopePath}` : ''})`;
      versionKey = target.commitId;
      branchDiff = await this.loadBranchDiff(primaryRef, target.baseBranch, target.scopePath, emit);
      source = branchDiff && branchDiff.changes.length > 0 ? 'branch-diff' : 'full';
      changesBlock = this.buildBranchChangesSummary(branchDiff, target.baseBranch, this.rankFiles((branchDiff?.changes || []).map((c) => c.path), keywords));
    }

    if (isCancelled()) return null;

    // 2) Árbol del repositorio principal (para list_files / search_code).
    const scopePath = (source !== 'changeset' && input.target?.scopePath) || '/';
    emit({ type: 'progress', message: 'Descargando árbol de archivos…' });
    const tree = await this.gateway.getTree(primaryRef, scopePath);
    const changedPaths = new Set<string>([
      ...workspaces.flatMap((ws) => ws.files.map((file) => file.path)),
      ...(branchDiff?.changes || []).map((change) => change.path),
    ]);
    this.changedPaths = Array.from(changedPaths);
    const rankedFiles = [
      ...this.rankFiles(tree.files.filter((path) => changedPaths.has(path)), keywords),
      ...this.rankFiles(tree.files.filter((path) => !changedPaths.has(path)), keywords),
    ];

    const messages: ChatMessage[] = [
      { role: 'system', content: CODE_AGENT_PROMPTS.SYSTEM(input.mode, CODE_AGENT_BUDGET.maxSteps, source) },
      {
        role: 'user',
        content: CODE_AGENT_PROMPTS.USER(
          input.description,
          input.acceptanceCriteria,
          input.userRequest,
          repoLabel,
          changesBlock,
          this.buildTreeSummary(rankedFiles, tree.truncated, source === 'changeset')
        ),
      },
    ];

    const filesReviewed = new Set<string>(workspaces.flatMap((ws) => ws.files.map((file) => file.path)).filter((path) => changesBlock.includes(`=== ${path}`)));
    let toolOutputChars = 0;

    for (let step = 1; step <= CODE_AGENT_BUDGET.maxSteps + 1; step++) {
      if (isCancelled()) return null;

      const overBudget = step > CODE_AGENT_BUDGET.maxSteps
        || Date.now() - startedAt > CODE_AGENT_BUDGET.maxDurationMs
        || toolOutputChars > CODE_AGENT_BUDGET.maxToolOutputChars
        || filesReviewed.size >= CODE_AGENT_BUDGET.maxFilesRead;

      if (overBudget) {
        messages.push({ role: 'user', content: CODE_AGENT_PROMPTS.FORCE_FINISH });
      }

      emit({ type: 'progress', message: overBudget ? 'Sintetizando contexto técnico…' : `Paso ${step}: analizando…` });
      const { message: reply, usage } = await this.gateway.llm(messages, { tools: CODE_AGENT_TOOLS, forceFinish: overBudget });
      stats.llmCalls++;
      stats.promptTokens += usage?.prompt_tokens || 0;
      stats.completionTokens += usage?.completion_tokens || 0;
      stats.cachedTokens += usage?.prompt_cache_hit_tokens || 0;

      const toolCalls = (reply.tool_calls || []).filter((call) => call?.function?.name);

      // Sin herramientas: el modelo respondió en texto → se toma como contexto final.
      if (toolCalls.length === 0) {
        const text = (reply.content || '').trim();
        if (!text) throw new Error('El agente no devolvió contexto técnico. Intenta de nuevo.');
        return this.finalize(text, input, emit, isCancelled, filesReviewed, versionKey, stats, startedAt);
      }

      messages.push({
        role: 'assistant',
        content: reply.content || '',
        tool_calls: toolCalls,
        ...(reply.reasoning_content ? { reasoning_content: reply.reasoning_content } : {}),
      });

      for (const call of toolCalls) {
        const args = this.parseArgs(call.function.arguments);

        if (call.function.name === 'finish') {
          const context = String(args.technical_context || '').trim();
          if (context) return this.finalize(context, input, emit, isCancelled, filesReviewed, versionKey, stats, startedAt);
        }

        const result = overBudget
          ? 'Presupuesto agotado. Llama a finish ahora.'
          : await this.executeTool(call.function.name, args, { primaryRef, workspaces, branchDiff, treeFiles: tree.files, rankedFiles, filesReviewed, emit });

        const clipped = result.length > CODE_AGENT_BUDGET.maxToolResultChars
          ? `${result.slice(0, CODE_AGENT_BUDGET.maxToolResultChars)}\n…[resultado truncado]`
          : result;
        toolOutputChars += clipped.length;
        messages.push({ role: 'tool', tool_call_id: call.id, content: clipped });
      }
    }

    throw new Error('El agente no logró completar la exploración dentro del presupuesto.');
  }

  /**
   * Cierra la corrida: corrige (CAMBIO HU)/(EXISTENTE) con los diffs y, con
   * criterios, un juez contrasta criterios ↔ reglas literales en una llamada
   * corta (sin el historial de exploración) y se arma la matriz final.
   */
  private async finalize(
    agentContext: string,
    input: CodeExplorationInput,
    emit: (event: CodeAgentEvent) => void,
    isCancelled: () => boolean,
    filesReviewed: Set<string>,
    versionKey: string,
    stats: CodeAgentResult['stats'],
    startedAt: number
  ): Promise<CodeAgentResult | null> {
    let context = this.changedPaths.length
      ? reconcileChangeLabels(agentContext, this.changedPaths, this.seenDiffs)
      : agentContext;
    const judgeFactsSource = context;

    if (input.mode === 'criteria-code' && input.acceptanceCriteria?.trim()) {
      emit({ type: 'progress', message: 'Contrastando criterios con el código…' });
      const judgeMessages: ChatMessage[] = [
        { role: 'system', content: CODE_AGENT_PROMPTS.JUDGE_SYSTEM },
        { role: 'user', content: CODE_AGENT_PROMPTS.JUDGE_USER(input.description, input.acceptanceCriteria, judgeFacts(context)) },
      ];
      const verdicts = await Promise.all(Array.from({ length: CODE_AGENT_BUDGET.judgeVotes }, () =>
        this.gateway.llm(judgeMessages, { tools: [], forceFinish: false }).catch(() => null)));
      const outputs: string[] = [];
      for (const verdict of verdicts) {
        if (!verdict) continue;
        stats.llmCalls++;
        stats.promptTokens += verdict.usage?.prompt_tokens || 0;
        stats.completionTokens += verdict.usage?.completion_tokens || 0;
        stats.cachedTokens += verdict.usage?.prompt_cache_hit_tokens || 0;
        outputs.push(verdict.message.content || '');
      }
      if (isCancelled()) return null;
      if (!outputs.length) throw new Error('No fue posible contrastar los criterios con el código. Intenta de nuevo.');
      context = buildCriteriaContext(context, mergeJudgeVotes(outputs));
    }

    stats.durationMs = Date.now() - startedAt;
    return { context, facts: judgeFactsSource, filesReviewed: Array.from(filesReviewed), versionKey, stats };
  }

  // ---------------------------------------------------------------------------
  // Fuentes de evidencia
  // ---------------------------------------------------------------------------

  private async loadWorkItemWorkspaces(workItemId: number | undefined, emit: (event: CodeAgentEvent) => void): Promise<Workspace[]> {
    if (!workItemId || !Number.isInteger(workItemId) || workItemId <= 0) return [];
    emit({ type: 'progress', message: `Buscando PRs y commits vinculados a la HU ${workItemId}…` });
    try {
      const changes = await this.gateway.getWorkItemChanges(workItemId);
      const workspaces = changes.groups.map((group: WorkItemChangeGroup) => ({
        name: group.repositoryName,
        ref: { project: group.projectId, repositoryId: group.repositoryId, commit: group.lastCommit },
        files: group.files,
        group,
      }));
      if (workspaces.length === 0) {
        emit({ type: 'progress', message: 'La HU no tiene PRs/commits vinculados con código; se usará la rama seleccionada.' });
      }
      for (const ws of workspaces) {
        const prs = ws.group.prs.map((pr) => `PR ${pr.id}`).join(', ') || `${ws.group.commits.length} commit(s)`;
        const also = ws.group.alsoMergedInto.length ? ` (también en ${ws.group.alsoMergedInto.join(', ')})` : '';
        emit({ type: 'progress', message: `${ws.name} → ${ws.group.targetBranch}${also}: ${prs}, ${ws.files.length} archivo(s).` });
      }
      return workspaces;
    } catch (error: any) {
      emit({ type: 'tool', message: `⚠️ No se pudieron leer los PRs de la HU: ${error?.error?.message || error?.message || 'error'}.` });
      return [];
    }
  }

  /** Precarga los diffs del conjunto de cambios (código primero, luego pruebas, build al final). */
  private async buildChangesetBlock(workspaces: Workspace[], keywords: string[], emit: (event: CodeAgentEvent) => void): Promise<string> {
    const multiRepo = workspaces.length > 1;
    const entries = workspaces.flatMap((ws) => ws.files.map((file) => ({ ws, file })));
    const priority = (path: string) => (BUILD_FILE.test(path) ? 2 : TEST_FILE.test(path) ? 1 : 0);
    const rankedPaths = this.rankFiles(entries.map((entry) => entry.file.path), keywords);
    entries.sort((a, b) => priority(a.file.path) - priority(b.file.path) || rankedPaths.indexOf(a.file.path) - rankedPaths.indexOf(b.file.path));

    emit({ type: 'tool', message: `🧬 Precargando diffs de ${entries.filter((entry) => priority(entry.file.path) < 2).length} archivo(s) de la HU…` });
    const diffs = await this.mapLimit(entries, CODE_AGENT_BUDGET.diffConcurrency, async ({ ws, file }) => {
      if (priority(file.path) === 2) return null; // build/config: solo se listan
      return this.gateway.getFileDiff(ws.ref, { path: file.path, changeType: file.changeType }, file.baseCommit, file.targetCommit)
        .catch((error: any) => ({ path: file.path, error: error?.message || 'error' } as AzureFileDiff));
    });

    let used = 0;
    const listed: string[] = [];
    const inlined: string[] = [];
    entries.forEach(({ ws, file }, index) => {
      const label = multiRepo ? `${ws.name}:${file.path}` : file.path;
      const diff = diffs[index];
      const kind = priority(file.path) === 2 ? 'build/config' : priority(file.path) === 1 ? 'prueba' : 'código';
      if (diff?.diff) this.seenDiffs.set(file.path, diff.diff);
      if (diff && diff.diff && used + diff.diff.length <= CODE_AGENT_BUDGET.preloadDiffChars) {
        used += diff.diff.length;
        inlined.push(`=== ${file.path} [${file.changeType}, ${kind}${multiRepo ? `, repo ${ws.name}` : ''}; +${diff.added}/-${diff.removed}] ===\n${diff.diff}`);
      } else {
        listed.push(`- [${file.changeType}, ${kind}] ${label}${diff?.error ? ` (diff no disponible: ${diff.error})` : priority(file.path) < 2 ? ' (usa diff_file)' : ''}`);
      }
    });

    const header = workspaces.map((ws) => {
      const group = ws.group;
      const prs = group.prs.map((pr) => `PR ${pr.id} "${pr.title}" (${pr.status}, ${pr.sourceBranch} → ${pr.targetBranch})`);
      const commits = group.commits.map((commit) => `commit ${commit.sha.slice(0, 8)} "${commit.comment || ''}"`);
      return `Repositorio ${ws.name} → ${group.targetBranch}${group.alsoMergedInto.length ? ` (también integrado en ${group.alsoMergedInto.join(', ')})` : ''}:\n${[...prs, ...commits].map((line) => `  - ${line}`).join('\n')}`;
    }).join('\n');

    return [
      'CAMBIOS DE CÓDIGO DE LA HU (PRs/commits vinculados en Azure Boards; es exactamente lo que se construyó para esta HU):',
      header,
      '',
      inlined.length ? `DIFFS (líneas "+" agregadas, "-" eliminadas, espacios normalizados):\n\n${inlined.join('\n\n')}` : '',
      listed.length ? `\nOTROS ARCHIVOS CAMBIADOS (no precargados):\n${listed.join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }

  private async loadBranchDiff(
    ref: RepoRef,
    baseBranch: string,
    scopePath: string,
    emit: (event: CodeAgentEvent) => void
  ): Promise<AzureBranchDiff | null> {
    if (!baseBranch || baseBranch === ref.branch) return null;

    emit({ type: 'progress', message: `Comparando ${ref.branch} contra ${baseBranch}…` });
    try {
      const diff = await this.gateway.getBranchDiff(ref, baseBranch);
      const prefix = this.normalizePrefix(scopePath);
      if (prefix) {
        diff.changes = diff.changes.filter((change) => change.path.toLowerCase().startsWith(prefix));
      }
      emit({
        type: 'progress',
        message: diff.changes.length
          ? `La rama tiene ${diff.aheadCount} commit(s) propios y ${diff.changes.length} archivo(s) de código modificados vs ${baseBranch}.`
          : `La rama no tiene cambios de código propios vs ${baseBranch}; se explorará el código existente.`
      });
      return diff;
    } catch (error: any) {
      emit({ type: 'tool', message: `⚠️ No se pudo comparar con ${baseBranch}: ${error?.error?.message || error?.message || 'error'}. Se explora la rama completa.` });
      return null;
    }
  }

  private buildBranchChangesSummary(diff: AzureBranchDiff | null, baseBranch: string, rankedChanged: string[]): string {
    if (!diff) {
      return 'CAMBIOS DE LA RAMA: sin comparación con rama base (se explora el código completo de la rama).';
    }
    if (diff.changes.length === 0) {
      return `CAMBIOS DE LA RAMA: ninguno de código respecto a ${baseBranch} (la HU puede estar ya integrada o no iniciada). Explora el código existente.`;
    }
    const byPath = new Map(diff.changes.map((change) => [change.path, change]));
    const shown = rankedChanged.slice(0, CODE_AGENT_BUDGET.branchChangesListingLimit);
    return [
      `CAMBIOS DE LA RAMA vs ${baseBranch} (desde el ancestro común; ${diff.aheadCount} commit(s) propios, último commit ${diff.targetCommit?.slice(0, 8)}):`,
      ...shown.map((path) => `- [${byPath.get(path)?.changeType}] ${path}`),
      diff.changes.length > shown.length ? `…y ${diff.changes.length - shown.length} archivo(s) más.` : '',
      diff.allChangesIncluded ? '' : 'Nota: la lista de cambios es parcial (rama muy grande).',
      diff.changes.length > 60 ? 'ATENCIÓN: son demasiados archivos para una sola HU; la rama probablemente incluye trabajo ajeno. Prioriza los que coinciden con el vocabulario de la HU.' : '',
    ].filter(Boolean).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Herramientas
  // ---------------------------------------------------------------------------

  private async executeTool(
    name: string,
    args: any,
    ctx: {
      primaryRef: RepoRef;
      workspaces: Workspace[];
      branchDiff: AzureBranchDiff | null;
      treeFiles: string[];
      rankedFiles: string[];
      filesReviewed: Set<string>;
      emit: (event: CodeAgentEvent) => void;
    }
  ): Promise<string> {
    const { emit, filesReviewed } = ctx;
    const workspace = this.resolveWorkspace(ctx.workspaces, args.repo);
    const ref = workspace ? workspace.ref : ctx.primaryRef;

    try {
      switch (name) {
        case 'diff_file': {
          const requested = this.normalizePath(args.path);
          const wsFile = workspace?.files.find((file) => file.path.toLowerCase() === requested);
          if (wsFile) {
            emit({ type: 'tool', message: `🧬 Diff de ${wsFile.path.split('/').pop()}` });
            const fileDiff = await this.gateway.getFileDiff(ref, { path: wsFile.path, changeType: wsFile.changeType }, wsFile.baseCommit, wsFile.targetCommit);
            if (fileDiff.error) return `=== ${wsFile.path} ===\nERROR: ${fileDiff.error}`;
            filesReviewed.add(wsFile.path);
            if (fileDiff.diff) this.seenDiffs.set(wsFile.path, fileDiff.diff);
            return `=== ${wsFile.path} (+${fileDiff.added}/-${fileDiff.removed}) ===\n${fileDiff.diff}`;
          }
          const change = ctx.branchDiff?.changes.find((item) => item.path.toLowerCase() === requested);
          if (!change || !ctx.branchDiff?.commonCommit || !ctx.branchDiff.targetCommit) {
            return 'Ese archivo no está en los cambios de la HU. Usa read_files para leerlo completo.';
          }
          emit({ type: 'tool', message: `🧬 Diff de ${change.path.split('/').pop()} (${change.changeType})` });
          const fileDiff = await this.gateway.getFileDiff(ref, change, ctx.branchDiff.commonCommit, ctx.branchDiff.targetCommit);
          if (fileDiff.error) return `=== ${change.path} ===\nERROR: ${fileDiff.error}`;
          filesReviewed.add(change.path);
          if (fileDiff.diff) this.seenDiffs.set(change.path, fileDiff.diff);
          return `=== ${change.path} (${change.changeType}; +${fileDiff.added}/-${fileDiff.removed}) ===\n${fileDiff.diff}`;
        }

        case 'list_files': {
          const prefix = this.normalizePrefix(args.path_prefix);
          const contains = String(args.contains || '').toLowerCase();
          const matches = ctx.treeFiles.filter((path) =>
            (!prefix || path.toLowerCase().startsWith(prefix)) && (!contains || path.toLowerCase().includes(contains)));
          emit({ type: 'tool', message: `📂 Listando ${prefix || '/'}${contains ? ` (“${contains}”)` : ''}: ${matches.length} archivos` });
          const shown = matches.slice(0, 150);
          return shown.length
            ? `${shown.join('\n')}${matches.length > shown.length ? `\n…y ${matches.length - shown.length} más (acota con path_prefix/contains)` : ''}`
            : 'Sin coincidencias.';
        }

        case 'search_code': {
          const terms: string[] = (Array.isArray(args.terms) ? args.terms : [args.terms]).map(String).filter(Boolean).slice(0, 8);
          const prefix = this.normalizePrefix(args.path_prefix);
          const pool = prefix ? ctx.rankedFiles.filter((path) => path.toLowerCase().startsWith(prefix)) : ctx.rankedFiles;
          const candidates = this.rankFiles(pool, terms.map((term) => this.normalizeText(term))).slice(0, CODE_AGENT_BUDGET.maxSearchFiles);
          emit({ type: 'tool', message: `🔎 Buscando “${terms.join(', ')}” en ${candidates.length} archivos` });
          if (candidates.length === 0) return 'No hay archivos candidatos para buscar.';
          // El backend lee hasta 30 archivos por llamada: se reparte en lotes paralelos.
          const batches: string[][] = [];
          for (let i = 0; i < candidates.length; i += CODE_AGENT_BUDGET.searchBatchSize) {
            batches.push(candidates.slice(i, i + CODE_AGENT_BUDGET.searchBatchSize));
          }
          const results = await Promise.all(batches.map((batch) => this.gateway.search(ctx.primaryRef, terms, batch)
            .catch(() => ({ searchedFiles: 0, matches: [] }))));
          const searched = results.reduce((sum, result) => sum + result.searchedFiles, 0);
          const matches = results.flatMap((result) => result.matches).slice(0, CODE_AGENT_BUDGET.maxSearchMatches);
          const coverage = searched < pool.length
            ? `Búsqueda PARCIAL: ${searched} de ${pool.length} archivos (los más afines por nombre); que no aparezca no prueba que no exista.`
            : `Búsqueda completa: ${searched} archivos.`;
          return matches.length
            ? `${coverage}\n${matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n')}`
            : `Sin coincidencias. ${coverage}`;
        }

        case 'read_files': {
          const requested = (Array.isArray(args.files) ? args.files : [])
            .slice(0, 6)
            .map((file: any) => ({
              path: String(file?.path || ''),
              startLine: Number(file?.start_line) || undefined,
              endLine: Number(file?.end_line) || undefined,
            }))
            .filter((file: { path: string }) => file.path);
          if (requested.length === 0) return 'Debes indicar al menos un archivo en "files".';

          emit({ type: 'tool', message: `📄 Leyendo ${requested.map((file: { path: string }) => file.path.split('/').pop()).join(', ')}` });
          const files = await this.gateway.readFiles(ref, requested);
          return files.map((file) => {
            if (file.error) return `=== ${file.path} ===\nERROR: ${file.error}`;
            filesReviewed.add(file.path);
            const header = `=== ${file.path} (líneas ${file.startLine}-${file.endLine} de ${file.totalLines}${file.truncated ? ', truncado' : ''}) ===`;
            return `${header}\n${file.content}`;
          }).join('\n\n');
        }

        case 'finish':
          return 'El argumento "technical_context" llegó vacío. Vuelve a llamar a finish con el contexto técnico completo.';

        default:
          return `Herramienta desconocida: ${name}`;
      }
    } catch (error: any) {
      const message = error?.error?.message || error?.message || 'Error desconocido';
      emit({ type: 'tool', message: `⚠️ ${name}: ${message}` });
      return `ERROR al ejecutar ${name}: ${message}`;
    }
  }

  private resolveWorkspace(workspaces: Workspace[], repo: unknown): Workspace | undefined {
    if (workspaces.length === 0) return undefined;
    const wanted = String(repo || '').trim().toLowerCase();
    return (wanted && workspaces.find((ws) => ws.name.toLowerCase() === wanted)) || workspaces[0];
  }

  // ---------------------------------------------------------------------------
  // Pre-filtro determinista (sin IA)
  // ---------------------------------------------------------------------------

  private async mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;
    const worker = async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await fn(items[current]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  private normalizeText(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  private normalizePath(path: unknown): string {
    return ('/' + String(path || '').trim().replace(/^[^:/]+:(?=\/)/, '').replace(/^\/+/, '')).toLowerCase();
  }

  private normalizePrefix(prefix: unknown): string {
    const raw = String(prefix || '').trim();
    if (!raw || raw === '/') return '';
    return ('/' + raw.replace(/^\/+/, '')).toLowerCase();
  }

  private extractKeywords(text: string): string[] {
    const counts = new Map<string, number>();
    for (const word of this.normalizeText(text).split(/[^a-z0-9ñ]+/)) {
      if (word.length < 4 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([word]) => word);
  }

  /** Ordena rutas por coincidencia con palabras clave (raíz de 5 letras) y tipo de archivo. */
  private rankFiles(files: string[], keywords: string[]): string[] {
    const stems = keywords.map((keyword) => keyword.slice(0, 5)).filter((stem) => stem.length >= 3);
    const scored = files.map((path, index) => {
      const normalized = this.normalizeText(path);
      let score = 0;
      for (const stem of stems) {
        if (normalized.includes(stem)) score += normalized.split('/').pop()!.includes(stem) ? 3 : 1;
      }
      if (SOURCE_HINTS.test(path)) score += 0.5;
      return { path, score, index };
    });
    return scored
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.path);
  }

  private buildTreeSummary(rankedFiles: string[], truncated: boolean, compact: boolean): string {
    // Con el conjunto de cambios de la HU el árbol es secundario: se envía más corto para ahorrar tokens.
    const limit = compact ? 60 : CODE_AGENT_BUDGET.treeListingLimit;
    const shown = rankedFiles.slice(0, limit);
    const folders = new Map<string, number>();
    for (const path of rankedFiles) {
      const folder = path.split('/').slice(0, 4).join('/') || '/';
      folders.set(folder, (folders.get(folder) || 0) + 1);
    }
    const folderSummary = Array.from(folders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, compact ? 15 : 40)
      .map(([folder, count]) => `${folder}/ (${count})`)
      .join('\n');

    return [
      `Carpetas principales (${rankedFiles.length} archivos${truncated ? ', árbol truncado' : ''}):`,
      folderSummary,
      '',
      `Archivos más relevantes (${shown.length}${rankedFiles.length > shown.length ? ` de ${rankedFiles.length}; usa list_files para ver más` : ''}):`,
      shown.join('\n'),
    ].join('\n');
  }

  private parseArgs(raw: string): any {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }
}

/**
 * Corrige de forma determinista la etiqueta (CAMBIO HU) de los comportamientos
 * RT: si ninguna de sus citas archivo:línea cae en líneas cambiadas por la HU
 * (o el archivo no está en los cambios), pasa a (EXISTENTE). Solo degrada: un
 * RT mal marcado como cambio genera casos redundantes; uno existente no.
 */
export function reconcileChangeLabels(context: string, changedPaths: string[], diffs: Map<string, string>): string {
  const changedLinesCache = new Map<string, Set<number>>();
  const changedLines = (path: string): Set<number> | null => {
    const diff = diffs.get(path);
    if (!diff) return null;
    if (!changedLinesCache.has(path)) changedLinesCache.set(path, collectChangedLines(diff));
    return changedLinesCache.get(path)!;
  };
  // Admite nombres abreviados ("UseCase.java" → ".../ReceivableAndSpecialUseCase.java").
  const findChanged = (cited: string): string | undefined => {
    const name = cited.toLowerCase();
    return changedPaths.find((path) => (path.toLowerCase().split('/').pop() || '').endsWith(name));
  };

  return context.split('\n').map((line) => {
    if (!/^\s*[-*]\s*\[RT-\d+\]\s*\(CAMBIO HU\)/.test(line)) return line;
    const source = line.match(/\bFuentes?:\s*(.*)$/i)?.[1] || '';
    const refs = [...source.matchAll(/([\w./…-]+\.[a-z]{2,10}):([\d,\s–-]+)/gi)];
    if (!refs.length) return line;

    let lastFile = '';
    const touchesChange = refs.some(([, file, ranges]) => {
      lastFile = file.replace(/^…|\.{3}/g, '').split('/').pop() || file;
      const path = findChanged(lastFile);
      if (!path) return false;
      const lines = changedLines(path);
      if (!lines) return true; // archivo cambiado sin diff visto: no se puede descartar
      return ranges.split(',').some((range) => {
        const [from, to = from] = range.trim().split(/[–-]/).map((n) => Number(n));
        if (!from) return false;
        for (let n = from; n <= (to || from); n++) if (lines.has(n)) return true;
        return false;
      });
    });
    return touchesChange ? line : line.replace('(CAMBIO HU)', '(EXISTENTE)');
  }).join('\n');
}

/** Números de línea agregados (±1), junto a eliminadas, y los de las eliminadas en el archivo base. */
function collectChangedLines(diff: string): Set<number> {
  const changed = new Set<number>();
  let pendingRemoval = false;
  let previous = 0;
  for (const raw of diff.split('\n')) {
    // Las citas de líneas eliminadas suelen usar la numeración del archivo base.
    const removed = raw.match(/^-\s*base\s+(\d+)\|/);
    if (removed) { changed.add(Number(removed[1])); pendingRemoval = true; continue; }
    const match = raw.match(/^([+ ])\s*(\d+)\|/);
    if (!match) continue;
    const lineNumber = Number(match[2]);
    if (match[1] === '+') [lineNumber - 1, lineNumber, lineNumber + 1].forEach((n) => changed.add(n));
    if (pendingRemoval) { [previous, lineNumber].forEach((n) => n && changed.add(n)); pendingRemoval = false; }
    previous = lineNumber;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Matriz criterios ↔ código (juez)
// ---------------------------------------------------------------------------

const RULE_LINE = /^\s*[-*]\s*\[(RT-\d+)\]\s*\((CAMBIO HU|EXISTENTE)\)\s*(.*)$/;

/** Secciones "## Título" del contexto, en orden. */
export function splitSections(text: string): { title: string; body: string }[] {
  return text.split(/\n(?=##\s)/).map((chunk) => {
    const match = chunk.match(/^##\s*([^\n]*)\n?([\s\S]*)$/);
    return match ? { title: match[1].trim(), body: match[2].trim() } : { title: '', body: chunk.trim() };
  }).filter((section) => section.title || section.body);
}

const section = (sections: { title: string; body: string }[], name: RegExp) =>
  sections.find((item) => name.test(item.title))?.body || '';

/** Lo que necesita el juez: flujo, reglas con código literal y búsquedas sin resultado. */
export function judgeFacts(agentContext: string): string {
  const sections = splitSections(agentContext);
  return sections
    .filter((item) => /flujo de ejecución|reglas del código|búsquedas sin resultado/i.test(item.title))
    .map((item) => `## ${item.title}\n${item.body}`)
    .join('\n\n');
}

/**
 * Matriz final: la cobertura del juez (con sus reglas resueltas a archivo:línea)
 * y, de forma determinista, los comportamientos (RT) que ningún criterio usa.
 */
export function buildCriteriaContext(agentContext: string, judgeOutput: string): string {
  const sections = splitSections(agentContext);
  const rules = new Map<string, { tag: string; text: string; source: string }>();
  section(sections, /reglas del código/i).split('\n').forEach((line) => {
    const match = line.match(RULE_LINE);
    if (!match) return;
    const source = match[3].match(/\bFuentes?:\s*(.*)$/i)?.[1]?.trim() || '';
    const text = match[3]
      .replace(/\s*\bFuentes?:.*$/i, '')
      .replace(/\s*C[oó]digo:\s*`[^`]*`\.?/i, '')
      .trim();
    rules.set(match[1], { tag: match[2], text, source });
  });

  const used = new Set<string>();
  const coverage = judgeOutput.split('\n')
    .filter((line) => /^\s*[-*]\s*\[CA-\d+\]/.test(line))
    .map((line) => {
      const refs = line.match(/\bReglas?:\s*([^\n]*)$/i)?.[1] || '';
      const ids = refs.match(/RT-\d+/g) || [];
      ids.forEach((id) => used.add(id));
      const sources = [...new Set(ids.map((id) => rules.get(id)?.source).filter(Boolean))];
      const base = line.replace(/\s*\bReglas?:\s*[^\n]*$/i, '').trim();
      return sources.length ? `${base} Fuente: ${sources.join('; ')}` : base;
    });

  if (!coverage.length) return agentContext;

  const uncovered = [...rules.entries()]
    .filter(([id]) => !used.has(id))
    .sort(([, a], [, b]) => (a.tag === b.tag ? 0 : a.tag === 'CAMBIO HU' ? -1 : 1))
    .map(([id, rule]) => `- [${id}] (${rule.tag}) ${rule.text}${rule.source ? ` Fuente: ${rule.source}` : ''}`);

  const keep = (name: RegExp, title: string) => {
    const body = section(sections, name);
    return body ? `## ${title}\n${body}` : '';
  };

  return [
    keep(/resumen técnico/i, 'Resumen técnico'),
    keep(/flujo de ejecución/i, 'Flujo de ejecución real'),
    `## Cobertura de criterios en el código\n${coverage.join('\n')}`,
    `## Comportamientos del código no cubiertos por los criterios\n${uncovered.length ? uncovered.join('\n') : 'Ninguno relevante'}`,
    keep(/datos de prueba/i, 'Datos de prueba sugeridos'),
    keep(/archivos revisados/i, 'Archivos revisados'),
  ].filter(Boolean).join('\n\n');
}

const STATUS_SEVERITY = ['PARCIAL', 'DIFERENTE', 'SIN EVIDENCIA', 'IMPLEMENTADO'];
const CA_STATUS = /^(\s*[-*]\s*\[(CA-\d+)\][^\n]*?→\s*)(IMPLEMENTADO|PARCIAL|DIFERENTE|SIN EVIDENCIA)\b/;

/**
 * Combina varios veredictos del juez: el estado de cada CA es el de la mayoría
 * (empate → el más prudente: un ⚠ de más cuesta menos que un defecto sin
 * detectar) y el texto sale del veredicto que más coincide con la mayoría.
 */
export function mergeJudgeVotes(outputs: string[]): string {
  const parsed = outputs.map((output) => {
    const lines = output.split('\n').filter((line) => CA_STATUS.test(line));
    return { lines, statuses: new Map(lines.map((line) => { const m = line.match(CA_STATUS)!; return [m[2], m[3]] as [string, string]; })) };
  }).filter((vote) => vote.lines.length);
  if (!parsed.length) return outputs[0] || '';

  // Solo votan los veredictos con el número de criterios más frecuente.
  const counts = new Map<number, number>();
  parsed.forEach((vote) => counts.set(vote.lines.length, (counts.get(vote.lines.length) || 0) + 1));
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const voters = parsed.filter((vote) => vote.lines.length === modal);

  const majority = new Map<string, string>();
  for (const id of voters[0].statuses.keys()) {
    const tally = new Map<string, number>();
    voters.forEach((vote) => { const status = vote.statuses.get(id); if (status) tally.set(status, (tally.get(status) || 0) + 1); });
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || STATUS_SEVERITY.indexOf(a[0]) - STATUS_SEVERITY.indexOf(b[0]))[0];
    majority.set(id, best[0]);
  }

  const agreement = (vote: typeof voters[number]) => [...majority].filter(([id, status]) => vote.statuses.get(id) === status).length;
  const base = voters.reduce((best, vote) => (agreement(vote) > agreement(best) ? vote : best));
  return ['## Cobertura de criterios en el código', ...base.lines.map((line) => {
    const id = line.match(CA_STATUS)![2];
    return line.replace(CA_STATUS, `$1${majority.get(id)}`);
  })].join('\n');
}
