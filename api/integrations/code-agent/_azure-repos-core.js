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
  'groovy', 'sh', 'graphql', 'gql', 'proto', 'jsp', 'xhtml', 'txt',
  // Plantillas de reportes/documentos (p. ej. JasperReports): son la lógica visible de los reportes.
  'jrxml', 'xsl', 'xslt', 'ftl'
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
  maxBranchChanges: 1000,
  maxAppSearchFiles: 12,
  maxAppSearchMatches: 30,
  maxDiffCells: 4000000,
  diffContextLines: 3,
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

function azureRepoGet(url, pat) {
  return azureRepoRequest(url, pat);
}

/** POST de solo lectura (p. ej. Code Search). */
function azureRepoPost(url, pat, body) {
  return azureRepoRequest(url, pat, body);
}

async function azureRepoRequest(url, pat, body) {
  const timeoutMs = Number(process.env.AZURE_DEVOPS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const basicToken = Buffer.from(`:${pat}`).toString('base64');
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${basicToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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

function versionQuery(version, versionType = 'branch') {
  return `versionDescriptor.version=${encodeURIComponent(version)}&versionDescriptor.versionType=${versionType}`;
}

/**
 * Versión a leer: commit exacto (si viene "commit") o rama. Leer por commit
 * permite analizar justo el código que entró con los PRs de la HU.
 */
function resolveVersion(body) {
  const commit = typeof body.commit === 'string' ? body.commit.trim() : '';
  if (commit) return { version: requireCommit(commit, 'commit'), versionType: 'commit' };
  return { version: normalizeBranch(body.branch), versionType: 'branch' };
}

function requireCommit(value, fieldName) {
  const commit = requireString(value, fieldName);
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new CodeAgentError(400, `El campo "${fieldName}" no es un commit válido.`);
  return commit;
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
async function getTree(organization, pat, project, repositoryId, ver, scopePath) {
  const scope = normalizeRepoPath(scopePath);
  const url = `${repoBase(organization, project, repositoryId)}/items?scopePath=${encodeURIComponent(scope)}`
    + `&recursionLevel=Full&${versionQuery(ver.version, ver.versionType)}&api-version=${API_VERSION}`;
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

async function fetchFileContent(organization, pat, project, repositoryId, version, path, versionType = 'branch') {
  const url = `${repoBase(organization, project, repositoryId)}/items?path=${encodeURIComponent(path)}`
    + `&includeContent=true&${versionQuery(version, versionType)}&api-version=${API_VERSION}`;
  const data = await azureRepoGet(url, pat);
  return typeof data.content === 'string' ? data.content : '';
}

/**
 * Lee archivos (con rango de líneas opcional). El contenido se devuelve con
 * número de línea para que la IA pueda citar archivo:línea.
 */
async function readFiles(organization, pat, project, repositoryId, ver, requests) {
  const list = Array.isArray(requests) ? requests.slice(0, LIMITS.maxFilesPerRead) : [];
  if (list.length === 0) throw new CodeAgentError(400, 'Debes indicar al menos un archivo.');

  return Promise.all(list.map(async (request) => {
    const path = normalizeRepoPath(request && request.path);
    if (!isReadableFile(path)) {
      return { path, error: 'Archivo no permitido (binario, generado o potencialmente con secretos).' };
    }

    try {
      const raw = await fetchFileContent(organization, pat, project, repositoryId, ver.version, path, ver.versionType);
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

/**
 * Búsqueda en todo el aplicativo (Azure Code Search, rama por defecto de cada
 * repo): los repos cuyo nombre empieza por alguno de los prefijos. Sirve para
 * lo que no está en los cambios de la HU: qué significa un código o
 * parámetro, qué pantalla llama un endpoint, qué proceso genera un dato.
 * Devuelve las líneas que contienen los términos, con 1 línea de contexto.
 */
async function searchApplication(organization, pat, body) {
  const projectId = requireString(body.projectId, 'projectId');
  const prefixes = (Array.isArray(body.repoPrefixes) ? body.repoPrefixes : []).map(String).filter(Boolean).slice(0, 5);
  const terms = (Array.isArray(body.terms) ? body.terms : []).map((term) => String(term).trim()).filter((term) => term.length >= 3).slice(0, 4);
  if (!prefixes.length || !terms.length) throw new CodeAgentError(400, 'Indica prefijos de repositorio y términos (mín. 3 caracteres).');

  const base = buildBaseUrl(organization);
  const [project, repos] = await Promise.all([
    azureRepoGet(`${base}/_apis/projects/${encodeURIComponent(projectId)}?api-version=${API_VERSION}`, pat),
    azureRepoGet(`${base}/${encodeURIComponent(projectId)}/_apis/git/repositories?api-version=${API_VERSION}`, pat),
  ]);
  const repoNames = (repos.value || []).filter((repo) => !repo.isDisabled && prefixes.some((prefix) => repo.name.startsWith(prefix))).map((repo) => repo.name);
  if (!repoNames.length) return { totalCount: 0, matches: [] };

  const searchUrl = `https://almsearch.dev.azure.com/${encodeURIComponent(organization)}/_apis/search/codesearchresults?api-version=${API_VERSION}`;
  const results = await Promise.all(terms.map((term) => azureRepoPost(searchUrl, pat, {
    searchText: term.includes(' ') ? `"${term}"` : term,
    $top: LIMITS.maxAppSearchFiles,
    filters: { Project: [project.name], Repository: repoNames },
  }).catch(() => ({ results: [] }))));

  const files = new Map();
  let totalCount = 0;
  results.forEach((data) => {
    totalCount += Number(data.count || 0);
    for (const item of data.results || []) {
      const key = `${item.repository && item.repository.id}|${item.path}`;
      if (!files.has(key) && isReadableFile(item.path)) files.set(key, item);
    }
  });

  const lowered = terms.map((term) => term.toLowerCase());
  const matches = [];
  await Promise.all(Array.from(files.values()).slice(0, LIMITS.maxAppSearchFiles).map(async (item) => {
    const branch = stripHeads((item.versions && item.versions[0] && item.versions[0].branchName) || '');
    const content = await fetchFileContent(organization, pat, item.project.id, item.repository.id, branch || 'trunk', item.path, 'branch').catch(() => '');
    const lines = redactSecrets(content).split(/\r?\n/);
    let found = 0;
    lines.forEach((line, index) => {
      if (found >= 3 || !lowered.some((term) => line.toLowerCase().includes(term))) return;
      found++;
      const context = lines.slice(Math.max(0, index - 1), index + 2).map((text) => text.trim().slice(0, 200)).join(' ⏎ ');
      matches.push({ repositoryName: item.repository.name, branch: branch || 'trunk', path: item.path, line: index + 1, text: context });
    });
  }));
  // Código productivo primero; las pruebas solo confirman.
  const isTest = (path) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(spec|test)\.|Test\.java$/i.test(path);
  matches.sort((a, b) => Number(isTest(a.path)) - Number(isTest(b.path))
    || a.repositoryName.localeCompare(b.repositoryName) || a.path.localeCompare(b.path) || a.line - b.line);
  return { totalCount, matches: matches.slice(0, LIMITS.maxAppSearchMatches) };
}

/** Búsqueda de texto (grep) sobre un conjunto acotado de archivos candidatos. */
async function searchInFiles(organization, pat, project, repositoryId, ver, terms, paths) {
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
        const lines = redactSecrets(await fetchFileContent(organization, pat, project, repositoryId, ver.version, path, ver.versionType)).split(/\r?\n/);
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
 * Cambios de la rama de la HU respecto a su rama base (merge-base / ancestro
 * común): exactamente lo que los desarrolladores han subido en la rama,
 * aunque hayan mezclado develop después.
 */
async function getBranchDiff(organization, pat, project, repositoryId, baseBranch, branch) {
  const url = `${repoBase(organization, project, repositoryId)}/diffs/commits`
    + `?baseVersion=${encodeURIComponent(baseBranch)}&baseVersionType=branch`
    + `&targetVersion=${encodeURIComponent(branch)}&targetVersionType=branch`
    + `&diffCommonCommit=true&$top=${LIMITS.maxBranchChanges}&api-version=${API_VERSION}`;
  const data = await azureRepoGet(url, pat);

  const fileChanges = (data.changes || [])
    .filter((change) => change.item && !change.item.isFolder && change.item.gitObjectType !== 'tree');
  const changes = fileChanges
    .filter((change) => isReadableFile(change.item.path))
    .map((change) => ({
      path: change.item.path,
      changeType: String(change.changeType || 'edit').toLowerCase(),
      originalPath: change.originalPath || undefined,
    }));

  return {
    baseBranch,
    branch,
    commonCommit: data.commonCommit || null,
    targetCommit: data.targetCommit || null,
    aheadCount: Number(data.aheadCount || 0),
    behindCount: Number(data.behindCount || 0),
    totalChangedFiles: fileChanges.length,
    allChangesIncluded: data.allChangesIncluded !== false,
    changes,
  };
}

/** Clave de comparación: ignora indentación y espacios repetidos (re-formateos no son cambios funcionales). */
function lineKey(line) {
  return line.trim().replace(/\s+/g, ' ');
}

/**
 * Diff por líneas (LCS) entre dos textos, ignorando diferencias de espacios.
 * Recorta prefijo/sufijo comunes y devuelve null si el bloque central es
 * demasiado grande para calcularlo.
 */
function computeLineDiff(baseText, targetText) {
  const baseLines = baseText;
  const targetLines = targetText;
  const baseKeys = baseLines.map(lineKey);
  const targetKeys = targetLines.map(lineKey);
  let start = 0;
  while (start < baseKeys.length && start < targetKeys.length && baseKeys[start] === targetKeys[start]) start++;
  let endBase = baseLines.length;
  let endTarget = targetLines.length;
  while (endBase > start && endTarget > start && baseKeys[endBase - 1] === targetKeys[endTarget - 1]) {
    endBase--;
    endTarget--;
  }

  const a = baseKeys.slice(start, endBase);
  const b = targetKeys.slice(start, endTarget);
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > LIMITS.maxDiffCells) return null;

  // lcs[i][j] = LCS de a[i..] y b[j..]
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  // ops: { type: ' ' | '-' | '+', baseLine, targetLine, text } (líneas 1-based)
  const ops = [];
  for (let k = 0; k < start; k++) ops.push({ type: ' ', baseLine: k + 1, targetLine: k + 1, text: targetLines[k] });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ type: ' ', baseLine: start + i + 1, targetLine: start + j + 1, text: targetLines[start + j] });
      i++; j++;
    } else if (i < n && (j >= m || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      ops.push({ type: '-', baseLine: start + i + 1, text: baseLines[start + i] });
      i++;
    } else {
      ops.push({ type: '+', targetLine: start + j + 1, text: targetLines[start + j] });
      j++;
    }
  }
  for (let k = 0; k < baseLines.length - endBase; k++) {
    ops.push({ type: ' ', baseLine: endBase + k + 1, targetLine: endTarget + k + 1, text: targetLines[endTarget + k] });
  }
  return ops;
}

/**
 * Formatea el diff en bloques (hunks) con contexto, numerados con la línea de la rama.
 * Con `known` ({ added, removed } de lineKey) solo se muestran los hunks con líneas que no estén ya en esos cambios.
 */
function formatHunks(ops, known = null) {
  const context = LIMITS.diffContextLines;
  const novel = (op) => op.type !== ' ' && (!known || !known[op.type === '+' ? 'added' : 'removed'].has(lineKey(op.text)));
  const changed = ops.map(novel);
  const keep = new Array(ops.length).fill(false);
  changed.forEach((isChanged, index) => {
    if (!isChanged) return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) keep[k] = true;
  });

  let output = '';
  let inHunk = false;
  for (let index = 0; index < ops.length; index++) {
    if (!keep[index]) {
      inHunk = false;
      continue;
    }
    let op = ops[index];
    if (op.type !== ' ' && !changed[index]) {
      if (op.type === '-') continue;
      op = { ...op, type: ' ' };
    }
    if (!inHunk) {
      output += `@@ cerca de la línea ${op.targetLine || op.baseLine} @@\n`;
      inHunk = true;
    }
    const lineNumber = op.type === '-' ? `base ${op.baseLine}` : String(op.targetLine);
    output += `${op.type} ${lineNumber}| ${lineKey(op.text)}\n`;
    if (output.length > LIMITS.maxCharsPerFile) {
      output += '…[diff truncado: usa read_files con rango de líneas para ver más]\n';
      break;
    }
  }
  return output || 'Sin cambios de contenido (posible cambio de permisos, renombre o fin de línea).';
}

const MAX_DIFF_SEGMENTS = 20;
const splitLines = (text) => (text ? text.split(/\r?\n/) : []);

/** Valida los tramos (PR/commit de la HU) que llegan del cliente. */
function normalizeSegments(list, path) {
  if (!Array.isArray(list) || list.length === 0) return null;
  if (list.length > MAX_DIFF_SEGMENTS) throw new CodeAgentError(400, 'Demasiados tramos para el diff.');
  return list.map((segment, index) => ({
    label: String((segment && segment.label) || '').slice(0, 120),
    baseCommit: requireCommit(segment && segment.baseCommit, `segments[${index}].baseCommit`),
    targetCommit: requireCommit(segment && segment.targetCommit, `segments[${index}].targetCommit`),
    changeType: String((segment && segment.changeType) || 'edit').toLowerCase(),
    originalPath: segment && segment.originalPath ? normalizeRepoPath(segment.originalPath) : path,
  }));
}

/**
 * Cambios de la HU sobre un archivo como tramos base→target. Dos PRs/commits seguidos de la HU se unen en un
 * tramo solo si nadie más tocó el archivo entre ellos (el target del primero es igual a la base del segundo);
 * si no, quedan separados y los cambios intermedios de otras HUs no se atribuyen a esta.
 */
async function fileChains(organization, pat, project, repositoryId, path, segments) {
  const cache = new Map();
  const content = (filePath, commit) => {
    if (!commit) return Promise.resolve('');
    const key = `${commit}|${filePath}`;
    if (!cache.has(key)) {
      cache.set(key, fetchFileContent(organization, pat, project, repositoryId, commit, filePath, 'commit')
        .then(redactSecrets).catch(() => ''));
    }
    return cache.get(key);
  };
  const texts = await Promise.all(segments.map((segment) => Promise.all([
    content(segment.originalPath || path, segment.changeType.includes('add') ? null : segment.baseCommit),
    content(path, segment.changeType.includes('delete') ? null : segment.targetCommit),
  ])));
  const chains = [];
  segments.forEach((segment, index) => {
    const [base, target] = texts[index];
    const last = chains[chains.length - 1];
    if (last && last.target === base) {
      last.target = target;
      last.labels.push(segment.label);
    } else {
      chains.push({ base, target, labels: [segment.label] });
    }
  });
  return chains;
}

/** Líneas agregadas/eliminadas (lineKey) de los tramos; null si alguno es demasiado grande para compararlo. */
function chainsChangedLines(chains) {
  const added = new Set();
  const removed = new Set();
  for (const chain of chains) {
    const ops = computeLineDiff(splitLines(chain.base), splitLines(chain.target));
    if (!ops) return null;
    for (const op of ops) {
      const key = lineKey(op.text);
      if (op.type !== ' ' && key) (op.type === '+' ? added : removed).add(key);
    }
  }
  return { added, removed };
}

/**
 * Diff de un archivo. Con `segments` (un tramo por PR/commit de la HU) se muestran solo los cambios propios;
 * con `exclude` (tramos del mismo archivo en otra rama destino) solo lo que no esté ya en esa rama.
 * Sin ellos: diff entre baseCommit y targetCommit.
 */
async function getFileDiff(organization, pat, project, repositoryId, body) {
  const path = normalizeRepoPath(body.path);
  if (!isReadableFile(path)) {
    return { path, error: 'Archivo no permitido (binario, generado o potencialmente con secretos).' };
  }
  const changeType = String(body.changeType || 'edit').toLowerCase();
  const originalPath = body.originalPath ? normalizeRepoPath(body.originalPath) : path;
  const segments = normalizeSegments(body.segments, path) || [{
    label: '', baseCommit: requireCommit(body.baseCommit, 'baseCommit'), targetCommit: requireCommit(body.targetCommit, 'targetCommit'),
    changeType, originalPath,
  }];
  const exclude = normalizeSegments(body.exclude, path);

  const [chains, excluded] = await Promise.all([
    fileChains(organization, pat, project, repositoryId, path, segments),
    exclude ? fileChains(organization, pat, project, repositoryId, path, exclude) : Promise.resolve(null),
  ]);
  const known = excluded ? chainsChangedLines(excluded) : null;

  let added = 0;
  let removed = 0;
  const parts = [];
  for (const chain of chains) {
    const ops = computeLineDiff(splitLines(chain.base), splitLines(chain.target));
    if (!ops) {
      return { path, changeType, error: 'El archivo cambió demasiado para calcular el diff; léelo con read_files (por rangos).' };
    }
    added += ops.filter((op) => op.type === '+').length;
    removed += ops.filter((op) => op.type === '-').length;
    const hunks = formatHunks(ops, known);
    parts.push(chains.length > 1 ? `[${chain.labels.filter(Boolean).join(', ')}]\n${hunks}` : hunks);
  }
  let diff = parts.join('\n');
  if (chains.length > 1) {
    diff = '(Entre los cambios de la HU otras HUs modificaron este archivo: se muestra cada cambio propio por separado y no lo de otras HUs.)\n' + diff;
  }
  if (known) diff = '(Solo los cambios que no están ya en la otra rama destino de la HU.)\n' + diff;
  const previous = segments.find((segment) => segment.originalPath && segment.originalPath !== path);
  if (previous) {
    diff = `(Script nuevo que redefine un objeto existente: se compara con su definición anterior ${previous.originalPath}.)\n` + diff;
  }
  return { path, changeType, added, removed, diff };
}

/**
 * Cambios de código de la HU, repartidos por repositorio (microservicio).
 *
 * Fuente principal: PRs y commits vinculados a la HU (Development en Azure
 * Boards); el merge de un PR trae TODOS sus commits. Se complementa con las
 * ramas de la HU (vinculadas o con el ID en el nombre) para detectar trabajo
 * sin PR o subido después del último PR.
 *
 * Reglas para no analizar código ajeno (verificadas con HUs reales):
 *  - PRs abandonados, promociones entre ramas de integración, PRs cuya rama
 *    nombra otra HU y PRs vinculados a muchas HUs (lotes de integración).
 *  - Un mismo cambio integrado en varias ramas (release/current, current,
 *    trunk, ramas "-on-trunk") se analiza una sola vez, en la rama de
 *    desarrollo preferida; las demás se informan como "también en", salvo
 *    que traigan líneas propias adicionales (se analiza solo lo adicional).
 *  - Cada PR/commit de la HU se compara contra su propio padre: los cambios
 *    de otras HUs integrados entre dos PRs de la HU no se le atribuyen.
 *  - Las ramas sin commits propios se informan, no se analizan.
 */
async function getWorkItemChanges(organization, pat, workItemId) {
  const id = Number(workItemId);
  if (!Number.isInteger(id) || id <= 0) throw new CodeAgentError(400, 'ID de HU inválido.');

  const base = buildBaseUrl(organization);
  const workItem = await azureRepoGet(`${base}/_apis/wit/workitems/${id}?$expand=relations&api-version=${API_VERSION}`, pat);
  const links = parseDevelopmentLinks(workItem.relations);

  const repoApi = (ref, path) => `${base}/${ref.projectId}/_apis/git/repositories/${ref.repositoryId}${path ? `/${path}` : ''}`
    + `${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`;
  const listRepos = (projectId) => azureRepoGet(`${base}/${projectId}/_apis/git/repositories?api-version=${API_VERSION}`, pat)
    .then((data) => data.value || []).catch(() => []);
  const get = (ref, path) => azureRepoGet(repoApi(ref, path), pat);
  const getCommit = (ref, sha) => get(ref, `commits/${sha}?changeCount=500`);
  const diffCommits = (ref, baseVersion, baseType, targetVersion, targetType) => get(ref, 'diffs/commits'
    + `?baseVersion=${encodeURIComponent(baseVersion)}&baseVersionType=${baseType}`
    + `&targetVersion=${encodeURIComponent(targetVersion)}&targetVersionType=${targetType}`
    + `&diffCommonCommit=true&$top=${LIMITS.maxBranchChanges}`);

  const repoNames = new Map();
  const repoName = async (ref) => {
    if (!repoNames.has(ref.repositoryId)) {
      repoNames.set(ref.repositoryId, get(ref, '').then((repo) => repo.name || ref.repositoryId).catch(() => ref.repositoryId));
    }
    return repoNames.get(ref.repositoryId);
  };

  const segments = [];
  const omitted = [];
  const coveredCommits = new Set();

  // 1) PRs vinculados: se descartan los ajenos antes de pedir sus cambios.
  await mapLimit(links.prs, 6, async (ref) => {
    try {
      const pr = await get(ref, `pullrequests/${ref.prId}`);
      if (pr.lastMergeCommit && pr.lastMergeCommit.commitId) coveredCommits.add(pr.lastMergeCommit.commitId);
      const info = {
        id: Number(ref.prId),
        title: String(pr.title || '').slice(0, 160),
        status: pr.status,
        sourceBranch: stripHeads(pr.sourceRefName),
        targetBranch: stripHeads(pr.targetRefName),
      };
      const name = (pr.repository && pr.repository.name) || await repoName(ref);
      repoNames.set(ref.repositoryId, Promise.resolve(name));

      const linkedWorkItems = await get(ref, `pullRequests/${ref.prId}/workitems`)
        .then((data) => (data.value || []).length).catch(() => 1);
      const reason = foreignPrReason(info, linkedWorkItems, id);
      if (reason) {
        omitted.push({ repositoryName: name, prId: info.id, title: info.title, reason });
        return;
      }

      const common = { ...ref, repositoryName: name, pr: info, kind: 'pr', targetBranch: info.targetBranch, sourceTip: pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId };
      const rebased = (pr.completionOptions && pr.completionOptions.mergeStrategy) === 'rebase';
      if (pr.status === 'completed' && pr.lastMergeCommit && !rebased) {
        // Merge/squash: el commit de merge contra su primer padre = todo lo que aportó el PR.
        const commit = await getCommit(ref, pr.lastMergeCommit.commitId);
        segments.push({
          ...common, date: pr.closedDate || (commit.committer && commit.committer.date),
          baseCommit: (commit.parents || [])[0], targetCommit: pr.lastMergeCommit.commitId, files: fileChangesOf(commit.changes),
        });
      } else if ((pr.status === 'active' || pr.status === 'completed') && pr.lastMergeSourceCommit && pr.lastMergeTargetCommit) {
        // Activo o completado con rebase: todos los commits de la rama origen desde el ancestro común.
        const diff = await diffCommits(ref, pr.lastMergeTargetCommit.commitId, 'commit', pr.lastMergeSourceCommit.commitId, 'commit');
        segments.push({
          ...common, date: pr.closedDate || pr.creationDate,
          baseCommit: diff.commonCommit, targetCommit: pr.lastMergeSourceCommit.commitId, files: fileChangesOf(diff.changes),
        });
      }
    } catch (error) {
      console.warn('[CODE_AGENT][WORK_ITEM_CHANGES] PR omitido:', ref.prId, error && error.message);
    }
  });

  // 2) Commits vinculados que no son el merge de un PR ya revisado (aceptado o descartado).
  await mapLimit(links.commits.filter((ref) => !coveredCommits.has(ref.sha)), 6, async (ref) => {
    try {
      const commit = await getCommit(ref, ref.sha);
      segments.push({
        ...ref, repositoryName: await repoName(ref), pr: null, kind: 'commits', targetBranch: '(commits vinculados)',
        date: commit.committer && commit.committer.date, baseCommit: (commit.parents || [])[0], targetCommit: ref.sha,
        comment: String(commit.comment || '').split('\n')[0].slice(0, 160),
        files: fileChangesOf(commit.changes),
      });
    } catch (error) {
      console.warn('[CODE_AGENT][WORK_ITEM_CHANGES] commit omitido:', ref.sha, error && error.message);
    }
  });

  // 3) Ramas de la HU: vinculadas, con el ID en el nombre y origen de los PRs aceptados.
  const emptyBranches = [];
  const branches = await collectHuBranches(links.branches, segments, id, get, repoName, listRepos);
  await mapLimit(branches, 6, async (branch) => {
    try {
      const segment = await branchSegment(branch, segments, get, diffCommits);
      if (segment.empty) {
        if (branch.reportIfEmpty) emptyBranches.push({ repositoryName: await repoName(branch), branch: branch.branch, reason: segment.empty });
        return;
      }
      if (segment.files) segments.push({ ...branch, ...segment, repositoryName: await repoName(branch) });
    } catch (error) {
      console.warn('[CODE_AGENT][WORK_ITEM_CHANGES] rama omitida:', branch.branch, error && error.message);
    }
  });

  const built = buildGroups(segments.filter((item) => item.baseCommit && item.targetCommit));
  const { groups, covered } = selectGroups(await resolvePreviousDefinitions(organization, pat, built));
  return {
    workItemId: id,
    groups: await refineCoveredGroups(organization, pat, groups, covered),
    omitted,
    emptyBranches,
  };
}

const INTEGRATION_BRANCH = /^(releases?\/.+|current|current-qa|trunk|main|master|develop|dev|qa|staging)$/i;
/** Ramas de paso a producción o nivelación: llevan trabajo ya hecho (a veces de varias HUs), no el desarrollo de la HU. */
const PROMOTION_BRANCH = /(^|[/_-])(paso[-_]?(a[-_]?)?(pdn|prod|produccion|producción)|pdn|nivelar|nivelacion|nivelación|actualizar[-_]?current|sync)([/_-]|$)/i;
/** Ramas de trabajo replicadas sobre otra rama destino (p. ej. "...-on-trunk"). */
const PORT_BRANCH = /-on-[a-z0-9._-]+$/i;
/** Rama base para medir los commits propios de una rama sin PR, en orden de preferencia. */
const BASE_BRANCH_CANDIDATES = ['release/current', 'current', 'develop', 'trunk', 'main', 'master'];
/** Preferencia de rama destino cuando el mismo cambio llegó a varias: menor = preferida. */
const TARGET_PRIORITY = [/^releases?\/current$/i, /^current$/i, /^releases?\//i, /^(develop|dev)$/i, /^(current-qa|qa|staging)$/i, /^(trunk|main|master)$/i];
/** Un PR vinculado a más HUs que esto es un lote de integración, salvo que su rama nombre la HU. */
const MAX_WORK_ITEMS_PER_PR = 3;
const BUILD_CONFIG_FILE = /(\.gradle(\.kts)?|(^|\/)pom\.xml|(^|\/)package\.json|\.csproj|(^|\/)gradle\.properties)$/i;

function stripHeads(refName) {
  return String(refName || '').replace(/^refs\/heads\//, '');
}

const DATE_YYYYMMDD = /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const DATE_DDMMYYYY = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])20\d{2}$/;

/** IDs de work item en el nombre de una rama: 6–8 dígitos sueltos (HU7794123, HA7932235, HU_7837004), sin fechas. */
function workItemIdsInBranch(branch) {
  const ids = [];
  for (const match of String(branch || '').matchAll(/(?:^|\D)(\d{6,8})(?!\d)/g)) {
    if (DATE_YYYYMMDD.test(match[1]) || DATE_DDMMYYYY.test(match[1])) continue;
    ids.push(Number(match[1]));
  }
  return ids;
}

/** Rama de paso a producción, nivelación o que agrupa varias HUs: no es el desarrollo de una HU. */
function isPromotionBranch(branch) {
  return INTEGRATION_BRANCH.test(branch) || PROMOTION_BRANCH.test(branch) || workItemIdsInBranch(branch).length > 1;
}

/** Motivo para no analizar un PR vinculado a la HU, o null si es trabajo de la HU. */
function foreignPrReason(pr, linkedWorkItems, workItemId) {
  if (pr.status === 'abandoned') return 'PR abandonado';
  if (INTEGRATION_BRANCH.test(pr.sourceBranch)) return 'promoción entre ramas de integración';
  if (isPromotionBranch(pr.sourceBranch)) return 'paso a producción o nivelación (no es el desarrollo de la HU)';
  const ids = workItemIdsInBranch(pr.sourceBranch);
  if (ids.includes(workItemId)) return null;
  // Un PR vinculado solo a esta HU es de esta HU aunque reutilice una rama con el nombre de otra.
  if (ids.length && linkedWorkItems > 1) return `rama de la HU ${ids[0]}`;
  if (linkedWorkItems > MAX_WORK_ITEMS_PER_PR) return `PR vinculado a ${linkedWorkItems} HUs (lote de integración)`;
  return null;
}

function parseDevelopmentLinks(relations) {
  const prs = [];
  const commits = [];
  const branches = new Map();
  for (const relation of relations || []) {
    if (relation.rel !== 'ArtifactLink') continue;
    const url = decodeURIComponent(String(relation.url || ''));
    if (url.startsWith('vstfs:///Git/PullRequestId/')) {
      const [projectId, repositoryId, prId] = url.slice('vstfs:///Git/PullRequestId/'.length).split('/');
      if (projectId && repositoryId && prId) prs.push({ projectId, repositoryId, prId });
    } else if (url.startsWith('vstfs:///Git/Commit/')) {
      const [projectId, repositoryId, sha] = url.slice('vstfs:///Git/Commit/'.length).split('/');
      if (projectId && repositoryId && /^[0-9a-f]{40}$/i.test(sha || '')) commits.push({ projectId, repositoryId, sha });
    } else if (url.startsWith('vstfs:///Git/Ref/')) {
      const [projectId, repositoryId, ...rest] = url.slice('vstfs:///Git/Ref/'.length).split('/');
      const refName = rest.join('/');
      if (projectId && repositoryId && refName.startsWith('GB')) {
        const branch = refName.slice(2);
        branches.set(`${repositoryId}|${branch}`, { projectId, repositoryId, branch });
      }
    }
  }
  return { prs, commits, branches: Array.from(branches.values()) };
}

function fileChangesOf(changes) {
  return (changes || [])
    .filter((change) => change.item && !change.item.isFolder && change.item.gitObjectType !== 'tree')
    .map((change) => ({ path: change.item.path, changeType: String(change.changeType || 'edit').toLowerCase() }));
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Ramas a revisar: las vinculadas, las que llevan el ID de la HU en repos del
 * mismo aplicativo (prefijo del nombre del repo, p. ej. "NU0139001_") y las de
 * origen de los PRs aceptados (para trabajo subido después del PR).
 */
async function collectHuBranches(linkedBranches, segments, workItemId, get, repoName, listRepos) {
  const branches = new Map();
  const add = (ref, branch, reportIfEmpty) => {
    if (isPromotionBranch(branch)) return;
    const key = `${ref.repositoryId}|${branch}`;
    const existing = branches.get(key);
    if (existing) existing.reportIfEmpty = existing.reportIfEmpty || reportIfEmpty;
    else branches.set(key, { projectId: ref.projectId, repositoryId: ref.repositoryId, branch, reportIfEmpty });
  };
  linkedBranches.forEach((ref) => add(ref, ref.branch, true));
  segments.filter((item) => item.pr).forEach((item) => add(item, item.pr.sourceBranch, false));

  // Búsqueda por nombre, acotada a los repos del aplicativo de la HU.
  const knownRefs = [...linkedBranches, ...segments];
  const prefixes = new Set((await Promise.all(knownRefs.map((ref) => repoName(ref))))
    .map((name) => (String(name).match(/^([A-Za-z0-9]+)_/) || [])[1]).filter(Boolean));
  const projectIds = Array.from(new Set(knownRefs.map((ref) => ref.projectId)));
  if (prefixes.size) {
    for (const projectId of projectIds) {
      const repos = await listRepos(projectId);
      const candidates = repos.filter((repo) => !repo.isDisabled && Array.from(prefixes).some((prefix) => repo.name.startsWith(`${prefix}_`)));
      await mapLimit(candidates, 8, async (repo) => {
        const ref = { projectId, repositoryId: repo.id };
        const refs = await get(ref, `refs?filter=heads/&filterContains=${workItemId}`).catch(() => ({ value: [] }));
        for (const item of refs.value || []) {
          const branch = stripHeads(item.name);
          if (workItemIdsInBranch(branch).includes(workItemId)) add(ref, branch, true);
        }
      });
    }
  }
  return Array.from(branches.values());
}

/**
 * Cambios de una rama de la HU que no llegaron por un PR aceptado.
 * Devuelve { empty: motivo } si no aporta nada, o un segmento con sus archivos.
 */
async function branchSegment(branch, segments, get, diffCommits) {
  const encoded = encodeURIComponent(branch.branch);
  const tip = await get(branch, `stats/branches?name=${encoded}`).then((stats) => stats.commit && stats.commit.commitId).catch(() => null);
  if (!tip) return { empty: 'la rama ya no existe' };

  const ownPrs = segments.filter((item) => item.pr && item.repositoryId === branch.repositoryId && item.pr.sourceBranch === branch.branch);
  let baseBranch;
  if (ownPrs.length) {
    // Si la rama se reutilizó luego para otra HU, lo posterior no es de esta HU.
    const prs = await get(branch, `pullrequests?searchCriteria.sourceRefName=refs/heads/${encoded}&searchCriteria.status=all&$top=100`)
      .then((data) => data.value || []).catch(() => []);
    // El trabajo de un PR abandonado se descartó: si la punta de la rama es ese trabajo, no hay nada nuevo.
    if (prs.some((pr) => pr.status === 'abandoned' && pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId === tip)) {
      return { empty: 'solo tiene los commits de un PR abandonado' };
    }
    const all = prs.filter((pr) => pr.status !== 'abandoned');
    all.sort((a, b) => String(b.creationDate).localeCompare(String(a.creationDate)));
    const latest = all[0];
    if (latest && !ownPrs.some((item) => item.pr.id === latest.pullRequestId)) return { empty: 'rama reutilizada después por otra HU' };
    const latestSource = latest ? latest.lastMergeSourceCommit && latest.lastMergeSourceCommit.commitId : null;
    if (!latest || tip === latestSource) return { empty: 'sin commits después del último PR' };
    baseBranch = stripHeads(latest.targetRefName);
  }

  // Commits propios de la rama frente a su rama base (desde el ancestro común). Sin PR que la indique, la base es
  // la rama de integración más cercana (menos commits por delante): una rama desactualizada como base atribuiría
  // a la HU todo lo integrado después.
  const candidates = (baseBranch ? [baseBranch] : BASE_BRANCH_CANDIDATES).filter((candidate) => candidate !== branch.branch);
  const diffs = (await Promise.all(candidates.map((candidate) => diffCommits(branch, candidate, 'branch', tip, 'commit')
    .then((diff) => ({ candidate, diff }), () => null)))).filter(Boolean);
  if (!diffs.length) return { empty: 'no se encontró rama base para comparar' };
  const { candidate, diff } = diffs.reduce((best, item) => (Number(item.diff.aheadCount || 0) < Number(best.diff.aheadCount || 0) ? item : best));
  if (!Number(diff.aheadCount)) return { empty: `sin commits propios frente a ${candidate}` };
  const files = fileChangesOf(diff.changes);
  if (!files.length) return { empty: `sin cambios de archivos frente a ${candidate}` };
  return {
    pr: null, kind: 'branch', targetBranch: `rama ${branch.branch}`, sourceBranch: branch.branch, baseBranch: candidate,
    date: new Date().toISOString(), baseCommit: diff.commonCommit, targetCommit: tip, files,
    comment: `${diff.aheadCount} commit(s) sin PR frente a ${candidate}`,
  };
}

/** Agrupa por repo + rama destino; por archivo, base del primer cambio y destino del último. */
function buildGroups(segments) {
  const groupsByKey = new Map();
  for (const segment of segments) {
    const key = `${segment.repositoryId}|${segment.targetBranch}`;
    if (!groupsByKey.has(key)) groupsByKey.set(key, []);
    groupsByKey.get(key).push(segment);
  }

  const groups = [];
  for (const groupSegments of groupsByKey.values()) {
    groupSegments.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const first = groupSegments[0];
    const last = groupSegments[groupSegments.length - 1];
    const files = new Map();
    for (const segment of groupSegments) {
      const label = segment.pr ? `PR ${segment.pr.id}` : segment.sourceBranch || segment.targetCommit.slice(0, 10);
      for (const file of segment.files) {
        if (!isReadableFile(file.path)) continue;
        const existing = files.get(file.path);
        files.set(file.path, {
          path: file.path,
          changeType: existing && existing.changeType === 'add' ? 'add' : file.changeType,
          baseCommit: existing ? existing.baseCommit : segment.baseCommit,
          targetCommit: segment.targetCommit,
          // Cada PR/commit de la HU por separado: entre uno y otro pueden haberse integrado cambios de otras HUs.
          segments: [...(existing ? existing.segments : []), {
            label, baseCommit: segment.baseCommit, targetCommit: segment.targetCommit,
            changeType: file.changeType, originalPath: file.originalPath || file.path,
          }],
        });
      }
    }
    if (files.size === 0) continue;

    groups.push({
      kind: first.kind,
      projectId: first.projectId,
      repositoryId: first.repositoryId,
      repositoryName: groupSegments.map((item) => item.repositoryName).find(Boolean) || first.repositoryId,
      targetBranch: first.targetBranch,
      sourceBranches: Array.from(new Set(groupSegments.map((item) => (item.pr ? item.pr.sourceBranch : item.sourceBranch)).filter(Boolean))),
      prs: groupSegments.map((item) => item.pr).filter(Boolean),
      commits: groupSegments.filter((item) => !item.pr).map((item) => ({ sha: item.targetCommit, comment: item.comment })),
      lastDate: last.date || null,
      lastCommit: last.targetCommit,
      files: Array.from(files.values()),
      alsoMergedInto: [],
    });
  }
  return groups;
}

function groupPriority(group) {
  const kind = group.kind === 'pr' ? 0 : group.kind === 'commits' ? 1 : 2;
  const target = TARGET_PRIORITY.findIndex((pattern) => pattern.test(group.targetBranch));
  const port = group.sourceBranches.length > 0 && group.sourceBranches.every((branch) => PORT_BRANCH.test(branch)) ? 1 : 0;
  return [kind, port, target < 0 ? TARGET_PRIORITY.length : target];
}

/** Objeto de BD que crea/reemplaza un script SQL (las migraciones tipo Liquibase redefinen el objeto en un archivo nuevo). */
const SQL_OBJECT_DEFINITION = /\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?(view|function|procedure|trigger)\s+(?:if\s+not\s+exists\s+)?((?:"?[\w$]+"?\.)?"?[\w$]+"?)/i;
const MAX_PREVIOUS_DEFINITION_READS = 8;

function sqlObjectOf(content) {
  const match = SQL_OBJECT_DEFINITION.exec(content || '');
  if (!match) return null;
  const name = match[2].replace(/"/g, '').toLowerCase();
  return { kind: match[1].toLowerCase(), name, shortName: name.split('.').pop() };
}

/**
 * Un script SQL agregado por la HU que redefine un objeto existente (CREATE OR REPLACE VIEW/FUNCTION…) no es
 * código nuevo: se compara con la definición anterior del objeto en el repo para mostrar solo lo que cambió la
 * HU y no la vista/función completa (que incluye la lógica de otras HUs).
 */
async function resolvePreviousDefinitions(organization, pat, groups) {
  const trees = new Map();
  const treeAt = (group, commit) => {
    const key = `${group.repositoryId}|${commit}`;
    if (!trees.has(key)) {
      trees.set(key, getTree(organization, pat, group.projectId, group.repositoryId, { version: commit, versionType: 'commit' }, '/')
        .then((tree) => tree.files).catch(() => []));
    }
    return trees.get(key);
  };
  const read = (group, commit, path) => fetchFileContent(organization, pat, group.projectId, group.repositoryId, commit, path, 'commit').catch(() => '');
  const baseName = (path) => path.split('/').pop().toLowerCase();

  for (const group of groups) {
    for (const file of group.files) {
      const segment = file.segments[0];
      if (!/\.sql$/i.test(file.path) || !segment.changeType.includes('add')) continue;
      const object = sqlObjectOf(await read(group, segment.targetCommit, file.path));
      if (!object) continue;
      const candidates = (await treeAt(group, segment.baseCommit))
        .filter((path) => /\.sql$/i.test(path) && path !== file.path && baseName(path).includes(object.shortName))
        .sort((a, b) => baseName(b).localeCompare(baseName(a)))
        .slice(0, MAX_PREVIOUS_DEFINITION_READS);
      for (const candidate of candidates) {
        const previous = sqlObjectOf(await read(group, segment.baseCommit, candidate));
        if (previous && previous.kind === object.kind && previous.name === object.name) {
          segment.originalPath = candidate;
          segment.changeType = 'edit';
          if (file.changeType.includes('add')) file.changeType = 'edit';
          file.previousDefinition = candidate;
          break;
        }
      }
    }
  }
  return groups;
}

/**
 * Una versión por cambio: si los archivos de código de un grupo ya están en
 * otro preferido del mismo repo (posible mismo trabajo integrado en otra rama),
 * se devuelve en `covered` junto a ese grupo para compararlos por contenido
 * (refineCoveredGroups) antes de informarlo como "también en".
 */
function selectGroups(groups) {
  const ordered = groups.slice().sort((a, b) => {
    const pa = groupPriority(a);
    const pb = groupPriority(b);
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return String(b.lastDate || '').localeCompare(String(a.lastDate || ''));
  });

  const result = [];
  const covered = [];
  for (const group of ordered) {
    const codeFiles = group.files.filter((file) => !BUILD_CONFIG_FILE.test(file.path));
    const keeper = result.find((kept) => kept.repositoryId === group.repositoryId
      && codeFiles.every((file) => kept.files.some((keptFile) => keptFile.path === file.path)));
    if (keeper) {
      covered.push({ group, keeper });
      continue;
    }
    result.push(group);
  }
  return { groups: result, covered };
}

/**
 * Un grupo cubierto (p. ej. el port a trunk) solo se descarta si no trae líneas nuevas frente a su grupo
 * preferido; si las trae, se conserva con esos archivos y `exclude` para que el diff muestre solo lo adicional.
 */
async function refineCoveredGroups(organization, pat, groups, covered) {
  const changedLines = async (group, file) => chainsChangedLines(
    await fileChains(organization, pat, group.projectId, group.repositoryId, file.path, file.segments),
  );
  const isSubset = (a, b) => [...a].every((item) => b.has(item));
  for (const { group, keeper } of covered) {
    const extra = [];
    for (const file of group.files) {
      if (BUILD_CONFIG_FILE.test(file.path)) continue;
      const keptFile = keeper.files.find((item) => item.path === file.path);
      const [own, kept] = await Promise.all([changedLines(group, file), changedLines(keeper, keptFile)]);
      if (!own || !kept || !isSubset(own.added, kept.added) || !isSubset(own.removed, kept.removed)) {
        extra.push({ ...file, exclude: keptFile.segments });
      }
    }
    if (extra.length) {
      groups.push({ ...group, files: extra, extraOver: keeper.targetBranch });
    } else {
      keeper.alsoMergedInto.push(group.targetBranch);
    }
  }
  return groups;
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
 *   GET  work-item-changes?workItemId=   (PRs/commits vinculados a la HU)
 *   POST tree        { project, repositoryId, branch | commit, scopePath? }
 *   POST files       { project, repositoryId, branch | commit, files: [{ path, startLine?, endLine? }] }
 *   POST search      { project, repositoryId, branch | commit, terms: [], paths: [] }
 *   POST branch-diff { project, repositoryId, baseBranch, branch }
 *   POST file-diff   { project, repositoryId, path, changeType, originalPath?, baseCommit, targetCommit }
 *   POST app-search { projectId, repoPrefixes: [], terms: [] }  (Code Search en los repos del aplicativo)
 */
async function handleCodeAgentRoute({ route, method, query, body, organization, pat }) {
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
      case 'work-item-changes':
        return getWorkItemChanges(organization, pat, q.workItemId);
      default:
        break;
    }
  }

  if (method === 'POST') {
    switch (route) {
      case 'tree':
        return getTree(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), resolveVersion(b), b.scopePath);
      case 'files':
        return readFiles(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), resolveVersion(b), b.files);
      case 'branch-diff':
        return getBranchDiff(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), normalizeBranch(b.baseBranch), normalizeBranch(b.branch));
      case 'file-diff':
        return getFileDiff(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), b);
      case 'app-search':
        return searchApplication(organization, pat, b);
      case 'search':
        return searchInFiles(organization, pat, requireString(b.project, 'project'), requireString(b.repositoryId, 'repositoryId'), resolveVersion(b), b.terms, b.paths);
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
  computeLineDiff,
  formatHunks,
  workItemIdsInBranch,
  isPromotionBranch,
  foreignPrReason,
  buildGroups,
  selectGroups,
  fileChains,
  chainsChangedLines,
};
