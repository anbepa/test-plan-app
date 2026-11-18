/**
 * Índice de símbolos de los repos del aplicativo (GitHub) para search_app.
 *
 * Por qué: la búsqueda de código de GitHub permite ~10 consultas por minuto y
 * el agente y la receta de datos hacen muchas más. El índice guarda, por
 * archivo, sus "símbolos" (tablas, vistas, clases, constantes, endpoints,
 * textos cortos) y se consulta en Supabase sin límite. Las líneas exactas se
 * siguen leyendo de GitHub con el token del usuario (si no tiene acceso al
 * repo, no ve nada).
 *
 * Construcción: un tarball por repo y rama (1 consulta a GitHub), leído en
 * memoria con zlib + un lector de tar mínimo: sin dependencias nuevas.
 */
const fetch = require('node-fetch');
const zlib = require('zlib');
const { CodeAgentError, isReadableFile } = require('./_azure-repos-core.js');

const MAX_FILE_BYTES = 400 * 1024;      // archivos más grandes no aportan símbolos útiles
const MAX_SYMBOLS_CHARS = 6000;         // por archivo
const UPSERT_BATCH = 400;
const SEARCH_LIMIT_PER_TERM = 12;
/** Ramas que se indexan además de la principal (si existen). */
const EXTRA_BRANCHES = ['release/current'];

// Palabras muy comunes en código que no sirven para encontrar nada.
const STOPWORDS = new Set(('the and for not null true false void public private protected static final class interface return '
  + 'import package new this super extends implements string int long boolean double float var let const function async await '
  + 'from select where join left inner order group having insert into values update set delete create table view or and as on '
  + 'case when then else end if while try catch throw throws default export type any number undefined object list map optional '
  + 'override get put post data value values name id').split(/\s+/));

// ---------------------------------------------------------------------------
// Tar mínimo (formato ustar + cabeceras pax que usa GitHub)
// ---------------------------------------------------------------------------

function parseOctal(buffer, start, length) {
  const text = buffer.toString('ascii', start, start + length).replace(/\0.*$/, '').trim();
  return text ? parseInt(text, 8) : 0;
}

function parsePax(content) {
  const records = {};
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    if (space < 0) break;
    const length = parseInt(content.toString('ascii', offset, space), 10);
    if (!length) break;
    const record = content.toString('utf8', space + 1, offset + length - 1);
    const eq = record.indexOf('=');
    if (eq > 0) records[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return records;
}

/** Recorre las entradas de archivo de un tar (ya descomprimido). */
function* tarEntries(tar) {
  let offset = 0;
  let paxPath = null;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') { paxPath = parsePax(data).path || null; continue; }
    if (type === 'g') continue;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/, ''); continue; }
    const path = paxPath || longName || (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    longName = null;
    if (type === '0' || type === '\0' || type === '7') yield { path, data };
  }
}

// ---------------------------------------------------------------------------
// Símbolos de un archivo
// ---------------------------------------------------------------------------

/** Símbolos útiles para buscar: objetos SQL, identificadores, textos cortos y rutas de endpoint. */
function extractSymbols(text) {
  const symbols = new Set();
  const add = (value) => {
    const symbol = String(value || '').trim().toLowerCase();
    if (symbol.length >= 3 && symbol.length <= 80 && !STOPWORDS.has(symbol)) symbols.add(symbol);
  };
  for (const match of text.matchAll(/[A-Za-z_][\w$]*\.[A-Za-z_][\w$]*/g)) add(match[0]);          // schsaf.tbl_x, Clase.metodo
  for (const match of text.matchAll(/'([^'\n]{3,60})'|"([^"\n]{3,60})"/g)) add(match[1] || match[2]); // 'CUENTA POR PAGAR'
  for (const match of text.matchAll(/\/[A-Za-z0-9_\-{}.]+(?:\/[A-Za-z0-9_\-{}.]+)+/g)) add(match[0]);  // /api/conciliation-report/xlsx
  for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) add(match[0]);                    // identificadores
  let joined = '';
  for (const symbol of symbols) {
    if (joined.length + symbol.length + 1 > MAX_SYMBOLS_CHARS) break;
    joined += (joined ? ' ' : '') + symbol;
  }
  return joined;
}

/** Descarga el tarball de repo@ref y devuelve [{ path, symbols }] de los archivos legibles. */
async function buildRepoEntries(token, owner, repo, ref) {
  const timeoutMs = Number(process.env.GITHUB_TARBALL_TIMEOUT_MS || 40000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let buffer;
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'test-plan-app-code-index' },
      signal: controller.signal,
    });
    if (response.status === 404) throw new CodeAgentError(404, `No existe ${repo}@${ref} o el token no tiene acceso.`);
    if (!response.ok) throw new CodeAgentError(502, `GitHub respondió ${response.status} al descargar ${repo}@${ref}.`);
    buffer = await response.buffer();
  } catch (error) {
    if (error instanceof CodeAgentError) throw error;
    throw new CodeAgentError(504, `No se pudo descargar ${repo}@${ref}: ${error && error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const tar = zlib.gunzipSync(buffer);
  const entries = [];
  for (const entry of tarEntries(tar)) {
    const path = '/' + entry.path.split('/').slice(1).join('/');   // quita la carpeta raíz "owner-repo-sha/"
    if (path === '/' || entry.data.length > MAX_FILE_BYTES || !isReadableFile(path)) continue;
    const symbols = extractSymbols(entry.data.toString('utf8'));
    if (symbols) entries.push({ path, symbols });
  }
  return { entries, compressedBytes: buffer.length };
}

// ---------------------------------------------------------------------------
// Supabase (service role)
// ---------------------------------------------------------------------------

async function rpc(db, name, params) {
  const { data, error } = await db.rpc(name, params);
  if (error) throw new CodeAgentError(500, `Índice de código: ${error.message}`);
  return data;
}

/** Indexa una rama de un repo: reemplaza sus filas por las del tarball actual. */
async function indexRepoBranch(db, token, owner, repo, branch, isDefault) {
  const head = await fetchJson(token, `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(branch)}`);
  if (!head) return { repo, branch, skipped: 'la rama no existe' };
  const sha = head.commit && head.commit.sha;
  const started = Date.now();
  const { entries, compressedBytes } = await buildRepoEntries(token, owner, repo, sha);
  const runId = `${sha}-${started}`;
  for (let i = 0; i < entries.length; i += UPSERT_BATCH) {
    const batch = entries.slice(i, i + UPSERT_BATCH).map((entry) => ({ path: entry.path, symbols: entry.symbols }));
    await rpc(db, 'code_index_upsert_files', { p_owner: owner, p_repo: repo, p_branch: branch, p_run_id: runId, p_files: batch });
  }
  await rpc(db, 'code_index_finish_run', { p_owner: owner, p_repo: repo, p_branch: branch, p_run_id: runId, p_head_sha: sha, p_files: entries.length, p_is_default: !!isDefault });
  return { repo, branch, sha, files: entries.length, compressedBytes, ms: Date.now() - started };
}

async function fetchJson(token, path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'test-plan-app-code-index' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new CodeAgentError(response.status === 401 ? 401 : 502, `GitHub respondió ${response.status} (${path}).`);
  return response.json();
}

const enc = encodeURIComponent;

/** Ramas a indexar de un repo: la principal y las extra que existan. */
async function branchesToIndex(token, owner, repo) {
  const info = await fetchJson(token, `/repos/${enc(owner)}/${enc(repo)}`);
  if (!info) throw new CodeAgentError(404, `No existe ${repo} o el token no tiene acceso.`);
  return [{ branch: info.default_branch, isDefault: true },
    ...EXTRA_BRANCHES.filter((branch) => branch !== info.default_branch).map((branch) => ({ branch, isDefault: false }))];
}

/** Indexa todas las ramas de un repo (una llamada por repo para no pasar los 60 s de Vercel). */
async function indexRepo(db, token, owner, repo) {
  const results = [];
  for (const { branch, isDefault } of await branchesToIndex(token, owner, repo)) {
    results.push(await indexRepoBranch(db, token, owner, repo, branch, isDefault));
  }
  return results;
}

/** Estado del índice: por repo y rama, el commit indexado frente al actual (desactualizado si cambió). */
async function indexStatus(db, token, owner, prefixes, checkHeads) {
  const rows = await rpc(db, 'code_index_status', { p_owner: owner, p_prefixes: prefixes });
  if (!checkHeads) return rows;
  const out = [];
  for (const row of rows) {
    const head = await fetchJson(token, `/repos/${enc(owner)}/${enc(row.repo)}/branches/${enc(row.branch)}`).catch(() => null);
    out.push({ ...row, current_sha: head && head.commit ? head.commit.sha : null, stale: !!(head && head.commit && head.commit.sha !== row.head_sha) });
  }
  return out;
}

/**
 * Qué repos del aplicativo faltan o están desactualizados en el índice.
 * `repos` = nombres de los repos del aplicativo (los lista el llamador con el token del usuario).
 */
async function indexPlan(db, token, owner, prefixes, repos) {
  const rows = await rpc(db, 'code_index_status', { p_owner: owner, p_prefixes: prefixes });
  const indexed = new Map();
  rows.forEach((row) => {
    if (!indexed.has(row.repo)) indexed.set(row.repo, []);
    indexed.get(row.repo).push(row);
  });
  const plan = [];
  for (const repo of repos) {
    const branches = indexed.get(repo) || [];
    if (!branches.length) { plan.push({ repo, reason: 'sin indexar' }); continue; }
    // Solo la rama principal se compara (1 consulta por repo); las extra se renuevan junto con ella.
    const main = branches.find((row) => row.is_default) || branches[0];
    const head = await fetchJson(token, `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(main.branch)}`).catch(() => null);
    if (head && head.commit && head.commit.sha !== main.head_sha) plan.push({ repo, reason: `${main.branch} cambió` });
  }
  return { indexedRepos: indexed.size, files: rows.reduce((sum, row) => sum + (row.files || 0), 0),
    lastIndexedAt: rows.map((row) => row.indexed_at).filter(Boolean).sort().pop() || null, pending: plan };
}

/**
 * Archivos candidatos para un término. Devuelve null si el índice no tiene
 * repos de esos prefijos (se usa la búsqueda de GitHub).
 */
async function searchIndex(db, owner, prefixes, terms) {
  const status = await rpc(db, 'code_index_status', { p_owner: owner, p_prefixes: prefixes }).catch(() => []);
  if (!status.length) return null;
  const files = new Map();
  for (const term of terms) {
    const rows = await rpc(db, 'code_index_search', { p_owner: owner, p_prefixes: prefixes, p_term: term, p_limit: SEARCH_LIMIT_PER_TERM });
    for (const row of rows) {
      const key = `${row.repo}|${row.path}`;
      // Una ruta en varias ramas: se prefiere la principal (primera que devuelve la consulta).
      if (!files.has(key)) files.set(key, { repo: row.repo, path: row.path, branch: row.branch });
    }
  }
  return Array.from(files.values());
}

module.exports = {
  EXTRA_BRANCHES,
  buildRepoEntries,
  extractSymbols,
  tarEntries,
  indexRepo,
  indexStatus,
  indexPlan,
  searchIndex,
  branchesToIndex,
};
