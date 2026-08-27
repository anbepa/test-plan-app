import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// ============================================================================
// GitHub Models (Copilot) — Shared helpers (Vercel serverless).
// Mismo patrón que api/integrations/azure-devops/shared.ts:
//   - getAuthenticatedUser: valida el Bearer de Supabase -> user_id
//   - RPCs vía adminClient (service role) contra github_models_* del .sql
//   - Device Flow OAuth de GitHub + validación contra la API de GitHub/Copilot
// ============================================================================

export interface GithubConnectionRecord {
  id: string;
  user_id: string;
  enabled: boolean;
  selected_model: string | null;
  status: 'connected' | 'invalid' | 'expired' | 'disconnected';
  token_hint: string;
  last_validated_at: string | null;
  updated_at: string | null;
}

export interface GithubSecretRecord extends GithubConnectionRecord {
  token: string;
  secret_id: string;
}

export interface GithubModelInfo {
  id: string;
  displayName: string;
  publisher: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly debug: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Variable de entorno faltante: ${name}`);
  }
  return value;
}

export function getSupabaseClients(): { authClient: SupabaseClient; adminClient: SupabaseClient } {
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = process.env['SUPABASE_ANON_KEY'] || process.env['SUPABASE_KEY'] || requiredEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'] || requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  return { authClient, adminClient };
}

export function getAuthTokenFromRequest(headers: Record<string, string | string[] | undefined>): string {
  const authorization = headers['authorization'];
  const rawValue = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!rawValue) {
    throw new ApiError(401, 'No autorizado. Inicia sesión nuevamente.');
  }
  const [type, token] = rawValue.split(' ');
  if (type?.toLowerCase() !== 'bearer' || !token) {
    throw new ApiError(401, 'Token de autorización inválido.');
  }
  return token.trim();
}

export async function getAuthenticatedUser(headers: Record<string, string | string[] | undefined>): Promise<AuthenticatedUser> {
  const token = getAuthTokenFromRequest(headers);
  const { authClient } = getSupabaseClients();
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError(401, 'Sesión inválida o expirada. Inicia sesión nuevamente.');
  }
  return { id: data.user.id, email: data.user.email };
}

export function maskTokenHint(token: string): string {
  const lastFour = (token || '').slice(-4).toUpperCase();
  return `••••${lastFour || '----'}`;
}

// ---------------------------------------------------------------------------
// RPCs de Supabase
// ---------------------------------------------------------------------------
export async function getGithubConnection(userId: string): Promise<GithubConnectionRecord | null> {
  const { adminClient } = getSupabaseClients();
  const { data, error } = await adminClient.rpc('github_models_get_connection', { p_user_id: userId });
  if (error) throw new ApiError(500, 'Error al consultar la conexión de GitHub Models.');
  const row = Array.isArray(data) ? data[0] : data;
  return (row as GithubConnectionRecord) || null;
}

export async function getGithubConnectionWithSecret(userId: string): Promise<GithubSecretRecord | null> {
  const { adminClient } = getSupabaseClients();
  const { data, error } = await adminClient.rpc('github_models_get_connection_secret', { p_user_id: userId });
  if (error) throw new ApiError(500, 'Error al consultar el secreto de GitHub Models.');
  const row = Array.isArray(data) ? data[0] : data;
  return (row as GithubSecretRecord) || null;
}

export async function upsertGithubConnection(
  userId: string,
  opts: { token?: string | null; enabled?: boolean | null; selectedModel?: string | null; status?: string | null } = {}
): Promise<GithubConnectionRecord> {
  const { adminClient } = getSupabaseClients();
  const { data, error } = await adminClient.rpc('github_models_upsert_connection', {
    p_user_id: userId,
    p_token: opts.token ?? null,
    p_enabled: opts.enabled ?? null,
    p_selected_model: opts.selectedModel ?? null,
    p_status: opts.status ?? 'connected',
  });

  if (error) {
    console.error('[GITHUB_MODELS][UPSERT_CONNECTION][RPC_ERROR]', {
      code: error.code, message: error.message, details: error.details, hint: error.hint,
    });
    throw new ApiError(500, 'Error al crear o actualizar la conexión de GitHub Models.', {
      source: 'supabase-rpc:github_models_upsert_connection',
      code: error.code, details: error.details, hint: error.hint, message: error.message,
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new ApiError(500, 'No se pudo guardar la conexión de GitHub Models.');
  return row as GithubConnectionRecord;
}

export async function updateGithubConnectionStatus(userId: string, status: string): Promise<void> {
  const { adminClient } = getSupabaseClients();
  const { error } = await adminClient.rpc('github_models_update_connection_status', {
    p_user_id: userId, p_status: status,
  });
  if (error) throw new ApiError(500, 'No se pudo actualizar el estado de la conexión de GitHub Models.');
}

export async function disconnectGithubConnection(userId: string): Promise<void> {
  const { adminClient } = getSupabaseClients();
  const { error } = await adminClient.rpc('github_models_disconnect_connection', { p_user_id: userId });
  if (error) throw new ApiError(500, 'No se pudo eliminar la conexión de GitHub Models.');
}

// ---------------------------------------------------------------------------
// Device Flow OAuth de GitHub
// ---------------------------------------------------------------------------
const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GH_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function ghClientId(): string {
  return requiredEnv('GITHUB_OAUTH_CLIENT_ID');
}
function ghScopes(): string {
  return process.env['GITHUB_MODELS_SCOPES'] || 'read:user';
}
function ghTimeoutMs(): number {
  return Number(process.env['GITHUB_MODELS_TIMEOUT_MS'] || 15000);
}

async function ghFetchJson(url: string, options: any = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ghTimeoutMs());
  try {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      signal: controller.signal as any,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (error: unknown) {
    if (String((error as Error)?.message || '').includes('aborted')) {
      throw new ApiError(504, 'La conexión con GitHub excedió el tiempo de espera.');
    }
    throw new ApiError(502, 'Error de conexión con GitHub.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface DeviceStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function deviceStart(): Promise<DeviceStartResult> {
  const { ok, data } = await ghFetchJson(GH_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: ghClientId(), scope: ghScopes() }),
  });
  if (!ok || !data?.device_code) {
    throw new ApiError(502, 'GitHub no devolvió un device_code válido.', { githubResponse: data });
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || 'https://github.com/login/device',
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  };
}

export interface DevicePollResult {
  pending: boolean;
  slowDown?: boolean;
  accessToken?: string;
  tokenType?: string;
  scope?: string;
}

export async function devicePoll(deviceCode: string): Promise<DevicePollResult> {
  const { data } = await ghFetchJson(GH_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: ghClientId(),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  if (data?.error) {
    switch (data.error) {
      case 'authorization_pending':
        return { pending: true, slowDown: false };
      case 'slow_down':
        return { pending: true, slowDown: true };
      case 'expired_token':
        throw new ApiError(410, 'El código expiró. Vuelve a iniciar la conexión con GitHub.');
      case 'access_denied':
        throw new ApiError(403, 'Autorización cancelada en GitHub.');
      default:
        throw new ApiError(502, `GitHub devolvió un error: ${data.error_description || data.error}`);
    }
  }

  if (!data?.access_token) {
    throw new ApiError(502, 'GitHub no devolvió un access_token.');
  }

  return { pending: false, accessToken: data.access_token, tokenType: data.token_type, scope: data.scope };
}

// ---------------------------------------------------------------------------
// Validación y listado de modelos
// ---------------------------------------------------------------------------
export async function validateGithubToken(token: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ghTimeoutMs());
  try {
    const response = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'test-plan-app',
      },
      signal: controller.signal as any,
    });
    if (response.status === 401) throw new ApiError(401, 'Token de GitHub inválido o expirado.');
    if (!response.ok) throw new ApiError(502, 'No se pudo validar el token con GitHub.');
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    if (String((error as Error)?.message || '').includes('aborted')) {
      throw new ApiError(504, 'La validación con GitHub excedió el tiempo de espera.');
    }
    throw new ApiError(502, 'Error de conexión con GitHub.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function listGithubModels(token: string): Promise<GithubModelInfo[]> {
  const catalogUrl = process.env['GITHUB_MODELS_CATALOG_URL'];
  if (catalogUrl) {
    const { ok, data } = await ghFetchJson(catalogUrl, { headers: { Authorization: `Bearer ${token}` } });
    const raw = data?.data || data?.models;
    if (ok && Array.isArray(raw)) {
      return raw.map((m: any) => ({
        id: m.id || m.name,
        displayName: m.display_name || m.name || m.id,
        publisher: m.publisher || m.vendor || 'GitHub',
      }));
    }
  }
  return [
    { id: 'gpt-4o', displayName: 'GPT-4o', publisher: 'OpenAI' },
    { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', publisher: 'OpenAI' },
    { id: 'o1', displayName: 'o1', publisher: 'OpenAI' },
    { id: 'o1-mini', displayName: 'o1-mini', publisher: 'OpenAI' },
    { id: 'claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet', publisher: 'Anthropic' },
  ];
}

export function toConnectionView(row: GithubConnectionRecord | null, fallbackHint?: string) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    enabled: !!row.enabled,
    selectedModel: row.selected_model || null,
    tokenHint: row.token_hint || fallbackHint || '',
    lastValidatedAt: row.last_validated_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function toErrorResponse(error: unknown): { status: number; body: { message: string; debug?: Record<string, unknown> } } {
  if (error instanceof ApiError) {
    const body: { message: string; debug?: Record<string, unknown> } = { message: error.message };
    if (process.env['NODE_ENV'] !== 'production' && error.debug) {
      body.debug = error.debug;
    }
    return { status: error.status, body };
  }
  return { status: 500, body: { message: 'Error interno del servidor.' } };
}
