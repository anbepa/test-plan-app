import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AiProvidersService } from './ai-providers.service';
import { AzureReposService, CodeContextCacheKey } from '../integrations/azure-repos.service';
import { SupabaseClientService } from '../database/supabase-client.service';
import { CodeAgentEvent, CodeExplorationInput, WorkItemChanges } from '../../models/code-agent.model';
import { ChatMessage, CodeAgentGateway, CodeAgentRunner, LlmUsage } from './code-agent-runner';

type CacheVersion = Pick<CodeContextCacheKey, 'repositoryId' | 'commitId'>;

/**
 * Agente autónomo (acotado) que explora el código de la HU en Azure Repos y
 * devuelve un "Contexto técnico" para complementar la generación de escenarios.
 *
 * La lógica del agente vive en CodeAgentRunner (sin dependencias de Angular);
 * este servicio conecta los proveedores de IA, el backend de Azure Repos y la
 * caché. El ciclo LLM ↔ herramientas corre en el navegador: cada paso es un
 * request corto, así ninguna función de Vercel se acerca a su maxDuration.
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

    // Los cambios de la HU se consultan una sola vez: sirven para la clave de caché y para el agente.
    let workItemChanges: Promise<WorkItemChanges> | null = null;
    const getWorkItemChanges = (workItemId: number) =>
      workItemChanges ??= firstValueFrom(this.azureRepos.getWorkItemChanges(workItemId));

    const baseKey = {
      scopePath: input.target?.scopePath || '/',
      baseBranch: input.target?.baseBranch || '',
      mode: input.mode,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
    };

    if (useCache) {
      const version = await this.resolveCacheVersion(input, getWorkItemChanges);
      if (version) {
        emit({ type: 'progress', message: 'Buscando contexto en caché…' });
        const cached = await firstValueFrom(this.azureRepos.getCachedContext({ ...baseKey, ...version })).catch(() => null);
        if (cached?.cached?.context) {
          emit({
            type: 'cached',
            message: 'Contexto reutilizado de caché (mismo código y misma HU).',
            context: cached.cached.context,
            filesReviewed: cached.cached.filesReviewed,
          });
          return;
        }
      }
    }

    const gateway: CodeAgentGateway = {
      llm: (messages, options) => this.callLlm(providerId, messages, options.tools, options.forceFinish),
      getWorkItemChanges,
      getTree: (ref, scopePath) => firstValueFrom(this.azureRepos.getTree(ref, scopePath)),
      readFiles: (ref, files) => firstValueFrom(this.azureRepos.readFiles(ref, files)),
      search: (ref, terms, paths) => firstValueFrom(this.azureRepos.search(ref, terms, paths)),
      getBranchDiff: (ref, baseBranch) => firstValueFrom(this.azureRepos.getBranchDiff(ref, baseBranch)),
      getFileDiff: (ref, change, baseCommit, targetCommit) => firstValueFrom(this.azureRepos.getFileDiff(ref, change, baseCommit, targetCommit)),
    };

    const result = await new CodeAgentRunner(gateway).run(input, emit, isCancelled);
    if (!result || isCancelled()) return;

    const seconds = Math.round(result.stats.durationMs / 1000);
    emit({
      type: 'done',
      message: `Contexto técnico listo (${result.filesReviewed.length} archivo(s) revisados, ${result.stats.llmCalls} paso(s) de IA, ${seconds}s).`,
      context: result.context,
      filesReviewed: result.filesReviewed,
    });

    if (result.versionKey) {
      this.azureRepos.saveCachedContext({
        ...baseKey,
        ...this.cacheVersion(input, result.versionKey),
        branch: input.target?.branch || '',
        context: result.context,
        filesReviewed: result.filesReviewed,
      }).subscribe({ error: () => { /* la caché es opcional */ } });
    }
  }

  /** Commit(s) que identifican el código analizado; sin ellos no se usa caché. */
  private async resolveCacheVersion(
    input: CodeExplorationInput,
    getWorkItemChanges: (workItemId: number) => Promise<WorkItemChanges>
  ): Promise<CacheVersion | null> {
    if (input.workItemId) {
      const changes = await getWorkItemChanges(input.workItemId).catch(() => null);
      if (changes?.groups.length) {
        return this.cacheVersion(input, changes.groups.map((group) => group.lastCommit).join(','));
      }
    }
    return input.target?.commitId ? this.cacheVersion(input, input.target.commitId) : null;
  }

  /** Con PRs de la HU la clave es la HU + sus commits; con rama elegida, el repo + su commit. */
  private cacheVersion(input: CodeExplorationInput, versionKey: string): CacheVersion {
    const fromChangeset = !input.target || versionKey !== input.target.commitId;
    return {
      repositoryId: fromChangeset ? `hu:${input.workItemId}` : input.target!.repositoryId,
      commitId: versionKey,
    };
  }

  // ---------------------------------------------------------------------------
  // LLM (proveedores actuales con tool calling)
  // ---------------------------------------------------------------------------

  /** Llamada de texto sin herramientas con el proveedor activo (p. ej. normalizar criterios). */
  async complete(messages: ChatMessage[]): Promise<string> {
    const providerId = this.providersService.getActiveProviderId();
    if (providerId === 'gemini') throw new Error('Se requiere DeepSeek o GitHub Models como proveedor activo.');
    const { message } = await this.callLlm(providerId, messages, [], false);
    return message.content || '';
  }

  private async callLlm(
    providerId: string | null,
    messages: ChatMessage[],
    tools: unknown[],
    forceFinish: boolean
  ): Promise<{ message: ChatMessage; usage?: LlmUsage }> {
    const common = {
      messages,
      // Sin herramientas (juez): respuesta en texto.
      ...(tools.length ? {
        tools,
        // Al agotar el presupuesto se obliga a llamar a finish.
        tool_choice: forceFinish ? { type: 'function', function: { name: 'finish' } } : 'auto',
      } : {}),
      // Determinista: el mismo código y la misma HU deben producir la misma matriz.
      temperature: 0,
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
        return { message: message as ChatMessage, usage: response?.usage };
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
}
