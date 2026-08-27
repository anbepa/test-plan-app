import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

interface AzureConnectionRecord {
  id: string;
  organization: string;
  status: 'connected' | 'invalid' | 'expired' | 'disconnected';
  token_hint: string;
  last_validated_at: string | null;
  updated_at: string | null;
}

interface AzureSecretRecord extends AzureConnectionRecord {
  personal_access_token: string;
  secret_id: string;
}

export interface AzureImportedUserStory {
  id: number;
  title: string;
  nodeName: string;
  sprint: string;
  description: string;
  acceptanceCriteria: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
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
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    }
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    }
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

  return {
    id: data.user.id,
    email: data.user.email
  };
}

export function normalizeOrganization(input: string): string {
  const raw = (input || '').trim();
  if (!raw) {
    throw new ApiError(400, 'La organización de Azure DevOps es obligatoria.');
  }

  const withoutProtocol = raw.replace(/^https?:\/\//i, '');
  const withoutDomain = withoutProtocol.replace(/^dev\.azure\.com\//i, '');
  const normalized = withoutDomain.split('/')[0].trim();

  if (!normalized) {
    throw new ApiError(400, 'La organización de Azure DevOps no es válida.');
  }

  return normalized;
}

export function maskTokenHint(personalAccessToken: string): string {
  const lastFour = personalAccessToken.slice(-4).toUpperCase();
  return `••••${lastFour || '----'}`;
}

export function buildAzureBaseUrl(organization: string): string {
  return `https://dev.azure.com/${encodeURIComponent(organization)}`;
}

export async function validateAzureConnection(organization: string, personalAccessToken: string): Promise<void> {
  const baseUrl = buildAzureBaseUrl(organization);
  const endpoint = `${baseUrl}/_apis/projects?$top=1&api-version=7.1`;
  await azureGet(endpoint, personalAccessToken);
}

export async function importAzureUserStory(organization: string, personalAccessToken: string, userStoryId: number): Promise<AzureImportedUserStory> {
  const baseUrl = buildAzureBaseUrl(organization);
  const endpoint = `${baseUrl}/_apis/wit/workitems/${userStoryId}?fields=System.Title,System.Description,System.NodeName,Microsoft.VSTS.Common.AcceptanceCriteria,System.IterationLevel3&api-version=7.1`;

  const payload = await azureGet(endpoint, personalAccessToken);

  const fields = payload?.fields ?? {};
  const cleanedDescription = cleanHtmlContent(String(fields['System.Description'] || ''));
  const cleanedAcceptanceCriteria = cleanHtmlContent(String(fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''));

  if (!cleanedDescription) {
    throw new ApiError(422, 'La HU importada no contiene descripción válida.');
  }

  if (!cleanedAcceptanceCriteria) {
    throw new ApiError(422, 'La HU importada no contiene criterios de aceptación válidos.');
  }

  return {
    id: Number(payload?.id || userStoryId),
    title: String(fields['System.Title'] || '').trim(),
    nodeName: String(fields['System.NodeName'] || '').trim(),
    sprint: String(fields['System.IterationLevel3'] || '').trim(),
    description: cleanedDescription,
    acceptanceCriteria: cleanedAcceptanceCriteria,
  };
}

async function azureGet(url: string, personalAccessToken: string): Promise<any> {
  const timeoutMs = Number(process.env['AZURE_DEVOPS_TIMEOUT_MS'] || 12000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const basicToken = Buffer.from(`:${personalAccessToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${basicToken}`,
        Accept: 'application/json'
      },
      signal: controller.signal as any
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        throw new ApiError(401, 'PAT inválido, vencido o revocado.');
      }
      if (response.status === 403) {
        throw new ApiError(403, 'No tienes permisos para consultar Azure DevOps.');
      }
      if (response.status === 404) {
        throw new ApiError(404, 'La Historia de Usuario no existe en Azure DevOps.');
      }

      throw new ApiError(502, 'No fue posible consultar Azure DevOps en este momento.');
    }

    return data;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('aborted')) {
      throw new ApiError(504, 'La consulta a Azure DevOps excedió el tiempo de espera.');
    }

    throw new ApiError(502, 'Error de conexión con Azure DevOps.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function upsertAzureConnection(
  userId: string,
  organization: string,
  personalAccessToken: string,
  status: AzureConnectionRecord['status'] = 'connected'
): Promise<AzureConnectionRecord> {
  const { adminClient } = getSupabaseClients();

  const { data, error } = await adminClient.rpc('azure_upsert_connection', {
    p_user_id: userId,
    p_organization: organization,
    p_personal_access_token: personalAccessToken,
    p_status: status,
  });

  if (error) {
    console.error('[AZURE][UPSERT_CONNECTION][RPC_ERROR]', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new ApiError(500, 'Error al crear o actualizar el secreto de Azure DevOps.', {
      source: 'supabase-rpc:azure_upsert_connection',
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) {
    throw new ApiError(500, 'No se pudo guardar la conexión de Azure DevOps.');
  }

  return row as AzureConnectionRecord;
}

export async function getAzureConnection(userId: string, organization?: string | null): Promise<AzureConnectionRecord | null> {
  const { adminClient } = getSupabaseClients();

  const { data, error } = await adminClient.rpc('azure_get_connection', {
    p_user_id: userId,
    p_organization: organization || null,
  });

  if (error) {
    throw new ApiError(500, 'Error al consultar la conexión de Azure DevOps.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export async function getAzureConnectionWithSecret(userId: string, organization?: string | null): Promise<AzureSecretRecord | null> {
  const { adminClient } = getSupabaseClients();

  const { data, error } = await adminClient.rpc('azure_get_connection_secret', {
    p_user_id: userId,
    p_organization: organization || null,
  });

  if (error) {
    throw new ApiError(500, 'Error al consultar el secreto de Azure DevOps.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export async function updateAzureConnectionStatus(
  userId: string,
  organization: string,
  status: AzureConnectionRecord['status']
): Promise<void> {
  const { adminClient } = getSupabaseClients();

  const { error } = await adminClient.rpc('azure_update_connection_status', {
    p_user_id: userId,
    p_organization: organization,
    p_status: status,
  });

  if (error) {
    throw new ApiError(500, 'No se pudo actualizar el estado de la conexión.');
  }
}

export async function disconnectAzureConnection(userId: string, organization: string): Promise<void> {
  const { adminClient } = getSupabaseClients();

  const { error } = await adminClient.rpc('azure_disconnect_connection', {
    p_user_id: userId,
    p_organization: organization,
  });

  if (error) {
    throw new ApiError(500, 'No se pudo eliminar la conexión de Azure DevOps.');
  }
}

export function cleanHtmlContent(inputHtml: string): string {
  if (!inputHtml || !inputHtml.trim()) {
    return '';
  }

  const normalizedHtml = inputHtml
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n')
    .replace(/<\s*\/\s*div\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n- ')
    .replace(/<\s*\/\s*li\s*>/gi, '\n');

  const withoutTags = normalizedHtml.replace(/<[^>]*>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);

  return decoded
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const namedMap: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'"
  };

  return value
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => namedMap[name] ?? match);
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

export function toErrorResponse(error: unknown): { status: number; body: { message: string; debug?: Record<string, unknown> } } {
  if (error instanceof ApiError) {
    const body: { message: string; debug?: Record<string, unknown> } = { message: error.message };
    if (process.env['NODE_ENV'] !== 'production' && error.debug) {
      body.debug = error.debug;
    }

    return {
      status: error.status,
      body
    };
  }

  return {
    status: 500,
    body: { message: 'Error interno del servidor.' }
  };
}
