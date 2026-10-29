/**
 * Núcleo compartido del "Agente de exploración de código" sobre Azure Repos.
 *
 * Lo usan:
 *   - api/integrations/code-agent/[...path].ts  (Vercel, función serverless)
 *   - local-api-server.js                        (desarrollo local)
 *
 * Es CommonJS plano para poder reutilizarse en ambos entornos sin duplicar
 * lógica. El prefijo "_" evita que Vercel lo publique como función (límite de
 * 12 funciones en plan Hobby).
 *
 * TODAS las operaciones son de SOLO LECTURA sobre Azure DevOps. Nunca se
 * escribe en repositorios ni en work items.
 */
const fetch = require('node-fetch');
const crypto = require('crypto');

const API_VERSION = '7.1';
const DEFAULT_TIMEOUT_MS = 15000;

/** Directorios que nunca aportan contexto funcional. */
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'bin', 'obj', '.git', 'target', 'vendor', 'coverage',
  '.angular', '.next', '.nuxt', 'out', '__pycache__', '.venv', 'venv', '.idea', '.vscode',
  'pods', '.gradle', '.mvn', 'bower_components', '.terraform', 'tmp', 'temp', 'logs'
]);

/** Extensiones de texto/código que el agente puede leer. */
const ALLOWED_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'java', 'kt', 'kts', 'cs', 'vb', 'py', 'go', 'rb', 'php',
  'scala', 'swift', 'm', 'dart', 'rs', 'vue', 'svelte', 'html', 'htm', 'cshtml', 'razor', 'css',
  'scss', 'less', 'sql', 'json', 'yaml', 'yml', 'xml', 'gradle', 'properties', 'md', 'feature',
  'groovy', 'sh', 'graphql', 'gql', 'proto', 'jsp', 'xhtml', 'txt'
]);

/** Archivos que pueden contener secretos: nunca se envían a la IA. */
const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /\.(pem|key|pfx|p12|crt|cer|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/i,
  /(^|\/)appsettings[^/]*\.json$/i,
  /(^|\/)web\.config$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)[^/]*secret[^/]*$/i,
  /(^|\/)[^/]*credential[^/]*$/i,
  /(^|\/)local\.settings\.json$/i,
];

/** Archivos ruidosos (generados) que no aportan contexto. */
const NOISE_FILE_PATTERNS = [
  /(^|\/)(package-lock|yarn\.lock|pnpm-lock|composer\.lock|gemfile\.lock|poetry\.lock)/i,
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /\.d\.ts$/i,
  /\.(spec|test)\.snap$/i,
];

/** Enmascara valores sensibles dentro del contenido antes de enviarlo a la IA. */
const SECRET_VALUE_PATTERNS = [
  /((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|connectionstring|connection_string)\s*["']?\s*[:=]\s*["']?)([^"'\s;,}]{4,})/gi,
  /(AccountKey=)([^;"'\s]+)/gi,
  /(Bearer\s+)([A-Za-z0-9\-._~+/]{20,}=*)/g,
  /(eyJ[A-Za-z0-9_-]{10,}\.)([A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
];

const LIMITS = {
  maxTreeItems: 4000,
  maxFilesPerRead: 6,
  maxCharsPerFile: 14000,
  maxSearchFiles: 30,
  maxSearchMatches: 60,
  searchConcurrency: 6,
  maxContextChars: 40000,
  cacheTtlDays: 7,
};

class CodeAgentError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CodeAgentError';
    this.status = status;
  }
}

function buildBaseUrl(organization) {
  return `https://dev.azure.com/${encodeURIComponent(organization)}`;
}

async function azureRepoGet(url, pat) {
  const timeoutMs = Number(process.env.AZURE_DEVOPS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const basicToken = Buffer.from(`:${pat}`).toString('base64');
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${basicToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });

    // Azure responde 203 + HTML de login cuando el PAT no es válido.
    if (response.status === 203) {
      throw new CodeAgentError(401, 'PAT inválido, vencido o revocado.');
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new CodeAgentError(403, 'El PAT no tiene permiso para leer código. Genera un PAT con el alcance "Code (Read)" y vuelve a guardar la conexión de Azure DevOps.');
      }
      if (response.status === 404) {
        throw new CodeAgentError(404, 'No se encontró el recurso en Azure Repos (proyecto, repositorio, rama o archivo).');
      }
      throw new CodeAgentError(502, 'No fue posible consultar Azure Repos en este momento.');
    }

    return data;
  } catch (error) {
    if (error instanceof CodeAgentError) throw error;
    const message = error && error.message ? error.message : String(error);
    if (message.includes('aborted')) {
      throw new CodeAgentError(504, 'La consulta a Azure Repos excedió el tiempo de espera.');
    }
    throw new CodeAgentError(502, 'Error de conexión con Azure Repos.');
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Utilidades de rutas y filtros
// ---------------------------------------------------------------------------

function requireString(value, fieldName) {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) throw new CodeAgentError(400, `El campo "${fieldName}" es obligatorio.`);
  return str;
}

function normalizeRepoPath(path) {
  const raw = String(path || '').trim().replace(/\\/g, '/');
  if (!raw || raw === '/') return '/';
  if (raw.split('/').some((segment) => segment === '..')) {
    throw new CodeAgentError(400, 'Ruta inválida.');
  }
  return '/' + raw.replace(/^\/+/, '').replace(/\/+$/, '');
}

function normalizeBranch(branch) {
  return requireString(branch, 'branch').replace(/^refs\/heads\//i, '');
}

function getExtension(path) {
  const fileName = path.split('/').pop() || '';
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

function isSecretFile(path) {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

function isReadableFile(path) {
  const segments = path.toLowerCase().split('/').filter(Boolean);
  if (segments.slice(0, -1).some((segment) => EXCLUDED_DIRS.has(segment))) return false;
  if (isSecretFile(path)) return false;
  if (NOISE_FILE_PATTERNS.some((pattern) => pattern.test(path))) return false;
  return ALLOWED_EXTENSIONS.has(getExtension(path));
}

function redactSecrets(content) {
  let result = content;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, (_match, prefix) => `${prefix}***REDACTED***`);
  }
  return result;
}

function versionQuery(branch) {
  return `versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch`;
}

function repoBase(organization, project, repositoryId) {
  return `${buildBaseUrl(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}`;
}

// ---------------------------------------------------------------------------
// Operaciones de Azure Repos
// ---------------------------------------------------------------------------

async function listProjects(organization, pat) {
  const data = await azureRepoGet(`${buildBaseUrl(organization)}/_apis/projects?$top=500&api-version=${API_VERSION}`, pat);
  return (data.value || [])
    .map((project) => ({ id: project.id, name: project.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listRepositories(organization, pat, project) {
  const data = await azureRepoGet(
    `${buildBaseUrl(organization)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${API_VERSION}`,
    pat
  );
  return (data.value || [])
    .filter((repo) => !repo.isDisabled)
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      defaultBranch: String(repo.defaultBranch || '').replace(/^refs\/heads\//, ''),
      projectId: repo.project && repo.project.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listBranches(organization, pat, project, repositoryId) {
  const data = await azureRepoGet(
    `${repoBase(organization, project, repositoryId)}/refs?filter=heads/&$top=1000&api-version=${API_VERSION}`,
    pat
  );
  return (data.value || [])
    .map((ref) => ({ name: String(ref.name || '').replace(/^refs\/heads\//, ''), commitId: ref.objectId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Árbol de archivos legibles de la rama (un solo llamado a Azure).
 * Devuelve solo rutas de código/texto, sin carpetas excluidas ni secretos.
 */
async function getTree(organization, pat, project, repositoryId, branch, scopePath) {
  const scope = normalizeRepoPath(scopePath);
  const url = `${repoBase(organization, project, repositoryId)}/items?scopePath=${encodeURIComponent(scope)}`
    + `&recursionLevel=Full&${versionQuery(branch)}&api-version=${API_VERSION}`;
  const data = await azureRepoGet(url, pat);

  const allFiles = (data.value || []).filter((item) => !item.isFolder && item.gitObjectType !== 'tree');
  const readable = allFiles.map((item) => item.path).filter(isReadableFile);

  return {
    scopePath: scope,
    totalFiles: allFiles.length,
    readableFiles: readable.length,
    truncated: readable.length > LIMITS.maxTreeItems,
    files: readable.slice(0, LIMITS.maxTreeItems),
  };
}

async function fetchFileContent(organization, pat, project, repositoryId, branch, path) {
  const url = `${repoBase(organization, project, repositoryId)}/items?path=${encodeURIComponent(path)}`
    + `&includeContent=true&${versionQuery(branch)}&api-version=${API_VERSION}`;
  const data = await azureRepoGet(url, pat);
  return typeof data.content === 'string' ? data.content : '';
}

/**
 * Lee archivos (con rango de líneas opcional). El contenido se devuelve con
 * número de línea para que la IA pueda citar archivo:línea.
 */
async function readFiles(organization, pat, project, repositoryId, branch, requests) {
  const list = Array.isArray(requests) ? requests.slice(0, LIMITS.maxFilesPerRead) : [];
  if (list.length === 0) throw new CodeAgentError(400, 'Debes indicar al menos un archivo.');

  return Promise.all(list.map(async (request) => {
    const path = normalizeRepoPath(request && request.path);
    if (!isReadableFile(path)) {
      return { path, error: 'Archivo no permitido (binario, generado o potencialmente con secretos).' };
    }

    try {
      const raw = await fetchFileContent(organization, pat, project, repositoryId, branch, path);
      const lines = redactSecrets(raw).split(/\r?\n/);
      const startLine = Math.max(1, Number(request.startLine) || 1);
      const endLine = Math.min(lines.length, Number(request.endLine) || lines.length);

      let content = '';
      let lastLine = startLine - 1;
      for (let i = startLine - 1; i < endLine; i++) {
        const numbered = `${i + 1}| ${lines[i]}\n`;
        if (content.length + numbered.length > LIMITS.maxCharsPerFile) break;
        content += numbered;
        lastLine = i + 1;
      }

      return {
        path,
        totalLines: lines.length,
        startLine,
        endLine: lastLine,
        truncated: lastLine < endLine,
        content,
      };
    } catch (error) {
      return { path, error: error && error.message ? error.message : 'No se pudo leer el archivo.' };
    }
  }));
}

/** Búsqueda de texto (grep) sobre un conjunto acotado de archivos candidatos. */
async function searchInFiles(organization, pat, project, repositoryId, branch, terms, paths) {
  const cleanTerms = (Array.isArray(terms) ? terms : [terms])
    .map((term) => String(term || '').trim().toLowerCase())
    .filter((term) => term.length >= 2)
    .slice(0, 8);
  if (cleanTerms.length === 0) throw new CodeAgentError(400, 'Debes indicar al menos un término de búsqueda.');

  const candidates = (Array.isArray(paths) ? paths : [])
    .map((path) => normalizeRepoPath(path))
    .filter(isReadableFile)
    .slice(0, LIMITS.maxSearchFiles);

  const matches = [];
  let index = 0;

  async function worker() {
    while (index < candidates.length && matches.length < LIMITS.maxSearchMatches) {
      const path = candidates[index++];
      try {
        const lines = redactSecrets(await fetchFileContent(organization, pat, project, repositoryId, branch, path)).split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < LIMITS.maxSearchMatches; i++) {
          const lower = lines[i].toLowerCase();
          if (cleanTerms.some((term) => lower.includes(term))) {
            matches.push({ path, line: i + 1, text: lines[i].trim().slice(0, 220) });
          }
        }
      } catch {
        // Un archivo ilegible no debe abortar la búsqueda completa.
      }
    }
  }

  await Promise.all(Array.from({ length: LIMITS.searchConcurrency }, worker));
  return { searchedFiles: candidates.length, matches };
}

/**
 * Ramas vinculadas a una HU (Development → Branch en Azure Boards).
 * Formato de la relación: vstfs:///Git/Ref/{projectId}%2F{repoId}%2FGB{rama}
 */
async function getWorkItemLinkedBranches(organization, pat, workItemId) {
  const id = Number(workItemId);
  if (!Number.isInteger(id) || id <= 0) throw new CodeAgentError(400, 'ID de HU inválido.');

  const data = await azureRepoGet(
    `${buildBaseUrl(organization)}/_apis/wit/workitems/${id}?$expand=relations&api-version=${API_VERSION}`,
    pat
  );

  const links = [];
  for (const relation of data.relations || []) {
    const url = String(relation.url || '');
    if (relation.rel !== 'ArtifactLink' || !url.startsWith('vstfs:///Git/Ref/')) continue;

    const decoded = decodeURIComponent(url.slice('vstfs:///Git/Ref/'.length));
    const [projectId, repositoryId, ...rest] = decoded.split('/');
    const refName = rest.join('/');
    if (!projectId || !repositoryId || !refName.startsWith('GB')) continue;

    links.push({ projectId, repositoryId, branch: refName.slice(2) });
  }
  return links;
}

// ---------------------------------------------------------------------------
// Caché de contexto técnico (Supabase, tabla opcional code_context_cache)
// ---------------------------------------------------------------------------

function buildCacheKey(body) {
  const parts = [
    requireString(body.repositoryId, 'repositoryId'),
    requireString(body.commitId, 'commitId'),
    normalizeRepoPath(body.scopePath),
    String(body.mode || ''),
    String(body.description || '').trim(),
    String(body.acceptanceCriteria || '').trim(),
  ];
  return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

/** Si la tabla aún no existe, la caché se desactiva sin romper el flujo. */
async function getCachedContext(adminClient, userId, body) {
  if (!adminClient) return null;
  const cacheKey = buildCacheKey(body);
  const minDate = new Date(Date.now() - LIMITS.cacheTtlDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await adminClient
    .from('code_context_cache')
    .select('context, files_reviewed, created_at')
    .eq('user_id', userId)
    .eq('cache_key', cacheKey)
    .gte('created_at', minDate)
    .maybeSingle();

  if (error) {
    console.warn('[CODE_AGENT][CACHE][GET] caché no disponible:', error.message);
    return null;
  }
  return data ? { context: data.context, filesReviewed: data.files_reviewed || [], createdAt: data.created_at } : null;
}

async function saveCachedContext(adminClient, userId, body) {
  if (!adminClient) return { saved: false };
  const context = String(body.context || '').slice(0, LIMITS.maxContextChars);
  if (!context.trim()) throw new CodeAgentError(400, 'El contexto a guardar está vacío.');

  const row = {
    user_id: userId,
    cache_key: buildCacheKey(body),
    repository_id: String(body.repositoryId),
    branch: String(body.branch || ''),
    commit_id: String(body.commitId),
    context,
    files_reviewed: Array.isArray(body.filesReviewed) ? body.filesReviewed.slice(0, 100).map(String) : [],
    created_at: new Date().toISOString(),
  };

  const { error } = await adminClient
    .from('code_context_cache')
    .upsert(row, { onConflict: 'user_id,cache_key' });

  if (error) {
    console.warn('[CODE_AGENT][CACHE][SAVE] caché no disponible:', error.message);
    return { saved: false };
  }
  return { saved: true };
}

// ---------------------------------------------------------------------------
// Router común
// ---------------------------------------------------------------------------

/**
 * Ejecuta la ruta solicitada. El llamador ya autenticó al usuario y resolvió
 * su conexión de Azure DevOps (organization + PAT).
 *
 * Rutas:
 *   GET  projects
 *   GET  repositories?project=
 *   GET  branches?project=&repositoryId=
 *   GET  work-item-links?workItemId=
 *   POST tree        { project, repositoryId, branch, scopePath? }
 *   POST files       { project, repositoryId, branch, files: [{ path, startLine?, endLine? }] }
 *   POST search      { project, repositoryId, branch, terms: [], paths: [] }
 *   POST cache/get   { repositoryId, commitId, scopePath, mode, description, acceptanceCriteria }
 *   POST cache/save  { ...cache/get, branch, context, filesReviewed }
 */
async function handleCodeAgentRoute({ route, method, query, body, organization, pat, userId, adminClient }) {
  const q = query || {};
  const b = body || {};

  if (method === 'GET') {
    switch (route) {
      case 'projects':
        return listProjects(organization, pat);
      case 'repositories':
        return listRepositories(organization, pat, requireString(q.project, 'project'));
      case 'branches':
        return listBranches(organization, pat, requireString(q.project, 'project'), requireString(q.repositoryId, 'repositoryId'));
      case 'work-item-links':
        return getWorkItemLinkedBranches(organization, pat, q.workItemId);
      default:
        break;
    }
  }

  if (method === 'POST') {
    switch (route) {
      case 'tree':
        return getTree(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), normalizeBranch(b.branch), b.scopePath);
      case 'files':
        return readFiles(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), normalizeBranch(b.branch), b.files);
      case 'search':
        return searchInFiles(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), normalizeBranch(b.branch), b.terms, b.paths);
      case 'cache/get':
        return { cached: await getCachedContext(adminClient, userId, b) };
      case 'cache/save':
        return saveCachedContext(adminClient, userId, b);
      default:
        break;
    }
  }

  throw new CodeAgentError(404, 'Recurso del agente de código no encontrado.');
}

module.exports = {
  CodeAgentError,
  LIMITS,
  handleCodeAgentRoute,
  // Exportados para pruebas unitarias
  isReadableFile,
  redactSecrets,
  normalizeRepoPath,
};
