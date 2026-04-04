import { Component, OnInit, OnDestroy } from '@angular/core';
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
export class RiskStrategyViewComponent implements OnInit {
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

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private databaseService: DatabaseService,
    private mapper: TestPlanMapperService,
    private aiService: AiUnifiedService,
    private toastService: ToastService
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
      const plan = await this.databaseService.getTestPlanById(this.testPlanId);
      if (!plan) {
        this.toastService.error('No se pudo cargar el plan de pruebas');
        this.goBack();
        return;
      }

      this.testPlanTitle = this.testPlanTitle || plan.title || '';
      this.huList = this.mapper.mapDbTestPlanToHUList(plan);
      this.riskScenarioOptions = this.buildScenarioOptions();

      const savedRisk = await this.databaseService.getRiskStrategyByTestPlanId(this.testPlanId);
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
    }
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

    this.aiService.generateRiskStrategy(huSummary, this.riskScenarioOptions)
      .pipe(
        tap((response: any) => {
          this.riskData = this.mapAIResponse(response);
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

    const normScenarios = (raw: any[], min: number) => {
      const arr = (Array.isArray(raw) ? raw : []).map(s => (s ?? '').toString().trim()).filter(Boolean);
      const resolved = arr.map(s =>
        this.riskScenarioOptions.find(o => o === s || o.toLowerCase().includes(s.toLowerCase())) || s
      );
      while (resolved.length < min) resolved.push('');
      return resolved;
    };

    return {
      probabilidadDe: (r?.probabilidadDe || '').toString().trim(),
      puedeOcurrir: (r?.puedeOcurrir || '').toString().trim(),
      loQuePodriaOcasionar: (r?.loQuePodriaOcasionar || '').toString().trim(),
      impacto: impactMap[Number(r?.impactLevel)] || '',
      probabilidad: probMap[Number(r?.probabilityLevel)] || '',
      positiveScenarios: normScenarios(r?.positiveScenarios, 2),
      alternateScenarios: normScenarios(r?.alternateScenarios, 1)
    };
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
