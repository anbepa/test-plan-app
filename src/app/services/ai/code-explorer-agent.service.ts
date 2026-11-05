import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AiProvidersService } from './ai-providers.service';
import { AzureReposService } from '../integrations/azure-repos.service';
import { SupabaseClientService } from '../database/supabase-client.service';
import { TRANSIENT_RETRY_DELAYS_MS, isTransientError } from '../core/transient-retry';
import { CodeAgentEvent, CodeExplorationInput, ExtraCodeTarget, WorkItemChangeGroup, WorkItemChanges, changeGroupKey } from '../../models/code-agent.model';
import { ChatMessage, CodeAgentGateway, CodeAgentRunner, LlmUsage } from './code-agent-runner';

/**
 * Agente autónomo (acotado) que explora el código de la HU en Azure Repos y
 * devuelve un "Contexto técnico" para complementar la generación de escenarios.
 *
 * La lógica del agente vive en CodeAgentRunner (sin dependencias de Angular);
 * este servicio conecta los proveedores de IA y el backend de Azure Repos.
 * Cada exploración analiza el código actual: no se reutilizan contextos guardados. El ciclo LLM ↔ herramientas corre en el navegador: cada paso es un
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

  explore(input: CodeExplorationInput): Observable<CodeAgentEvent> {
    return new Observable<CodeAgentEvent>((observer) => {
      let cancelled = false;

      this.run(input, (event) => {
        if (!cancelled) observer.next(event);
      }, () => cancelled)
        .then(() => { if (!cancelled) observer.complete(); })
        .catch((error) => { if (!cancelled) observer.error(error); });

      return () => { cancelled = true; };
    });
  }

  private async run(
    input: CodeExplorationInput,
    emit: (event: CodeAgentEvent) => void,
    isCancelled: () => boolean
  ): Promise<void> {
    const providerId = this.providersService.getActiveProviderId();
    if (providerId === 'gemini') {
      throw new Error('El agente de código requiere DeepSeek o GitHub Models como proveedor activo.');
    }

    // Los cambios de la HU se consultan una sola vez.
    // Los repos que el usuario desmarcó no se analizan.
    const excluded = new Set(input.excludedGroups || []);
    let workItemChanges: Promise<WorkItemChanges> | null = null;
    const extraTargets = input.extraTargets || [];
    const getWorkItemChanges = (workItemId: number) =>
      workItemChanges ??= (async () => {
        // Cambios vinculados a la HU (menos los repos desmarcados) + ramas que el usuario agregó.
        let changes: WorkItemChanges = { workItemId, groups: [] };
        try {
          changes = await firstValueFrom(this.azureRepos.getWorkItemChanges(workItemId));
        } catch (error) {
          if (!extraTargets.length) throw error;
          emit({ type: 'tool', message: '⚠️ No se pudieron leer los PRs de la HU; se analizan solo las ramas agregadas.' });
        }
        const groups = input.ignoreWorkItemGroups ? [] : changes.groups.filter((group) => !excluded.has(changeGroupKey(group)));
        const extraGroups = await this.buildExtraGroups(extraTargets, emit);
        return { ...changes, groups: [...groups, ...extraGroups] };
      })();

    const gateway: CodeAgentGateway = {
      llm: (messages, options) => this.callLlm(providerId, messages, options.tools, options.forceFinish, options.finishTool),
      getWorkItemChanges,
      getTree: (ref, scopePath) => firstValueFrom(this.azureRepos.getTree(ref, scopePath)),
      readFiles: (ref, files) => firstValueFrom(this.azureRepos.readFiles(ref, files)),
      search: (ref, terms, paths) => firstValueFrom(this.azureRepos.search(ref, terms, paths)),
      getBranchDiff: (ref, baseBranch) => firstValueFrom(this.azureRepos.getBranchDiff(ref, baseBranch)),
      getFileDiff: (ref, change, baseCommit, targetCommit, segments) => firstValueFrom(this.azureRepos.getFileDiff(ref, change, baseCommit, targetCommit, segments)),
      searchApp: (projectId, repoPrefixes, terms) => firstValueFrom(this.azureRepos.searchApplication(projectId, repoPrefixes, terms)),
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

  }

  /** Tope de seguridad de archivos por rama agregada; el recorte por relevancia lo hace el agente. */
  private static readonly MAX_EXTRA_FILES = 400;

  /**
   * Convierte cada rama agregada a mano en un grupo de cambios igual a los de la
   * HU: sus archivos son los que la rama modificó desde que salió de la principal.
   */
  private async buildExtraGroups(targets: ExtraCodeTarget[], emit: (event: CodeAgentEvent) => void): Promise<WorkItemChangeGroup[]> {
    const groups = await Promise.all(targets.map(async (target): Promise<WorkItemChangeGroup | null> => {
      const label = `${target.repositoryName}:${target.branch}`;
      try {
        emit({ type: 'progress', message: `Comparando ${label} contra ${target.baseBranch}…` });
        const diff = await firstValueFrom(this.azureRepos.getBranchDiff(
          { project: target.project, repositoryId: target.repositoryId, branch: target.branch }, target.baseBranch));
        if (!diff.commonCommit || !diff.targetCommit || !diff.changes.length) {
          emit({ type: 'tool', message: `⚠️ ${label} no tiene cambios propios respecto a ${target.baseBranch}: se omite.` });
          return null;
        }
        const max = CodeExplorerAgentService.MAX_EXTRA_FILES;
        const changes = diff.changes.slice(0, max);
        if (diff.changes.length > max) {
          emit({ type: 'tool', message: `⚠️ ${label} modificó ${diff.changes.length} archivos; se consideran los primeros ${max}.` });
        }
        return {
          kind: 'branch',
          projectId: target.project,
          repositoryId: target.repositoryId,
          repositoryName: target.repositoryName,
          targetBranch: target.branch,
          sourceBranches: [target.branch],
          prs: [],
          commits: [],
          lastDate: null,
          lastCommit: diff.targetCommit,
          alsoMergedInto: [],
          files: changes.map((change) => ({
            path: change.path,
            changeType: change.changeType,
            baseCommit: diff.commonCommit as string,
            targetCommit: diff.targetCommit as string,
          })),
        };
      } catch (error: any) {
        emit({ type: 'tool', message: `⚠️ No se pudo leer ${label}: ${error?.error?.message || error?.message || 'error'}.` });
        return null;
      }
    }));
    return groups.filter((group): group is WorkItemChangeGroup => !!group);
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
    forceFinish: boolean,
    finishTool: string = 'finish'
  ): Promise<{ message: ChatMessage; usage?: LlmUsage }> {
    const common = {
      messages,
      // Sin herramientas (juez): respuesta en texto.
      ...(tools.length ? {
        tools,
        // Al agotar el presupuesto se obliga a llamar a finish.
        tool_choice: forceFinish ? { type: 'function', function: { name: finishTool } } : 'auto',
      } : {}),
      // Determinista: el mismo código y la misma HU deben producir la misma matriz.
      temperature: 0,
      // El contexto final (finish) ronda 3-4k tokens: con 4000 se truncaba y el agente repetía la síntesis.
      max_tokens: 8000,
    };

    const attempts = TRANSIENT_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
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
        // "Failed to fetch" (status 0) suele ser un corte momentáneo: se reintenta sin perder la exploración.
        if (attempt < attempts && isTransientError(error)) {
          await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS_MS[attempt - 1]));
          continue;
        }
        if (isTransientError(error) && Number(error?.status) === 0) {
          throw new Error(`Se perdió la conexión con el proveedor de IA (${attempts} intentos). Revisa tu red o VPN y vuelve a explorar.`);
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
