import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { from, Observable, switchMap } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';

export interface AzureSerenityIntegrationPayload {
  azureOrganization: string;
  azureProject: string;
  releaseDefinitionId: number;
  pipelineName?: string;
  branch?: string;
}

export interface AzureSerenityIntegrationResponse {
  id: string;
  azureOrganization: string;
  azureProject: string;
  releaseDefinitionId: number;
  pipelineName: string;
  branch: string;
  status: 'connected' | 'invalid' | 'expired' | 'disconnected' | 'default';
  tokenHint: string;
  lastValidatedAt: string | null;
  updatedAt?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class SerenityIntegrationService {
  private readonly azureConfigUrl = '/api/integrations/serenity/config-azure';

  constructor(
    private http: HttpClient,
    private supabaseClient: SupabaseClientService
  ) {}

  getAzureSerenityConfig(): Observable<AzureSerenityIntegrationResponse | null> {
    return this.authorizedGet<AzureSerenityIntegrationResponse | null>(this.azureConfigUrl);
  }

  saveAzureSerenityConfig(payload: AzureSerenityIntegrationPayload): Observable<AzureSerenityIntegrationResponse> {
    return this.authorizedPost<AzureSerenityIntegrationResponse>(this.azureConfigUrl, payload);
  }

  disconnectAzureSerenity(): Observable<{ success: boolean }> {
    return this.authorizedDelete<{ success: boolean }>(this.azureConfigUrl);
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
