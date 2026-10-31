import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { defer, Observable, switchMap } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';
import { retryTransient } from '../core/transient-retry';
import {
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
  ContextSource,
  FileDiffSegments,
  WorkItemChanges,
} from '../../models/code-agent.model';
import { RepoRef } from '../ai/code-agent-runner';

/**
 * Cliente HTTP del backend de Azure Repos (solo lectura) usado por el agente
 * de exploración de código. Reutiliza la conexión (PAT) de Azure DevOps.
 */
@Injectable({
  providedIn: 'root'
})
export class AzureReposService {
  private readonly baseUrl = '/api/integrations/code-agent';

  constructor(
    private http: HttpClient,
    private supabaseClient: SupabaseClientService
  ) {}

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
