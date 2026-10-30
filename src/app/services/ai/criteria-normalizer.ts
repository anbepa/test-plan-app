/**
 * Normalización de criterios de aceptación (sin dependencias de Angular).
 *
 * El funcional escribe los criterios con viñetas, anidados o en párrafos. Un
 * paso de IA los separa en criterios verificables (CA-xx), y este módulo
 * arma con esa respuesta una lista numerada y estable que usan el juez y la
 * generación: cada CA-xx debe tener al menos un escenario propio.
 */

export const CRITERIA_NORMALIZATION_SYSTEM = `
Eres un analista QA Senior. Conviertes los criterios de aceptación que escribió un funcional en una lista de criterios verificables. No inventas ni omites requisitos y conservas las palabras del funcional (solo quitas muletillas). Respondes solo con JSON válido.

UNIDADES:
- Grupo: encabezado que introduce una lista (p. ej. "Al ingresar al menú X, el sistema deberá:"). No es un criterio: da contexto a los criterios que contiene.
- Criterio: un resultado verificable propio (verbo: debe mostrar, no debe, permite, valida, calcula, envía…). Cada viñeta con su propio resultado esperado es un criterio aparte, aunque esté anidada bajo otra.
- Opción: viñeta que solo nombra un valor, tipo o pantalla sin resultado propio (p. ej. "Descuento por pronto pago"). Va en "options" del criterio al que pertenece.
- Resumen: frase que repite lo que ya exigen otros criterios sin agregar condición ni resultado nuevo. Va en "summaries" con los ids que resume. También lo son las frases sobre qué verificar para certificar ("para la certificación se debe verificar que…") cuando lo que piden ya está en otros criterios.
- Definición: texto que explica qué significa un término, tipo o estado, o cómo y quién lo origina en el negocio (p. ej. "Cliente inactivo: el que no registra movimientos en 90 días"), sin pedir un resultado al sistema de esta HU. No es un criterio: va en "definitions" y sirve para preparar los datos de prueba. Si la definición contiene además un resultado que esta HU debe producir, ese resultado sí es criterio.

REGLAS:
- Una frase con dos resultados independientes (p. ej. "muestra solo USD y no muestra las comisiones") son dos criterios.
- Un encabezado con resultado propio es criterio solo si sus viñetas no cubren ese resultado.
- Frases que describen el mismo resultado con otras palabras (p. ej. "no se puede consolidar ni cruzar" y "se debe dividir en dos procesos independientes") son UN criterio.
- Una frase que solo explica CÓMO se cumple otro criterio (por qué tipo, ruta o módulo se gestiona cada parte) no es un criterio aparte: va en "options" de ese criterio, con el formato "parte → opción" (p. ej. "persona natural → Solicitud web, Oficina").
- Una frase general que repite lo que ya exigen criterios más específicos (p. ej. "cada módulo muestra solo la moneda que le corresponde" cuando ya hay un criterio por módulo) es un resumen, no un criterio.
- Las frases de contexto ("Actualmente el pop-up se ve así") y los marcadores de imagen no son criterios; si un criterio depende de una imagen, dilo en "note".
- Una tabla (filas × columnas con marcas) es UN criterio por tabla o caso de negocio: sus celdas van en "options" con el formato "fila → columnas marcadas", y las filas sin marca como "fila → ninguna (no aplica)". Las celdas vacías también son requisito: lo que no aplica no debe ocurrir.
- Si dudas entre criterio y opción, elige criterio (más cobertura) y explica la duda en "note". Sin duda, "note" va vacío.
- El texto de cada criterio debe entenderse solo: empieza siempre por su sujeto (pantalla, módulo, tipo o campo), tomado de la viñeta o del grupo (p. ej. "Devoluciones ME: mostrar solo registros en USD de productos de ME").
- Numera los criterios CA-01, CA-02… en el orden del texto, de forma continua entre grupos.

PRUEBA FINAL (aplícala antes de responder): cada criterio tendrá un escenario de prueba propio.
- Para cada par de criterios del mismo grupo: si el escenario que verifica uno verifica también el otro con los mismos datos y el mismo resultado esperado, son el mismo criterio: fusiónalos en uno.
- Para cada criterio general: si los escenarios de otros criterios ya lo verifican por completo, pásalo a "summaries".

FORMATO:
{"groups":[{"title":"encabezado o vacío","criteria":[{"id":"CA-01","text":"…","options":["…"],"note":""}],"summaries":[{"text":"…","covers":["CA-01"]}]}],"definitions":[{"term":"…","text":"…"}]}`;

export const CRITERIA_NORMALIZATION_USER = (description: string, acceptanceCriteria: string): string => `
HISTORIA DE USUARIO (contexto, no es criterio):
${description?.trim() || 'No proporcionada.'}

CRITERIOS DE ACEPTACIÓN TAL COMO LOS ESCRIBIÓ EL FUNCIONAL:
${acceptanceCriteria.trim()}`;

interface RawCriterion { id?: string; text?: string; options?: string[]; note?: string }
interface RawGroup { title?: string; criteria?: RawCriterion[]; summaries?: { text?: string; covers?: string[] }[] }

export interface NormalizedCriterion { id: string; text: string; options: string[]; note: string }
export interface NormalizedGroup {
  title: string;
  criteria: NormalizedCriterion[];
  summaries: { text: string; covers: string[] }[];
  /** Glosario del funcional (qué es y cómo se origina cada término): guía para preparar datos, no son criterios. */
  definitions?: { term: string; text: string }[];
}

export const DEFINITIONS_TITLE = 'Definiciones (para preparar datos de prueba; no son criterios)';

const CRITERION_LINE = /^\s*-\s*\*\*(CA-\d{2,})\*\*\s/;

/** true si el texto ya es una lista normalizada (no se vuelve a interpretar). */
export function isNormalizedCriteria(text: string): boolean {
  return (text || '').split('\n').some((line) => CRITERION_LINE.test(line));
}

/** Ids CA-xx de una lista normalizada, en orden. */
export function criteriaIds(text: string): string[] {
  return (text || '').split('\n').map((line) => line.match(CRITERION_LINE)?.[1]).filter((id): id is string => !!id);
}

/** Lee la respuesta del modelo; renumera de forma continua para que los ids sean estables. */
export function parseNormalizedCriteria(raw: string): NormalizedGroup[] {
  let data: { groups?: RawGroup[]; definitions?: { term?: string; text?: string }[] };
  try {
    data = JSON.parse(String(raw || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    return [];
  }
  const renumber = new Map<string, string>();
  let next = 1;
  const groups = (data.groups || []).map((group) => ({
    title: String(group.title || '').trim().replace(/:\s*$/, ''),
    criteria: (group.criteria || []).filter((criterion) => String(criterion.text || '').trim()).map((criterion) => {
      const id = `CA-${String(next++).padStart(2, '0')}`;
      if (criterion.id) renumber.set(criterion.id, id);
      return {
        id,
        text: String(criterion.text).trim(),
        options: (criterion.options || []).map((option) => String(option).trim()).filter(Boolean),
        note: String(criterion.note || '').trim(),
      };
    }),
    summaries: (group.summaries || []).filter((summary) => String(summary.text || '').trim()).map((summary) => ({
      text: String(summary.text).trim(),
      covers: (summary.covers || []).map((id) => renumber.get(id) || id),
    })),
  }));
  const definitions = (data.definitions || [])
    .map((item) => ({ term: String(item.term || '').trim(), text: String(item.text || '').trim() }))
    .filter((item) => item.text);
  const result: NormalizedGroup[] = groups.filter((group) => group.criteria.length || group.summaries.length);
  if (definitions.length) result.push({ title: DEFINITIONS_TITLE, criteria: [], summaries: [], definitions });
  return result;
}

/** Lista numerada en markdown: un CA-xx por criterio verificable. */
export function formatNormalizedCriteria(groups: NormalizedGroup[]): string {
  return groups.map((group) => [
    group.title ? `### ${group.title}` : '',
    ...group.criteria.flatMap((criterion) => [
      `- **${criterion.id}** ${criterion.text}`,
      criterion.options.length ? `  - Opciones: ${criterion.options.join('; ')}` : '',
      criterion.note ? `  - ⚠ Interpretación: ${criterion.note}` : '',
    ]),
    ...group.summaries.map((summary) => `- Resumen${summary.covers.length ? ` (se verifica en ${summary.covers.join(', ')})` : ''}: ${summary.text}`),
    ...(group.definitions || []).map((item) => `- Definición${item.term ? ` — ${item.term}` : ''}: ${item.text}`),
  ].filter(Boolean).join('\n')).join('\n\n');
}

/** Comportamientos (CAMBIO HU) que el código agrega y ningún criterio cubre: también requieren cobertura. */
export function uncoveredChangeBehaviorIds(codeContext: string): string[] {
  const section = (codeContext || '').split(/^##\s*Comportamientos del código no cubiertos[^\n]*$/m)[1]?.split(/^##\s/m)[0] || '';
  return section.split('\n').map((line) => line.match(/^\s*[-*]\s*\[(RT-\d+)\]\s*\(CAMBIO HU\)/)?.[1]).filter((id): id is string => !!id);
}

/** Criterios (o comportamientos) sin ningún escenario que los cubra. */
export function uncoveredCriteria(criteriaText: string, testCases: { coveredCriteria?: string[] }[], codeContext: string = ''): string[] {
  const covered = new Set(testCases.flatMap((testCase) => testCase.coveredCriteria || []));
  return [...criteriaIds(criteriaText), ...uncoveredChangeBehaviorIds(codeContext)].filter((id) => !covered.has(id));
}
