/**
 * Núcleo del "Agente de exploración de código" sobre GitHub.
 *
 * Mismas rutas y mismas respuestas que _azure-repos-core.js, para que el
 * frontend (servicio, runner del agente y jueces) no distinga el origen:
 *   - "project"      = organización o usuario de GitHub (owner)
 *   - "repositoryId" = nombre del repositorio
 *   - rutas de archivo con "/" inicial (como Azure)
 *
 * La HU sigue viviendo en Azure Boards; su código en GitHub se encuentra por
 * el ID de la HU: PRs que lo mencionan (título, descripción o rama, incl.
 * "AB#<id>") y ramas con el ID en el nombre dentro de los repos del aplicativo.
 *
 * TODAS las operaciones son de SOLO LECTURA.
 */
const fetch = require('node-fetch');
const core = require('./_azure-repos-core.js');

const { CodeAgentError, LIMITS, isReadableFile, redactSecrets, requireString, normalizeBranch, resolveVersion, mapLimit } = core;

const API = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REPO_PAGES = 10;      // 1000 repos
const MAX_BRANCH_PAGES = 10;    // 1000 ramas
const MAX_COMPARE_FILE_PAGES = 4; // compare devuelve 300 archivos por página
const MAX_HU_PRS = 30;
const MAX_HU_REPOS = 40;

async function githubRequest(token, path, { raw = false, allow404 = false } = {}) {
  const timeoutMs = Number(process.env.GITHUB_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'test-plan-app-code-agent',
      },
      signal: controller.signal,
    });

    if (response.status === 404 && allow404) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = String(body.message || '');
      if (response.status === 401) throw new CodeAgentError(401, 'Token de GitHub inválido, vencido o revocado.');
      if (response.status === 403 && /saml|sso/i.test(detail)) {
        throw new CodeAgentError(403, 'La organización exige SSO: autoriza el token para la organización en GitHub (Settings → Tokens → Configure SSO).');
      }
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new CodeAgentError(429, 'Se alcanzó el límite de consultas de GitHub. Intenta de nuevo en unos minutos.');
      }
      if (response.status === 403) throw new CodeAgentError(403, 'El token de GitHub no tiene permiso para leer este repositorio (alcance "repo" / Contents: Read).');
      if (response.status === 404) throw new CodeAgentError(404, 'No se encontró el recurso en GitHub (organización, repositorio, rama o archivo), o el token no tiene acceso.');
      if (response.status === 422) throw new CodeAgentError(422, detail || 'GitHub rechazó la consulta.');
      throw new CodeAgentError(502, 'No fue posible consultar GitHub en este momento.');
    }
    return raw ? response.text() : response.json();
  } catch (error) {
    if (error instanceof CodeAgentError) throw error;
    const message = error && error.message ? error.message : String(error);
    if (message.includes('aborted')) throw new CodeAgentError(504, 'La consulta a GitHub excedió el tiempo de espera.');
    throw new CodeAgentError(502, 'Error de conexión con GitHub.');
  } finally {
    clearTimeout(timeoutId);
  }
}

async function paginate(token, path, maxPages, pick = (data) => data) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await githubRequest(token, `${path}${sep}per_page=100&page=${page}`);
    const list = pick(data) || [];
    items.push(...list);
    if (list.length < 100) break;
  }
  return items;
}

const enc = encodeURIComponent;
const repoPath = (owner, repo) => `/repos/${enc(owner)}/${enc(repo)}`;
const toRepoPath = (path) => '/' + String(path || '').replace(/^\/+/, '');
const fromRepoPath = (path) => String(path || '').replace(/^\/+/, '');
const encodePath = (path) => fromRepoPath(path).split('/').map(enc).join('/');

/** Prefijos configurados ("NU0139001_SAF, NU0139001_X") en minúsculas. */
function parseFilter(repoFilter) {
  return String(repoFilter || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}
const matchesFilter = (name, prefixes) => !prefixes.length || prefixes.some((prefix) => String(name).toLowerCase().startsWith(prefix));

function changeTypeOf(status) {
  switch (status) {
    case 'added': return 'add';
    case 'removed': return 'delete';
    case 'renamed': return 'rename';
    default: return 'edit';
  }
}

// ---------------------------------------------------------------------------
// Operaciones básicas
// ---------------------------------------------------------------------------

function githubSource(token) {
  return {
    content: (owner, repo, ref, path) => fetchFileContent(token, owner, repo, ref, path),
    treeFiles: (owner, repo, commit) => getTree(token, owner, repo, { version: commit }, '/').then((tree) => tree.files),
  };
}

async function fetchFileContent(token, owner, repo, ref, path) {
  const text = await githubRequest(token, `${repoPath(owner, repo)}/contents/${encodePath(path)}?ref=${enc(ref)}`, { raw: true });
  return typeof text === 'string' ? text : '';
}

async function listRepositories(token, owner, repoFilter) {
  const prefixes = parseFilter(repoFilter);
  let repos = [];
  // Con filtro: búsqueda por nombre (rápida aun en organizaciones con miles de repos).
  for (const prefix of prefixes) {
    const found = await paginate(token, `/search/repositories?q=${enc(`${prefix} in:name org:${owner}`)}`, 3, (data) => data.items)
      .catch(() => []);
    repos.push(...found);
    // Un filtro que es el nombre exacto de un repo se agrega aunque la búsqueda no lo indexe aún.
    if (!found.some((repo) => repo.name.toLowerCase() === prefix)) {
      const exact = await githubRequest(token, `${repoPath(owner, prefix)}`, { allow404: true }).catch(() => null);
      if (exact) repos.push(exact);
    }
  }
  if (!prefixes.length || !repos.length) {
    try {
      repos = await paginate(token, `/orgs/${enc(owner)}/repos?type=all&sort=full_name`, MAX_REPO_PAGES);
    } catch (error) {
      if (!(error instanceof CodeAgentError) || error.status !== 404) throw error;
      repos = await paginate(token, `/users/${enc(owner)}/repos?type=all&sort=full_name`, MAX_REPO_PAGES);
    }
  }
  const byName = new Map();
  for (const repo of repos) {
    if (repo.archived || repo.disabled || !matchesFilter(repo.name, prefixes)) continue;
    byName.set(repo.name, { id: repo.name, name: repo.name, defaultBranch: repo.default_branch || 'main', projectId: owner });
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function listBranches(token, owner, repo) {
  const branches = await paginate(token, `${repoPath(owner, repo)}/branches`, MAX_BRANCH_PAGES);
  return branches.map((branch) => ({ name: branch.name, commitId: branch.commit && branch.commit.sha }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getTree(token, owner, repo, ver, scopePath) {
  const scope = scopePath && scopePath !== '/' ? toRepoPath(scopePath).replace(/\/+$/, '') : '/';
  const data = await githubRequest(token, `${repoPath(owner, repo)}/git/trees/${enc(ver.version)}?recursive=1`);
  const allFiles = (data.tree || []).filter((item) => item.type === 'blob').map((item) => toRepoPath(item.path))
    .filter((path) => scope === '/' || path.startsWith(`${scope}/`));
  const readable = allFiles.filter(isReadableFile);
  return {
    scopePath: scope,
    totalFiles: allFiles.length,
    readableFiles: readable.length,
    truncated: !!data.truncated || readable.length > LIMITS.maxTreeItems,
    files: readable.slice(0, LIMITS.maxTreeItems),
  };
}

/** compare base...head: ancestro común, commits propios y archivos cambiados (paginado). */
async function compare(token, owner, repo, base, head) {
  const path = `${repoPath(owner, repo)}/compare/${enc(base)}...${enc(head)}`;
  const first = await githubRequest(token, `${path}?per_page=100&page=1`);
  const files = [...(first.files || [])];
  for (let page = 2; page <= MAX_COMPARE_FILE_PAGES && files.length === (page - 1) * 300; page++) {
    const next = await githubRequest(token, `${path}?per_page=100&page=${page}`).catch(() => null);
    if (!next || !(next.files || []).length) break;
    files.push(...next.files);
  }
  return {
    commonCommit: first.merge_base_commit && first.merge_base_commit.sha,
    aheadCount: Number(first.ahead_by || 0),
    behindCount: Number(first.behind_by || 0),
    files,
  };
}

const fileChangesOf = (files) => (files || []).map((file) => ({
  path: toRepoPath(file.filename),
  changeType: changeTypeOf(file.status),
  originalPath: file.previous_filename ? toRepoPath(file.previous_filename) : undefined,
}));

async function branchTip(token, owner, repo, branch) {
  const data = await githubRequest(token, `${repoPath(owner, repo)}/branches/${enc(branch)}`, { allow404: true });
  return data && data.commit ? data.commit.sha : null;
}

async function getBranchDiff(token, owner, repo, baseBranch, branch) {
  const tip = await branchTip(token, owner, repo, branch);
  if (!tip) throw new CodeAgentError(404, `No existe la rama "${branch}" en ${repo}.`);
  const diff = await compare(token, owner, repo, baseBranch, tip);
  const all = fileChangesOf(diff.files);
  return {
    baseBranch,
    branch,
    commonCommit: diff.commonCommit || null,
    targetCommit: tip,
    aheadCount: diff.aheadCount,
    behindCount: diff.behindCount,
    totalChangedFiles: all.length,
    allChangesIncluded: diff.files.length < MAX_COMPARE_FILE_PAGES * 300,
    changes: all.filter((change) => isReadableFile(change.path)),
  };
}

/** Code search de GitHub en los repos del aplicativo (los que empiezan por los prefijos). */
async function searchApplication(token, owner, body) {
  const prefixes = (Array.isArray(body.repoPrefixes) ? body.repoPrefixes : []).map((item) => String(item).toLowerCase()).filter(Boolean).slice(0, 5);
  const terms = (Array.isArray(body.terms) ? body.terms : []).map((term) => String(term).trim()).filter((term) => term.length >= 3).slice(0, 4);
  if (!prefixes.length || !terms.length) throw new CodeAgentError(400, 'Indica prefijos de repositorio y términos (mín. 3 caracteres).');

  const results = await Promise.all(terms.map((term) => githubRequest(token,
    `/search/code?per_page=${LIMITS.maxAppSearchFiles}&q=${enc(`${term.includes(' ') ? `"${term}"` : term} org:${owner}`)}`)
    .catch(() => ({ items: [], total_count: 0 }))));

  const files = new Map();
  let totalCount = 0;
  for (const data of results) {
    totalCount += Number(data.total_count || 0);
    for (const item of data.items || []) {
      const repo = item.repository && item.repository.name;
      const path = toRepoPath(item.path);
      if (repo && matchesFilter(repo, prefixes) && isReadableFile(path) && !files.has(`${repo}|${path}`)) {
        files.set(`${repo}|${path}`, { repo, path, branch: (item.repository && item.repository.default_branch) || '' });
      }
    }
  }

  const lowered = terms.map((term) => term.toLowerCase());
  const matches = [];
  await mapLimit(Array.from(files.values()).slice(0, LIMITS.maxAppSearchFiles), 6, async (file) => {
    const content = await fetchFileContent(token, owner, file.repo, file.branch || 'HEAD', file.path).catch(() => '');
    const lines = redactSecrets(content).split(/\r?\n/);
    let found = 0;
    lines.forEach((line, index) => {
      if (found >= 3 || !lowered.some((term) => line.toLowerCase().includes(term))) return;
      found++;
      const context = lines.slice(Math.max(0, index - 1), index + 2).map((text) => text.trim().slice(0, 200)).join(' ⏎ ');
      matches.push({ repositoryName: file.repo, branch: file.branch || 'HEAD', path: file.path, line: index + 1, text: context });
    });
  });
  const isTest = (path) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(spec|test)\.|Test\.java$/i.test(path);
  matches.sort((a, b) => Number(isTest(a.path)) - Number(isTest(b.path))
    || a.repositoryName.localeCompare(b.repositoryName) || a.path.localeCompare(b.path) || a.line - b.line);
  return { totalCount, matches: matches.slice(0, LIMITS.maxAppSearchMatches) };
}

// ---------------------------------------------------------------------------
// Código de la HU (por el ID de la HU de Azure Boards)
// ---------------------------------------------------------------------------

/** El ID aparece como número suelto (no dentro de otro número): "HU7743787", "AB#7743787", "7743787". */
function mentionsId(text, id) {
  return new RegExp(`(^|\\D)${id}(?!\\d)`).test(String(text || ''));
}

/** PRs de la organización que mencionan la HU en título, descripción o rama. */
async function findHuPullRequests(token, owner, id, prefixes) {
  const queries = [`${id} org:${owner} is:pr`, `AB#${id} org:${owner} is:pr`];
  const found = new Map();
  for (const query of queries) {
    const data = await githubRequest(token, `/search/issues?per_page=50&q=${enc(query)}`).catch(() => ({ items: [] }));
    for (const item of data.items || []) {
      const repo = String(item.repository_url || '').split('/').pop();
      if (!repo || !matchesFilter(repo, prefixes)) continue;
      if (!mentionsId(`${item.title} ${item.body || ''}`, id) && !item.pull_request) continue;
      found.set(`${repo}#${item.number}`, { repo, number: item.number });
    }
  }
  return Array.from(found.values()).slice(0, MAX_HU_PRS);
}

async function getWorkItemChanges(token, owner, repoFilter, workItemId) {
  const id = Number(workItemId);
  if (!Number.isInteger(id) || id <= 0) throw new CodeAgentError(400, 'ID de HU inválido.');
  const prefixes = parseFilter(repoFilter);
  const source = githubSource(token);

  const segments = [];
  const omitted = [];
  const emptyBranches = [];

  // 1) PRs que mencionan la HU (búsqueda) y ramas con el ID de la HU en los repos del aplicativo.
  const prRefs = new Map((await findHuPullRequests(token, owner, id, prefixes)).map((ref) => [`${ref.repo}#${ref.number}`, ref]));
  const pulls = new Map();
  const loadPull = async (ref) => {
    const key = `${ref.repo}#${ref.number}`;
    if (!pulls.has(key)) {
      pulls.set(key, githubRequest(token, `${repoPath(owner, ref.repo)}/pulls/${ref.number}`).catch(() => null));
    }
    return pulls.get(key);
  };
  await mapLimit(Array.from(prRefs.values()), 6, loadPull);

  const repos = new Set(Array.from(prRefs.values()).map((ref) => ref.repo));
  if (prefixes.length) {
    (await listRepositories(token, owner, repoFilter).catch(() => [])).forEach((repo) => repos.add(repo.name));
  }
  const branches = [];
  await mapLimit(Array.from(repos).slice(0, MAX_HU_REPOS), 6, async (repo) => {
    const list = await listBranches(token, owner, repo).catch(() => []);
    for (const branch of list) {
      if (core.workItemIdsInBranch(branch.name).includes(id) && !core.isPromotionBranch(branch.name)) {
        branches.push({ projectId: owner, repositoryId: repo, branch: branch.name, tip: branch.commitId });
      }
    }
  });

  // 2) Todos los PRs de las ramas de la HU (aunque no mencionen el ID ni la rama exista aún).
  const huBranches = new Map();
  branches.forEach((branch) => huBranches.set(`${branch.repositoryId}|${branch.branch}`, { repo: branch.repositoryId, branch: branch.branch }));
  for (const pull of await Promise.all(Array.from(pulls.values()))) {
    const ref = pull && pull.head && pull.head.ref;
    const repo = pull && pull.base && pull.base.repo && pull.base.repo.name;
    if (ref && repo && core.workItemIdsInBranch(ref).includes(id)) huBranches.set(`${repo}|${ref}`, { repo, branch: ref });
  }
  await mapLimit(Array.from(huBranches.values()), 6, async ({ repo, branch }) => {
    const list = await githubRequest(token, `${repoPath(owner, repo)}/pulls?state=all&per_page=50&head=${enc(`${owner}:${branch}`)}`).catch(() => []);
    for (const pull of Array.isArray(list) ? list : []) {
      const key = `${repo}#${pull.number}`;
      if (!prRefs.has(key) && prRefs.size < MAX_HU_PRS) {
        prRefs.set(key, { repo, number: pull.number });
        await loadPull({ repo, number: pull.number });
      }
    }
  });

  // 3) Cada PR: todo lo que aportó, desde el ancestro común con su rama destino.
  await mapLimit(Array.from(prRefs.values()), 6, async (ref) => {
    try {
      const pr = await loadPull(ref);
      if (!pr) return;
      const info = {
        id: pr.number,
        title: String(pr.title || '').slice(0, 160),
        status: pr.merged_at ? 'completed' : pr.state === 'open' ? 'active' : 'abandoned',
        sourceBranch: pr.head && pr.head.ref,
        targetBranch: pr.base && pr.base.ref,
      };
      const otherIds = (String(pr.title || '') + ' ' + String(pr.body || '')).match(/(?:^|\D)(\d{6,8})(?!\d)/g) || [];
      const linkedWorkItems = Math.max(1, new Set(otherIds.map((item) => item.replace(/\D/g, ''))).size);
      const reason = core.foreignPrReason(info, linkedWorkItems, id)
        || (!mentionsId(`${pr.title} ${pr.body || ''} ${info.sourceBranch}`, id) ? 'el PR no menciona la HU' : null);
      if (reason) {
        omitted.push({ repositoryName: ref.repo, prId: info.id, title: info.title, reason });
        return;
      }
      const head = pr.head && pr.head.sha;
      const diff = await compare(token, owner, ref.repo, pr.base.sha, head);
      segments.push({
        projectId: owner, repositoryId: ref.repo, repositoryName: ref.repo, pr: info, kind: 'pr',
        targetBranch: info.targetBranch, sourceTip: head, date: pr.merged_at || pr.closed_at || pr.created_at,
        baseCommit: diff.commonCommit, targetCommit: head, files: fileChangesOf(diff.files),
      });
    } catch (error) {
      console.warn('[CODE_AGENT][GITHUB][WORK_ITEM_CHANGES] PR omitido:', ref.repo, ref.number, error && error.message);
    }
  });

  // 4) Ramas de la HU con commits que no llegaron por un PR.
  await mapLimit(branches, 6, async (branch) => {
    try {
      const segment = await branchSegment(token, owner, branch, segments);
      if (segment.empty) {
        emptyBranches.push({ repositoryName: branch.repositoryId, branch: branch.branch, reason: segment.empty });
        return;
      }
      segments.push({ projectId: owner, repositoryId: branch.repositoryId, repositoryName: branch.repositoryId, ...segment });
    } catch (error) {
      console.warn('[CODE_AGENT][GITHUB][WORK_ITEM_CHANGES] rama omitida:', branch.branch, error && error.message);
    }
  });

  return core.finalizeWorkItemChanges(source, id, segments, omitted, emptyBranches);
}

/** Commits de una rama de la HU que no llegaron por un PR ya analizado. */
async function branchSegment(token, owner, branch, segments) {
  const tip = branch.tip || await branchTip(token, owner, branch.repositoryId, branch.branch);
  if (!tip) return { empty: 'la rama ya no existe' };
  const ownPrs = segments.filter((item) => item.pr && item.repositoryId === branch.repositoryId && item.pr.sourceBranch === branch.branch);
  if (ownPrs.some((item) => item.sourceTip === tip)) return { empty: 'sin commits después del último PR' };

  const candidates = (ownPrs.length ? [ownPrs[0].pr.targetBranch] : core.BASE_BRANCH_CANDIDATES).filter((name) => name && name !== branch.branch);
  const diffs = (await Promise.all(candidates.map((candidate) => compare(token, owner, branch.repositoryId, candidate, tip)
    .then((diff) => ({ candidate, diff }), () => null)))).filter(Boolean);
  if (!diffs.length) return { empty: 'no se encontró rama base para comparar' };
  const { candidate, diff } = diffs.reduce((best, item) => (item.diff.aheadCount < best.diff.aheadCount ? item : best));
  if (!diff.aheadCount) return { empty: `sin commits propios frente a ${candidate}` };
  const files = fileChangesOf(diff.files);
  if (!files.length) return { empty: `sin cambios de archivos frente a ${candidate}` };
  return {
    pr: null, kind: 'branch', targetBranch: `rama ${branch.branch}`, sourceBranch: branch.branch, baseBranch: candidate,
    date: new Date().toISOString(), baseCommit: diff.commonCommit, targetCommit: tip, files,
    comment: `${diff.aheadCount} commit(s) sin PR frente a ${candidate}`,
  };
}

/** Ramas de la HU (con el ID en el nombre) en los repos del aplicativo: equivalente a "ramas vinculadas". */
async function getWorkItemLinkedBranches(token, owner, repoFilter, workItemId) {
  const id = Number(workItemId);
  if (!Number.isInteger(id) || id <= 0) throw new CodeAgentError(400, 'ID de HU inválido.');
  const prefixes = parseFilter(repoFilter);
  if (!prefixes.length) return [];
  const repos = await listRepositories(token, owner, repoFilter);
  const links = [];
  await mapLimit(repos.slice(0, MAX_HU_REPOS), 6, async (repo) => {
    const list = await listBranches(token, owner, repo.name).catch(() => []);
    list.filter((branch) => core.workItemIdsInBranch(branch.name).includes(id))
      .forEach((branch) => links.push({ projectId: owner, repositoryId: repo.name, branch: branch.name }));
  });
  return links;
}

// ---------------------------------------------------------------------------
// Router (mismas rutas que Azure)
// ---------------------------------------------------------------------------

async function handleGithubRoute({ route, method, query, body, owner, repoFilter, token }) {
  const q = query || {};
  const b = body || {};
  const source = githubSource(token);
  const projectOf = (value) => String(value || '').trim() || owner;

  if (method === 'GET') {
    switch (route) {
      case 'projects':
        return [{ id: owner, name: owner }];
      case 'repositories':
        return listRepositories(token, projectOf(q.project), repoFilter);
      case 'branches':
        return listBranches(token, projectOf(q.project), requireString(q.repositoryId, 'repositoryId'));
      case 'work-item-links':
        return getWorkItemLinkedBranches(token, owner, repoFilter, q.workItemId);
      case 'work-item-changes':
        return getWorkItemChanges(token, owner, repoFilter, q.workItemId);
      default:
        break;
    }
  }

  if (method === 'POST') {
    const project = projectOf(b.project);
    switch (route) {
      case 'tree':
        return getTree(token, project, requireString(b.repositoryId, 'repositoryId'), resolveVersion(b), b.scopePath);
      case 'files':
        return core.readFiles(source, project, requireString(b.repositoryId, 'repositoryId'), resolveVersion(b), b.files);
      case 'branch-diff':
        return getBranchDiff(token, project, requireString(b.repositoryId, 'repositoryId'), normalizeBranch(b.baseBranch), normalizeBranch(b.branch));
      case 'file-diff':
        return core.getFileDiff(source, project, requireString(b.repositoryId, 'repositoryId'), b);
      case 'app-search':
        return searchApplication(token, owner, b);
      case 'search':
        return core.searchInFiles(source, project, requireString(b.repositoryId, 'repositoryId'), resolveVersion(b), b.terms, b.paths);
      default:
        break;
    }
  }

  throw new CodeAgentError(404, 'Recurso del agente de código no encontrado.');
}

/** Valida token + owner (y que el filtro encuentre repos). Devuelve un resumen para la UI. */
async function validateGithubConnection(token, owner, repoFilter) {
  const user = await githubRequest(token, '/user');
  const repos = await listRepositories(token, owner, repoFilter);
  return { login: user.login, repositories: repos.length, sample: repos.slice(0, 5).map((repo) => repo.name) };
}

/**
 * Acepta "cib-bancolombia", "https://github.com/cib-bancolombia" o la URL de un
 * repo: devuelve owner y, si vino un repo, lo usa como filtro.
 */
function parseOwnerInput(input) {
  const text = String(input || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const match = text.match(/github\.com[/:]([^/\s]+)(?:\/([^/\s?#]+))?/i);
  const owner = match ? match[1] : text.split('/')[0];
  const repo = match ? match[2] || '' : text.split('/')[1] || '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner || '')) {
    throw new CodeAgentError(400, 'Indica la organización o el usuario de GitHub (p. ej. cib-bancolombia) o la URL de un repositorio.');
  }
  return { owner, repo };
}

module.exports = {
  handleGithubRoute,
  validateGithubConnection,
  parseOwnerInput,
  // pruebas
  mentionsId,
  parseFilter,
  changeTypeOf,
};
