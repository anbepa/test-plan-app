import { Injectable } from '@angular/core';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
import { PlanExecution, TestRun } from '../../models/hu-data.model';

/** A single step inside a Gherkin scenario. */
interface BundleStep { keyword: string; text: string; }
/** A Gherkin scenario derived from a manual test case. */
interface BundleScenario { name: string; type: string; tags: string[]; steps: BundleStep[]; }
/** One evidence file carried inline as a base64 data URL. */
interface BundleEvidence { name: string; base64: string; }

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
