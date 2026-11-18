import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownLitePipe, inline, sourceCell } from '../../pipes/markdown-lite.pipe';
import { TechContextModel, TechFlowStep, parseTechContext } from '../../utils/tech-context-parser';

/**
 * Vista visual del contexto técnico del agente: resumen, flujo de ejecución
 * como diagrama y el resto en secciones plegables. Solo presentación; el texto
 * se edita con "Editar" y es el que se envía a la IA.
 */
@Component({
  selector: 'app-tech-context-view',
  standalone: true,
  imports: [CommonModule, MarkdownLitePipe],
  templateUrl: './tech-context-view.component.html',
  styleUrls: ['./tech-context-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechContextViewComponent {
  model: TechContextModel = parseTechContext('');
  raw = '';
  private openSteps = new Set<number>();

  /** Texto a partir del cual un paso del flujo se muestra recortado con "Ver más". */
  readonly longStep = 220;

  @Input() set context(value: string | null | undefined) {
    this.raw = value || '';
    this.model = parseTechContext(this.raw);
    this.openSteps.clear();
  }

  html(text: string): string {
    return inline(text);
  }

  source(text: string): string {
    return sourceCell(text);
  }

  isLong(step: TechFlowStep): boolean {
    return step.text.length > this.longStep;
  }

  isOpen(index: number): boolean {
    return this.openSteps.has(index);
  }

  toggleStep(index: number): void {
    if (this.openSteps.has(index)) this.openSteps.delete(index);
    else this.openSteps.add(index);
  }

  get ruleCount(): number {
    return this.model.ruleGroups.reduce((sum, group) => sum + group.rules.length, 0);
  }

  get changedRules(): number {
    return this.model.ruleGroups.reduce((sum, group) => sum + group.rules.filter((rule) => rule.change === 'CAMBIO HU').length, 0);
  }

  get unverifiedRecipe(): number {
    return this.model.recipe.filter((item) => item.unverified > 0).length;
  }

  get unconfirmed(): number {
    return this.model.equivalences.filter((item) => !item.confirmed).length;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
