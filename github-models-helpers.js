// ============================================================================
// GitHub Models (Copilot) — Helpers para el servidor local (Express) y Vercel.
// Replica el patrón de las funciones Azure en local-api-server.js:
//   - Autenticación por usuario (Bearer de Supabase -> user_id)
//   - RPCs vía adminClient (service role) contra las funciones creadas en
//     supabase/migrations/github_models_connections.sql
//   - Device Flow OAuth de GitHub + validación contra la API de Copilot
//
// Las credenciales del "GitHub App / OAuth App" se leen de variables de entorno:
//   GITHUB_OAUTH_CLIENT_ID   (obligatorio para el Device Flow)
//   GITHUB_MODELS_SCOPES     (opcional; por defecto 'read:user')
//   GITHUB_MODELS_API_URL    (opcional; por defecto la API de Copilot)
//   GITHUB_MODELS_TIMEOUT_MS (opcional; por defecto 15000)
// ============================================================================

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------------------------
// Infraestructura común (equivalente a la de Azure)
// ---------------------------------------------------------------------------
function ghRequiredEnv(name) {
    const value = process.env[name];
    if (!value || !String(value).trim()) {
        throw new Error(`Variable de entorno faltante: ${name}`);
    }
    return value;
}

function ghGetSupabaseClients() {
    const supabaseUrl = ghRequiredEnv('SUPABASE_URL');
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || ghRequiredEnv('SUPABASE_ANON_KEY');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ghRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

    return {
        authClient: createClient(supabaseUrl, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        }),
        adminClient: createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        })
    };
}

function ghApiError(status, message, meta = null) {
    const error = new Error(message);
    error.status = status;
    error.meta = meta;
    return error;
}

function ghMaskTokenHint(token) {
    const value = String(token || '').trim();
    if (!value) return '';
    return `••••${value.slice(-4).toUpperCase() || '----'}`;
}

async function ghGetAuthenticatedUser(req) {
    const authHeader = req.headers.authorization;
    const [type, token] = String(authHeader || '').split(' ');

    if (type?.toLowerCase() !== 'bearer' || !token) {
        throw ghApiError(401, 'No autorizado. Inicia sesión nuevamente.');
    }

    const { authClient } = ghGetSupabaseClients();
    const { data, error } = await authClient.auth.getUser(token.trim());
    if (error || !data?.user?.id) {
        throw ghApiError(401, 'Sesión inválida o expirada. Inicia sesión nuevamente.');
    }

    return data.user;
}

// ---------------------------------------------------------------------------
// RPCs de Supabase (mismas firmas que el .sql de github_models_connections)
// ---------------------------------------------------------------------------
async function ghGetConnection(userId) {
    const { adminClient } = ghGetSupabaseClients();
    const { data, error } = await adminClient.rpc('github_models_get_connection', {
        p_user_id: userId
    });
    if (error) throw ghApiError(500, 'Error al consultar la conexión de GitHub Models.');
    return Array.isArray(data) ? data[0] || null : data || null;
}

async function ghGetConnectionWithSecret(userId) {
    const { adminClient } = ghGetSupabaseClients();
    const { data, error } = await adminClient.rpc('github_models_get_connection_secret', {
        p_user_id: userId
    });
    if (error) throw ghApiError(500, 'Error al consultar el secreto de GitHub Models.');
    return Array.isArray(data) ? data[0] || null : data || null;
}

async function ghUpsertConnection(userId, { token = null, enabled = null, selectedModel = null, status = 'connected' } = {}) {
    const { adminClient } = ghGetSupabaseClients();
    const { data, error } = await adminClient.rpc('github_models_upsert_connection', {
        p_user_id: userId,
        p_token: token,
        p_enabled: enabled,
        p_selected_model: selectedModel,
        p_status: status
    });

    if (error) {
        console.error('[GITHUB_MODELS][UPSERT_CONNECTION][RPC_ERROR]', {
            code: error.code, message: error.message, details: error.details, hint: error.hint
        });
        throw ghApiError(500, 'Error al crear o actualizar la conexión de GitHub Models.', {
            source: 'supabase-rpc:github_models_upsert_connection',
            code: error.code, details: error.details, hint: error.hint, message: error.message
        });
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) throw ghApiError(500, 'No se pudo guardar la conexión de GitHub Models.');
    return row;
}

async function ghUpdateConnectionStatus(userId, status) {
    const { adminClient } = ghGetSupabaseClients();
    const { error } = await adminClient.rpc('github_models_update_connection_status', {
        p_user_id: userId,
        p_status: status
    });
    if (error) throw ghApiError(500, 'No se pudo actualizar el estado de la conexión de GitHub Models.');
}

async function ghDisconnectConnection(userId) {
    const { adminClient } = ghGetSupabaseClients();
    const { error } = await adminClient.rpc('github_models_disconnect_connection', {
        p_user_id: userId
    });
    if (error) throw ghApiError(500, 'No se pudo eliminar la conexión de GitHub Models.');
}

// ---------------------------------------------------------------------------
// Device Flow OAuth de GitHub
// Docs: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// ---------------------------------------------------------------------------
const GH_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GH_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

// Client ID oficial de GitHub Copilot para editores (mismo que VS Code / DBeaver).
// El endpoint /copilot_internal/v2/token SOLO acepta tokens emitidos por las OAuth
// Apps aprobadas de Copilot; un OAuth App propio da 401 en el token exchange aunque
// el usuario tenga suscripcion activa.
const GH_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

function ghClientId() {
    return process.env.GITHUB_OAUTH_CLIENT_ID || GH_COPILOT_CLIENT_ID;
}

function ghScopes() {
    return process.env.GITHUB_MODELS_SCOPES || 'read:user';
}

function ghTimeoutMs() {
    return Number(process.env.GITHUB_MODELS_TIMEOUT_MS || 15000);
}

async function ghFetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ghTimeoutMs());
    try {
        const response = await fetch(url, {
            ...options,
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        return { response, data };
    } catch (error) {
        if (String(error?.message || '').includes('aborted')) {
            throw ghApiError(504, 'La conexión con GitHub excedió el tiempo de espera.');
        }
        throw ghApiError(502, 'Error de conexión con GitHub.');
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Paso 1 del Device Flow: solicita device_code + user_code.
 * Devuelve lo necesario para que el frontend muestre el código y sondee.
 */
async function ghDeviceStart() {
    const { response, data } = await ghFetchJson(GH_DEVICE_CODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: ghClientId(), scope: ghScopes() })
    });

    if (!response.ok || !data?.device_code) {
        throw ghApiError(502, 'GitHub no devolvió un device_code válido.', { githubResponse: data });
    }

    return {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri || 'https://github.com/login/device',
        expiresIn: data.expires_in,
        interval: data.interval || 5
    };
}

/**
 * Paso 2 del Device Flow: canjea el device_code por un access_token.
 * Retorna { pending: true } mientras el usuario no ha autorizado.
 */
async function ghDevicePoll(deviceCode) {
    const { data } = await ghFetchJson(GH_ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: ghClientId(),
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
    });

    // Errores "de flujo" (no fatales): el usuario aún no autoriza.
    if (data?.error) {
        switch (data.error) {
            case 'authorization_pending':
                return { pending: true, slowDown: false };
            case 'slow_down':
                return { pending: true, slowDown: true };
            case 'expired_token':
                throw ghApiError(410, 'El código expiró. Vuelve a iniciar la conexión con GitHub.');
            case 'access_denied':
                throw ghApiError(403, 'Autorización cancelada en GitHub.');
            default:
                throw ghApiError(502, `GitHub devolvió un error: ${data.error_description || data.error}`);
        }
    }

    if (!data?.access_token) {
        throw ghApiError(502, 'GitHub no devolvió un access_token.');
    }

    return { pending: false, accessToken: data.access_token, tokenType: data.token_type, scope: data.scope };
}

// ---------------------------------------------------------------------------
// Validación y listado de modelos contra la API de GitHub Models / Copilot
// ---------------------------------------------------------------------------
function ghModelsApiUrl() {
    // Endpoint base para el proxy de Copilot; sobrescribible por env.
    return process.env.GITHUB_MODELS_API_URL || 'https://api.githubcopilot.com';
}

/**
 * Valida el token efectivo contra GitHub (identidad del usuario).
 * Un 401 => token inválido/expirado.
 */
async function ghValidateToken(token) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ghTimeoutMs());
    try {
        const response = await fetch('https://api.github.com/user', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'test-plan-app'
            },
            signal: controller.signal
        });
        if (response.status === 401) throw ghApiError(401, 'Token de GitHub inválido o expirado.');
        if (!response.ok) throw ghApiError(502, 'No se pudo validar el token con GitHub.');
        return await response.json().catch(() => ({}));
    } catch (error) {
        if (error.status) throw error;
        if (String(error?.message || '').includes('aborted')) {
            throw ghApiError(504, 'La validación con GitHub excedió el tiempo de espera.');
        }
        throw ghApiError(502, 'Error de conexión con GitHub.');
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Catálogo de modelos disponibles. Si GITHUB_MODELS_CATALOG_URL está definido,
 * se consulta; de lo contrario se devuelve un catálogo estático razonable.
 */
async function ghListModels(token) {
    const catalogUrl = process.env.GITHUB_MODELS_CATALOG_URL;
    if (catalogUrl) {
        const { response, data } = await ghFetchJson(catalogUrl, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok && Array.isArray(data?.data || data?.models)) {
            const raw = data.data || data.models;
            return raw.map((m) => ({
                id: m.id || m.name,
                displayName: m.display_name || m.name || m.id,
                publisher: m.publisher || m.vendor || 'GitHub'
            }));
        }
    }

    // Fallback estático (los modelos típicos vía Copilot).
    return [
        { id: 'gpt-4o', displayName: 'GPT-4o', publisher: 'OpenAI' },
        { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', publisher: 'OpenAI' },
        { id: 'o1', displayName: 'o1', publisher: 'OpenAI' },
        { id: 'o1-mini', displayName: 'o1-mini', publisher: 'OpenAI' },
        { id: 'claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet', publisher: 'Anthropic' }
    ];
}

// Vista pública de una conexión (sin secretos) para la respuesta HTTP.
function ghToConnectionView(row, fallbackHint) {
    if (!row) return null;
    return {
        id: row.id,
        status: row.status,
        enabled: !!row.enabled,
        selectedModel: row.selected_model || null,
        tokenHint: row.token_hint || fallbackHint || '',
        lastValidatedAt: row.last_validated_at || null,
        updatedAt: row.updated_at || null
    };
}

module.exports = {
    ghApiError,
    ghMaskTokenHint,
    ghGetAuthenticatedUser,
    ghGetConnection,
    ghGetConnectionWithSecret,
    ghUpsertConnection,
    ghUpdateConnectionStatus,
    ghDisconnectConnection,
    ghDeviceStart,
    ghDevicePoll,
    ghValidateToken,
    ghListModels,
    ghModelsApiUrl,
    ghToConnectionView
};
