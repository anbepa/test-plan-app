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
- Criterio: un resultado verificable propio (verbo: debe mostrar, no debe, permite, valida, calcula, envía…). Cada viñeta con su propio resultado esperado es candidata a criterio, aunque esté anidada bajo otra; se fusiona con otra cuando las reglas de abajo lo indican.
- Opción: viñeta que solo nombra un valor, tipo o pantalla sin resultado propio (p. ej. "Descuento por pronto pago"). Va en "options" del criterio al que pertenece.
- Resumen: frase que repite lo que ya exigen otros criterios sin agregar condición ni resultado nuevo. Va en "summaries" con los ids que resume. También lo son las frases sobre qué verificar para certificar ("para la certificación se debe verificar que…") cuando lo que piden ya está en otros criterios.
- Definición: texto que explica qué significa un término, tipo o estado, o cómo y quién lo origina en el negocio (p. ej. "Cliente inactivo: el que no registra movimientos en 90 días"), sin pedir un resultado al sistema de esta HU. No es un criterio: va en "definitions" y sirve para preparar los datos de prueba. Si la definición contiene además un resultado que esta HU debe producir, ese resultado sí es criterio.

MÉTODO (en este orden):
1. Reconstruye el recorrido funcional: las etapas por las que pasa el usuario (acceso o ruta, pantalla de entrada, consulta o validación, resultados, ventana o pop-up, confirmación o creación, proceso automático). Cada grupo de la respuesta es una etapa del recorrido, en ese orden; usa los encabezados del funcional solo si coinciden con una etapa. Un mismo requisito que el funcional repite en dos secciones va una sola vez, en su etapa.
2. Dentro de cada etapa, agrupa lo que se verifica en la MISMA ejecución (mismo disparo, misma pantalla o misma acción): eso es un criterio; lo demás son sus opciones.
3. Aplica las reglas de abajo y la prueba final.
4. Revisa ambigüedades y contradicciones y anótalas en "note" del criterio afectado.

REGLAS PARA DECIDIR CRITERIO, OPCIÓN O RESUMEN:
- Un criterio es UN resultado verificable con su propio disparo. Dos frases son criterios distintos solo si se prueban con ejecuciones distintas (otra pantalla, otra acción u otros datos que cambian el resultado).
- Positivo y negativo de la misma regla son UN criterio (p. ej. "habilitado solo en X" y "bloqueado en Y"; "se permite con A" y "no se permite con B"): el negativo va en "options".
- Una validación y lo que pasa cuando falla (mensaje, bloqueo, detener el proceso) son UN criterio, aunque el funcional las escriba en viñetas separadas.
- Las ramas de una misma validación (p. ej. "si no tiene registros → mensaje" y "si tiene → continúa") son UN criterio con una opción por rama.
- Abrir una ventana y su título, o un subtítulo y la sección que encabeza, son UN criterio.
- Las características de un mismo campo (valor por defecto, si es editable, texto de referencia, color) son UN criterio de ese campo. Su validación de límite es otro criterio solo si se prueba con otra acción (p. ej. intentar guardar un valor inválido).
- La misma regla aplicada en varias pantallas (p. ej. un formato de moneda en la tabla y en el pop-up) es UN criterio; cada pantalla va en "options".
- Enumeraciones (columnas, campos, botones, opciones de un selector, tamaños de página, estados permitidos, formatos por moneda) son "options" de su criterio, una por elemento, nunca criterios aparte.
- Una frase general que repite lo que ya exigen criterios más específicos es un resumen ("summaries"), no un criterio.
- Una frase que explica CÓMO se cumple otro criterio (por qué tipo, ruta o módulo se gestiona cada parte) va en "options" de ese criterio, con el formato "parte → opción".
- Una tabla (filas × columnas con marcas) es UN criterio por tabla o caso de negocio: sus celdas van en "options" con el formato "fila → columnas marcadas", y las filas sin marca como "fila → ninguna (no aplica)". Las celdas vacías también son requisito: lo que no aplica no debe ocurrir.
- Las frases de contexto ("Actualmente el pop-up se ve así") y los marcadores de imagen no son criterios.
- Si dudas entre criterio y opción, decide por la ejecución: si se verifica en la misma ejecución que otro criterio, es opción de ese criterio.
- El texto de cada criterio debe entenderse solo: empieza siempre por su sujeto (pantalla, módulo, tipo o campo), tomado de la viñeta o del grupo (p. ej. "Devoluciones ME: mostrar solo registros en USD de productos de ME").
- Numera los criterios CA-01, CA-02… en el orden del recorrido, de forma continua entre grupos.

AMBIGÜEDADES (obligatorio revisarlas; van en "note" del criterio afectado, en una frase que termina en pregunta para el funcional):
- Contradicciones entre criterios (p. ej. uno limita a una moneda y otro muestra o formatea otra).
- Patrón que no coincide con su ejemplo (p. ej. formato sin decimales con un ejemplo con decimales).
- Términos no definidos que deciden el resultado (p. ej. "activas", "vigentes"): si otro criterio permite deducirlos, escribe la deducción y pide confirmación.
- Condiciones sin definir: valor vacío, cero o negativo; si la habilitación exige uno o todos los campos; si el bloqueo es al escribir o al guardar; si un error detiene todo el lote o solo ese registro.
- Resultado exitoso no descrito (qué pasa cuando todo está bien al final del flujo).
- Criterios que dependen de una imagen de la HU.
- Sin ambigüedad, "note" va vacío.

PRUEBA FINAL (aplícala antes de responder): cada criterio tendrá un escenario de prueba propio. Corrige la lista hasta que todas estas comprobaciones se cumplan:
1. Ningún par de criterios seguidos se verifica en la misma ejecución. Revisa especialmente: las dos ramas de una validación ("si no tiene… / si sí tiene…"), un título y la ventana o sección que encabeza, un subtítulo y la tabla que lo sigue, los filtros de una pantalla y su encabezado, una acción y lo que muestra al ejecutarse. Si se verifican juntos, fusiónalos (el segundo pasa a "options").
2. Ningún campo de una pantalla o ventana es un criterio aparte cuando solo dice qué dato muestra ("el campo X mostrará/recuperará Y"): todos esos campos son "options" de un único criterio "campos de <pantalla>".
3. Ninguna regla aparece dos veces para pantallas distintas (formatos, validaciones o textos iguales en la tabla y en el pop-up): queda una vez, con cada pantalla en "options".
4. Ninguna enumeración quedó como criterios separados.
5. Cada frase general que otros criterios ya verifican por completo está en "summaries" (p. ej. "no mezclar A con B" cuando otra regla ya obliga a elegir solo uno).
6. Contradicciones: compara cada restricción de valores (moneda, estado, producto, tipo, rango) con las columnas, formatos, opciones y ejemplos de TODOS los demás criterios, también de otras etapas. Si un criterio limita a un valor y otro muestra, formatea o permite otro, anótalo en "note" de ambos criterios.
7. Cada ambigüedad de la sección AMBIGÜEDADES que aplique tiene su "note".

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
/**
 * Criterios limpios en una línea cada uno ("CA-01: texto [Opciones: …]"), con
 * sus IDs reales. Títulos, interpretaciones y definiciones no son criterios.
 * Devuelve [] si el texto no está normalizado.
 */
export function compactNormalizedCriteria(text: string): string[] {
  const out: string[] = [];
  for (const line of (text || '').split('\n')) {
    const crit = line.match(/^\s*-\s*\*\*(CA-\d{2,})\*\*\s+(.*)$/);
    if (crit) { out.push(`${crit[1]}: ${crit[2].trim()}`); continue; }
    const opts = line.match(/^\s+-\s*Opciones:\s*(.*)$/i);
    if (opts && out.length) out[out.length - 1] += ` [Opciones: ${opts[1].trim()}]`;
  }
  return out;
}

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
