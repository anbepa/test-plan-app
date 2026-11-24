import { QaDataQuery, QaDataResult } from '../../models/code-agent.model';

const WRITE_SQL = /(;|\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|merge|vacuum|lock)\b)/i;

/** Consultas válidas de la respuesta de la IA (mismas reglas que el backend y el stage). */
export function parseQaDataQueries(text: string): QaDataQuery[] {
  const json = (text || '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  let parsed: any;
  try { parsed = JSON.parse(json); } catch { return []; }
  const seen = new Set<string>();
  return (Array.isArray(parsed?.queries) ? parsed.queries : [])
    .map((q: any, i: number) => ({
      id: String(q?.id || `q${i + 1}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40),
      label: String(q?.label || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      sql: String(q?.sql || '').replace(/\s+/g, ' ').trim().replace(/;\s*$/, ''),
    }))
    .filter((q: QaDataQuery) => /^(select|with)\b/i.test(q.sql) && !WRITE_SQL.test(q.sql) && q.sql.length <= 1500
      && !seen.has(q.id) && !!seen.add(q.id))
    .slice(0, 6);
}

/** Bloque que se agrega al contexto técnico para la generación. */
export function formatQaData(result: QaDataResult): string {
  const blocks = result.results.map((item) => {
    const title = `- ${item.label || item.id}`;
    if (item.error) return `${title}: sin datos (la consulta falló: ${item.error.slice(0, 140)})`;
    if (!item.rows?.length) return `${title}: no hay registros en QA que cumplan la condición (hay que crearlo).`;
    const cols = item.columns || [];
    const rows = item.rows.slice(0, 5).map((row) => '  · ' + cols.map((c, i) => `${c}=${row[i] ?? '∅'}`).join(', '));
    return [title + ':', ...rows].join('\n');
  });
  const when = result.fetchedAt ? new Date(result.fetchedAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return [
    `## Datos reales de QA`,
    `Registros existentes en la BD de QA (solo lectura${when ? `, ${when}` : ''}; datos personales enmascarados). Úsalos como datos sugeridos en "Preparar": nombra el registro por su identificador; si un dato no tiene registros, el caso lo crea. Verifica su estado antes de ejecutar.`,
    ...blocks,
  ].join('\n');
}

export function qaDataSummary(result: QaDataResult): string {
  const found = result.results.filter((r) => r.rows?.length).length;
  const rows = result.results.reduce((sum, r) => sum + (r.rows?.length || 0), 0);
  const failed = result.results.filter((r) => r.error).length;
  return `${found} de ${result.results.length} datos con registros (${rows} filas)${failed ? ` · ${failed} consulta(s) con error` : ''}`;
}
