import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { defer, firstValueFrom, Observable, switchMap } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';
import { retryTransient } from '../core/transient-retry';
import { QaDataQuery, QaDataResponse,
  AzureAppSearchResult,
  AzureBranchChange,
  AzureBranchDiff,
  AzureFileDiff,
  AzureLinkedBranch,
  AzureRepoBranch,
  AzureRepoFile,
  AzureRepoFileRequest,
  AzureRepoProject,
  AzureRepoSearchResult,
  AzureRepoTree,
  AzureRepository,
  CodeIndexPlan,
  CodeIndexRefreshResult,
  CodeProvider,
  ContextSource,
  GithubCodeConnection,
  GithubCodeConnectionPayload,
  FileDiffSegments,
  WorkItemChanges,
} from '../../models/code-agent.model';
import { RepoRef } from '../ai/code-agent-runner';

/**
 * Cliente HTTP del backend de código (solo lectura) usado por el agente de
 * exploración de código. El origen es Azure Repos (conexión de Azure DevOps)
 * o GitHub (conexión de GitHub): se elige con `provider` y viaja en la
 * cabecera X-Code-Provider; las rutas y respuestas son las mismas.
 */
@Injectable({
  providedIn: 'root'
})
export class AzureReposService {
  private readonly baseUrl = '/api/integrations/code-agent';

  /** Origen del código: GitHub (Azure Repos queda solo como respaldo del backend). */
  provider: CodeProvider = 'github';

  /** Última revisión del índice por prefijo de aplicativo (en memoria: como mucho una cada 30 min). */
  private indexWarmedAt = new Map<string, number>();
  private indexWarming = false;

  constructor(
    private http: HttpClient,
    private supabaseClient: SupabaseClientService
  ) {}

  getGithubConnection(): Observable<GithubCodeConnection | null> {
    return defer(() => this.buildAuthHeaders('azure')).pipe(
      switchMap((headers) => this.http.get<GithubCodeConnection | null>(`${this.baseUrl}/github/connection`, { headers }))
    );
  }

  saveGithubConnection(payload: GithubCodeConnectionPayload): Observable<GithubCodeConnection> {
    return defer(() => this.buildAuthHeaders('azure')).pipe(
      switchMap((headers) => this.http.post<GithubCodeConnection>(`${this.baseUrl}/github/connection`, payload, { headers }))
    );
  }

  disconnectGithub(): Observable<{ success: boolean }> {
    return defer(() => this.buildAuthHeaders('azure')).pipe(
      switchMap((headers) => this.http.delete<{ success: boolean }>(`${this.baseUrl}/github/connection`, { headers }))
    );
  }

  /** Repos del aplicativo (prefijos) que faltan o cambiaron en el índice de código. */
  getIndexPlan(prefixes: string[]): Observable<CodeIndexPlan> {
    return this.authorizedPost<CodeIndexPlan>(`${this.baseUrl}/index/plan`, { prefixes });
  }

  /** Indexa un repo (sus ramas indexadas). Una llamada por repo. */
  refreshIndexRepo(repo: string): Observable<CodeIndexRefreshResult> {
    return defer(() => this.buildAuthHeaders()).pipe(
      switchMap((headers) => this.http.post<CodeIndexRefreshResult>(`${this.baseUrl}/index/refresh`, { repo }, { headers }))
    );
  }

  /**
   * En segundo plano: indexa los repos del aplicativo que faltan o cambiaron, deducidos de los repos de la
   * HU (prefijo antes del primer "_", p. ej. NU0139001_). No bloquea ni avisa errores: la búsqueda usa
   * GitHub mientras el índice no esté listo.
   */
  warmAppIndex(repoNames: string[]): void {
    if (this.provider !== 'github' || this.indexWarming) return;
    const prefixes = Array.from(new Set(repoNames.map((name) => name.match(/^([A-Za-z0-9]+)_/)?.[1]).filter((p): p is string => !!p)))
      .map((prefix) => `${prefix}_`)
      .filter((prefix) => Date.now() - (this.indexWarmedAt.get(prefix) || 0) > 30 * 60_000);
    if (!prefixes.length) return;
    prefixes.forEach((prefix) => this.indexWarmedAt.set(prefix, Date.now()));
    this.indexWarming = true;
    (async () => {
      try {
        const plan = await firstValueFrom(this.getIndexPlan(prefixes));
        for (const item of plan.pending) {
          await firstValueFrom(this.refreshIndexRepo(item.repo)).catch(() => undefined);
        }
      } catch {
        // Opcional: sin índice, search_app sigue con la búsqueda de GitHub.
      } finally {
        this.indexWarming = false;
      }
    })();
  }

  listProjects(): Observable<AzureRepoProject[]> {
    return this.authorizedGet<AzureRepoProject[]>(`${this.baseUrl}/projects`);
  }

  listRepositories(project: string): Observable<AzureRepository[]> {
    return this.authorizedGet<AzureRepository[]>(`${this.baseUrl}/repositories`, { project });
  }

  listBranches(project: string, repositoryId: string): Observable<AzureRepoBranch[]> {
    return this.authorizedGet<AzureRepoBranch[]>(`${this.baseUrl}/branches`, { project, repositoryId });
  }

  getLinkedBranches(workItemId: number): Observable<AzureLinkedBranch[]> {
    return this.authorizedGet<AzureLinkedBranch[]>(`${this.baseUrl}/work-item-links`, { workItemId: String(workItemId) });
  }

  /** PRs/commits vinculados a la HU con los archivos que cambiaron (base → destino). */
  getWorkItemChanges(workItemId: number): Observable<WorkItemChanges> {
    return this.authorizedGet<WorkItemChanges>(`${this.baseUrl}/work-item-changes`, { workItemId: String(workItemId) });
  }

  getTree(ref: RepoRef, scopePath: string): Observable<AzureRepoTree> {
    return this.authorizedPost<AzureRepoTree>(`${this.baseUrl}/tree`, { ...ref, scopePath });
  }

  readFiles(ref: RepoRef, files: AzureRepoFileRequest[]): Observable<AzureRepoFile[]> {
    return this.authorizedPost<AzureRepoFile[]>(`${this.baseUrl}/files`, { ...ref, files });
  }

  /** Datos reales de QA: crea el release (solo stage BD_CONSULTA) o devuelve el resultado en caché. */
  startQaData(queries: QaDataQuery[], force = false): Observable<QaDataResponse> {
    return this.authorizedPost<QaDataResponse>(`${this.baseUrl}/qa-data/start`, { queries, force });
  }

  qaDataStatus(releaseId: number, key: string): Observable<QaDataResponse> {
    return this.authorizedGet<QaDataResponse>(`${this.baseUrl}/qa-data/status`, { releaseId: String(releaseId), key });
  }

  /** Búsqueda en todos los repos del aplicativo (los que empiezan por alguno de los prefijos). */
  searchApplication(projectId: string, repoPrefixes: string[], terms: string[]): Observable<AzureAppSearchResult> {
    return this.authorizedPost<AzureAppSearchResult>(`${this.baseUrl}/app-search`, { projectId, repoPrefixes, terms });
  }

  getBranchDiff(ref: RepoRef, baseBranch: string): Observable<AzureBranchDiff> {
    return this.authorizedPost<AzureBranchDiff>(`${this.baseUrl}/branch-diff`, { ...ref, baseBranch });
  }

  getFileDiff(ref: RepoRef, change: AzureBranchChange, baseCommit: string, targetCommit: string, segments?: FileDiffSegments): Observable<AzureFileDiff> {
    return this.authorizedPost<AzureFileDiff>(`${this.baseUrl}/file-diff`, {
      project: ref.project,
      repositoryId: ref.repositoryId,
      path: change.path,
      changeType: change.changeType,
      originalPath: change.originalPath,
      baseCommit,
      targetCommit,
      segments: segments?.segments,
      exclude: segments?.exclude
    });
  }

  /**
   * GitHub busca sobre una sola descarga del repo: las rutas van en una llamada (Azure: lotes de 30).
   * Se mantienen los 150 archivos más afines: buscar en todo el repo llenaba el tope de coincidencias
   * con archivos menos relevantes (p. ej. versiones viejas de una vista) y empeoraba la cobertura.
   */
  searchLimits(): { batchSize: number; maxFiles: number } | null {
    return this.provider === 'github' ? { batchSize: 5000, maxFiles: 150 } : null;
  }

  search(ref: RepoRef, terms: string[], paths: string[]): Observable<AzureRepoSearchResult> {
    return this.authorizedPost<AzureRepoSearchResult>(`${this.baseUrl}/search`, { ...ref, terms, paths });
  }

  // Todas las rutas son de solo lectura: ante un corte de red o un 5xx se reintenta (incluida la sesión).
  private authorizedGet<T>(url: string, params?: Record<string, string>): Observable<T> {
    return defer(() => this.buildAuthHeaders()).pipe(
      switchMap((headers) => this.http.get<T>(url, { headers, params: new HttpParams({ fromObject: params || {} }) })),
      retryTransient()
    );
  }

  private authorizedPost<T>(url: string, body: unknown): Observable<T> {
    return defer(() => this.buildAuthHeaders()).pipe(
      switchMap((headers) => this.http.post<T>(url, body, { headers })),
      retryTransient()
    );
  }

  private async buildAuthHeaders(provider: CodeProvider = this.provider): Promise<HttpHeaders> {
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

    return new HttpHeaders({ Authorization: `Bearer ${session.access_token}`, 'X-Code-Provider': provider });
  }
}
