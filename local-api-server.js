require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const sanitizeHtml = require('sanitize-html');
const { htmlToText } = require('html-to-text');
const { decode } = require('he');

const app = express();
const PORT = 3000;

// Configuración básica
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Logging inicial
console.log('\n[0] [dotenv@17.2.3] injecting env from .env.local');
console.log('[0] ');
console.log(`[0] [SERVER] Local API server running on http://localhost:${PORT}`);
console.log(`[0] [ENDPOINT] http://localhost:${PORT}/api/gemini-proxy`);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (GEMINI_API_KEY) {
    console.log('[0] [API_KEY] GEMINI_API_KEY: Configured');
} else {
    console.warn('[0] [API_KEY] GEMINI_API_KEY: NOT FOUND in .env.local');
}

const MODEL_NAME = 'gemini-2.5-flash-lite';
console.log(`[0] [MODEL] Using ${MODEL_NAME} (v1 REST API)`);
console.log('[0] ');

const DEEPSEEK_MIN_REQUEST_INTERVAL = 1000;
let deepseekLastRequestTime = 0;

async function waitForDeepSeekRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - deepseekLastRequestTime;

    if (timeSinceLastRequest < DEEPSEEK_MIN_REQUEST_INTERVAL) {
        const waitTime = DEEPSEEK_MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    deepseekLastRequestTime = Date.now();
}

async function callDeepSeekWithRetry(apiKey, apiBody, maxRetries = 3) {
    let lastError = null;
    const url = 'https://api.deepseek.com/chat/completions';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await waitForDeepSeekRateLimit();

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(apiBody)
            });

            const responseData = await response.json();

            if (!response.ok) {
                throw new Error(JSON.stringify(responseData));
            }

            return responseData;
        } catch (error) {
            lastError = error;
            const errorMessage = error?.message || String(error);
            const isRateLimit = errorMessage.includes('429') || errorMessage.includes('Too Many Requests');

            if (isRateLimit && attempt < maxRetries) {
                const backoffTime = Math.pow(2, attempt) * 2000;
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                continue;
            }

            if (attempt < maxRetries && (errorMessage.includes('500') || errorMessage.includes('Internal Server Error'))) {
                const backoffTime = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                continue;
            }

            break;
        }
    }

    throw lastError;
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Variable de entorno faltante: ${name}`);
    }
    return value;
}

function getSupabaseClients() {
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || requiredEnv('SUPABASE_ANON_KEY');
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

    return {
        authClient: createClient(supabaseUrl, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        }),
        adminClient: createClient(supabaseUrl, serviceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
        })
    };
}

function apiError(status, message, meta = null) {
    const error = new Error(message);
    error.status = status;
    error.meta = meta;
    return error;
}

function normalizeOrganization(input) {
    const raw = String(input || '').trim();
    if (!raw) throw apiError(400, 'La organización de Azure DevOps es obligatoria.');

    const withoutProtocol = raw.replace(/^https?:\/\//i, '');
    const withoutDomain = withoutProtocol.replace(/^dev\.azure\.com\//i, '');
    const normalized = withoutDomain.split('/')[0].trim();

    if (!normalized) throw apiError(400, 'La organización de Azure DevOps no es válida.');
    return normalized;
}

function buildAzureBaseUrl(organization) {
    return `https://dev.azure.com/${encodeURIComponent(organization)}`;
}

function maskTokenHint(pat) {
    const lastFour = String(pat || '').slice(-4).toUpperCase();
    return `••••${lastFour || '----'}`;
}

function cleanHtmlContent(inputHtml) {
    if (!inputHtml || !String(inputHtml).trim()) return '';

    const decoded = decode(String(inputHtml), { isAttributeValue: false });
    const sanitized = sanitizeHtml(decoded, {
        allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'br', 'strong', 'b', 'em', 'i', 'u'],
        allowedAttributes: {},
        disallowedTagsMode: 'discard'
    });

    const plainText = htmlToText(sanitized, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' }
        ]
    });

    return plainText
        .replace(/\u00A0/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function azureGet(url, personalAccessToken) {
    const timeoutMs = Number(process.env.AZURE_DEVOPS_TIMEOUT_MS || 12000);
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
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (response.status === 403) throw apiError(403, 'No tienes permisos para consultar Azure DevOps.');
            if (response.status === 404) throw apiError(404, 'La Historia de Usuario no existe en Azure DevOps.');
            throw apiError(502, 'No fue posible consultar Azure DevOps en este momento.');
        }

        return data;
    } catch (error) {
        if (error.status) throw error;
        if (String(error?.message || '').includes('aborted')) {
            throw apiError(504, 'La consulta a Azure DevOps excedió el tiempo de espera.');
        }
        throw apiError(502, 'Error de conexión con Azure DevOps.');
    } finally {
        clearTimeout(timeoutId);
    }
}

async function validateAzureConnection(organization, personalAccessToken) {
    const endpoint = `${buildAzureBaseUrl(organization)}/_apis/projects?$top=1&api-version=7.1`;
    await azureGet(endpoint, personalAccessToken);
}

async function getAuthenticatedUser(req) {
    const authHeader = req.headers.authorization;
    const [type, token] = String(authHeader || '').split(' ');

    if (type?.toLowerCase() !== 'bearer' || !token) {
        throw apiError(401, 'No autorizado. Inicia sesión nuevamente.');
    }

    const { authClient } = getSupabaseClients();
    const { data, error } = await authClient.auth.getUser(token.trim());
    if (error || !data?.user?.id) {
        throw apiError(401, 'Sesión inválida o expirada. Inicia sesión nuevamente.');
    }

    return data.user;
}

async function getAzureConnection(userId, organization = null) {
    const { adminClient } = getSupabaseClients();
    const { data, error } = await adminClient.rpc('azure_get_connection', {
        p_user_id: userId,
        p_organization: organization || null
    });

    if (error) throw apiError(500, 'Error al consultar la conexión de Azure DevOps.');
    return Array.isArray(data) ? data[0] || null : data || null;
}

async function getAzureConnectionWithSecret(userId, organization = null) {
    const { adminClient } = getSupabaseClients();
    const { data, error } = await adminClient.rpc('azure_get_connection_secret', {
        p_user_id: userId,
        p_organization: organization || null
    });

    if (error) throw apiError(500, 'Error al consultar el secreto de Azure DevOps.');
    return Array.isArray(data) ? data[0] || null : data || null;
}

async function upsertAzureConnection(userId, organization, personalAccessToken, status = 'connected') {
    const { adminClient } = getSupabaseClients();
    const { data, error } = await adminClient.rpc('azure_upsert_connection', {
        p_user_id: userId,
        p_organization: organization,
        p_personal_access_token: personalAccessToken,
        p_status: status
    });

    if (error) {
        console.error('[AZURE][UPSERT_CONNECTION][RPC_ERROR]', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
        });
        throw apiError(
            500,
            'Error al crear o actualizar el secreto de Azure DevOps.',
            {
                source: 'supabase-rpc:azure_upsert_connection',
                code: error.code,
                details: error.details,
                hint: error.hint,
                message: error.message
            }
        );
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) throw apiError(500, 'No se pudo guardar la conexión de Azure DevOps.');
    return row;
}

async function updateAzureConnectionStatus(userId, organization, status) {
    const { adminClient } = getSupabaseClients();
    const { error } = await adminClient.rpc('azure_update_connection_status', {
        p_user_id: userId,
        p_organization: organization,
        p_status: status
    });
    if (error) throw apiError(500, 'No se pudo actualizar el estado de la conexión.');
}

async function disconnectAzureConnection(userId, organization) {
    const { adminClient } = getSupabaseClients();
    const { error } = await adminClient.rpc('azure_disconnect_connection', {
        p_user_id: userId,
        p_organization: organization
    });
    if (error) throw apiError(500, 'No se pudo eliminar la conexión de Azure DevOps.');
}

function sendApiError(res, error) {
    const status = error?.status || 500;
    const message = error?.message || 'Error interno del servidor.';
    const response = { message };

    if (process.env.NODE_ENV !== 'production' && error?.meta) {
        response.debug = error.meta;
    }

    return res.status(status).json(response);
}

async function resolveImageUrls(apiBody) {
    if (!apiBody || !apiBody.contents) return;

    for (const content of apiBody.contents) {
        if (!content.parts) continue;

        const resolvedParts = [];
        for (const part of content.parts) {
            if (part.image_url) {
                const url = part.image_url;
                try {
                    console.log(`[PROXY-LOCAL] Resolviendo imagen: ${url}`);
                    const res = await fetch(url);

                    if (!res.ok) {
                        console.error(`[PROXY-LOCAL] Error descarga (${res.status}): ${url}`);
                        continue;
                    }

                    const buffer = await res.buffer();
                    const mimeType = res.headers.get('content-type') || 'image/jpeg';
                    const base64 = buffer.toString('base64');

                    resolvedParts.push({
                        inline_data: {
                            mime_type: mimeType,
                            data: base64
                        }
                    });
                } catch (e) {
                    console.error(`[PROXY-LOCAL] Error procesando URL:`, e.message);
                }
            } else {
                resolvedParts.push(part);
            }
        }
        content.parts = resolvedParts;
    }
}

// Proxy para Gemini
app.post('/api/gemini-proxy', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: {
                code: 500,
                message: 'GEMINI_API_KEY not configured in .env.local',
                status: 'INTERNAL_ERROR'
            }
        });
    }

    try {
        const { payload } = req.body;
        const apiBody = payload || req.body;

        // RESOLVER URLs ANTES DE LLAMAR A GEMINI
        await resolveImageUrls(apiBody);

        console.log(`[API] Calling Original Google API - Model: ${MODEL_NAME}`);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(apiBody)
        });

        const responseData = await response.json();

        // Enviar respuesta original (incluyendo errores de Google)
        if (!response.ok || responseData.error) {
            console.error('[API] Google API returned an error:', responseData.error || responseData);
            return res.status(response.status).json(responseData);
        }

        console.log('[API] Success response from Google');
        return res.json(responseData);

    } catch (error) {
        console.error('[API] Fatal Error calling Google API:', error.message);
        return res.status(500).json({
            error: {
                code: 500,
                message: 'Fatal error connecting to Google API: ' + error.message,
                status: 'INTERNAL_ERROR'
            }
        });
    }
});

app.post('/api/deepseek-proxy', async (req, res) => {
    if (!process.env.DEEPSEEK_API_KEY) {
        return res.status(500).json({
            error: 'DEEPSEEK_API_KEY not configured',
            userMessage: 'La API key de DeepSeek no está configurada.'
        });
    }

    try {
        const { payload } = req.body || {};
        const apiBody = payload || req.body || {};

        if (!apiBody.messages) {
            return res.status(400).json({
                error: 'Bad Request',
                userMessage: 'La solicitud no contiene "messages".'
            });
        }

        if (!apiBody.model) {
            apiBody.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
        }

        if (apiBody.stream === true) {
            const streamResponse = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify(apiBody)
            });

            if (!streamResponse.ok) {
                const errData = await streamResponse.json().catch(() => ({}));
                return res.status(streamResponse.status).json(errData);
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            for await (const chunk of streamResponse.body) {
                res.write(chunk);
            }
            res.end();
            return;
        }

        const result = await callDeepSeekWithRetry(process.env.DEEPSEEK_API_KEY, apiBody);
        return res.status(200).json(result);
    } catch (error) {
        const message = error?.message || 'Error desconocido';
        return res.status(500).json({
            error: 'DeepSeek API error',
            userMessage: 'Error al procesar la solicitud con DeepSeek.',
            technicalDetails: String(message).substring(0, 200)
        });
    }
});

app.get('/api/integrations/azure-devops/connections', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const organization = typeof req.query.organization === 'string' && req.query.organization
            ? normalizeOrganization(req.query.organization)
            : null;

        const connection = await getAzureConnection(user.id, organization);
        if (!connection) {
            return res.status(200).json(null);
        }

        return res.status(200).json({
            id: connection.id,
            organization: connection.organization,
            status: connection.status,
            tokenHint: connection.token_hint,
            lastValidatedAt: connection.last_validated_at,
            updatedAt: connection.updated_at
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.post('/api/integrations/azure-devops/connections', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const organization = normalizeOrganization(req.body?.organization);
        const personalAccessToken = String(req.body?.personalAccessToken || '').trim();

        if (!personalAccessToken) {
            throw apiError(400, 'El PAT es obligatorio para guardar la conexión.');
        }

        await validateAzureConnection(organization, personalAccessToken);
        const saved = await upsertAzureConnection(user.id, organization, personalAccessToken, 'connected');

        return res.status(200).json({
            id: saved.id,
            organization: saved.organization,
            status: saved.status,
            tokenHint: saved.token_hint || maskTokenHint(personalAccessToken),
            lastValidatedAt: saved.last_validated_at
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.post('/api/integrations/azure-devops/connections/validate', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const organization = req.body?.organization ? normalizeOrganization(req.body.organization) : null;
        const connection = await getAzureConnectionWithSecret(user.id, organization);

        if (!connection) {
            throw apiError(404, 'Azure DevOps no está configurado para tu usuario.');
        }

        try {
            await validateAzureConnection(connection.organization, connection.personal_access_token);
            await updateAzureConnectionStatus(user.id, connection.organization, 'connected');
            return res.status(200).json({
                id: connection.id,
                organization: connection.organization,
                status: 'connected',
                tokenHint: connection.token_hint,
                lastValidatedAt: new Date().toISOString()
            });
        } catch (validationError) {
            const status = validationError?.status === 401 ? 'invalid' : 'expired';
            await updateAzureConnectionStatus(user.id, connection.organization, status);
            throw validationError;
        }
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.delete('/api/integrations/azure-devops/connections', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const organization = normalizeOrganization(req.query.organization);

        await disconnectAzureConnection(user.id, organization);
        return res.status(200).json({ success: true });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.post('/api/integrations/azure-devops/work-items/import', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const userStoryId = Number(req.body?.userStoryId);

        if (!Number.isInteger(userStoryId) || userStoryId <= 0) {
            throw apiError(400, 'ID de HU inválido. Debe ser un número entero positivo.');
        }

        const connection = await getAzureConnectionWithSecret(user.id, null);
        if (!connection || connection.status === 'disconnected') {
            throw apiError(404, 'Azure DevOps no está configurado para este usuario.');
        }

        const endpoint = `${buildAzureBaseUrl(connection.organization)}/_apis/wit/workitems/${userStoryId}?fields=System.Title,System.Description,System.NodeName,Microsoft.VSTS.Common.AcceptanceCriteria,System.IterationLevel3&api-version=7.1`;
        const payload = await azureGet(endpoint, connection.personal_access_token);

        const fields = payload?.fields || {};
        const description = cleanHtmlContent(fields['System.Description'] || '');
        const acceptanceCriteria = cleanHtmlContent(fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '');

        if (!description) {
            throw apiError(422, 'La HU importada no contiene descripción válida.');
        }
        if (!acceptanceCriteria) {
            throw apiError(422, 'La HU importada no contiene criterios de aceptación válidos.');
        }

        return res.status(200).json({
            id: Number(payload?.id || userStoryId),
            title: String(fields['System.Title'] || '').trim(),
            nodeName: String(fields['System.NodeName'] || '').trim(),
            sprint: String(fields['System.IterationLevel3'] || '').trim(),
            description,
            acceptanceCriteria
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.listen(PORT, () => {
    // Servidor listo
});
