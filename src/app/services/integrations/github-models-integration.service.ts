import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { from, Observable, switchMap } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';
import {
  GitHubModelsConnectionPayload,
  GitHubModelsConnectionResponse,
  GitHubModelsConnectionView,
  GitHubModelsListResponse,
} from '../../models/github-models.model';

/**
 * Servicio de integración con "GitHub Models" (a través de GitHub Copilot / PAT).
 *
 * Replica el patrón de AzureDevOpsIntegrationService: todas las llamadas van al
 * backend propio (local-api-server.js / Vercel functions) bajo
 * `/api/integrations/github-models`, y NUNCA se envía el PAT en claro al frontend.
 *
 * El backend es responsable de:
 *   1. Guardar/validar el PAT de forma segura (igual que Azure DevOps).
 *   2. Ejecutar el Device Flow / canje del token efímero de Copilot.
 *   3. Consultar el catálogo de modelos y hacer proxy del chat/completions.
 */
@Injectable({
  providedIn: 'root'
})
export class GitHubModelsIntegrationService {
  private readonly baseUrl = '/api/integrations/github-models';

  constructor(
    private http: HttpClient,
    private supabaseClient: SupabaseClientService
  ) {}

  /** Guarda (o reemplaza) el PAT y valida la conexión contra la API de Copilot. */
  saveConnection(payload: GitHubModelsConnectionPayload): Observable<GitHubModelsConnectionResponse> {
    return this.authorizedPost<GitHubModelsConnectionResponse>(`${this.baseUrl}/connections`, payload);
  }

  /** Valida la conexión existente (verifica que el token efímero se pueda obtener). */
  validateConnection(): Observable<GitHubModelsConnectionResponse> {
    return this.authorizedPost<GitHubModelsConnectionResponse>(`${this.baseUrl}/connections/validate`, {});
  }

  /** Obtiene la conexión guardada (sin exponer el PAT). */
  getConnection(): Observable<GitHubModelsConnectionView | null> {
    return this.authorizedGet<GitHubModelsConnectionView | null>(`${this.baseUrl}/connections`);
  }

  /** Elimina la conexión y desactiva el proveedor. */
  disconnectConnection(): Observable<{ success: boolean }> {
    return this.authorizedDelete<{ success: boolean }>(`${this.baseUrl}/connections`);
  }

  /** Actualiza el modelo seleccionado y/o el flag enabled sin reintroducir el PAT. */
  updatePreferences(preferences: { enabled?: boolean; selectedModel?: string }): Observable<GitHubModelsConnectionResponse> {
    return this.authorizedPost<GitHubModelsConnectionResponse>(`${this.baseUrl}/connections/preferences`, preferences);
  }

  /** Lista el catálogo de modelos disponibles para el token conectado. */
  listModels(): Observable<GitHubModelsListResponse> {
    return this.authorizedGet<GitHubModelsListResponse>(`${this.baseUrl}/models`);
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
