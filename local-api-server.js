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
app.use(express.json({ limit: '150mb' }));

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

function maskSerenityTokenHint(pat) {
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

async function getSerenityConnectionWithSecret(userId) {
    const { adminClient } = getSupabaseClients();
    const { data, error } = await adminClient.rpc('serenity_get_connection_secret', {
        p_user_id: userId
    });

    if (error) throw apiError(500, 'Error al consultar la configuración de Serenity.');
    return Array.isArray(data) ? data[0] || null : data || null;
}

function buildSerenityRepositoryUrl(repositoryOwner, repositoryName) {
    if (!repositoryOwner || !repositoryName) return '';
    return `https://github.com/${repositoryOwner}/${repositoryName}`;
}

function resolveSerenityEnvDefaults() {
    const repositoryOwner = process.env.GH_DISPATCH_OWNER || 'anbepa';
    const repositoryName = process.env.GH_DISPATCH_REPO || 'ManualTest';
    const workflowFileName = process.env.GH_DISPATCH_WORKFLOW_ID || 'serenity-report.yml';
    const branch = process.env.GH_DISPATCH_BRANCH || 'main';
    const githubUsername = process.env.GH_DISPATCH_GITHUB_USERNAME || repositoryOwner || 'anbepa';
    const workflowName = process.env.GH_DISPATCH_WORKFLOW_NAME || 'Serenity Report';
    const repositoryUrl = process.env.GH_DISPATCH_REPOSITORY_URL || buildSerenityRepositoryUrl(repositoryOwner, repositoryName);
    const personalAccessToken = process.env.GH_DISPATCH_TOKEN || process.env.GH_TOKEN || '';
    return {
        personalAccessToken,
        repositoryOwner,
        repositoryName,
        workflowFileName,
        branch,
        githubUsername,
        workflowName,
        repositoryUrl
    };
}

function maskTokenHint(pat) {
    const value = String(pat || '').trim();
    if (!value) return '';
    return `••••${value.slice(-4).toUpperCase() || '----'}`;
}

async function resolveSerenityRuntimeConfig(req) {
    const user = await getAuthenticatedUser(req);
    const row = await getSerenityConnectionWithSecret(user.id);

    if (row?.personal_access_token) {
        return {
            personalAccessToken: String(row.personal_access_token || ''),
            repositoryOwner: String(row.repository_owner || ''),
            repositoryName: String(row.repository_name || ''),
            workflowFileName: String(row.workflow_file_name || 'serenity-report.yml'),
            branch: String(row.branch || 'main'),
            githubUsername: String(row.github_username || row.repository_owner || ''),
            workflowName: String(row.workflow_name || 'Serenity Report'),
            repositoryUrl: String(row.repository_url || buildSerenityRepositoryUrl(row.repository_owner, row.repository_name))
        };
    }

    const {
        personalAccessToken,
        repositoryOwner,
        repositoryName,
        workflowFileName,
        branch,
        githubUsername,
        workflowName,
        repositoryUrl
    } = resolveSerenityEnvDefaults();

    if (!personalAccessToken || !repositoryOwner || !repositoryName || !workflowFileName) {
        throw apiError(404, 'Serenity no está configurado para este usuario y no existe configuración global en variables de entorno.');
    }

    return {
        personalAccessToken,
        repositoryOwner,
        repositoryName,
        workflowFileName,
        branch,
        githubUsername,
        workflowName,
        repositoryUrl
    };
}

function gh(path, token, opts = {}) {
    return fetch(`https://api.github.com${path}`, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'test-plan-app',
            ...(opts.headers || {})
        }
    });
}

async function findRunByJobId(jobId, config) {
    try {
        const workflowRuns = await gh(
            `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/workflows/${encodeURIComponent(config.workflowFileName)}/runs?event=workflow_dispatch&per_page=10`,
            config.personalAccessToken
        );

        if (workflowRuns.ok) {
            const data = await workflowRuns.json();
            const match = (data.workflow_runs || []).find((r) =>
                (String(r.name || '').includes('Serenity') || String(r.display_title || '').includes('Serenity'))
                && (String(r.name || '').includes(jobId) || String(r.display_title || '').includes(jobId))
            );
            if (match) return String(match.id);
        }
    } catch (error) {
        console.error('[serenity-report][local] Error buscando run por jobId:', error?.message || error);
    }
    return null;
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

async function handleGetWorkItem(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        const workItemId = String(req.params.workItemId || req.query.workItemId || req.body?.workItemId || '').trim();

        if (!workItemId) {
            throw apiError(400, 'workItemId requerido');
        }

        const connection = await getAzureConnectionWithSecret(user.id, null);
        if (!connection || connection.status === 'disconnected') {
            throw apiError(404, 'Azure DevOps no está configurado para este usuario.');
        }

        const endpoint = `${buildAzureBaseUrl(connection.organization)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?$expand=all&api-version=7.1`;
        const payload = await azureGet(endpoint, connection.personal_access_token);

        return res.status(200).json(payload);
    } catch (error) {
        if (error?.status === 404) {
            return res.status(404).json({ error: 'Work Item no encontrado' });
        }
        return sendApiError(res, error);
    }
}

async function handleUploadAttachment(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        const workItemId = String(req.params.workItemId || req.query.workItemId || req.body?.workItemId || '').trim();
        const fileName = String(req.body?.fileName || '').trim();
        const areaPath = String(req.body?.areaPath || '').trim();
        const fileBlob = req.body?.fileBlob;

        if (!workItemId) throw apiError(400, 'workItemId requerido');
        if (!fileName) throw apiError(400, 'fileName requerido');
        if (!fileBlob || typeof fileBlob !== 'string') throw apiError(400, 'fileBlob requerido en base64');

        const connection = await getAzureConnectionWithSecret(user.id, null);
        if (!connection || connection.status === 'disconnected') {
            throw apiError(404, 'Azure DevOps no está configurado para este usuario.');
        }

        const rawBase64 = fileBlob.includes(',') ? fileBlob.split(',')[1] : fileBlob;
        const fileBuffer = Buffer.from(rawBase64, 'base64');

        const attachmentUrl = `${buildAzureBaseUrl(connection.organization)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=Simple&areaPath=${encodeURIComponent(areaPath)}&api-version=7.1`;
        const basicToken = Buffer.from(`:${connection.personal_access_token}`).toString('base64');

        const response = await fetch(attachmentUrl, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/octet-stream',
                Accept: 'application/json'
            },
            body: fileBuffer
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (response.status === 403) throw apiError(403, 'No tienes permisos para cargar adjuntos en Azure DevOps.');
            if (response.status === 404) throw apiError(404, 'No fue posible cargar el archivo de evidencia.');
            throw apiError(502, 'No fue posible cargar la evidencia en Azure DevOps.');
        }

        return res.status(201).json({
            id: data.id,
            url: data.url,
            size: data.size
        });
    } catch (error) {
        return sendApiError(res, error);
    }
}

async function handleLinkAttachment(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        const workItemId = String(req.params.workItemId || req.query.workItemId || req.body?.workItemId || '').trim();
        const attachmentUrl = String(req.body?.attachmentUrl || '').trim();
        const planTitle = String(req.body?.planTitle || '').trim();

        if (!workItemId) throw apiError(400, 'workItemId requerido');
        if (!attachmentUrl) throw apiError(400, 'attachmentUrl requerido');

        const connection = await getAzureConnectionWithSecret(user.id, null);
        if (!connection || connection.status === 'disconnected') {
            throw apiError(404, 'Azure DevOps no está configurado para este usuario.');
        }

        const endpoint = `${buildAzureBaseUrl(connection.organization)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?api-version=7.1`;
        const basicToken = Buffer.from(`:${connection.personal_access_token}`).toString('base64');

        const patchBody = [
            {
                op: 'add',
                path: '/relations/-',
                value: {
                    rel: 'AttachedFile',
                    url: attachmentUrl,
                    attributes: {
                        comment: `Evidencia adjunta al plan: ${planTitle || workItemId}`
                    }
                }
            }
        ];

        const response = await fetch(endpoint, {
            method: 'PATCH',
            headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/json-patch+json',
                Accept: 'application/json'
            },
            body: JSON.stringify(patchBody)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (response.status === 403) throw apiError(403, 'No tienes permisos para vincular adjuntos en Azure DevOps.');
            if (response.status === 404) throw apiError(404, 'No se encontró el plan para vincular la evidencia.');
            throw apiError(502, 'No fue posible vincular la evidencia al plan.');
        }

        return res.status(200).json({
            success: true,
            id: data.id,
            message: `Evidencia vinculada al plan ${workItemId}`
        });
    } catch (error) {
        return sendApiError(res, error);
    }
}

async function handleUploadSerenity(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        const workItemId = String(req.params.workItemId || req.query.workItemId || req.body?.workItemId || '').trim();
        const artifactDownloadUrl = String(req.body?.artifactDownloadUrl || '').trim();
        const projectId = String(req.body?.projectId || '').trim();
        const areaPath = String(req.body?.areaPath || '').trim();
        const planTitle = String(req.body?.planTitle || '').trim();
        const fileName = String(req.body?.fileName || 'Evidencia.zip').trim();

        if (!workItemId) throw apiError(400, 'workItemId requerido');
        if (!artifactDownloadUrl) throw apiError(400, 'artifactDownloadUrl requerido');
        if (!projectId) throw apiError(400, 'projectId requerido');

        const connection = await getAzureConnectionWithSecret(user.id, null);
        if (!connection || connection.status === 'disconnected') {
            throw apiError(404, 'Azure DevOps no está configurado para este usuario.');
        }

        const basicToken = Buffer.from(`:${connection.personal_access_token}`).toString('base64');
        const baseUrl = buildAzureBaseUrl(connection.organization);

        console.log('[upload-serenity] Descargando artifact:', artifactDownloadUrl.substring(0, 80) + '...');
        const artifactRes = await fetch(artifactDownloadUrl);
        if (!artifactRes.ok) {
            throw apiError(502, `No fue posible descargar el reporte de Serenity (${artifactRes.status}).`);
        }
        const artifactBuffer = Buffer.from(await artifactRes.arrayBuffer());
        console.log('[upload-serenity] Artifact descargado:', artifactBuffer.length, 'bytes');

        const attachmentUrl = `${baseUrl}/${encodeURIComponent(projectId)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=Simple&areaPath=${encodeURIComponent(areaPath)}&api-version=7.1`;
        const uploadRes = await fetch(attachmentUrl, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/octet-stream',
                Accept: 'application/json'
            },
            body: artifactBuffer
        });

        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
            if (uploadRes.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (uploadRes.status === 403) throw apiError(403, 'No tienes permisos para cargar adjuntos en Azure DevOps.');
            throw apiError(502, 'No fue posible cargar la evidencia en Azure DevOps.');
        }
        console.log('[upload-serenity] Attachment creado:', uploadData.url);

        const linkEndpoint = `${baseUrl}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?api-version=7.1`;
        const patchBody = [
            {
                op: 'add',
                path: '/relations/-',
                value: {
                    rel: 'AttachedFile',
                    url: uploadData.url,
                    attributes: {
                        comment: `Evidencia adjunta al plan: ${planTitle || workItemId}`
                    }
                }
            }
        ];

        const linkRes = await fetch(linkEndpoint, {
            method: 'PATCH',
            headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/json-patch+json',
                Accept: 'application/json'
            },
            body: JSON.stringify(patchBody)
        });

        const linkData = await linkRes.json().catch(() => ({}));
        if (!linkRes.ok) {
            if (linkRes.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (linkRes.status === 403) throw apiError(403, 'No tienes permisos para vincular adjuntos en Azure DevOps.');
            throw apiError(502, 'No fue posible vincular la evidencia al plan.');
        }
        console.log('[upload-serenity] Evidencia vinculada al plan', workItemId);

        return res.status(200).json({
            success: true,
            attachmentId: uploadData.id,
            attachmentUrl: uploadData.url,
            fileName,
            workItemId: linkData.id,
            message: `Evidencia "${fileName}" cargada y vinculada al plan ${workItemId}`
        });
    } catch (error) {
        return sendApiError(res, error);
    }
}

async function handleUploadEvidence(req, res) {
    try {
        const JSZip = require('jszip');
        const user = await getAuthenticatedUser(req);
        const workItemId = String(req.params.workItemId || req.query.workItemId || req.body?.workItemId || '').trim();
        const artifactDownloadUrl = String(req.body?.artifactDownloadUrl || '').trim();
        const extraFiles = Array.isArray(req.body?.extraFiles) ? req.body.extraFiles : [];
        const projectId = String(req.body?.projectId || '').trim();
        const areaPath = String(req.body?.areaPath || '').trim();
        const planTitle = String(req.body?.planTitle || '').trim();
        let fileName = String(req.body?.fileName || 'Evidencia.zip').trim();
        if (!/\.zip$/i.test(fileName)) fileName += '.zip';

        if (!workItemId) throw apiError(400, 'workItemId requerido');
        if (!projectId) throw apiError(400, 'projectId requerido');
        if (!artifactDownloadUrl && extraFiles.length === 0) {
            throw apiError(400, 'No hay evidencias para cargar');
        }

        const connection = await getAzureConnectionWithSecret(user.id, null);
        if (!connection || connection.status === 'disconnected') {
            throw apiError(404, 'Azure DevOps no está configurado para este usuario.');
        }

        const basicToken = Buffer.from(`:${connection.personal_access_token}`).toString('base64');
        const baseUrl = buildAzureBaseUrl(connection.organization);

        const zip = new JSZip();

        if (artifactDownloadUrl) {
            console.log('[upload-evidence] Descargando artifact Serenity:', artifactDownloadUrl.substring(0, 80) + '...');
            const artifactRes = await fetch(artifactDownloadUrl);
            if (!artifactRes.ok) {
                throw apiError(502, `No fue posible descargar el reporte de Serenity (${artifactRes.status}).`);
            }
            const artifactBuffer = Buffer.from(await artifactRes.arrayBuffer());
            console.log('[upload-evidence] Serenity descargado:', artifactBuffer.length, 'bytes');
            zip.file('target.zip', artifactBuffer);
        }

        for (const f of extraFiles) {
            const name = String(f?.name || '').trim();
            const base64 = String(f?.base64 || '').trim();
            if (!name || !base64) continue;
            zip.file(name, Buffer.from(base64, 'base64'));
        }

        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        console.log('[upload-evidence] ZIP final generado:', zipBuffer.length, 'bytes, nombre:', fileName);

        const attachmentUrl = `${baseUrl}/${encodeURIComponent(projectId)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=Simple&areaPath=${encodeURIComponent(areaPath)}&api-version=7.1`;
        const uploadRes = await fetch(attachmentUrl, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/octet-stream',
                Accept: 'application/json'
            },
            body: zipBuffer
        });

        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
            if (uploadRes.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (uploadRes.status === 403) throw apiError(403, 'No tienes permisos para cargar adjuntos en Azure DevOps.');
            throw apiError(502, 'No fue posible cargar la evidencia en Azure DevOps.');
        }
        console.log('[upload-evidence] Attachment creado:', uploadData.url);

        const linkEndpoint = `${baseUrl}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?api-version=7.1`;
        const patchBody = [
            {
                op: 'add',
                path: '/relations/-',
                value: {
                    rel: 'AttachedFile',
                    url: uploadData.url,
                    attributes: {
                        comment: `Evidencia adjunta al plan: ${planTitle || workItemId}`
                    }
                }
            }
        ];

        const linkRes = await fetch(linkEndpoint, {
            method: 'PATCH',
            headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/json-patch+json',
                Accept: 'application/json'
            },
            body: JSON.stringify(patchBody)
        });

        const linkData = await linkRes.json().catch(() => ({}));
        if (!linkRes.ok) {
            if (linkRes.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (linkRes.status === 403) throw apiError(403, 'No tienes permisos para vincular adjuntos en Azure DevOps.');
            throw apiError(502, 'No fue posible vincular la evidencia al plan.');
        }
        console.log('[upload-evidence] Evidencia vinculada al plan', workItemId);

        return res.status(200).json({
            success: true,
            attachmentId: uploadData.id,
            attachmentUrl: uploadData.url,
            fileName,
            workItemId: linkData.id,
            message: `Evidencia "${fileName}" cargada y vinculada al plan ${workItemId}`
        });
    } catch (error) {
        return sendApiError(res, error);
    }
}

async function handleUpdateFields(req, res) {
    try {
        const user = await getAuthenticatedUser(req);
        const workItemId = String(req.params.workItemId || req.query.workItemId || req.body?.workItemId || '').trim();
        const title = req.body?.title;
        const description = req.body?.description;

        if (!workItemId) throw apiError(400, 'workItemId requerido');

        const connection = await getAzureConnectionWithSecret(user.id, null);
        if (!connection || connection.status === 'disconnected') {
            throw apiError(404, 'Azure DevOps no está configurado para este usuario.');
        }

        const patchBody = [];
        if (title !== undefined && title !== null && String(title).trim() !== '') {
            patchBody.push({
                op: 'add',
                path: '/fields/System.Title',
                value: String(title).trim()
            });
        }
        if (description !== undefined && description !== null && String(description).trim() !== '') {
            patchBody.push({
                op: 'add',
                path: '/fields/System.Description',
                value: String(description).trim()
            });
        }

        if (patchBody.length === 0) {
            throw apiError(400, 'No se proporcionaron campos para actualizar en Azure DevOps.');
        }

        const endpoint = `${buildAzureBaseUrl(connection.organization)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?api-version=7.1`;
        const basicToken = Buffer.from(`:${connection.personal_access_token}`).toString('base64');

        const response = await fetch(endpoint, {
            method: 'PATCH',
            headers: {
                Authorization: `Basic ${basicToken}`,
                'Content-Type': 'application/json-patch+json',
                Accept: 'application/json'
            },
            body: JSON.stringify(patchBody)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) throw apiError(401, 'PAT inválido, vencido o revocado.');
            if (response.status === 403) throw apiError(403, 'No tienes permisos para actualizar campos en Azure DevOps.');
            if (response.status === 404) throw apiError(404, 'No se encontró el Work Item en Azure DevOps.');
            throw apiError(502, 'No fue posible actualizar el plan en Azure DevOps.');
        }

        return res.status(200).json({
            success: true,
            id: data.id,
            rev: data.rev,
            message: `Plan ${workItemId} actualizado correctamente en Azure DevOps`
        });
    } catch (error) {
        return sendApiError(res, error);
    }
}

// Rutas GET para work-items (query params & path params)
app.get('/api/integrations/azure-devops/work-items', handleGetWorkItem);
app.get('/api/integrations/azure-devops/work-items/:workItemId', handleGetWorkItem);

// Rutas POST para work-items
app.post('/api/integrations/azure-devops/work-items', async (req, res) => {
    const action = String(req.query.action || req.body?.action || '').trim();
    if (action === 'attachments') {
        return handleUploadAttachment(req, res);
    } else if (action === 'upload-evidence') {
        return handleUploadEvidence(req, res);
    } else if (action === 'upload-serenity') {
        return handleUploadSerenity(req, res);
    } else {
        return res.status(400).json({ error: `Acción '${action}' no válida en POST /work-items` });
    }
});
app.post('/api/integrations/azure-devops/work-items/:workItemId/attachments', handleUploadAttachment);
app.post('/api/integrations/azure-devops/work-items/:workItemId/upload-serenity', handleUploadSerenity);
app.post('/api/integrations/azure-devops/work-items/:workItemId/upload-evidence', handleUploadEvidence);

// Rutas PATCH para work-items
app.patch('/api/integrations/azure-devops/work-items', async (req, res) => {
    const action = String(req.query.action || req.body?.action || '').trim();
    if (action === 'update-fields') {
        return handleUpdateFields(req, res);
    } else if (action === 'link-attachment') {
        return handleLinkAttachment(req, res);
    } else {
        return res.status(400).json({ error: `Acción '${action}' no válida en PATCH /work-items` });
    }
});
app.patch('/api/integrations/azure-devops/work-items/:workItemId/link-attachment', handleLinkAttachment);
app.patch('/api/integrations/azure-devops/work-items/:workItemId/update-fields', handleUpdateFields);

app.post('/api/serenity-report', async (req, res) => {
    try {
        const config = await resolveSerenityRuntimeConfig(req);
        const bundle = req.body?.bundle;
        if (!bundle) {
            throw apiError(400, 'Se requiere un bundle');
        }

        const jobId = `serenity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const gistRes = await gh('/gists', config.personalAccessToken, {
            method: 'POST',
            body: JSON.stringify({
                description: `Serenity bundle — ${jobId}`,
                public: false,
                files: {
                    'serenity-bundle.json': {
                        content: JSON.stringify(bundle, null, 2)
                    }
                }
            })
        });

        if (!gistRes.ok) {
            const errText = await gistRes.text().catch(() => '');
            console.error('[serenity-report][local] Error creando gist:', gistRes.status, errText);
            throw apiError(502, `Error al crear gist: ${gistRes.status}. Verifica permisos (gist/repo/workflow).`);
        }

        const gist = await gistRes.json();
        const gistId = gist?.id;
        const bundleUrl = gist?.files?.['serenity-bundle.json']?.raw_url;

        if (!gistId || !bundleUrl) {
            throw apiError(502, 'No se pudo obtener la URL del bundle desde GitHub Gist.');
        }

        const dispRes = await gh(
            `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/workflows/${encodeURIComponent(config.workflowFileName)}/dispatches`,
            config.personalAccessToken,
            {
                method: 'POST',
                body: JSON.stringify({
                    ref: config.branch,
                    inputs: {
                        job_id: jobId,
                        bundle_url: bundleUrl
                    }
                })
            }
        );

        if (dispRes.status !== 204) {
            const errText = await dispRes.text().catch(() => '');
            console.error('[serenity-report][local] Error en dispatch:', dispRes.status, errText);
            throw apiError(502, `Error al disparar workflow: ${dispRes.status}. Verifica permisos de Actions.`);
        }

        await new Promise((r) => setTimeout(r, 2500));
        const runId = await findRunByJobId(jobId, config);

        return res.status(200).json({
            success: true,
            phase: runId ? 'running' : 'dispatched',
            jobId,
            gistId,
            runId: runId || null,
            message: runId ? 'Workflow en ejecución' : 'Workflow disparado.'
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.get('/api/serenity-report', async (req, res) => {
    try {
        const config = await resolveSerenityRuntimeConfig(req);
        const runIdRaw = req.query?.runId;
        const gistIdRaw = req.query?.gistId;
        const jobIdRaw = req.query?.jobId;

        let runId = Array.isArray(runIdRaw) ? runIdRaw[0] : runIdRaw;
        const gistId = Array.isArray(gistIdRaw) ? gistIdRaw[0] : gistIdRaw;
        const jobId = Array.isArray(jobIdRaw) ? jobIdRaw[0] : jobIdRaw;

        if (!runId && jobId) {
            runId = await findRunByJobId(String(jobId), config);
        }

        if (!runId) {
            return res.status(202).json({
                status: 'running',
                phase: 'queued',
                conclusion: null,
                message: 'Buscando run...'
            });
        }

        const runRes = await gh(
            `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/runs/${encodeURIComponent(String(runId))}`,
            config.personalAccessToken
        );

        if (!runRes.ok) {
            throw apiError(502, `Error consultando run: ${runRes.status}`);
        }

        const runData = await runRes.json();
        const status = String(runData.status || 'unknown');
        const conclusion = runData.conclusion || null;

        if (status === 'completed') {
            if (conclusion === 'success') {
                const artifactsRes = await gh(
                    `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/runs/${encodeURIComponent(String(runId))}/artifacts`,
                    config.personalAccessToken
                );

                if (!artifactsRes.ok) {
                    return res.status(200).json({ status: 'done', phase: 'completed_no_artifacts', conclusion });
                }

                const artifactsData = await artifactsRes.json();
                const targetArtifact = (artifactsData.artifacts || []).find((a) =>
                    a.name === 'target' || a.name === 'target.zip' || a.name === 'serenity-report'
                );

                if (!targetArtifact) {
                    return res.status(200).json({
                        status: 'done',
                        phase: 'completed_no_target',
                        conclusion,
                        artifacts: (artifactsData.artifacts || []).map((a) => a.name)
                    });
                }

                const dlRes = await gh(
                    `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/artifacts/${encodeURIComponent(String(targetArtifact.id))}/zip`,
                    config.personalAccessToken,
                    { redirect: 'manual' }
                );

                const artifactDownloadUrl = dlRes.headers.get('location') || '';

                if (gistId) {
                    await gh(`/gists/${encodeURIComponent(String(gistId))}`, config.personalAccessToken, { method: 'DELETE' }).catch(() => null);
                }

                return res.status(200).json({ status: 'done', phase: 'completed', conclusion, artifactDownloadUrl });
            }

            if (gistId) {
                await gh(`/gists/${encodeURIComponent(String(gistId))}`, config.personalAccessToken, { method: 'DELETE' }).catch(() => null);
            }

            return res.status(200).json({ status: 'done', phase: 'failed', conclusion });
        }

        return res.status(200).json({ status: 'running', phase: status, conclusion: null });
    } catch (error) {
        return sendApiError(res, error);
    }
});

// ─── Serenity integration ────────────────────────────────────────────────

app.get('/api/integrations/serenity/config', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const row = await getSerenityConnectionWithSecret(user.id);
        if (!row) {
            const fallback = resolveSerenityEnvDefaults();
            return res.status(200).json({
                id: 'global-default',
                githubUsername: fallback.githubUsername,
                repositoryOwner: fallback.repositoryOwner,
                repositoryName: fallback.repositoryName,
                workflowFileName: fallback.workflowFileName,
                branch: fallback.branch,
                repositoryUrl: fallback.repositoryUrl,
                workflowName: fallback.workflowName,
                status: 'default',
                tokenHint: maskSerenityTokenHint(fallback.personalAccessToken),
                lastValidatedAt: null,
                updatedAt: null
            });
        }
        return res.status(200).json({
            id: row.id,
            githubUsername: row.github_username,
            repositoryOwner: row.repository_owner,
            repositoryName: row.repository_name,
            workflowFileName: row.workflow_file_name,
            branch: row.branch,
            repositoryUrl: row.repository_url,
            workflowName: row.workflow_name,
            status: row.status,
            tokenHint: row.token_hint,
            lastValidatedAt: row.last_validated_at,
            updatedAt: row.updated_at
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.post('/api/integrations/serenity/config', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const body = req.body || {};
        const fallback = resolveSerenityEnvDefaults();
        const repositoryOwner = String(body.repositoryOwner || fallback.repositoryOwner).trim();
        const repositoryName  = String(body.repositoryName  || fallback.repositoryName).trim();
        const workflowFileName = String(body.workflowFileName || fallback.workflowFileName).trim();
        const branch = String(body.branch || fallback.branch).trim();
        const githubUsername = String(body.githubUsername || '').trim() || repositoryOwner;
        const workflowName = String(body.workflowName || fallback.workflowName).trim();
        const repositoryUrl = String(body.repositoryUrl || '').trim() || `https://github.com/${repositoryOwner}/${repositoryName}`;
        const typedPersonalAccessToken = String(body.personalAccessToken || '').trim();
        const existingConnection = await getSerenityConnectionWithSecret(user.id);
        const personalAccessToken = typedPersonalAccessToken || String(existingConnection?.personal_access_token || '').trim() || fallback.personalAccessToken;

        if (!repositoryOwner) throw apiError(400, 'El owner del repositorio es obligatorio.');
        if (!repositoryName)  throw apiError(400, 'El nombre del repositorio es obligatorio.');
        if (!personalAccessToken) throw apiError(400, 'No hay token disponible. Configura GH_DISPATCH_TOKEN o ingresa un token manualmente.');

        // Validar acceso a GitHub
        const ghHeaders = {
            Authorization: `Bearer ${personalAccessToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'test-plan-app'
        };
        const repoRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`, { headers: ghHeaders });
        if (repoRes.status === 401 || repoRes.status === 403) throw apiError(401, 'El Personal Access Token de GitHub es inválido o sin permisos.');
        if (repoRes.status === 404) throw apiError(404, 'No se encontró el repositorio de Serenity.');
        if (!repoRes.ok) throw apiError(502, 'No fue posible validar el repositorio de GitHub.');

        const { adminClient } = getSupabaseClients();
        const { data, error } = await adminClient.rpc('serenity_upsert_connection', {
            p_user_id: user.id,
            p_github_username: githubUsername,
            p_repository_owner: repositoryOwner,
            p_repository_name: repositoryName,
            p_workflow_file_name: workflowFileName,
            p_branch: branch,
            p_repository_url: repositoryUrl,
            p_workflow_name: workflowName,
            p_personal_access_token: personalAccessToken,
            p_status: 'connected'
        });
        if (error) throw apiError(500, 'Error al guardar la configuración de Serenity.');
        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.id) throw apiError(500, 'No se pudo guardar la configuración de Serenity.');
        return res.status(200).json({
            id: row.id,
            githubUsername: row.github_username,
            repositoryOwner: row.repository_owner,
            repositoryName: row.repository_name,
            workflowFileName: row.workflow_file_name,
            branch: row.branch,
            repositoryUrl: row.repository_url,
            workflowName: row.workflow_name,
            status: row.status,
            tokenHint: row.token_hint,
            lastValidatedAt: row.last_validated_at
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.delete('/api/integrations/serenity/config', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const { adminClient } = getSupabaseClients();
        const { error } = await adminClient.rpc('serenity_disconnect_connection', {
            p_user_id: user.id
        });
        if (error) throw apiError(500, 'No se pudo eliminar la configuración de Serenity.');
        return res.status(200).json({ success: true });
    } catch (error) {
        return sendApiError(res, error);
    }
});

// ─── Serenity + Azure DevOps (Release) ───────────────────────────────────

async function getAzureSerenityConnectionWithSecret(userId) {
    const { adminClient } = getSupabaseClients();
    const { data, error } = await adminClient.rpc('azure_serenity_get_connection_secret', {
        p_user_id: userId
    });

    if (error) throw apiError(500, 'Error al consultar la configuración de Serenity Azure.');
    return Array.isArray(data) ? data[0] || null : data || null;
}

function azureReleaseRequest(url, personalAccessToken, method = 'GET', body = null) {
    const basicToken = Buffer.from(`:${personalAccessToken}`).toString('base64');
    return fetch(url, {
        method,
        headers: {
            Authorization: `Basic ${basicToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'test-plan-app'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
}

async function validateAzureSerenityPipeline(organization, project, releaseDefinitionId, personalAccessToken) {
    const url = `https://vsrm.dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/release/definitions/${releaseDefinitionId}?api-version=7.1`;
    const response = await azureReleaseRequest(url, personalAccessToken);

    if (response.status === 401) throw apiError(401, 'El PAT de Azure DevOps es inválido o no tiene permisos.');
    if (response.status === 403) throw apiError(403, 'Azure DevOps rechazó el acceso al Release Definition.');
    if (response.status === 404) throw apiError(404, 'No se encontró el Release Definition. Verifica Project y Release Definition ID.');
    if (!response.ok) throw apiError(502, 'No fue posible validar el Release Definition de Azure DevOps.');
}

async function resolveAzureSerenityRuntimeConfig(req) {
    const user = await getAuthenticatedUser(req);
    const row = await getAzureSerenityConnectionWithSecret(user.id);

    if (!row?.personal_access_token) return null;

    return {
        userId: user.id,
        azureOrganization: String(row.azure_organization || ''),
        azureProject: String(row.azure_project || ''),
        releaseDefinitionId: Number(row.release_definition_id || 0),
        pipelineName: String(row.pipeline_name || 'Serenity Report CD'),
        branch: String(row.branch || 'trunk'),
        personalAccessToken: String(row.personal_access_token || '')
    };
}

function resolveAzureArtifactDownloadUrlFromRelease(data) {
    const candidates = [
        data?.artifactDownloadUrl,
        data?.reportZipUrl,
        data?.variables?.SERENITY_REPORT_ZIP_URL?.value,
        data?.variables?.REPORT_ZIP_URL?.value,
        data?.variables?.ARTIFACT_DOWNLOAD_URL?.value,
        data?.environments?.[0]?.variables?.SERENITY_REPORT_ZIP_URL?.value,
        data?.environments?.[0]?.variables?.REPORT_ZIP_URL?.value,
        data?.environments?.[0]?.variables?.ARTIFACT_DOWNLOAD_URL?.value,
    ];

    for (const v of candidates) {
        const s = String(v || '').trim();
        if (/^https?:\/\//i.test(s)) return s;
    }
    return null;
}

const SERENITY_BUNDLE_BUCKET = 'execution-evidence';

function serenityBundlePath(userId, jobId) {
    return `serenity-bundles/${userId}/${jobId}.json`;
}

async function deleteSerenityBundle(userId, jobId) {
    try {
        const { adminClient } = getSupabaseClients();
        await adminClient.storage.from(SERENITY_BUNDLE_BUCKET).remove([serenityBundlePath(userId, jobId)]);
    } catch (_) { /* no-op */ }
}

app.get('/api/integrations/serenity/config-azure', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const row = await getAzureSerenityConnectionWithSecret(user.id);
        if (!row) return res.status(200).json(null);

        return res.status(200).json({
            id: row.id,
            azureOrganization: row.azure_organization,
            azureProject: row.azure_project,
            releaseDefinitionId: row.release_definition_id,
            pipelineName: row.pipeline_name,
            branch: row.branch,
            status: row.status,
            tokenHint: row.token_hint,
            lastValidatedAt: row.last_validated_at,
            updatedAt: row.updated_at
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.post('/api/integrations/serenity/config-azure', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const body = req.body || {};

        const azureOrganization = String(body.azureOrganization || '').trim();
        const azureProject = String(body.azureProject || '').trim();
        const releaseDefinitionId = Number(body.releaseDefinitionId || 0);
        const pipelineName = String(body.pipelineName || 'Serenity Report CD').trim() || 'Serenity Report CD';
        const branch = String(body.branch || 'trunk').trim() || 'trunk';
        const typedToken = String(body.personalAccessToken || '').trim();

        if (!azureOrganization) throw apiError(400, 'La organización de Azure DevOps es obligatoria.');
        if (!azureProject) throw apiError(400, 'El proyecto de Azure DevOps es obligatorio.');
        if (!releaseDefinitionId || releaseDefinitionId <= 0) throw apiError(400, 'El Release Definition ID es obligatorio.');

        const existing = await getAzureSerenityConnectionWithSecret(user.id);
        const personalAccessToken = typedToken || String(existing?.personal_access_token || '').trim();
        if (!personalAccessToken) throw apiError(400, 'Debes ingresar un PAT de Azure DevOps.');

        await validateAzureSerenityPipeline(azureOrganization, azureProject, releaseDefinitionId, personalAccessToken);

        const { adminClient } = getSupabaseClients();
        const { data, error } = await adminClient.rpc('azure_serenity_upsert_connection', {
            p_user_id: user.id,
            p_azure_organization: azureOrganization,
            p_azure_project: azureProject,
            p_release_definition_id: releaseDefinitionId,
            p_pipeline_name: pipelineName,
            p_branch: branch,
            p_personal_access_token: personalAccessToken,
            p_status: 'connected'
        });

        if (error) {
            console.error('[SERENITY_AZURE][UPSERT][RPC_ERROR]', error);
            throw apiError(500, 'Error al guardar la configuración de Serenity Azure.');
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.id) throw apiError(500, 'No se pudo guardar la configuración de Serenity Azure.');

        return res.status(200).json({
            id: row.id,
            azureOrganization: row.azure_organization,
            azureProject: row.azure_project,
            releaseDefinitionId: row.release_definition_id,
            pipelineName: row.pipeline_name,
            branch: row.branch,
            status: row.status,
            tokenHint: row.token_hint || maskTokenHint(personalAccessToken),
            lastValidatedAt: row.last_validated_at
        });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.delete('/api/integrations/serenity/config-azure', async (req, res) => {
    try {
        const user = await getAuthenticatedUser(req);
        const { adminClient } = getSupabaseClients();
        const { error } = await adminClient.rpc('azure_serenity_disconnect_connection', {
            p_user_id: user.id
        });
        if (error) throw apiError(500, 'No se pudo eliminar la configuración de Serenity Azure.');
        return res.status(200).json({ success: true });
    } catch (error) {
        return sendApiError(res, error);
    }
});

app.post('/api/serenity-report-azure', async (req, res) => {
    try {
        const config = await resolveAzureSerenityRuntimeConfig(req);
        if (!config) {
            return res.status(400).json({ error: 'No hay configuración de Serenity Azure para este usuario.' });
        }

        const { bundle } = req.body || {};
        if (!bundle) {
            return res.status(400).json({ error: 'Se requiere un bundle' });
        }

        const jobId = `serenity-azure-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const bundleJson = JSON.stringify(bundle);
        const { adminClient } = getSupabaseClients();
        const path = serenityBundlePath(config.userId, jobId);

        const { error: uploadError } = await adminClient.storage
            .from(SERENITY_BUNDLE_BUCKET)
            .upload(path, bundleJson, { contentType: 'application/json', upsert: true });

        if (uploadError) {
            console.error('[serenity-report-azure][local] Error subiendo bundle:', uploadError);
            return res.status(502).json({ error: 'Error al almacenar el bundle.' });
        }

        const { data: signedData, error: signedError } = await adminClient.storage
            .from(SERENITY_BUNDLE_BUCKET)
            .createSignedUrl(path, 3600);

        if (signedError || !signedData?.signedUrl) {
            await deleteSerenityBundle(config.userId, jobId);
            return res.status(502).json({ error: 'Error al generar URL firmada para el bundle.' });
        }

        const bundleUrl = signedData.signedUrl;
        console.log(`[serenity-report-azure][local] Bundle subido (${(bundleJson.length / 1024).toFixed(0)} KB): ${path}`);

        const releaseUrlApi = `https://vsrm.dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_apis/release/releases?api-version=7.1`;
        const releaseResponse = await azureReleaseRequest(releaseUrlApi, config.personalAccessToken, 'POST', {
            definitionId: config.releaseDefinitionId,
            description: `Serenity report — ${jobId}`,
            variables: {
                BUNDLE_URL: { value: bundleUrl },
                RUN_ID: { value: jobId },
                RUN_NAME: { value: jobId }
            }
        });

        if (!releaseResponse.ok) {
            const errText = await releaseResponse.text();
            console.error('[serenity-report-azure][local] Error al crear release:', releaseResponse.status, errText);
            await deleteSerenityBundle(config.userId, jobId);
            const hint = releaseResponse.status === 401 || releaseResponse.status === 403
                ? ' Verifica que el PAT tenga permisos Release (Read, Write, & Execute).'
                : '';
            return res.status(502).json({ error: `Error al crear release: ${releaseResponse.status}.${hint}`.trim() });
        }

        const releaseData = await releaseResponse.json();
        const releaseId = releaseData?.id;
        if (!releaseId) {
            await deleteSerenityBundle(config.userId, jobId);
            return res.status(502).json({ error: 'No se pudo obtener el ID del release de Azure DevOps.' });
        }

        console.log(`[serenity-report-azure][local] Release creado: ${releaseId}`);

        return res.status(200).json({
            success: true,
            phase: 'running',
            jobId,
            releaseId,
            message: 'Release de Azure DevOps creado.'
        });
    } catch (error) {
        console.error('[serenity-report-azure][local] Error fatal:', error);
        return sendApiError(res, error);
    }
});

app.get('/api/serenity-report-azure', async (req, res) => {
    try {
        const config = await resolveAzureSerenityRuntimeConfig(req);
        if (!config) {
            return res.status(400).json({ error: 'No hay configuración de Serenity Azure para este usuario.' });
        }

        const releaseId = String(req.query.releaseId || '').trim();
        const jobId = String(req.query.jobId || '').trim();
        if (!releaseId) {
            return res.status(400).json({ error: 'Falta releaseId.' });
        }

        const url = `https://vsrm.dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_apis/release/releases/${releaseId}?api-version=7.1`;
        const response = await azureReleaseRequest(url, config.personalAccessToken);

        if (!response.ok) {
            return res.status(502).json({ status: 'error', message: `Error consultando release: ${response.status}` });
        }

        const data = await response.json();
        const environments = data?.environments || [];
        const status = environments[0]?.status || 'unknown';

        if (status === 'succeeded' || status === 'rejected') {
            if (jobId) await deleteSerenityBundle(config.userId, jobId);

            if (status === 'succeeded') {
                const releaseUrl = `https://dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_releaseProgress?_a=release-pipeline-progress&releaseId=${releaseId}`;
                const artifactDownloadUrl = resolveAzureArtifactDownloadUrlFromRelease(data);
                return res.status(200).json({
                    status: 'done',
                    phase: 'completed',
                    result: status,
                    artifactDownloadUrl,
                    releaseUrl,
                    message: 'Release completado exitosamente.'
                });
            }

            return res.status(200).json({ status: 'done', phase: 'failed', result: status });
        }

        return res.status(200).json({ status: 'running', phase: status, result: null });
    } catch (error) {
        console.error('[serenity-report-azure][local] Error en poll:', error);
        return sendApiError(res, error);
    }
});

app.listen(PORT, () => {
    // Servidor listo
});
