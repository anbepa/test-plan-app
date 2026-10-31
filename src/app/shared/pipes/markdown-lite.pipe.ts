import { Pipe, PipeTransform } from '@angular/core';

/**
 * Markdown mínimo y seguro para vistas previas (criterios y contexto técnico):
 * títulos, listas con sangría, tablas, **negrita** y `código`. El texto se
 * escapa antes de dar formato, así nunca se inyecta HTML del contenido.
 *
 * Las líneas de cobertura del agente ("- [CA-01] … → ESTADO. Detalle: …" y
 * "- [RT-01] (CAMBIO HU) …") se muestran como tabla.
 */
@Pipe({
  name: 'markdownLite',
  standalone: true,
})
export class MarkdownLitePipe implements PipeTransform {
  /** 'no-coverage': omite la matriz CA (la pantalla la muestra con estados editables). */
  transform(value: string | null | undefined, mode?: 'no-coverage'): string {
    return renderMarkdownLite(value || '', { skipCoverage: mode === 'no-coverage' });
  }
}

const STATUS_CLASS: Record<string, string> = {
  'IMPLEMENTADO': 'md-status-ok',
  'PARCIAL': 'md-status-partial',
  'DIFERENTE': 'md-status-diff',
  'SIN EVIDENCIA': 'md-status-none',
};

const CA_LINE = /^\s*[-*]\s*\[(CA-\d+)\]\s*(.*?)\s*→\s*(IMPLEMENTADO|PARCIAL|DIFERENTE|SIN EVIDENCIA)\b\.?\s*(.*)$/;
const RT_LINE = /^\s*[-*]\s*\[(RT-\d+)\]\s*(?:\((CAMBIO HU|EXISTENTE)\))?\s*(.*)$/;
const LIST_LINE = /^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/;

export function renderMarkdownLite(source: string, options: { skipCoverage?: boolean } = {}): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) { flushParagraph(); continue; }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (options.skipCoverage && heading && /cobertura de criterios/i.test(heading[2])) continue;
    if (options.skipCoverage && CA_LINE.test(line)) continue;
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (CA_LINE.test(line) || RT_LINE.test(line)) {
      flushParagraph();
      const isCa = CA_LINE.test(line);
      const block: string[] = [];
      while (i < lines.length && (isCa ? CA_LINE : RT_LINE).test(lines[i])) block.push(lines[i++]);
      i--;
      html.push(isCa ? coverageTable(block) : behaviorTable(block));
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      const block: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) block.push(lines[i++]);
      i--;
      html.push(markdownTable(block));
      continue;
    }

    if (LIST_LINE.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && LIST_LINE.test(lines[i]) && !CA_LINE.test(lines[i]) && !RT_LINE.test(lines[i])) {
        const [, indent, number, text] = lines[i].match(LIST_LINE)!;
        const depth = Math.min(Math.floor(indent.replace(/\t/g, '  ').length / 2), 4);
        const marker = number ? `<span class="md-num">${number}.</span> ` : '';
        items.push(`<li class="md-depth-${depth}${number ? ' md-ordered' : ''}">${marker}${inline(text)}</li>`);
        i++;
      }
      i--;
      html.push(`<ul class="md-list">${items.join('')}</ul>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return html.join('');
}

function coverageTable(lines: string[]): string {
  const rows = lines.map((line) => {
    const [, id, criterion, status, rest] = line.match(CA_LINE)!;
    const { detail, source } = splitSource(rest.replace(/^Detalle:\s*/i, ''));
    return `<tr><td class="md-id">${id}</td><td>${inline(criterion.replace(/^"|"$/g, ''))}</td>`
      + `<td><span class="md-status ${STATUS_CLASS[status]}">${status}</span></td>`
      + `<td>${inline(detail)}</td><td class="md-source">${sourceCell(source)}</td></tr>`;
  });
  return tableWrap('<tr><th>CA</th><th>Criterio</th><th>Estado</th><th>Detalle</th><th>Fuente</th></tr>', rows);
}

function behaviorTable(lines: string[]): string {
  const rows = lines.map((line) => {
    const [, id, kind, rest] = line.match(RT_LINE)!;
    const { detail, source } = splitSource(rest);
    const kindHtml = kind ? `<span class="md-status ${kind === 'CAMBIO HU' ? 'md-status-partial' : 'md-status-none'}">${kind}</span>` : '';
    return `<tr><td class="md-id">${id}</td><td>${kindHtml}</td><td>${inline(detail)}</td><td class="md-source">${sourceCell(source)}</td></tr>`;
  });
  return tableWrap('<tr><th>RT</th><th>Tipo</th><th>Comportamiento</th><th>Fuente</th></tr>', rows);
}

function markdownTable(lines: string[]): string {
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
  const rows = lines.filter((line) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)).map(cells);
  if (!rows.length) return '';
  const [head, ...body] = rows;
  return tableWrap(
    `<tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr>`,
    body.map((row) => `<tr>${head.map((_, i) => `<td>${inline(row[i] || '')}</td>`).join('')}</tr>`)
  );
}

function tableWrap(head: string, rows: string[]): string {
  return `<div class="md-table-wrap"><table class="md-table"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function splitSource(text: string): { detail: string; source: string } {
  const match = text.match(/^(.*?)\s*\(?\bFuentes?:\s*(.*?)\)?\s*$/i);
  return match ? { detail: match[1].replace(/[.;\s]+$/, ''), source: match[2] } : { detail: text, source: '' };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Columna Fuente: rutas largas como carpeta/…/archivo, con la ruta completa en el tooltip. */
function sourceCell(source: string): string {
  return inline(source).replace(/[\w.@-]+(?:\/[\w.@-]+){3,}/g, (path) => {
    const parts = path.split('/');
    return `<span class="md-path" title="${path}">${parts[0]}/…/${parts[parts.length - 1]}</span>`;
  });
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/⚠/g, '<span class="md-warn">⚠</span>');
}
