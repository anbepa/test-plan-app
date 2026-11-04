/**
 * Límites y recorte del texto de las secciones generales del plan
 * (Fuera del Alcance, Estrategia, Limitaciones, Supuestos).
 *
 * Una sola fuente para el prompt (STATIC_SECTION_ENHANCEMENT) y para el recorte
 * que se aplica a la respuesta de la IA, de modo que la IA escriba por debajo
 * del tope y el recorte casi nunca tenga que actuar. Cuando actúa, cierra en la
 * última oración completa para no dejar ideas a medias.
 */
export interface StaticSectionLimits {
  /** Líneas máximas que se conservan. */
  maxLines: number;
  /** Caracteres máximos que se conservan (tope duro). */
  maxChars: number;
  /** Caracteres que se le piden a la IA (≈80% del tope, porque la IA no cuenta bien). */
  targetChars: number;
}

export function getStaticSectionLimits(huCount: number): StaticSectionLimits {
  let maxLines: number;
  let maxChars: number;
  if (huCount <= 3) {
    maxLines = 4; maxChars = 500;
  } else if (huCount <= 7) {
    maxLines = 6; maxChars = 750;
  } else if (huCount <= 15) {
    maxLines = 8; maxChars = 1000;
  } else {
    maxLines = 10; maxChars = 1400;
  }
  return { maxLines, maxChars, targetChars: Math.round((maxChars * 0.8) / 10) * 10 };
}

/** Recorta la respuesta de la IA a los límites sin partir palabras ni dejar frases a medias. */
export function compactStaticSectionText(content: string, huCount: number): string {
  if (!content) return '';
  const { maxLines, maxChars } = getStaticSectionLimits(huCount);

  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, maxLines);

  let compact = lines.join('\n').trim();

  if (compact.length > maxChars) {
    const slice = compact.slice(0, maxChars);
    const lastSpace = slice.lastIndexOf(' ');
    compact = (lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
  }

  return closeAtLastSentence(compact);
}

/** Cierra el texto en la última oración completa para evitar frases a medias. */
export function closeAtLastSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (/[.!?]$/.test(trimmed)) return trimmed;
  const lastPeriod = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('.\n'));
  // Solo recortar si se conserva una porción sustancial (>50%).
  if (lastPeriod > trimmed.length * 0.5) {
    return trimmed.slice(0, lastPeriod + 1).trim();
  }
  // Sin punto útil: quitar la puntuación colgante y cerrar la frase.
  const cleaned = trimmed.replace(/[\s,;:\-–—]+$/, '').replace(/\s+(y|o|e|u|de|del|con|para|por|en|la|el|los|las)$/i, '').trim();
  return cleaned ? `${cleaned}.` : cleaned;
}

/** Secciones que no deben pasar por la IA: son datos del equipo, no se deducen de las HUs. */
export function isAiEnhanceableSection(sectionName: string): boolean {
  const n = (sectionName || '').toLowerCase();
  return !(n.includes('repositorio') || n.includes('equipo'));
}
