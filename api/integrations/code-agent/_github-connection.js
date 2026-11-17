/**
 * Conexión de GitHub (origen del código) por usuario y despacho de rutas
 * GitHub del agente de código. CommonJS para usarse desde Vercel
 * ([...path].ts) y desde local-api-server.js.
 *
 * Rutas propias (bajo /api/integrations/code-agent):
 *   GET    github/connection   -> vista de la conexión (sin token) o null
 *   POST   github/connection   { owner, repoFilter?, token?, enabled? } -> valida y guarda
 *   DELETE github/connection   -> desconecta
 *
 * El resto de rutas usa GitHub cuando el cliente envía "X-Code-Provider: github".
 */
const github = require('./_github-repos-core.js');
const { CodeAgentError } = require('./_azure-repos-core.js');

function toView(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner,
    repoFilter: row.repo_filter || '',
    enabled: !!row.enabled,
    status: row.status,
    tokenHint: row.token_hint,
    lastValidatedAt: row.last_validated_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

async function getGithubConnectionWithSecret(adminClient, userId) {
  const { data, error } = await adminClient.rpc('github_repos_get_connection_secret', { p_user_id: userId });
  if (error) {
    console.error('[GITHUB_REPOS][GET_SECRET]', error.message);
    throw new CodeAgentError(500, 'No se pudo consultar la conexión de GitHub (¿falta aplicar la migración github_repos_connections.sql?).');
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

async function markExpired(adminClient, userId) {
  try {
    await adminClient.rpc('github_repos_update_connection_status', { p_user_id: userId, p_status: 'expired' });
  } catch {
    // Marcar como vencida es informativo: no debe ocultar el error original.
  }
}

async function handleConnectionRoute(adminClient, userId, method, body) {
  if (method === 'GET') {
    return toView(await getGithubConnectionWithSecret(adminClient, userId));
  }
  if (method === 'DELETE') {
    const { error } = await adminClient.rpc('github_repos_disconnect_connection', { p_user_id: userId });
    if (error) throw new CodeAgentError(500, 'No se pudo desconectar GitHub.');
    return { success: true };
  }
  if (method === 'POST') {
    const b = body || {};
    const parsed = github.parseOwnerInput(b.owner);
    const repoFilter = String(b.repoFilter != null && String(b.repoFilter).trim() ? b.repoFilter : parsed.repo || '').trim();
    const existing = await getGithubConnectionWithSecret(adminClient, userId);
    const newToken = String(b.token || '').trim();
    const token = newToken || (existing && existing.token) || '';
    if (!token) throw new CodeAgentError(400, 'El token de GitHub es obligatorio.');

    const summary = await github.validateGithubConnection(token, parsed.owner, repoFilter);
    if (!summary.repositories) {
      if (!repoFilter) {
        throw new CodeAgentError(400, `El token (usuario ${summary.login}) no ve repositorios de ${parsed.owner}. Usa un token con alcance "repo", autorizado para la organización (SSO), de una cuenta con acceso a esos repositorios.`);
      }
      throw new CodeAgentError(400, repoFilter
        ? `El token no ve repositorios de ${parsed.owner} que empiecen por "${repoFilter}". Revisa el filtro, el acceso del token o la autorización SSO.`
        : `El token no ve repositorios de ${parsed.owner}.`);
    }

    const { data, error } = await adminClient.rpc('github_repos_upsert_connection', {
      p_user_id: userId,
      p_owner: parsed.owner,
      p_repo_filter: repoFilter,
      p_enabled: b.enabled !== false,
      p_token: newToken || null,
      p_status: 'connected',
    });
    if (error) {
      console.error('[GITHUB_REPOS][UPSERT]', error.message);
      throw new CodeAgentError(500, 'No se pudo guardar la conexión de GitHub (¿falta aplicar la migración github_repos_connections.sql?).');
    }
    const row = Array.isArray(data) ? data[0] : data;
    return toView(row, { login: summary.login, repositories: summary.repositories, sample: summary.sample });
  }
  throw new CodeAgentError(405, 'Método no permitido.');
}

/**
 * Atiende la petición si le corresponde a GitHub. Devuelve { handled: false }
 * para que el llamador siga con Azure.
 */
async function maybeHandleGithub({ adminClient, userId, route, method, query, body, headers }) {
  if (route === 'github/connection') {
    return { handled: true, result: await handleConnectionRoute(adminClient, userId, method, body) };
  }
  const raw = headers && (headers['x-code-provider'] || headers['X-Code-Provider']);
  const provider = String(Array.isArray(raw) ? raw[0] : raw || '').toLowerCase();
  if (provider !== 'github') return { handled: false };

  const connection = await getGithubConnectionWithSecret(adminClient, userId);
  if (!connection || !connection.token) {
    throw new CodeAgentError(404, 'GitHub no está configurado: agrega la conexión en Configuración → GitHub (código).');
  }
  try {
    const result = await github.handleGithubRoute({
      route, method, query, body, owner: connection.owner, repoFilter: connection.repo_filter, token: connection.token,
    });
    return { handled: true, result };
  } catch (error) {
    if (error instanceof CodeAgentError && error.status === 401) {
      await markExpired(adminClient, userId);
      throw new CodeAgentError(424, 'El token de GitHub fue rechazado (vencido o revocado). Actualízalo en Configuración → GitHub (código).');
    }
    throw error;
  }
}

module.exports = { maybeHandleGithub };
