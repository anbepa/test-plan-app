/**
 * Lee el contexto técnico del agente (markdown con secciones fijas) y lo
 * separa en partes para mostrarlo de forma visual. Solo presentación: el texto
 * que se envía a la IA no cambia.
 */
export interface TechFlowStep { label: string; text: string; icon: string; }
export interface TechRule { id: string; change: 'CAMBIO HU' | 'EXISTENTE' | ''; text: string; code: string; source: string; }
export interface TechRuleGroup { title: string; rules: TechRule[]; }
export interface TechRecipeField { label: string; value: string; unverified: boolean; }
export interface TechRecipeItem { title: string; fields: TechRecipeField[]; unverified: number; }
export interface TechEquivalence { code: string; meaning: string; evidence: string; source: string; confirmed: boolean; }
export interface TechList { title: string; items: string[]; files: boolean; }

export interface TechContextModel {
  summary: string;
  flow: TechFlowStep[];
  ruleGroups: TechRuleGroup[];
  recipe: TechRecipeItem[];
  equivalences: TechEquivalence[];
  lists: TechList[];
  /** false si el texto no tiene la estructura del agente (se muestra como markdown). */
  structured: boolean;
}

const UNVERIFIED = /no verificable/i;
const SKIPPED = /^(cobertura de criterios|análisis)/i;

const FLOW_ICONS: [RegExp, string][] = [
  [/disparo/i, '▶'],
  [/fuente de datos/i, '🗄'],
  [/roles/i, '👤'],
  [/datos a preparar/i, '🧩'],
  [/opciones/i, '🔀'],
  [/dependencias/i, '🔌'],
  [/fuentes de la salida/i, '🔗'],
  [/salida/i, '📄'],
  [/consulta de control/i, '✔'],
];

interface Section { title: string; lines: string[]; }

function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { title: '', lines: [] };
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      if (current.title || current.lines.some((item) => item.trim())) sections.push(current);
      current = { title: heading[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.title || current.lines.some((item) => item.trim())) sections.push(current);
  return sections;
}

/** Viñetas de primer nivel; las líneas siguientes sin viñeta se unen a la anterior. */
function bullets(lines: string[]): string[] {
  const items: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const match = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (match) items.push(match[1].trim());
    else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
    else items.push(line.trim());
  }
  return items;
}

function splitLabel(item: string): { label: string; text: string } | null {
  const match = item.match(/^\**([^:*`]{2,45}?)\**\s*:\s*(.+)$/);
  return match ? { label: match[1].trim(), text: match[2].trim() } : null;
}

function parseRule(item: string): TechRule | null {
  const match = item.match(/^\[(RT-\d+)\]\s*(?:\((CAMBIO HU|EXISTENTE)\))?\s*(.*)$/);
  if (!match) return null;
  let rest = match[3];
  let source = '';
  const sourceAt = rest.search(/\s*Fuente:\s*/);
  if (sourceAt >= 0) {
    source = rest.slice(sourceAt).replace(/^\s*Fuente:\s*/, '').trim();
    rest = rest.slice(0, sourceAt);
  }
  let code = '';
  const codeAt = rest.search(/\s*Código:\s*/);
  if (codeAt >= 0) {
    code = rest.slice(codeAt).replace(/^\s*Código:\s*/, '').trim();
    rest = rest.slice(0, codeAt);
  }
  return { id: match[1], change: (match[2] as TechRule['change']) || '', text: rest.trim(), code, source };
}

function parseEquivalence(item: string): TechEquivalence | null {
  const match = item.match(/^(.+?)\s+=\s+(.+)$/);
  if (!match) return null;
  let rest = match[2];
  let source = '';
  const sourceAt = rest.search(/\s*Fuente:\s*/);
  if (sourceAt >= 0) {
    source = rest.slice(sourceAt).replace(/^\s*Fuente:\s*/, '').trim();
    rest = rest.slice(0, sourceAt);
  }
  let evidence = '';
  const evidenceAt = rest.search(/\s*Evidencia:\s*/);
  if (evidenceAt >= 0) {
    evidence = rest.slice(evidenceAt).replace(/^\s*Evidencia:\s*/, '').trim();
    rest = rest.slice(0, evidenceAt);
  }
  return {
    code: match[1].replace(/^\*+|\*+$/g, '').trim(),
    meaning: rest.replace(/\.\s*$/, '').trim(),
    evidence,
    source,
    confirmed: !/no confirmada/i.test(item),
  };
}

function parseRecipe(item: string): TechRecipeItem {
  const fields = item.split(/\s+\|\s+/).map((part) => {
    const labeled = splitLabel(part);
    const label = labeled ? labeled.label : '';
    const value = labeled ? labeled.text : part.trim();
    return { label, value, unverified: UNVERIFIED.test(value) };
  });
  const titleField = fields.find((field) => /^dato$/i.test(field.label)) || fields[0];
  const rest = fields.filter((field) => field !== titleField);
  return { title: titleField?.value || item, fields: rest, unverified: rest.filter((field) => field.unverified).length };
}

export function parseTechContext(text: string): TechContextModel {
  const model: TechContextModel = { summary: '', flow: [], ruleGroups: [], recipe: [], equivalences: [], lists: [], structured: false };
  for (const section of splitSections(text)) {
    const title = section.title;
    if (!title) {
      const body = section.lines.join('\n').trim();
      if (body) model.lists.push({ title: 'Notas', items: bullets(section.lines), files: false });
      continue;
    }
    if (SKIPPED.test(title)) continue;
    model.structured = true;
    if (/resumen técnico/i.test(title)) {
      model.summary = section.lines.join('\n').trim();
    } else if (/flujo de ejecución/i.test(title)) {
      model.flow = bullets(section.lines).map((item) => {
        const labeled = splitLabel(item) || { label: 'Paso', text: item };
        const icon = FLOW_ICONS.find(([pattern]) => pattern.test(labeled.label))?.[1] || '•';
        return { label: labeled.label, text: labeled.text, icon };
      });
    } else if (/receta de datos/i.test(title)) {
      model.recipe = bullets(section.lines).map(parseRecipe);
    } else if (/equivalencias/i.test(title)) {
      const items = bullets(section.lines);
      const parsed = items.map(parseEquivalence);
      if (parsed.every(Boolean)) model.equivalences = parsed as TechEquivalence[];
      else model.lists.push({ title, items, files: false });
    } else if (/reglas del código|comportamientos/i.test(title)) {
      const items = bullets(section.lines);
      const rules = items.map(parseRule);
      if (rules.length && rules.every(Boolean)) model.ruleGroups.push({ title, rules: rules as TechRule[] });
      else if (items.length) model.lists.push({ title, items, files: false });
    } else {
      const items = bullets(section.lines);
      if (items.length) model.lists.push({ title, items, files: /archivos revisados/i.test(title) });
    }
  }
  return model;
}
