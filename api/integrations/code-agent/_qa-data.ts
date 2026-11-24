/**
 * Datos reales de QA para el generador: consultas SELECT de solo lectura que corre
 * el stage "BD_CONSULTA" de un release de Azure DevOps (agente dentro de la red del
 * banco, con las variables de conexión a la BD). La app nunca se conecta a la BD.
 *
 *   POST qa-data/start   { queries: [{ id, label, sql }], force? }
 *        -> { status: 'done', cached, result } | { status: 'running', releaseId, key }
 *   GET  qa-data/status?releaseId&key
 *        -> { status: 'running' } | { status: 'done', result } | { status: 'error', message }
 *
 * Flujo: las consultas se suben a Storage (URL firmada de lectura = QUERIES_URL) y se
 * firma una URL de subida para el resultado (RESULT_URL). Se crea el release sin
 * desplegar ningún stage y se inicia solo BD_CONSULTA. Mismo resultado durante
 * CACHE_HOURS = sin release nuevo.
 */
import { createHash } from 'crypto';
import { ApiError, getSupabaseClients } from '../azure-devops/_shared';
import { resolveAzureSerenityRuntimeConfig } from '../serenity/_shared';

const BUCKET = 'execution-evidence';
const CACHE_HOURS = 6;
const MAX_QUERIES = 8;
const MAX_SQL_LENGTH = 1500;
const MAX_ROWS_RETURNED = 5;

export interface QaDataQuery { id: string; label?: string; sql: string; }
export interface QaDataResultItem { id: string; label?: string; columns?: string[]; rows?: (string | null)[][]; error?: string; }
export interface QaDataResult { fetchedAt: string | null; results: QaDataResultItem[]; }

function definitionId(): number {
  return Number(process.env['AZURE_QA_DATA_RELEASE_DEFINITION_ID'] || 16731);
}
function stageName(): string {
  return String(process.env['AZURE_QA_DATA_STAGE'] || 'BD_CONSULTA');
}

/** Misma validación que el stage: una sola sentencia SELECT/WITH, sin escritura ni ';'. */
export function validateQueries(input: unknown): QaDataQuery[] {
  if (!Array.isArray(input) || !input.length) throw new ApiError(400, 'No hay consultas para ejecutar.');
  if (input.length > MAX_QUERIES) throw new ApiError(400, `Máximo ${MAX_QUERIES} consultas por HU.`);
  const seen = new Set<string>();
  return input.map((raw: any, index) => {
    const id = String(raw?.id || `q${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    const sql = String(raw?.sql || '').replace(/\s+/g, ' ').trim();
    const lower = sql.toLowerCase();
    if (!sql || sql.length > MAX_SQL_LENGTH) throw new ApiError(400, `La consulta ${id} está vacía o es muy larga.`);
    if (!/^(select|with)\b/.test(lower)) throw new ApiError(400, `La consulta ${id} no es un SELECT.`);
    if (/(;|\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|merge|vacuum|lock)\b)/.test(lower)) {
      throw new ApiError(400, `La consulta ${id} contiene sentencias de escritura o ';'.`);
    }
    if (seen.has(id)) throw new ApiError(400, `Consulta repetida: ${id}.`);
    seen.add(id);
    return { id, label: String(raw?.label || '').replace(/\s+/g, ' ').trim().slice(0, 160) || undefined, sql };
  });
}

const SENSITIVE_COLUMN = /(nit|document|documento|identif|cedula|name|nombre|razon|email|correo|phone|telefono|celular|address|direccion|account_number|cuenta_bancaria)/i;
/** Datos personales enmascarados: se conservan inicio y fin para reconocer el registro. */
export function maskValue(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  const keep = value.length <= 8 ? 2 : 3;
  return value.slice(0, keep) + '*'.repeat(Math.max(3, value.length - keep - 2)) + value.slice(-2);
}
export function maskResult(raw: any, queries: QaDataQuery[] = [], fetchedAt: string | null = null): QaDataResult {
  const labels = new Map(queries.map((q) => [q.id, q.label]));
  const results: QaDataResultItem[] = (Array.isArray(raw?.results) ? raw.results : []).map((item: any) => {
    const id = String(item?.id || '');
    if (item?.error) return { id, label: labels.get(id) || item.label, error: String(item.error).slice(0, 300) };
    const columns: string[] = Array.isArray(item?.columns) ? item.columns.map(String) : [];
    const sensitive = columns.map((column) => SENSITIVE_COLUMN.test(column));
    const rows = (Array.isArray(item?.rows) ? item.rows : []).slice(0, MAX_ROWS_RETURNED).map((row: any[]) =>
      columns.map((_, i) => (row?.[i] == null ? null : sensitive[i] ? maskValue(String(row[i])) : String(row[i]).slice(0, 120))));
    return { id, label: labels.get(id) || item.label, columns, rows };
  });
  return { fetchedAt: fetchedAt || raw?.fetchedAt || null, results };
}

function paths(userId: string, key: string) {
  const dir = `qa-data/${userId}`;
  return { dir, queries: `${dir}/${key}-queries.tsv`, meta: `${dir}/${key}-queries.json`, result: `${dir}/${key}.json`, resultName: `${key}.json` };
}

async function readJson(path: string): Promise<any | null> {
  const { adminClient } = getSupabaseClients();
  const { data, error } = await adminClient.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}

/** Resultado guardado y su fecha (null si no existe o venció). */
async function cachedResult(userId: string, key: string, maxAgeHours: number): Promise<{ raw: any; updatedAt: string } | null> {
  const { adminClient } = getSupabaseClients();
  const p = paths(userId, key);
  const { data } = await adminClient.storage.from(BUCKET).list(p.dir, { search: p.resultName, limit: 5 });
  const file = (data || []).find((f: any) => f.name === p.resultName);
  if (!file) return null;
  const updatedAt = String((file as any).updated_at || (file as any).created_at || '');
  if (maxAgeHours > 0 && updatedAt && Date.now() - new Date(updatedAt).getTime() > maxAgeHours * 3600_000) return null;
  const raw = await readJson(p.result);
  return raw ? { raw, updatedAt } : null;
}

function azureAuth(pat: string): string {
  return 'Basic ' + Buffer.from(':' + pat).toString('base64');
}
async function azureJson(method: string, url: string, pat: string, body?: unknown): Promise<any> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: azureAuth(pat), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    if (response.status === 401) throw new ApiError(401, 'El PAT de Azure DevOps está vencido o fue revocado. Actualízalo en Configuración > Azure DevOps.');
    if (response.status === 403) throw new ApiError(403, 'El PAT de Azure DevOps no tiene permiso Release (Read, write & execute).');
    throw new ApiError(502, `Azure DevOps rechazó la consulta de datos (HTTP ${response.status})${data?.message ? `: ${data.message}` : '.'}`);
  }
  return data;
}

async function runtime(headers: Record<string, string | string[] | undefined>) {
  const config = await resolveAzureSerenityRuntimeConfig(headers);
  if (!config?.azureOrganization || !config.azureProject) {
    throw new ApiError(400, 'Falta la configuración de Azure DevOps (organización y proyecto de Serenity) para consultar datos de QA.');
  }
  if (!config.personalAccessToken) throw new ApiError(400, 'No hay PAT de Azure DevOps: configúralo en Configuración > Azure DevOps.');
  const base = `https://vsrm.dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_apis/release`;
  return { base, pat: config.personalAccessToken };
}

export async function startQaData(userId: string, headers: Record<string, string | string[] | undefined>, body: any) {
  const queries = validateQueries(body?.queries);
  const key = createHash('sha256').update(JSON.stringify(queries.map((q) => [q.id, q.sql]))).digest('hex').slice(0, 24);

  if (!body?.force) {
    const cached = await cachedResult(userId, key, CACHE_HOURS);
    if (cached) return { status: 'done', cached: true, key, result: maskResult(cached.raw, queries, cached.updatedAt) };
  }

  const { adminClient } = getSupabaseClients();
  const p = paths(userId, key);
  const tsv = queries.map((q) => `${q.id}\t${q.sql}`).join('\n') + '\n';
  const up = await adminClient.storage.from(BUCKET).upload(p.queries, tsv, { contentType: 'text/plain', upsert: true });
  if (up.error) throw new ApiError(502, 'No se pudieron guardar las consultas.');
  await adminClient.storage.from(BUCKET).upload(p.meta, JSON.stringify(queries), { contentType: 'application/json', upsert: true });
  await adminClient.storage.from(BUCKET).remove([p.result]);
  const read = await adminClient.storage.from(BUCKET).createSignedUrl(p.queries, 3600);
  const write = await adminClient.storage.from(BUCKET).createSignedUploadUrl(p.result, { upsert: true });
  if (read.error || !read.data?.signedUrl || write.error || !write.data?.signedUrl) throw new ApiError(502, 'No se pudieron firmar las URLs de intercambio.');

  const { base, pat } = await runtime(headers);
  const definition = await azureJson('GET', `${base}/definitions/${definitionId()}?api-version=7.1`, pat);
  const stages: string[] = (definition?.environments || []).map((env: any) => env.name);
  if (!stages.includes(stageName())) throw new ApiError(400, `La definición ${definitionId()} no tiene el stage ${stageName()}.`);

  // Ningún stage se despliega solo; luego se inicia únicamente BD_CONSULTA.
  const release = await azureJson('POST', `${base}/releases?api-version=7.1`, pat, {
    definitionId: definitionId(),
    description: `Datos QA para el generador (${key})`,
    manualEnvironments: stages,
    variables: { QUERIES_URL: { value: read.data.signedUrl }, RESULT_URL: { value: write.data.signedUrl } },
  });
  const env = (release?.environments || []).find((e: any) => e.name === stageName());
  if (!release?.id || !env) throw new ApiError(502, 'Azure DevOps no devolvió el release creado.');
  await azureJson('PATCH', `${base}/releases/${release.id}/environments/${env.id}?api-version=7.1-preview.6`, pat, {
    status: 'inProgress', comment: 'Consulta de datos QA (solo lectura)',
  });
  return { status: 'running', releaseId: release.id, key };
}

export async function qaDataStatus(userId: string, headers: Record<string, string | string[] | undefined>, query: any) {
  const key = String(query?.key || '').replace(/[^a-f0-9]/g, '').slice(0, 24);
  const releaseId = Number(query?.releaseId || 0);
  if (!key || !releaseId) throw new ApiError(400, 'Faltan releaseId o key.');

  const p = paths(userId, key);
  const result = await readJson(p.result);
  if (result) {
    const queries = (await readJson(p.meta)) || [];
    return { status: 'done', key, result: maskResult(result, queries, new Date().toISOString()) };
  }

  const { base, pat } = await runtime(headers);
  const release = await azureJson('GET', `${base}/releases/${releaseId}?api-version=7.1`, pat);
  const env = (release?.environments || []).find((e: any) => e.name === stageName());
  const status = String(env?.status || '');
  if (['rejected', 'canceled', 'partiallySucceeded', 'succeeded'].includes(status)) {
    const issues: string[] = [];
    for (const step of env?.deploySteps || []) for (const phase of step.releaseDeployPhases || []) for (const job of phase.deploymentJobs || []) {
      for (const task of job.tasks || []) for (const issue of task.issues || []) if (issue.issueType === 'Error' && issue.message) issues.push(issue.message);
    }
    // succeeded sin resultado: la subida pudo tardar; se informa solo si sigue faltando.
    if (status === 'succeeded') return { status: 'running', stage: status };
    return { status: 'error', message: issues[0] ? `La consulta en Azure falló: ${issues[0]}` : `El stage ${stageName()} terminó en estado ${status}.` };
  }
  return { status: 'running', stage: status || 'pending' };
}
