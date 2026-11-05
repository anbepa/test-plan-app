import { Component, OnInit, AfterViewChecked, AfterViewInit, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, finalize, of, tap } from 'rxjs';

import { AiUnifiedService } from '../../services/ai/ai-unified.service';
import { ToastService } from '../../services/core/toast.service';
import { DatabaseService } from '../../services/database/database.service';
import { TestPlanMapperService } from '../../services/database/test-plan-mapper.service';
import { HUData } from '../../models/hu-data.model';
import { RiskStrategyData } from '../components/general-sections/general-sections.component';

@Component({
  selector: 'app-risk-strategy-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './risk-strategy-view.component.html',
  styleUrls: ['./risk-strategy-view.component.css']
})
export class RiskStrategyViewComponent implements OnInit, AfterViewChecked, AfterViewInit {
  testPlanId: string = '';
  testPlanTitle: string = '';
  isLoading = true;
  isSaving = false;
  loadingAI = false;
  errorAI: string | null = null;
  copiedFieldKey = '';

  huList: HUData[] = [];
  riskScenarioOptions: string[] = [];

  riskData: RiskStrategyData = this.createEmpty();

  readonly impactOptions = [
    '1 - Ninguno', '2 - Bajo', '3 - Moderado', '4 - Alto', '5 - Crítico'
  ];

  readonly probabilityOptions = [
    '25% - Poca posibilidad de ocurrir',
    '50% - Puede ocurrir',
    '75% - Gran posibilidad de ocurrir',
    '100% - Ocurrido (Issue)'
  ];

  get uiLocked(): boolean {
    return this.loadingAI || this.isSaving;
  }

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private databaseService: DatabaseService,
    private mapper: TestPlanMapperService,
    private aiService: AiUnifiedService,
    private toastService: ToastService,
    private host: ElementRef<HTMLElement>
  ) { }

  async ngOnInit(): Promise<void> {
    this.testPlanId = this.route.snapshot.paramMap.get('id') || '';
    this.testPlanTitle = history.state?.testPlanTitle || '';

    if (!this.testPlanId) {
      this.toastService.warning('No se encontró el plan de pruebas');
      this.goBack();
      return;
    }

    await this.loadData();
  }

  ngAfterViewInit(): void {
    this.scheduleAutoResize();
  }

  goBack(): void {
    this.goToPlanDetail();
  }

  goToPlansList(): void {
    this.router.navigate(['/viewer']);
  }

  goToPlanDetail(): void {
    this.router.navigate(['/viewer'], { queryParams: { id: this.testPlanId } });
  }

  goToCurrentPage(): void {
    if (!this.testPlanId) return;

    this.router.navigate(['/viewer/risk-strategy', this.testPlanId], {
      state: { testPlanTitle: this.testPlanTitle }
    });
  }

  // ── Carga ───────────────────────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    this.isLoading = true;
    try {
      // HUs desde la última versión cargada (si existe) y, en paralelo, el plan
      // actual y el riesgo guardado: antes eran dos consultas una tras otra.
      const cached = this.databaseService.getCachedTestPlan(this.testPlanId);
      if (cached) this.applyPlan(cached);
      const [plan, savedRisk] = await Promise.all([
        this.databaseService.getTestPlanById(this.testPlanId),
        this.databaseService.getRiskStrategyByTestPlanId(this.testPlanId)
      ]);
      if (!plan) {
        this.toastService.error('No se pudo cargar el plan de pruebas');
        this.goBack();
        return;
      }
      this.applyPlan(plan);

      if (savedRisk?.risk_data) {
        this.riskData = this.normalizeRisk(savedRisk.risk_data);
      } else {
        this.riskData = this.createEmpty();
      }
    } catch (err) {
      console.error('❌ Error cargando riesgos:', err);
      this.toastService.error('Error al cargar los riesgos del plan');
    } finally {
      this.isLoading = false;
      this.needsAutoResize = true;
      this.scheduleAutoResize();
    }
  }

  private applyPlan(plan: any): void {
    this.testPlanTitle = this.testPlanTitle || plan.title || '';
    this.huList = this.mapper.mapDbTestPlanToHUList(plan);
    this.riskScenarioOptions = this.buildScenarioOptions();
  }

  // ── Persistencia ────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    this.isSaving = true;
    const toastId = this.toastService.loading('Guardando riesgos...');
    try {
      const ok = await this.databaseService.upsertRiskStrategy(this.testPlanId, this.riskData);
      this.toastService.dismiss(toastId);
      if (ok) {
        this.toastService.success('Riesgos guardados correctamente');
      } else {
        this.toastService.error('No se pudieron guardar los riesgos');
      }
    } catch {
      this.toastService.dismiss(toastId);
      this.toastService.error('Error al guardar los riesgos');
    } finally {
      this.isSaving = false;
    }
  }

  // ── IA ──────────────────────────────────────────────────────────────────────

  generateWithAI(): void {
    this.loadingAI = true;
    this.errorAI = null;

    const huSummary = this.mapper.getHuSummaryForAI(this.huList);

    // Pasar el conteo de HUs para ajustar dinámicamente la profundidad del análisis de riesgos:
    // más HUs = más espacio para riesgos complejos, causas múltiples, integraciones, etc.
    // El riesgo ya registrado se envía para que la IA no lo repita y proponga el siguiente.
    this.aiService.generateRiskStrategy(huSummary, this.riskScenarioOptions, this.huList.length, this.currentRiskForAI())
      .pipe(
        tap((response: any) => {
          this.riskData = this.mapAIResponse(response);
          this.needsAutoResize = true;
          this.scheduleAutoResize();
          this.toastService.success('Riesgo generado con IA');
        }),
        catchError(err => {
          const msg = err?.message || 'Error desconocido';
          this.errorAI = msg;
          this.toastService.error(`No se pudo generar el riesgo: ${msg}`);
          return of(null);
        }),
        finalize(() => { this.loadingAI = false; })
      )
      .subscribe();
  }

  // ── Escenarios ──────────────────────────────────────────────────────────────

  getScenarioOptions(currentValues: string[], index: number): string[] {
    const current = currentValues[index] || '';
    const others = currentValues
      .filter((_, i) => i !== index)
      .map(v => v.trim())
      .filter(Boolean);

    return this.riskScenarioOptions.filter(opt =>
      opt.trim() === current.trim() || !others.includes(opt.trim())
    );
  }

  addPositiveScenario(): void {
    const next = this.nextAvailable(this.riskData.positiveScenarios);
    this.riskData.positiveScenarios = [...this.riskData.positiveScenarios, next];
  }

  removePositiveScenario(i: number): void {
    if (this.riskData.positiveScenarios.length <= 2) return;
    this.riskData.positiveScenarios = this.riskData.positiveScenarios.filter((_, idx) => idx !== i);
  }

  addAlternateScenario(): void {
    const next = this.nextAvailable(this.riskData.alternateScenarios);
    this.riskData.alternateScenarios = [...this.riskData.alternateScenarios, next];
  }

  removeAlternateScenario(i: number): void {
    if (this.riskData.alternateScenarios.length <= 1) return;
    this.riskData.alternateScenarios = this.riskData.alternateScenarios.filter((_, idx) => idx !== i);
  }

  // ── Clipboard ───────────────────────────────────────────────────────────────

  copyField(value: string, key: string): void {
    if (!navigator?.clipboard || !value.trim()) return;
    navigator.clipboard.writeText(value.trim()).then(() => {
      this.copiedFieldKey = key;
      setTimeout(() => { if (this.copiedFieldKey === key) this.copiedFieldKey = ''; }, 1200);
    });
  }

  // ── Autoajuste de altura de los textareas ────────────────────────────────────

  private needsAutoResize = false;

  ngAfterViewChecked(): void {
    if (this.needsAutoResize) {
      this.needsAutoResize = false;
      this.scheduleAutoResize();
    }
  }

  private scheduleAutoResize(): void {
    requestAnimationFrame(() => {
      this.autoResizeAll();
      setTimeout(() => this.autoResizeAll(), 120);
    });
  }

  /** Ajusta la altura de un único textarea al contenido. */
  autoResize(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.fitTextarea(el);
  }

  /** Reajusta todos los textareas del formulario (tras cargar datos o generar con IA). */
  autoResizeAll(): void {
    const nodes = this.host?.nativeElement?.querySelectorAll<HTMLTextAreaElement>('textarea.field-textarea');
    nodes?.forEach(el => this.fitTextarea(el));
  }

  private fitTextarea(el: HTMLTextAreaElement | null): void {
    if (!el) return;
    el.style.height = '0px';
    el.style.height = el.scrollHeight + 'px';
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private createEmpty(): RiskStrategyData {
    return {
      probabilidadDe: '', puedeOcurrir: '', loQuePodriaOcasionar: '',
      impacto: '', probabilidad: '',
      positiveScenarios: ['', ''], alternateScenarios: ['']
    };
  }

  private normalizeRisk(raw: any): RiskStrategyData {
    const pos = [...(raw.positiveScenarios || [])].map((v: any) => (v ?? '').toString());
    const alt = [...(raw.alternateScenarios || [])].map((v: any) => (v ?? '').toString());
    while (pos.length < 2) pos.push('');
    while (alt.length < 1) alt.push('');
    return {
      probabilidadDe: (raw.probabilidadDe || '').toString(),
      puedeOcurrir: (raw.puedeOcurrir || '').toString(),
      loQuePodriaOcasionar: (raw.loQuePodriaOcasionar || '').toString(),
      impacto: (raw.impacto || '').toString(),
      probabilidad: (raw.probabilidad || '').toString(),
      positiveScenarios: pos, alternateScenarios: alt
    };
  }

  private mapAIResponse(r: any): RiskStrategyData {
    const impactMap: Record<number, string> = {
      1: '1 - Ninguno', 2: '2 - Bajo', 3: '3 - Moderado', 4: '4 - Alto', 5: '5 - Crítico'
    };
    const probMap: Record<number, string> = {
      25: '25% - Poca posibilidad de ocurrir', 50: '50% - Puede ocurrir',
      75: '75% - Gran posibilidad de ocurrir', 100: '100% - Ocurrido (Issue)'
    };

    // Los escenarios ya usados (en cualquiera de las dos listas) no se repiten.
    const used = new Set<string>();
    const normScenarios = (raw: any[], min: number) => {
      const arr = (Array.isArray(raw) ? raw : []).map(s => (s ?? '').toString().trim()).filter(Boolean);
      const resolved: string[] = [];

      for (const s of arr) {
        const match = this.matchScenarioOption(s, used);
        if (match) {
          resolved.push(match);
          used.add(match);
        }
        // Sin coincidencia: se descarta en lugar de poner un escenario sin relación.
      }

      // La pantalla exige un mínimo: se completa con escenarios disponibles no usados.
      while (resolved.length < min) {
        const next = this.riskScenarioOptions.find(o => !used.has(o)) ?? '';
        if (next) used.add(next);
        resolved.push(next);
      }

      return resolved;
    };

    return {
      probabilidadDe: this.pickAiField(r, ['probabilidadDe', 'evento', 'riesgo']),
      puedeOcurrir: this.pickAiField(r, ['puedeOcurrir', 'causa']),
      loQuePodriaOcasionar: this.pickAiField(r, ['loQuePodriaOcasionar', 'consecuencia', 'impacto']),
      impacto: impactMap[Number(this.pickAiField(r, ['impactLevel', 'impacto_nivel']))] || '',
      probabilidad: probMap[Number(this.pickAiField(r, ['probabilityLevel', 'probabilidad']))] || '',
      positiveScenarios: normScenarios(r?.positiveScenarios ?? r?.escenariosPositivos, 2),
      alternateScenarios: normScenarios(r?.alternateScenarios ?? r?.escenariosAlternos, 1)
    };
  }

  /**
   * Lee un campo del JSON de la IA tolerando variantes del nombre
   * (tildes, mayúsculas, guiones bajos) o un sinónimo.
   */
  private pickAiField(r: any, names: string[]): string {
    if (!r || typeof r !== 'object') return '';
    const norm = (k: string) => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const byKey = new Map(Object.keys(r).map(k => [norm(k), r[k]]));
    for (const n of names) {
      const v = byKey.get(norm(n));
      if (v !== undefined && v !== null && typeof v !== 'object' && `${v}`.trim()) return `${v}`.trim();
    }
    return '';
  }

  /** Resumen del riesgo ya registrado, para que la IA no lo repita. */
  private currentRiskForAI(): string[] {
    const r = this.riskData;
    if (!r?.probabilidadDe?.trim()) return [];
    return [
      `Evento: ${r.probabilidadDe.trim()} | Causa: ${(r.puedeOcurrir || '').trim()} | Consecuencia: ${(r.loQuePodriaOcasionar || '').trim()}`
    ];
  }

  /**
   * Empareja el escenario devuelto por la IA con una opción de la lista:
   * exacto → contenido → mayor coincidencia de palabras (≥ 60%).
   */
  private matchScenarioOption(aiText: string, used: Set<string>): string | null {
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/^\s*\d+\s*[.)-]\s*/, '').replace(/\s+/g, ' ').trim();
    const target = norm(aiText);
    if (!target) return null;
    const options = this.riskScenarioOptions.filter(o => !used.has(o));

    const exact = options.find(o => norm(o) === target);
    if (exact) return exact;

    const contained = options.find(o => {
      const on = norm(o);
      return on.includes(target) || target.includes(on) || on.endsWith(target);
    });
    if (contained) return contained;

    const words = (t: string) => new Set(t.split(/[^a-z0-9ñ]+/).filter(w => w.length > 2));
    const tw = words(target);
    let best: string | null = null;
    let bestScore = 0;
    for (const o of options) {
      const ow = words(norm(o));
      if (!ow.size || !tw.size) continue;
      let common = 0;
      tw.forEach(w => { if (ow.has(w)) common++; });
      const score = common / Math.min(tw.size, ow.size);
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  private buildScenarioOptions(): string[] {
    const all = this.huList.flatMap(hu => {
      const detailed = (hu.detailedTestCases || [])
        .map(tc => tc.title?.trim()).filter((t): t is string => Boolean(t));
      if (detailed.length) return detailed.map(t => `${hu.id} - ${t}`);
      return (hu.generatedTestCaseTitles || '').split(/\r?\n|\|/)
        .map(l => l.trim()).filter(Boolean).map(t => `${hu.id} - ${t}`);
    });
    return Array.from(new Set(all)).slice(0, 40);
  }

  private nextAvailable(current: string[]): string {
    const sel = current.map(v => v.trim()).filter(Boolean);
    return this.riskScenarioOptions.find(o => !sel.includes(o.trim())) || '';
  }
}
