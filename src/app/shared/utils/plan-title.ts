/**
 * Nombre del test plan a partir de una plantilla configurable
 * (Configuración > Parámetros globales).
 *
 * Marcadores:
 *   {HU}     → ID de la HU (p. ej. 7932235)
 *   {SPRINT} → número del sprint. Si el sprint se guardó como "Sprint 256",
 *              solo se toma "256" para no repetir la palabra.
 */
export const DEFAULT_PLAN_TITLE_TEMPLATE = 'TEST PLAN EVC00057_ {HU} SPRINT {SPRINT}';

export const PLAN_TITLE_PLACEHOLDERS: ReadonlyArray<{ token: string; description: string }> = [
  { token: '{HU}', description: 'ID de la HU' },
  { token: '{SPRINT}', description: 'Número del sprint' }
];

/** "Sprint 256" → "256"; "sprint-12" → "12"; "N/A" → "N/A". */
export function sprintNumber(sprint: string | null | undefined): string {
  const raw = String(sprint ?? '').trim();
  if (!raw) return '';
  const withoutWord = raw.replace(/^\s*sprint\b[\s:_-]*/i, '').trim();
  return withoutWord || raw;
}

export function buildPlanTitle(template: string | null | undefined, huId: string, sprint: string | null | undefined): string {
  const tpl = (template || '').trim() || DEFAULT_PLAN_TITLE_TEMPLATE;
  return tpl
    .replace(/\{HU\}/gi, String(huId ?? '').trim())
    .replace(/\{SPRINT\}/gi, sprintNumber(sprint))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** La plantilla debe incluir {HU} para que cada plan tenga un nombre distinto. */
export function validatePlanTitleTemplate(template: string): string | null {
  const tpl = (template || '').trim();
  if (!tpl) return null; // vacío = plantilla por defecto
  if (!/\{HU\}/i.test(tpl)) return 'La plantilla debe incluir {HU} para que cada plan tenga un nombre distinto.';
  const unknown = (tpl.match(/\{[^}]*\}/g) || []).filter(t => !/^\{(HU|SPRINT)\}$/i.test(t));
  if (unknown.length) return `Marcador no reconocido: ${unknown.join(', ')}. Usa {HU} y {SPRINT}.`;
  if (tpl.length > 150) return 'La plantilla no puede superar 150 caracteres.';
  return null;
}
