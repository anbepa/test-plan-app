import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { from, Observable, switchMap } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';
import {
  AzureDevOpsConnectionPayload,
  AzureDevOpsConnectionResponse,
  AzureDevOpsConnectionView,
  AzureDevOpsImportedUserStory,
  AzureDevOpsImportRequest,
} from '../../models/azure-devops.model';

@Injectable({
  providedIn: 'root'
})
export class AzureDevOpsIntegrationService {
  private readonly baseUrl = '/api/integrations/azure-devops';

  constructor(
    private http: HttpClient,
    private supabaseClient: SupabaseClientService
  ) {}

  saveConnection(payload: AzureDevOpsConnectionPayload): Observable<AzureDevOpsConnectionResponse> {
    return this.authorizedPost<AzureDevOpsConnectionResponse>(`${this.baseUrl}/connections`, payload);
  }

  validateConnection(organization?: string): Observable<AzureDevOpsConnectionResponse> {
    return this.authorizedPost<AzureDevOpsConnectionResponse>(`${this.baseUrl}/connections/validate`, {
      organization: organization?.trim() || undefined
    });
  }

  getConnection(organization?: string): Observable<AzureDevOpsConnectionView | null> {
    const query = organization?.trim() ? `?organization=${encodeURIComponent(organization.trim())}` : '';
    return this.authorizedGet<AzureDevOpsConnectionView | null>(`${this.baseUrl}/connections${query}`);
  }

  disconnectConnection(organization: string): Observable<{ success: boolean }> {
    const query = `?organization=${encodeURIComponent(organization.trim())}`;
    return this.authorizedDelete<{ success: boolean }>(`${this.baseUrl}/connections${query}`);
  }

  importUserStory(userStoryId: number): Observable<AzureDevOpsImportedUserStory> {
    const payload: AzureDevOpsImportRequest = { userStoryId };
    return this.authorizedPost<AzureDevOpsImportedUserStory>(`${this.baseUrl}/work-items/import`, payload);
  }

  private authorizedGet<T>(url: string): Observable<T> {
    return this.withAuthHeaders().pipe(
      switchMap((headers) => this.http.get<T>(url, { headers }))
    );
  }

  private authorizedPost<T>(url: string, body: unknown): Observable<T> {
    return this.withAuthHeaders().pipe(
      switchMap((headers) => this.http.post<T>(url, body, { headers }))
    );
  }

  private authorizedDelete<T>(url: string): Observable<T> {
    return this.withAuthHeaders().pipe(
      switchMap((headers) => this.http.delete<T>(url, { headers }))
    );
  }

  private withAuthHeaders(): Observable<HttpHeaders> {
    return from(this.buildAuthHeaders());
  }

  private async buildAuthHeaders(): Promise<HttpHeaders> {
    let { data, error } = await this.supabaseClient.supabase.auth.getSession();
    let session = data.session;

    const isExpired = !!session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000;

    if ((!session?.access_token || isExpired) && !error) {
      const refreshed = await this.supabaseClient.supabase.auth.refreshSession();
      session = refreshed.data.session ?? null;
      error = refreshed.error ?? null;
    }

    if (!session?.access_token) {
      await this.supabaseClient.supabase.auth.signOut().catch(() => undefined);
      throw new Error('Sesión inválida o expirada. Inicia sesión nuevamente.');
    }

    return new HttpHeaders({ Authorization: `Bearer ${session.access_token}` });
  }
}
