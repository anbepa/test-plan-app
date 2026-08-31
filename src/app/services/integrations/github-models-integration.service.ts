import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { from, Observable, switchMap } from 'rxjs';
import { SupabaseClientService } from '../database/supabase-client.service';
import {
  GitHubDevicePollResponse,
  GitHubDeviceStartResponse,
  GitHubModelsConnectionResponse,
  GitHubModelsConnectionView,
  GitHubModelsListResponse,
} from '../../models/github-models.model';

/**
 * Servicio de integración con "GitHub Models" (a través de GitHub Copilot).
 *
 * La autenticación usa el GitHub OAuth Device Flow (igual que DBeaver, VS Code,
 * etc.): el usuario autoriza en github.com/login/device con un código corto y
 * el backend obtiene su token efímero. NUNCA se pega un token manualmente.
 *
 * Todas las llamadas van al backend propio bajo `/api/integrations/github-models`.
 * El backend es responsable de:
 *   1. Ejecutar el Device Flow y guardar/validar el token de forma segura.
 *   2. Consultar el catálogo de modelos y hacer proxy del chat/completions.
 */
@Injectable({
  providedIn: 'root'
})
export class GitHubModelsIntegrationService {
  private readonly baseUrl = '/api/integrations/github-models';

  /** Paso 1 del Device Flow: pide a GitHub un código de dispositivo. */
  deviceStart(): Observable<GitHubDeviceStartResponse> {
    return this.authorizedPost<GitHubDeviceStartResponse>(`${this.baseUrl}/device/start`, {});
  }

  /**
   * Paso 2 del Device Flow: consulta si el usuario ya autorizó en GitHub.
   * Devuelve { pending: true } mientras se espera, o { pending: false, connection }
   * cuando la autorización se completa y el token queda guardado.
   */
  devicePoll(deviceCode: string, options: { enabled?: boolean; selectedModel?: string } = {}): Observable<GitHubDevicePollResponse> {
    return this.authorizedPost<GitHubDevicePollResponse>(`${this.baseUrl}/device/poll`, {
      deviceCode,
      enabled: options.enabled,
      selectedModel: options.selectedModel,
    });
  }

  /** Valida la conexión existente (verifica que el token siga siendo válido). */
  validateConnection(): Observable<GitHubModelsConnectionResponse> {
    return this.authorizedPost<GitHubModelsConnectionResponse>(`${this.baseUrl}/connections/validate`, {});
  }

  /** Obtiene la conexión guardada (sin exponer el token). */
  getConnection(): Observable<GitHubModelsConnectionView | null> {
    return this.authorizedGet<GitHubModelsConnectionView | null>(`${this.baseUrl}/connections`);
  }

  /** Elimina la conexión y desactiva el proveedor. */
  disconnectConnection(): Observable<{ success: boolean }> {
    return this.authorizedDelete<{ success: boolean }>(`${this.baseUrl}/connections`);
  }

  /** Actualiza el modelo seleccionado y/o el flag enabled sin reautenticar. */
  updatePreferences(preferences: { enabled?: boolean; selectedModel?: string }): Observable<GitHubModelsConnectionResponse> {
    return this.authorizedPost<GitHubModelsConnectionResponse>(`${this.baseUrl}/connections/preferences`, preferences);
  }

  /** Lista el catálogo de modelos disponibles para el token conectado. */
  listModels(): Observable<GitHubModelsListResponse> {
    return this.authorizedGet<GitHubModelsListResponse>(`${this.baseUrl}/models`);
  }

  constructor(
    private http: HttpClient,
    private supabaseClient: SupabaseClientService
  ) {}

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
