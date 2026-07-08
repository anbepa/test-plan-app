import { Injectable } from '@angular/core';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
import { PlanExecution, TestRun } from '../../models/hu-data.model';

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
    const execution = await this.storage.getExecution(run.executionId);
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

  /** Builds the FULL bundle with optionally compressed evidence images for smaller payload. */
  async buildFullBundle(execution: PlanExecution, run: TestRun): Promise<any> {
    return this.convert(execution, run);
  }

  /**
   * Builds a SIZE-OPTIMIZED bundle by re-compressing evidence images.
   * Each image is resized to max 640px wide and re-encoded as WebP at quality 0.5,
   * dramatically reducing the base64 payload for Vercel upload.
   */
  async buildCompressedBundle(execution: PlanExecution, run: TestRun): Promise<any> {
    const compressedEvidences: BundleEvidence[] = [];
    const usedNames = new Set<string>();

    for (let sIdx = 0; sIdx < (execution.testCases || []).length; sIdx++) {
      const tc = execution.testCases[sIdx];
      for (let i = 0; i < (tc.steps || []).length; i++) {
        const step = tc.steps[i];
        for (let evIdx = 0; evIdx < (step.evidences || []).length; evIdx++) {
          const ev = step.evidences[evIdx];
          const dataUrl = ev.base64Data || ev.originalBase64;
          if (ev.type === 'image' && dataUrl) {
            const ext = this.extFromDataUrl(dataUrl);
            const name = `ev-${sIdx}-${i}-${evIdx}.${ext}`;
            if (usedNames.has(name)) continue;
            usedNames.add(name);

            try {
              const smallBase64 = await this.compressImage(dataUrl, 640, 0.5);
              compressedEvidences.push({ name, base64: smallBase64 });
            } catch {
              compressedEvidences.push({ name, base64: dataUrl });
            }
          }
        }
      }
    }

    // Reuse convert() but replace evidences array
    const fullBundle = this.convert(execution, run);
    fullBundle.evidences = compressedEvidences;
    return fullBundle;
  }

  /**
   * Compress an image: resize to maxWidth, re-encode as WebP at given quality.
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
        resolve(canvas.toDataURL('image/webp', quality));
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

  /** Builds the SERENITY BUNDLE WITH embedded base64 evidence (for direct download/import into Manual BDD Studio). */
  buildFullBundle(execution: PlanExecution, run: TestRun): any {
    return this.convert(execution, run);
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

      (tc.steps || []).forEach((step, i) => {
        steps.push({
          keyword: this.keywordFor(i),
          text: (step.accion || '').trim() || `Paso ${i + 1}`,
        });

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

        stepResults[String(i)] = {
          status: this.mapStatus(step.status),
          evidences: evNames,
          notes: step.notes || '',
        };
      });

      scenarios.push({ name: scenarioName, type: 'Scenario', tags: [], steps });
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

  private keywordFor(i: number): string {
    if (i === 0) return 'Given';
    if (i === 1) return 'When';
    if (i === 2) return 'Then';
    return 'And';
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
    const clean = (base || 'Escenario').trim() || 'Escenario';
    let name = clean;
    let n = 2;
    while (used.has(name)) {
      name = `${clean} (${n++})`;
    }
    used.add(name);
    return name;
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
