import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, Input, OnDestroy, QueryList, ViewChildren } from '@angular/core';
import { Subscription } from 'rxjs';

import { MarkdownLitePipe, sourceCell } from '../../pipes/markdown-lite.pipe';
import { TechContextModel, parseTechContext } from '../../utils/tech-context-parser';

/**
 * Vista visual del contexto técnico del agente: resumen, flujo de ejecución
 * como diagrama y el resto en secciones plegables. Solo presentación; el texto
 * se edita con "Editar" y es el que se envía a la IA.
 */
@Component({
  selector: 'app-tech-context-view',
  standalone: true,
  imports: [MarkdownLitePipe],
  templateUrl: './tech-context-view.component.html',
  styleUrls: ['./tech-context-view.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechContextViewComponent implements AfterViewInit, OnDestroy {
  model: TechContextModel = parseTechContext('');
  raw = '';
  /** Bloques recortados que el usuario abrió ("Ver más"). */
  private opened = new Set<string>();
  /** Bloques cuyo texto no cabe en las líneas visibles: solo esos muestran "Ver más". */
  overflowing = new Set<string>();
  private clampSub?: Subscription;

  @ViewChildren('clampEl') clampEls!: QueryList<ElementRef<HTMLElement>>;

  constructor(private cdr: ChangeDetectorRef) {}

  @Input() set context(value: string | null | undefined) {
    this.raw = value || '';
    this.model = parseTechContext(this.raw);
    this.opened.clear();
    this.overflowing = new Set<string>();
    setTimeout(() => this.measure());
  }

  ngAfterViewInit(): void {
    this.measure();
    this.clampSub = this.clampEls.changes.subscribe(() => this.measure());
  }

  ngOnDestroy(): void {
    this.clampSub?.unsubscribe();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.measure();
  }

  /** Mide en pantalla qué bloques recortados tienen más texto del que se ve. */
  private measure(): void {
    requestAnimationFrame(() => {
      if (!this.clampEls) return;
      const next = new Set<string>();
      this.clampEls.forEach(({ nativeElement: el }) => {
        const key = el.dataset['key'] || '';
        if (this.opened.has(key)) {
          if (this.overflowing.has(key)) next.add(key);
        } else if (el.scrollHeight > el.clientHeight + 2) {
          next.add(key);
        }
      });
      const changed = next.size !== this.overflowing.size || Array.from(next).some((key) => !this.overflowing.has(key));
      if (changed) {
        this.overflowing = next;
        this.cdr.markForCheck();
      }
    });
  }

  /** Texto con formato en línea y rutas largas abreviadas (carpeta/…/archivo, ruta completa en el title). */
  html(text: string): string {
    return sourceCell(text);
  }

  source(text: string): string {
    return sourceCell(text);
  }

  isOpen(key: string): boolean {
    return this.opened.has(key);
  }

  toggle(key: string): void {
    if (this.opened.has(key)) this.opened.delete(key);
    else this.opened.add(key);
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
}
