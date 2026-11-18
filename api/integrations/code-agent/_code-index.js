/**
 * Índice de "líneas de interés" de los repos del aplicativo (GitHub) para search_app.
 *
 * Guarda, por repo (rama principal), solo las líneas que sirven para probar,
 * clasificadas: definiciones (tablas, vistas, clases, rutas), escrituras
 * (INSERT/UPDATE, save), lecturas (SELECT, @Query, find…By), endpoints y
 * constantes o mensajes. search_app responde directo desde aquí (sin leer
 * GitHub) y sin el límite de búsquedas de código de GitHub.
 *
 * Seguridad: tablas en el esquema code_index sin acceso público (solo service
 * role); nunca se indexan archivos con secretos y los valores sensibles se
 * enmascaran; los resultados se filtran por los repos que el token del usuario
 * puede ver. Construcción: un tarball por repo (zlib + lector tar mínimo).
 */
const fetch = require('node-fetch');
const zlib = require('zlib');
const { CodeAgentError, isReadableFile, redactSecrets } = require('./_azure-repos-core.js');

const MAX_FILE_BYTES = 400 * 1024;
const MAX_LINES_PER_FILE = 150;
const MAX_TEXT = 220;
const INSERT_BATCH = 1500;
const SEARCH_LIMIT = 15;          // líneas por búsqueda (todas las palabras)
const PER_FILE = 3;               // líneas por archivo en una búsqueda

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
// Clasificación de líneas
// ---------------------------------------------------------------------------

const KIND_LABEL = { def: 'definición', write: 'escritura', read: 'lectura', endpoint: 'endpoint', const: 'constante' };
const clean = (text) => redactSecrets(String(text || '')).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
const ext = (path) => (path.split('.').pop() || '').toLowerCase();
const isTestPath = (path) => /(^|\/)(test|tests|__tests__|e2e)(\/|$)|\.(spec|test)\.|Test\.(java|kt)$/i.test(path);

function layerOf(path, repo) {
  const e = ext(path);
  if (e === 'sql') return 'bd';
  if (/front/i.test(repo) || ['html', 'scss', 'css'].includes(e) || /(^|\/)src\/app\//.test(path)) return 'front';
  return 'back';
}

const SQL_OBJECT = /\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?(table|view|function|procedure|trigger|sequence)\s+(?:if\s+not\s+exists\s+)?([\w."$]+)/i;

/** Devuelve { kind, object } si la línea es de interés para probar; null si no. */
function classify(line, e) {
  const t = line.trim();
  if (t.length < 4 || t.length > 600 || /^(\/\/|\*|\/\*|--|#|import |package |@import)/.test(t)) return null;
  let m;
  const sqlish = e === 'sql' || /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b/i.test(t);
  if (sqlish) {
    if ((m = SQL_OBJECT.exec(t))) return { kind: 'def', object: m[2].replace(/"/g, '') };
    if ((m = /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][\w.]*)/i.exec(t)) && !/^update\s*\(/i.test(t)) return { kind: 'write', object: m[1] };
    if ((m = /\b(?:from|join)\s+([a-z_]\w*\.[a-z_]\w*|tbl_\w+|view_\w+)/i.exec(t))) return { kind: 'read', object: m[1] };
    if (e === 'sql' && (m = /(?:\bwhen\b|=|\bin\s*\()\s*'([^']{2,60})'/i.exec(t))) return { kind: 'const', object: m[1] };
    if (e === 'sql') return null;
  }
  if (e === 'java' || e === 'kt') {
    if ((m = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]*)"/.exec(t))) return { kind: 'endpoint', object: m[2] };
    if ((m = /@Table\s*\(\s*name\s*=\s*"([^"]+)"/.exec(t))) return { kind: 'def', object: m[1] };
    if ((m = /\b(?:public|private|protected)?\s*(?:abstract\s+|final\s+)?(class|interface|enum|record)\s+(\w+)/.exec(t))) return { kind: 'def', object: m[2] };
    if (/@Query\s*\(/.test(t)) return { kind: 'read', object: '' };
    if ((m = /\.(save|saveAll|insert|update|delete|persist|merge|executeUpdate)\s*\(/.exec(t))) return { kind: 'write', object: m[1] };
    if ((m = /\b((?:find|get|search|exists|count|read)\w*By\w*)\s*\(/.exec(t))) return { kind: 'read', object: m[1] };
    if ((m = /\bstatic\s+final\s+[\w<>,\[\]\s]+?\s+([A-Z][A-Z0-9_]{2,})\s*=\s*(.+);/.exec(t))) return { kind: 'const', object: m[1] };
    if ((m = /^([A-Z][A-Z0-9_]{1,})\s*\(\s*["\w]/.exec(t))) return { kind: 'const', object: m[1] };
    if ((m = /"([^"]*[A-Za-zÁÉÍÓÚáéíóúñÑ]+\s[^"]{6,})"/.exec(t))) return { kind: 'const', object: '' };
    return null;
  }
  if (e === 'ts' || e === 'js') {
    if ((m = /\bpath\s*:\s*['"`]([^'"`]+)['"`]/.exec(t))) return { kind: 'endpoint', object: m[1] };
    if ((m = /\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*[`'"]?([^,`'")]*)/.exec(t)) && /http|api|url|\$\{|\//i.test(t)) return { kind: m[1] === 'get' ? 'read' : 'write', object: m[2].slice(0, 80) };
    if ((m = /\bselector\s*:\s*['"]([^'"]+)['"]/.exec(t))) return { kind: 'def', object: m[1] };
    if ((m = /\bexport\s+(?:abstract\s+)?(?:class|enum|interface)\s+(\w+)/.exec(t))) return { kind: 'def', object: m[1] };
    if ((m = /\bexport\s+const\s+(\w+)\s*=/.exec(t))) return { kind: 'const', object: m[1] };
    if ((m = /^([A-Z][A-Z0-9_]{1,})\s*=\s*['"]/.exec(t))) return { kind: 'const', object: m[1] };
    if ((m = /['"`]([^'"`]*[A-Za-zÁÉÍÓÚáéíóúñÑ]+\s[^'"`]{6,})['"`]/.exec(t)) && !/\b(import|console\.)/.test(t)) return { kind: 'const', object: '' };
    return null;
  }
  if (e === 'html') {
    if ((m = /routerLink\s*=\s*"([^"]+)"/.exec(t))) return { kind: 'endpoint', object: m[1] };
    if ((m = /formControlName\s*=\s*"([^"]+)"/.exec(t))) return { kind: 'def', object: m[1] };
    if ((m = />\s*([^<>{}]*[A-Za-zÁÉÍÓÚáéíóúñÑ]{3}[^<>{}]{0,77})\s*</.exec(t))) return { kind: 'const', object: m[1].trim().slice(0, 80) };
    return null;
  }
  if (e === 'yaml' || e === 'yml' || e === 'properties') {
    if ((m = /^([\w.\-]{3,})\s*[:=]\s*(\S.*)$/.exec(t)) && !/password|secret|token|key|credential/i.test(m[1])) return { kind: 'const', object: m[1] };
    return null;
  }
  return null;
}

/** Líneas de interés de un archivo y los objetos SQL que define (para marcar migraciones viejas). */
function extractFileLines(repo, path, text) {
  const e = ext(path);
  const lines = text.split(/\r?\n/);
  const out = [];
  const defines = new Set();
  for (let i = 0; i < lines.length && out.length < MAX_LINES_PER_FILE; i++) {
    const hit = classify(lines[i], e);
    if (!hit) continue;
    if (e === 'sql' && hit.kind === 'def') defines.add(hit.object.toLowerCase());
    out.push({ line: i + 1, kind: hit.kind, object: clean(hit.object).slice(0, 120), text: clean(lines[i]) });
  }
  return { lines: out, defines, layer: layerOf(path, repo), isTest: isTestPath(path) };
}

/**
 * Descarga repo@sha y devuelve las filas a guardar. Los scripts SQL que redefinen una vista o
 * función ya redefinida en un script posterior se marcan "historic": por defecto no se devuelven.
 */
async function buildRepoRows(token, owner, repo, sha) {
  const timeoutMs = Number(process.env.GITHUB_TARBALL_TIMEOUT_MS || 40000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let buffer;
  try {
    const response = await fetch(`https://api.github.com/repos/${enc(owner)}/${enc(repo)}/tarball/${enc(sha)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'test-plan-app-code-index' },
      signal: controller.signal,
    });
    if (response.status === 404) throw new CodeAgentError(404, `No existe ${repo} o el token no tiene acceso.`);
    if (!response.ok) throw new CodeAgentError(response.status === 403 || response.status === 429 ? 429 : 502, `GitHub respondió ${response.status} al descargar ${repo}.`);
    buffer = await response.buffer();
  } catch (error) {
    if (error instanceof CodeAgentError) throw error;
    throw new CodeAgentError(504, `No se pudo descargar ${repo}: ${error && error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const files = [];
  for (const entry of tarEntries(zlib.gunzipSync(buffer))) {
    const path = '/' + entry.path.split('/').slice(1).join('/');
    if (path === '/' || entry.data.length > MAX_FILE_BYTES || !isReadableFile(path)) continue;
    const result = extractFileLines(repo, path, entry.data.toString('utf8'));
    if (result.lines.length) files.push({ path, ...result });
  }

  // Última definición de cada objeto SQL = el script de nombre mayor (los scripts llevan fecha al inicio).
  const latestByObject = new Map();
  const base = (path) => path.split('/').pop().toLowerCase();
  for (const file of files) {
    for (const object of file.defines) {
      const current = latestByObject.get(object);
      if (!current || base(file.path) > base(current)) latestByObject.set(object, file.path);
    }
  }
  const rows = [];
  for (const file of files) {
    const historic = file.defines.size > 0 && [...file.defines].every((object) => latestByObject.get(object) !== file.path);
    for (const line of file.lines) {
      rows.push({ path: file.path, line: line.line, kind: line.kind, object: line.object, text: line.text, layer: file.layer, is_test: file.isTest, historic });
    }
  }
  return { rows, files: files.length, compressedBytes: buffer.length };
}

// ---------------------------------------------------------------------------
// Supabase (service role) y GitHub
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;

async function rpc(db, name, params) {
  const { data, error } = await db.rpc(name, params);
  if (error) throw new CodeAgentError(500, `Índice de código: ${error.message}`);
  return data;
}

async function fetchJson(token, path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'test-plan-app-code-index' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new CodeAgentError(response.status === 401 ? 401 : response.status === 403 || response.status === 429 ? 429 : 502, `GitHub respondió ${response.status} (${path}).`);
  return response.json();
}

/** Indexa la rama principal de un repo (una llamada por repo para no pasar los 60 s de Vercel). */
async function indexRepo(db, token, owner, repo) {
  const info = await fetchJson(token, `/repos/${enc(owner)}/${enc(repo)}`);
  if (!info) throw new CodeAgentError(404, `No existe ${repo} o el token no tiene acceso.`);
  const head = await fetchJson(token, `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(info.default_branch)}`);
  const sha = head && head.commit && head.commit.sha;
  if (!sha) return { results: [{ repo, skipped: 'sin rama principal' }] };
  const started = Date.now();
  const { rows, files, compressedBytes } = await buildRepoRows(token, owner, repo, sha);
  const runId = `${sha.slice(0, 12)}-${started}`;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await rpc(db, 'code_index_insert_lines', { p_owner: owner, p_repo: repo, p_run_id: runId, p_lines: rows.slice(i, i + INSERT_BATCH) });
  }
  await rpc(db, 'code_index_finish_repo', { p_owner: owner, p_repo: repo, p_branch: info.default_branch, p_run_id: runId, p_head_sha: sha, p_lines: rows.length });
  return { results: [{ repo, branch: info.default_branch, sha, files, lines: rows.length, compressedBytes, ms: Date.now() - started }] };
}

/** Repos del aplicativo que faltan o cuya rama principal cambió desde la última indexación. */
async function indexPlan(db, token, owner, prefixes, repos) {
  const rows = await rpc(db, 'code_index_status', { p_owner: owner, p_prefixes: prefixes });
  const indexed = new Map(rows.map((row) => [row.repo, row]));
  const pending = [];
  for (const repo of repos) {
    const row = indexed.get(repo);
    if (!row) { pending.push({ repo, reason: 'sin indexar' }); continue; }
    const head = await fetchJson(token, `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(row.branch)}`).catch(() => null);
    if (head && head.commit && head.commit.sha !== row.head_sha) pending.push({ repo, reason: `${row.branch} cambió` });
  }
  return { indexedRepos: indexed.size, files: rows.reduce((sum, row) => sum + (row.lines || 0), 0),
    lastIndexedAt: rows.map((row) => row.indexed_at).filter(Boolean).sort().pop() || null, pending };
}

/**
 * Líneas para los términos, solo de repos visibles para el usuario. null si el índice no tiene
 * repos de esos prefijos (se usa la búsqueda de GitHub). Máx. SEARCH_LIMIT líneas y PER_FILE por archivo,
 * repartidas entre los términos.
 */
async function searchIndex(db, owner, prefixes, terms, visibleRepos) {
  const status = await rpc(db, 'code_index_status', { p_owner: owner, p_prefixes: prefixes });
  if (!status.length) return null;
  const allowed = status.map((row) => row.repo).filter((repo) => !visibleRepos || visibleRepos.has(repo));
  if (!allowed.length) return [];
  const perTerm = await Promise.all(terms.map((term) => rpc(db, 'code_index_search', { p_owner: owner, p_repos: allowed, p_term: term, p_limit: 60 })));
  const picked = [];
  const seen = new Set();
  const perFile = new Map();
  // Reparto por turnos entre términos para que ninguno acapare el cupo.
  for (let round = 0; picked.length < SEARCH_LIMIT && round < 60; round++) {
    let added = false;
    for (const rows of perTerm) {
      const row = rows[round];
      if (!row) continue;
      added = true;
      const key = `${row.repo}|${row.path}|${row.line}`;
      const fileKey = `${row.repo}|${row.path}`;
      if (seen.has(key) || (perFile.get(fileKey) || 0) >= PER_FILE) continue;
      seen.add(key);
      perFile.set(fileKey, (perFile.get(fileKey) || 0) + 1);
      picked.push({ repositoryName: row.repo, branch: row.branch, path: row.path, line: row.line,
        text: `[${KIND_LABEL[row.kind] || row.kind}${row.layer ? ' · ' + row.layer : ''}] ${row.text}` });
      if (picked.length >= SEARCH_LIMIT) break;
    }
    if (!added) break;
  }
  return picked;
}

module.exports = { classify, extractFileLines, buildRepoRows, tarEntries, indexRepo, indexPlan, searchIndex, KIND_LABEL };
