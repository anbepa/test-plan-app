import { Injectable } from '@angular/core';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
import { PlanExecution, TestRun, TestCaseExecution } from '../../models/hu-data.model';

/** A single step inside a Gherkin scenario. */
interface BundleStep { keyword: string; text: string; }
/** A Gherkin scenario derived from a manual test case. */
interface BundleScenario { name: string; type: string; tags: string[]; steps: BundleStep[]; }
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

      // 1) Precondición → uno o varios Given (soporta múltiples líneas).
      const preconditionLines = this.splitLines(tc.preconditions);
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
          const dataUrl = ev.base64Data || ev.originalBase64;
          if (ev.type === 'image' && dataUrl) {
            const ext = this.extFromDataUrl(dataUrl);
            const name = `ev-${sIdx}-${i}-${evIdx}.${ext}`;
            evidences.push({ name, base64: dataUrl });
            evNames.push(name);
          } else {
            // CSV/tabular or evidences without an image payload are not
            // representable as Serenity screenshots; skip and count them.
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
      scenarios.push({ name: scenarioName, type: 'Scenario', tags: scenarioTags, steps });
      results[scenarioName] = { steps: stepResults, notes: tc.notes || '' };
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
