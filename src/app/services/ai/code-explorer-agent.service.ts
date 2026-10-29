import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AiProvidersService } from './ai-providers.service';
import { AzureReposService, CodeContextCacheKey } from '../integrations/azure-repos.service';
import { SupabaseClientService } from '../database/supabase-client.service';
import { CODE_AGENT_PROMPTS, CODE_AGENT_TOOLS } from '../../config/code-agent-prompts.config';
import { CodeAgentEvent, CodeExplorationInput } from '../../models/code-agent.model';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Presupuesto del agente: mantiene tiempo y tokens acotados. */
const BUDGET = {
  maxSteps: 10,
  maxFilesRead: 24,
  maxToolOutputChars: 120_000,
  maxToolResultChars: 30_000,
  maxDurationMs: 240_000,
  treeListingLimit: 350,
};

const STOPWORDS = new Set([
  'para', 'como', 'quiero', 'poder', 'desde', 'hasta', 'cuando', 'donde', 'debe', 'deben', 'sistema',
  'usuario', 'usuarios', 'entonces', 'dado', 'que', 'una', 'uno', 'unos', 'unas', 'este', 'esta', 'estos',
  'estas', 'con', 'sin', 'por', 'los', 'las', 'del', 'sus', 'mas', 'más', 'sea', 'ser', 'esto', 'cada',
  'todo', 'todos', 'toda', 'todas', 'otro', 'otra', 'pero', 'tambien', 'también', 'tiene', 'tener', 'hace',
  'dentro', 'sobre', 'entre', 'mediante', 'según', 'segun', 'pantalla', 'opcion', 'opción', 'campo', 'campos',
  'with', 'that', 'this', 'from', 'when', 'then', 'should', 'user', 'given'
]);

const SOURCE_HINTS = /(controller|service|handler|validator|validation|rule|usecase|use-case|component|model|entity|dto|repository|resolver|router|routes|api|command|query|schema|policy|guard|spec|test)/i;

/**
 * Agente autónomo (acotado) que explora una rama de Azure Repos y devuelve un
 * "Contexto técnico" para complementar la generación de escenarios.
 *
 * El ciclo LLM ↔ herramientas corre en el navegador: cada paso es un request
 * corto a los proxies existentes (DeepSeek / GitHub Models) y al backend de
 * Azure Repos, así ninguna función de Vercel se acerca a su maxDuration.
 */
@Injectable({
  providedIn: 'root'
})
export class CodeExplorerAgentService {

  constructor(
    private http: HttpClient,
    private providersService: AiProvidersService,
    private azureRepos: AzureReposService,
    private supabaseClient: SupabaseClientService
  ) {}

  explore(input: CodeExplorationInput, options: { useCache?: boolean } = {}): Observable<CodeAgentEvent> {
    return new Observable<CodeAgentEvent>((observer) => {
      let cancelled = false;

      this.run(input, options.useCache !== false, (event) => {
        if (!cancelled) observer.next(event);
      }, () => cancelled)
        .then(() => { if (!cancelled) observer.complete(); })
        .catch((error) => { if (!cancelled) observer.error(error); });

      return () => { cancelled = true; };
    });
  }

  private async run(
    input: CodeExplorationInput,
    useCache: boolean,
    emit: (event: CodeAgentEvent) => void,
    isCancelled: () => boolean
  ): Promise<void> {
    const providerId = this.providersService.getActiveProviderId();
    if (providerId === 'gemini') {
      throw new Error('El agente de código requiere DeepSeek o GitHub Models como proveedor activo.');
    }

    const { target } = input;
    const ref = { project: target.project, repositoryId: target.repositoryId, branch: target.branch };
    const cacheKey: CodeContextCacheKey = {
      repositoryId: target.repositoryId,
      commitId: target.commitId,
      scopePath: target.scopePath || '/',
      mode: input.mode,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
    };

    if (useCache && target.commitId) {
      emit({ type: 'progress', message: 'Buscando contexto en caché…' });
      const cached = await firstValueFrom(this.azureRepos.getCachedContext(cacheKey)).catch(() => null);
      if (cached?.cached?.context) {
        emit({
          type: 'cached',
          message: 'Contexto reutilizado de caché (misma rama, mismo commit y misma HU).',
          context: cached.cached.context,
          filesReviewed: cached.cached.filesReviewed,
        });
        return;
      }
    }

    emit({ type: 'progress', message: `Descargando árbol de ${target.repositoryName}@${target.branch}…` });
    const tree = await firstValueFrom(this.azureRepos.getTree(ref, target.scopePath || '/'));
    if (tree.files.length === 0) {
      throw new Error('No se encontraron archivos de código legibles en la rama/ruta seleccionada.');
    }
    emit({ type: 'progress', message: `Árbol listo: ${tree.readableFiles} archivos de código (de ${tree.totalFiles}).` });

    const keywords = this.extractKeywords(`${input.description}\n${input.acceptanceCriteria}\n${input.userRequest}`);
    const rankedFiles = this.rankFiles(tree.files, keywords);

    const messages: ChatMessage[] = [
      { role: 'system', content: CODE_AGENT_PROMPTS.SYSTEM(input.mode, BUDGET.maxSteps) },
      {
        role: 'user',
        content: CODE_AGENT_PROMPTS.USER(
          input.description,
          input.acceptanceCriteria,
          input.userRequest,
          `${target.repositoryName} (rama ${target.branch}${target.scopePath && target.scopePath !== '/' ? `, alcance ${target.scopePath}` : ''})`,
          this.buildTreeSummary(rankedFiles, tree.truncated)
        ),
      },
    ];

    const filesReviewed = new Set<string>();
    let toolOutputChars = 0;
    const startedAt = Date.now();

    for (let step = 1; step <= BUDGET.maxSteps + 1; step++) {
      if (isCancelled()) return;

      const overBudget = step > BUDGET.maxSteps
        || Date.now() - startedAt > BUDGET.maxDurationMs
        || toolOutputChars > BUDGET.maxToolOutputChars
        || filesReviewed.size >= BUDGET.maxFilesRead;

      if (overBudget) {
        messages.push({ role: 'user', content: CODE_AGENT_PROMPTS.FORCE_FINISH });
      }

      emit({ type: 'progress', message: overBudget ? 'Sintetizando contexto técnico…' : `Paso ${step}: analizando…` });
      const reply = await this.callLlm(providerId, messages, overBudget);
      const toolCalls = (reply.tool_calls || []).filter((call) => call?.function?.name);

      // Sin herramientas: el modelo respondió en texto → se toma como contexto final.
      if (toolCalls.length === 0) {
        const text = (reply.content || '').trim();
        if (!text) throw new Error('El agente no devolvió contexto técnico. Intenta de nuevo.');
        await this.finalize(text, filesReviewed, cacheKey, target.branch, emit);
        return;
      }

      messages.push({ role: 'assistant', content: reply.content || '', tool_calls: toolCalls });

      for (const call of toolCalls) {
        const args = this.parseArgs(call.function.arguments);

        if (call.function.name === 'finish') {
          const context = String(args.technical_context || '').trim();
          if (context) {
            await this.finalize(context, filesReviewed, cacheKey, target.branch, emit);
            return;
          }
        }

        const result = overBudget
          ? 'Presupuesto agotado. Llama a finish ahora.'
          : await this.executeTool(call.function.name, args, ref, tree.files, rankedFiles, filesReviewed, emit);

        const clipped = result.length > BUDGET.maxToolResultChars
          ? `${result.slice(0, BUDGET.maxToolResultChars)}\n…[resultado truncado]`
          : result;
        toolOutputChars += clipped.length;
        messages.push({ role: 'tool', tool_call_id: call.id, content: clipped });
      }
    }

    throw new Error('El agente no logró completar la exploración dentro del presupuesto.');
  }

  private async finalize(
    context: string,
    filesReviewed: Set<string>,
    cacheKey: CodeContextCacheKey,
    branch: string,
    emit: (event: CodeAgentEvent) => void
  ): Promise<void> {
    const files = Array.from(filesReviewed);
    if (cacheKey.commitId) {
      // La caché es opcional: un fallo aquí no debe afectar al usuario.
      await firstValueFrom(this.azureRepos.saveCachedContext({ ...cacheKey, branch, context, filesReviewed: files })).catch(() => null);
    }
    emit({ type: 'done', message: `Exploración completada (${files.length} archivos revisados).`, context, filesReviewed: files });
  }

  // ---------------------------------------------------------------------------
  // Herramientas
  // ---------------------------------------------------------------------------

  private async executeTool(
    name: string,
    args: any,
    ref: { project: string; repositoryId: string; branch: string },
    allFiles: string[],
    rankedFiles: string[],
    filesReviewed: Set<string>,
    emit: (event: CodeAgentEvent) => void
  ): Promise<string> {
    try {
      switch (name) {
        case 'list_files': {
          const prefix = this.normalizePrefix(args.path_prefix);
          const contains = String(args.contains || '').toLowerCase();
          const matches = allFiles.filter((path) =>
            (!prefix || path.toLowerCase().startsWith(prefix)) && (!contains || path.toLowerCase().includes(contains)));
          emit({ type: 'tool', message: `📂 Listando ${prefix || '/'}${contains ? ` (“${contains}”)` : ''}: ${matches.length} archivos` });
          const shown = matches.slice(0, 200);
          return shown.length
            ? `${shown.join('\n')}${matches.length > shown.length ? `\n…y ${matches.length - shown.length} más (acota con path_prefix/contains)` : ''}`
            : 'Sin coincidencias.';
        }

        case 'search_code': {
          const terms: string[] = (Array.isArray(args.terms) ? args.terms : [args.terms]).map(String).filter(Boolean).slice(0, 8);
          const prefix = this.normalizePrefix(args.path_prefix);
          const pool = prefix ? rankedFiles.filter((path) => path.toLowerCase().startsWith(prefix)) : rankedFiles;
          const candidates = this.rankFiles(pool, terms.map((term) => this.normalizeText(term))).slice(0, 30);
          emit({ type: 'tool', message: `🔎 Buscando “${terms.join(', ')}” en ${candidates.length} archivos` });
          if (candidates.length === 0) return 'No hay archivos candidatos para buscar.';
          const result = await firstValueFrom(this.azureRepos.search(ref, terms, candidates));
          return result.matches.length
            ? result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n')
            : `Sin coincidencias en ${result.searchedFiles} archivos revisados.`;
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
          const files = await firstValueFrom(this.azureRepos.readFiles(ref, requested));
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

  // ---------------------------------------------------------------------------
  // LLM (proveedores actuales con tool calling)
  // ---------------------------------------------------------------------------

  private async callLlm(providerId: string | null, messages: ChatMessage[], forceFinish: boolean): Promise<ChatMessage> {
    const common = {
      messages,
      tools: CODE_AGENT_TOOLS,
      // Al agotar el presupuesto se obliga a llamar a finish.
      tool_choice: forceFinish ? { type: 'function', function: { name: 'finish' } } : 'auto',
      temperature: 0.2,
      max_tokens: 4000,
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let response: any;
        if (providerId === 'github-models') {
          const headers = await this.buildAuthHeaders();
          response = await firstValueFrom(this.http.post<any>('/api/integrations/github-models/chat', common, { headers }));
        } else {
          response = await firstValueFrom(this.http.post<any>('/api/deepseek-proxy', {
            action: 'codeAgent',
            payload: { model: 'deepseek-flash', thinking: { type: 'disabled' }, ...common },
          }));
        }

        const message = response?.choices?.[0]?.message;
        if (!message) throw new Error('Respuesta vacía del proveedor de IA.');
        return message as ChatMessage;
      } catch (error: any) {
        const status = Number(error?.status || 0);
        const retryable = status === 429 || status >= 500;
        if (attempt < 2 && retryable) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
        }
        throw new Error(error?.error?.userMessage || error?.error?.message || error?.message || 'Error al consultar el proveedor de IA.');
      }
    }
    throw new Error('Error al consultar el proveedor de IA.');
  }

  private async buildAuthHeaders(): Promise<HttpHeaders> {
    let { data, error } = await this.supabaseClient.supabase.auth.getSession();
    let session = data.session;
    const isExpired = !!session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;
    if ((!session?.access_token || isExpired) && !error) {
      const refreshed = await this.supabaseClient.supabase.auth.refreshSession();
      session = refreshed.data.session ?? null;
    }
    if (!session?.access_token) {
      throw new Error('Sesión inválida o expirada. Inicia sesión nuevamente.');
    }
    return new HttpHeaders({ Authorization: `Bearer ${session.access_token}` });
  }

  // ---------------------------------------------------------------------------
  // Pre-filtro determinista (sin IA)
  // ---------------------------------------------------------------------------

  private normalizeText(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
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

  private buildTreeSummary(rankedFiles: string[], truncated: boolean): string {
    const shown = rankedFiles.slice(0, BUDGET.treeListingLimit);
    const folders = new Map<string, number>();
    for (const path of rankedFiles) {
      const folder = path.split('/').slice(0, 4).join('/') || '/';
      folders.set(folder, (folders.get(folder) || 0) + 1);
    }
    const folderSummary = Array.from(folders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
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
