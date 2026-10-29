import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { from, Observable, switchMap } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';
import {
  AzureLinkedBranch,
  AzureRepoBranch,
  AzureRepoFile,
  AzureRepoFileRequest,
  AzureRepoProject,
  AzureRepoSearchResult,
  AzureRepoTree,
  AzureRepository,
  ContextSource,
} from '../../models/code-agent.model';

interface RepoRef {
  project: string;
  repositoryId: string;
  branch: string;
}

export interface CodeContextCacheKey {
  repositoryId: string;
  commitId: string;
  scopePath: string;
  mode: ContextSource;
  description: string;
  acceptanceCriteria: string;
}

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

  getTree(ref: RepoRef, scopePath: string): Observable<AzureRepoTree> {
    return this.authorizedPost<AzureRepoTree>(`${this.baseUrl}/tree`, { ...ref, scopePath });
  }

  readFiles(ref: RepoRef, files: AzureRepoFileRequest[]): Observable<AzureRepoFile[]> {
    return this.authorizedPost<AzureRepoFile[]>(`${this.baseUrl}/files`, { ...ref, files });
  }

  search(ref: RepoRef, terms: string[], paths: string[]): Observable<AzureRepoSearchResult> {
    return this.authorizedPost<AzureRepoSearchResult>(`${this.baseUrl}/search`, { ...ref, terms, paths });
  }

  getCachedContext(key: CodeContextCacheKey): Observable<{ cached: { context: string; filesReviewed: string[] } | null }> {
    return this.authorizedPost(`${this.baseUrl}/cache/get`, key);
  }

  saveCachedContext(key: CodeContextCacheKey & { branch: string; context: string; filesReviewed: string[] }): Observable<{ saved: boolean }> {
    return this.authorizedPost(`${this.baseUrl}/cache/save`, key);
  }

  private authorizedGet<T>(url: string, params?: Record<string, string>): Observable<T> {
    return from(this.buildAuthHeaders()).pipe(
      switchMap((headers) => this.http.get<T>(url, { headers, params: new HttpParams({ fromObject: params || {} }) }))
    );
  }

  private authorizedPost<T>(url: string, body: unknown): Observable<T> {
    return from(this.buildAuthHeaders()).pipe(
      switchMap((headers) => this.http.post<T>(url, body, { headers }))
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
