import { Injectable } from '@angular/core';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
import { PlanExecution, TestRun, TestCaseExecution } from '../../models/hu-data.model';

/** A single step inside a Gherkin scenario. */
interface BundleStep { keyword: string; text: string; }
/** A Gherkin scenario derived from a manual test case. */
interface BundleScenario { name: string; type: string; tags: string[]; description?: string[]; steps: BundleStep[]; }

/**
 * Advertencias que la IA antepone a las precondiciones ("⚠ Implementación
 * parcial: …"). No son precondiciones: van como etiqueta filtrable en el
 * reporte y como descripción/nota del escenario.
 */
const WARNING_TAGS: { pattern: RegExp; tag: string }[] = [
  { pattern: /^implementaci[oó]n parcial/i, tag: '@implementacion-parcial' },
  { pattern: /^discrepancia/i, tag: '@discrepancia' },
  { pattern: /^sin evidencia/i, tag: '@sin-evidencia' },
  { pattern: /^duda/i, tag: '@duda' },
  { pattern: /^riesgo de regresi[oó]n/i, tag: '@regresion' },
];
/** One evidence file carried inline as a base64 data URL. */
interface BundleEvidence { name: string; base64: string; }
/** Lightweight evidence ref (no base64) for the metadata-only bundle. */
interface BundleEvidenceRef { name: string; ext: string; }

/**
 * Converts a manual PlanExecution (test cases + steps + evidences stored in
 * Supabase) into a self-contained JSON "bundle" that mirrors exactly what
 * Manual BDD Studio (webapp) expects. The webapp then imports this file and
 * runs Gradle/Serenity locally to produce the report.
 *
 * Nothing about Gherkin/TSV conversion is exposed to the user: they only click
 * "Descargar reporte Serenity" and get a .json file.
 *
 * Las advertencias de la IA en precondiciones (⚠ …) viajan como etiquetas y
 * descripción del escenario, y las evidencias tabulares (CSV) como imagen.
 */
@Injectable({ providedIn: 'root' })
export class SerenityExportService {
  constructor(private storage: ExecutionStorageService) {}

  /** Builds and triggers the browser download of the Serenity bundle JSON. */
  async downloadBundle(run: TestRun): Promise<void> {
    const bundle = await this.buildBundle(run);
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName(run);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Fetches the execution + evidences and converts it to the bundle object. */
  async buildBundle(run: TestRun): Promise<any> {
    if (!run.executionId) {
      throw new Error('Esta ejecucion no tiene datos ejecutados todavia.');
    }
    const execution = await this.storage.getExecution(run.executionId, { throwOnError: true });
    if (!execution) {
      throw new Error('No se encontro la ejecucion en la base de datos.');
    }
    // Populate base64Data on every step evidence.
    await this.storage.hydrateAllEvidence(execution);
    return this.convert(execution, run);
  }

  /** Converts an already-hydrated execution into the bundle object (public). */
  buildBundleFromExecution(execution: PlanExecution, run: TestRun): any {
    return this.convert(execution, run);
  }

  /**
   * Builds a SIZE-OPTIMIZED bundle by re-compressing evidence images.
   * Los parámetros por defecto priorizan calidad, ya que el bundle se sube
   * DIRECTAMENTE a Supabase Storage (no pasa por el límite de body de Vercel).
   * Evidence names are normalized to .jpg to maximize Serenity compatibility.
   */
  async buildCompressedBundle(
    execution: PlanExecution,
    run: TestRun,
    maxWidth: number = 1600,
    quality: number = 0.85
  ): Promise<any> {
    // 1) Build full bundle (convert handles all naming consistently)
    const fullBundle = this.convert(execution, run);

    // 2) Compress each evidence. Only rename if compression succeeds.
    const renameMap = new Map<string, string>();

    for (const ev of (fullBundle.evidences || [])) {
      if (!ev.base64) continue;
      const oldName = ev.name;
      const isJpg = oldName.toLowerCase().endsWith('.jpg') || oldName.toLowerCase().endsWith('.jpeg');
      const newName = isJpg ? oldName : oldName.replace(/\.(png|jpe?g|gif|webp)$/i, '.jpg');
      try {
        const compressed = await this.compressImage(ev.base64, maxWidth, quality);
        ev.base64 = compressed;
        if (newName !== oldName) {
          ev.name = newName;
          renameMap.set(oldName, newName);
        }
      } catch {
        // keep original name + base64 intact
      }
    }

    // 3) Patch results only for evidence that was successfully renamed
    for (const [scenarioName, sc] of Object.entries(fullBundle.results || {})) {
      for (const [stepIdx, r] of Object.entries((sc as any).steps || {})) {
        const stepResult: any = r;
        const origNames: string[] = Array.isArray(stepResult.evidences)
          ? stepResult.evidences
          : (stepResult.evidence ? [stepResult.evidence] : []);
        const patchedNames = origNames.map(n => renameMap.get(n) || n);
        stepResult.evidences = patchedNames;
        if (patchedNames.length > 0) stepResult.evidence = patchedNames[0];
      }
    }

    return fullBundle;
  }

  /**
    * Compress an image: resize to maxWidth, re-encode as JPEG at given quality.
   * Uses Canvas API — must run in browser context.
   */
  private compressImage(dataUrl: string, maxWidth: number, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /**
   * Returns the evidence items that need to be uploaded separately
   * (to avoid exceeding Vercel request body limits for large executions).
   * Each item has { name, base64 } and is uploaded individually to the Gist.
   */
  getEvidenceUploads(execution: PlanExecution, run: TestRun): { name: string; base64: string }[] {
    const uploads: { name: string; base64: string }[] = [];
    const usedNames = new Set<string>();

    (execution.testCases || []).forEach((tc, sIdx) => {
      (tc.steps || []).forEach((step, i) => {
        (step.evidences || []).forEach((ev, evIdx) => {
          const dataUrl = ev.base64Data || ev.originalBase64;
          if (ev.type === 'image' && dataUrl) {
            const ext = this.extFromDataUrl(dataUrl);
            const name = `ev-${sIdx}-${i}-${evIdx}.${ext}`;
            if (!usedNames.has(name)) {
              usedNames.add(name);
              uploads.push({ name, base64: dataUrl });
            }
          }
        });
      });
    });

    return uploads;
  }

  /**
   * Builds a METADATA‑ONLY bundle (no base64) for sending through Vercel API.
   * Evidence references are kept as { name } only and a separate evidenceMap
   * maps each bundle evidence name → Supabase storage path so the workflow can
   * download them directly from Supabase.
   */
  buildMetadataBundle(execution: PlanExecution, run: TestRun, userId: string): any {
    const full = this.convert(execution, run);
    if (full.evidences && Array.isArray(full.evidences)) {
      full.evidences = full.evidences.map((ev: any) => ({ name: ev.name }));
    }
    full.evidenceMap = this.buildEvidenceMap(execution, userId);
    return full;
  }

  /** Maps bundle evidence name (ev-0-0-0.png) → Supabase storage path (userId/execId/img_123.webp). */
  private buildEvidenceMap(execution: PlanExecution, userId: string): Record<string, string> {
    const map: Record<string, string> = {};
    (execution.testCases || []).forEach((tc, sIdx) => {
      (tc.steps || []).forEach((step, i) => {
        (step.evidences || []).forEach((ev, evIdx) => {
          if (ev.type === 'image' && ev.id) {
            const dataUrl = ev.base64Data || ev.originalBase64;
            if (dataUrl) {
              const ext = this.extFromDataUrl(dataUrl);
              const bundleName = `ev-${sIdx}-${i}-${evIdx}.${ext}`;
              map[bundleName] = `${userId}/${execution.id}/${ev.id}.${ext}`;
            }
          }
        });
      });
    });
    return map;
  }

  // ── Conversion ──────────────────────────────────────────────

  private convert(execution: PlanExecution, run: TestRun): any {
    const scenarios: BundleScenario[] = [];
    const results: Record<string, any> = {};
    const evidences: BundleEvidence[] = [];
    const usedNames = new Set<string>();
    let skippedEvidence = 0;

    (execution.testCases || []).forEach((tc, sIdx) => {
      const scenarioName = this.uniqueName(tc.title || `Caso ${sIdx + 1}`, usedNames);
      const steps: BundleStep[] = [];
      const stepResults: Record<string, any> = {};

      // Índice global del paso dentro del escenario. Debe permanecer alineado
      // con las claves de stepResults (evidencias/veredicto por paso), por eso
      // se incrementa por CADA paso emitido, incluidos los inyectados
      // (precondición Given y resultado esperado Then).
      let outIdx = 0;
      const scenarioStatus = this.mapStatus(tc.status);

      // 1) Precondición → uno o varios Given (soporta múltiples líneas). Las
      //    advertencias "⚠ …" se separan: van como etiqueta y descripción.
      const { warnings, lines: preconditionLines } = this.extractWarnings(this.splitLines(tc.preconditions));
      preconditionLines.forEach((line, pIdx) => {
        steps.push({ keyword: pIdx === 0 ? 'Given' : 'And', text: line });
        stepResults[String(outIdx)] = {
          status: scenarioStatus === 'pending' ? 'pending' : 'passed',
          evidences: [],
          notes: '',
        };
        outIdx++;
      });

      // 2) Acciones → When (primera) / And (siguientes). Aquí van las evidencias.
      let actionCount = 0;
      (tc.steps || []).forEach((step, i) => {
        const isFirstAction = actionCount === 0;
        steps.push({
          keyword: isFirstAction ? 'When' : 'And',
          text: this.oneLine(step.accion || '') || `Paso ${i + 1}`,
        });
        actionCount++;

        const evNames: string[] = [];
        (step.evidences || []).forEach((ev, evIdx) => {
          // Las tablas (CSV) se dibujan como imagen: así aparecen en el reporte
          // como cualquier captura, sin depender de que el convertidor del
          // pipeline soporte tablas de datos de Gherkin.
          const dataUrl = ev.type === 'csv'
            ? this.renderTableImage(ev.tabularData, ev.csvConfig?.hasHeader !== false, ev.rowColors, ev.description)
            : (ev.base64Data || ev.originalBase64);
          if (dataUrl && (ev.type === 'image' || ev.type === 'csv')) {
            const ext = this.extFromDataUrl(dataUrl);
            const name = `ev-${sIdx}-${i}-${evIdx}.${ext}`;
            evidences.push({ name, base64: dataUrl });
            evNames.push(name);
          } else {
            // Evidencia sin contenido representable (imagen no cargada o tabla vacía).
            skippedEvidence++;
          }
        });

        stepResults[String(outIdx)] = {
          status: this.mapStatus(step.status),
          evidences: evNames,
          notes: step.notes || '',
        };
        outIdx++;
      });

      // 3) Resultado esperado → uno o varios Then (soporta múltiples líneas).
      const expectedLines = this.splitLines(tc.expectedResults);
      expectedLines.forEach((line, eIdx) => {
        steps.push({ keyword: eIdx === 0 ? 'Then' : 'And', text: line });
        stepResults[String(outIdx)] = {
          status: scenarioStatus === 'pending' ? 'pending' : scenarioStatus,
          evidences: [],
          notes: '',
        };
        outIdx++;
      });

      // Fallback: si el caso no tuvo ningún paso emitido, garantizar al menos uno
      // para que el escenario sea Gherkin válido.
      if (steps.length === 0) {
        steps.push({ keyword: 'When', text: tc.title || `Caso ${sIdx + 1}` });
        stepResults['0'] = { status: scenarioStatus, evidences: [], notes: '' };
      }

      const scenarioTags = this.buildScenarioTags(tc, execution);
      for (const w of warnings) {
        if (!scenarioTags.includes(w.tag)) scenarioTags.push(w.tag);
      }
      const scenario: BundleScenario = { name: scenarioName, type: 'Scenario', tags: scenarioTags, steps };
      if (warnings.length) scenario.description = warnings.map(w => w.text);
      scenarios.push(scenario);
      const warningNote = warnings.map(w => w.text).join(' ');
      results[scenarioName] = { steps: stepResults, notes: [warningNote, tc.notes || ''].filter(Boolean).join(' · ') };
    });


    const huLine = execution.huTitle ? `HU: ${execution.huTitle}` : '';

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      run: {
        id: run.id,
        name: run.name,
        huTitle: run.huTitle,
        testPlanTitle: run.testPlanTitle,
      },
      feature: {
        name: run.name || execution.huTitle || 'Reporte manual',
        description: huLine ? [huLine] : [],
        tags: [],
        scenarios,
      },
      results,
      evidences,
      meta: { skippedEvidence, totalScenarios: scenarios.length },
    };
  }

  /**
   * Divide un texto multi-línea en líneas limpias (una por renglón / viñeta).
   * Cada línea se aplana con oneLine para que sea Gherkin válido.
   */
  private splitLines(text?: string): string[] {
    if (!text) return [];
    return String(text)
      .split(/\r?\n/)
      .map(l => l.replace(/^\s*[-*•·]\s*/, '')) // quitar viñetas al inicio
      .map(l => this.oneLine(l))
      .filter(l => l.length > 0);
  }

  /**
   * Separa las advertencias "⚠ …" del inicio de cada línea de precondición.
   * Una advertencia termina en el primer punto seguido de mayúscula, de otra
   * "⚠" o del final, para no cortar en "p. ej." ni en cifras como 1.000.
   */
  private extractWarnings(lines: string[]): { warnings: { text: string; tag: string }[]; lines: string[] } {
    const warnings: { text: string; tag: string }[] = [];
    const rest: string[] = [];
    for (const original of lines) {
      let line = original.trim();
      while (line.startsWith('⚠')) {
        const body = line.replace(/^⚠\s*/, '');
        const end = body.search(/\.(?=\s+(?:[A-ZÁÉÍÓÚÑ¿¡]|⚠)|\s*$)/);
        const text = (end >= 0 ? body.slice(0, end + 1) : body).trim();
        line = (end >= 0 ? body.slice(end + 1) : '').trim();
        if (!text) break;
        const tag = WARNING_TAGS.find(w => w.pattern.test(text))?.tag || '@advertencia';
        warnings.push({ text: `⚠ ${text}`, tag });
      }
      if (line) rest.push(line);
    }
    return { warnings, lines: rest };
  }

  /**
   * Dibuja una evidencia tabular como PNG (encabezado, colores de fila y hasta
   * 40 filas). Devuelve '' si no hay datos o no hay canvas (fuera del navegador).
   */
  private renderTableImage(rows: any[][] | undefined, hasHeader: boolean, rowColors?: string[], title?: string): string {
    if (!rows?.length || typeof document === 'undefined') return '';
    const MAX_ROWS = 40, MAX_CELL = 48, FONT = 13, PAD = 8, ROW_H = 24;
    const cell = (v: unknown) => {
      const t = String(v ?? '').replace(/\s+/g, ' ').trim();
      return t.length > MAX_CELL ? t.slice(0, MAX_CELL - 1) + '…' : t;
    };
    const shown = rows.slice(0, MAX_ROWS).map(r => (Array.isArray(r) ? r : [r]).map(cell));
    const hidden = rows.length - shown.length;
    const cols = Math.max(...shown.map(r => r.length));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.font = `${FONT}px Arial, sans-serif`;
    const widths = Array.from({ length: cols }, (_, c) =>
      Math.min(360, Math.max(48, ...shown.map(r => ctx.measureText(r[c] || '').width + PAD * 2))));
    const titleH = title ? 30 : 0;
    const footH = hidden > 0 ? 26 : 0;
    canvas.width = Math.ceil(widths.reduce((a, b) => a + b, 0)) + 2;
    canvas.height = titleH + shown.length * ROW_H + footH + 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'middle';
    if (title) {
      ctx.font = `bold ${FONT + 1}px Arial, sans-serif`;
      ctx.fillStyle = '#111827';
      ctx.fillText(cell(title), PAD, titleH / 2);
    }
    shown.forEach((r, ri) => {
      const y = titleH + ri * ROW_H;
      const isHeader = hasHeader && ri === 0;
      const bg = isHeader ? '#1f6f43' : (rowColors?.[ri] || (ri % 2 ? '#f9fafb' : '#ffffff'));
      ctx.fillStyle = bg;
      ctx.fillRect(1, y, canvas.width - 2, ROW_H);
      let x = 1;
      for (let c = 0; c < cols; c++) {
        ctx.strokeStyle = '#d1d5db';
        ctx.strokeRect(x, y, widths[c], ROW_H);
        ctx.font = `${isHeader ? 'bold ' : ''}${FONT}px Arial, sans-serif`;
        ctx.fillStyle = isHeader ? '#ffffff' : '#111827';
        ctx.fillText(r[c] || '', x + PAD, y + ROW_H / 2, widths[c] - PAD * 2);
        x += widths[c];
      }
    });
    if (hidden > 0) {
      ctx.font = `italic ${FONT}px Arial, sans-serif`;
      ctx.fillStyle = '#6b7280';
      ctx.fillText(`… ${hidden} fila(s) más en la evidencia original`, PAD, titleH + shown.length * ROW_H + footH / 2);
    }
    return canvas.toDataURL('image/png');
  }

  /** Genera tags automáticos para el escenario (@passed/@failed, @HU-xxx). */
  private buildScenarioTags(tc: TestCaseExecution, execution: PlanExecution): string[] {
    const tags: string[] = [];
    const status = this.mapStatus(tc.status);
    if (status === 'passed') tags.push('@passed');
    else if (status === 'failed') tags.push('@failed');
    else tags.push('@pending');

    const huId = execution.huId ? String(execution.huId).trim() : '';
    if (huId) {
      const safe = huId.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '');
      if (safe) tags.push(`@HU-${safe}`);
    }
    return tags;
  }

  private mapStatus(status: string): string {
    if (status === 'completed') return 'passed';
    if (status === 'failed') return 'failed';
    return 'pending';
  }

  private extFromDataUrl(dataUrl: string): string {
    const m = /^data:([^;]+);base64,/i.exec(dataUrl);
    const mime = ((m && m[1]) || 'image/png').toLowerCase();
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('pdf')) return 'pdf';
    return 'png';
  }

  private uniqueName(base: string, used: Set<string>): string {
    const clean = this.oneLine(base || 'Escenario') || 'Escenario';
    let name = clean;
    let n = 2;
    while (used.has(name)) {
      name = `${clean} (${n++})`;
    }
    used.add(name);
    return name;
  }

  private oneLine(s: string): string {
    return (s || '').replace(/[\t\r\n]+/g, ' ').replace(/#/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  private fileName(run: TestRun): string {
    const safe = (run.name || 'reporte')
      .toLowerCase()
      .replace(/[^\w\-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'reporte';
    return `serenity-${safe}.json`;
  }
}
