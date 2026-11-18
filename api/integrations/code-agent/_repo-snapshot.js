/**
 * Copia en memoria de un repo de GitHub en una versión (rama o commit), descargada con UNA consulta
 * (tarball). La usan search_code y read_files del agente en vez de leer archivo por archivo
 * (150–630 consultas por exploración). Vive en la instancia de la función unos minutos; las
 * peticiones simultáneas del mismo repo comparten la misma descarga. Solo guarda archivos legibles
 * (sin secretos ni generados), igual que el resto del agente.
 */
const fetch = require('node-fetch');
const zlib = require('zlib');
const { CodeAgentError, isReadableFile } = require('./_azure-repos-core.js');
const { tarEntries } = require('./_code-index.js');

const TTL_MS = 10 * 60_000;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_FILE_BYTES = 400 * 1024;
const cache = new Map();     // clave -> { at, bytes, files: Map<ruta, texto> }
const inflight = new Map();  // clave -> Promise

const keyOf = (owner, repo, ref) => `${owner}/${repo}@${ref}`;

function evict() {
  let total = 0;
  const entries = [...cache.entries()].sort((a, b) => b[1].at - a[1].at);
  for (const [key, value] of entries) {
    total += value.bytes;
    if (total > MAX_TOTAL_BYTES || Date.now() - value.at > TTL_MS) cache.delete(key);
  }
}

/** Archivos ya descargados de repo@ref, o null (no descarga nada). */
function peek(owner, repo, ref) {
  const hit = cache.get(keyOf(owner, repo, ref));
  return hit && Date.now() - hit.at < TTL_MS ? hit.files : null;
}

async function download(token, owner, repo, ref) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.GITHUB_TARBALL_TIMEOUT_MS || 40000));
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'test-plan-app-code-agent' },
      signal: controller.signal,
    });
    if (response.status === 404) throw new CodeAgentError(404, `No existe ${repo}@${ref} o el token no tiene acceso.`);
    if (response.status === 401) throw new CodeAgentError(401, 'Token de GitHub inválido, vencido o revocado.');
    if (response.status === 403 || response.status === 429) throw new CodeAgentError(429, 'Se alcanzó el límite de consultas de GitHub. Intenta de nuevo en unos minutos.');
    if (!response.ok) throw new CodeAgentError(502, `GitHub respondió ${response.status} al descargar ${repo}.`);
    const files = new Map();
    let bytes = 0;
    for (const entry of tarEntries(zlib.gunzipSync(await response.buffer()))) {
      const path = '/' + entry.path.split('/').slice(1).join('/');
      if (path === '/' || entry.data.length > MAX_FILE_BYTES || !isReadableFile(path)) continue;
      const text = entry.data.toString('utf8');
      files.set(path, text);
      bytes += text.length;
    }
    return { at: Date.now(), bytes, files };
  } catch (error) {
    if (error instanceof CodeAgentError) throw error;
    throw new CodeAgentError(504, `No se pudo descargar ${repo}: ${error && error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Archivos legibles de repo@ref (descarga una vez y reutiliza). */
async function getSnapshot(token, owner, repo, ref) {
  const key = keyOf(owner, repo, ref);
  const files = peek(owner, repo, ref);
  if (files) return files;
  if (!inflight.has(key)) {
    inflight.set(key, download(token, owner, repo, ref)
      .then((snapshot) => { cache.set(key, snapshot); evict(); return snapshot.files; })
      .finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

module.exports = { getSnapshot, peek };
