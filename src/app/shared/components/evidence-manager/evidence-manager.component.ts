import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanExecution, HUData, TestRun } from '../../../models/hu-data.model';
import { EvidenceDownloadModalComponent } from '../evidence-download-modal/evidence-download-modal.component';
import { EvidenceUploadModalComponent } from '../evidence-upload-modal/evidence-upload-modal.component';

@Component({
  selector: 'app-evidence-manager',
  standalone: true,
  imports: [CommonModule, EvidenceDownloadModalComponent, EvidenceUploadModalComponent],
  templateUrl: './evidence-manager.component.html',
  styleUrls: ['./evidence-manager.component.css']
})
export class EvidenceManagerComponent implements OnInit, OnDestroy {
  @Input() execution: PlanExecution | null = null;
  @Input() testRun: TestRun | null = null;
  @Input() huData: HUData | null = null;
  @Output() openSerenityHistory = new EventEmitter<void>();
  /** Se emite cuando el usuario valida un Plan ID de Azure DevOps, para recordarlo y no volver a pedirlo. */
  @Output() planValidated = new EventEmitter<{ planId: string; planTitle: string }>();

  /** Pestaña activa dentro del modal unificado */
  activeTab: 'download' | 'upload' = 'download';
  showModal = false;
  isProcessing = false;
  processingMessage = '';
  /** Último Plan ID validado en esta sesión, para precargarlo y evitar pedirlo de nuevo. */
  lastValidatedPlanId = '';

  private previousBodyOverflow: string | null = null;
  private lastFocusedElement: HTMLElement | null = null;

  constructor(private hostRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.unlockBodyScroll();
  }

  /**
   * Subtítulo contextual del modal: indica sobre qué ejecución se está trabajando.
   * Es solo informativo (UX), no altera el comportamiento.
   */
  get contextLabel(): string {
    const name = this.testRun?.name || this.huData?.title || this.execution?.huTitle || '';
    const id = this.huData?.id || this.execution?.huId || '';
    if (id && name) return `${id} — ${name}`;
    return name || id || '';
  }

  /** Nº total de evidencias adjuntas, para dar contexto antes de descargar/subir. */
  get evidenceCount(): number {
    const testCases = this.execution?.testCases || [];
    return testCases.reduce(
      (sum, tc) => sum + (tc.steps || []).reduce((s, step: any) => s + (step.evidences?.length || 0), 0),
      0
    );
  }

  openModal(tab: 'download' | 'upload' = 'download'): void {
    if (this.isProcessing) return;
    this.lastFocusedElement = document.activeElement as HTMLElement;
    this.activeTab = tab;
    this.showModal = true;
    this.lockBodyScroll();
  }

  selectTab(tab: 'download' | 'upload'): void {
    if (this.isProcessing) return;
    this.activeTab = tab;
  }

  /** Navegación entre pestañas con flechas (patrón ARIA tablist). */
  onTabsKeydown(event: KeyboardEvent): void {
    if (this.isProcessing) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    this.activeTab = this.activeTab === 'download' ? 'upload' : 'download';
    const tabs = this.hostRef.nativeElement.querySelectorAll<HTMLElement>('.evidence-tab');
    tabs[this.activeTab === 'download' ? 0 : 1]?.focus();
  }

  /** Cerrar con Escape (bloqueado mientras hay un proceso en curso). */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showModal) this.closeModal();
  }

  closeModal(): void {
    if (this.isProcessing) return;
    this.showModal = false;
    this.unlockBodyScroll();
    this.lastFocusedElement?.focus?.();
    this.lastFocusedElement = null;
  }

  handleOpenSerenityHistory(): void {
    this.showModal = false;
    this.unlockBodyScroll();
    this.openSerenityHistory.emit();
  }

  handlePlanValidated(event: { planId: string; planTitle: string }): void {
    this.lastValidatedPlanId = event.planId;
    this.planValidated.emit(event);
  }

  setProcessing(event: any): void {
    this.isProcessing = event.isProcessing;
    this.processingMessage = event.message;
  }

  private lockBodyScroll(): void {
    if (typeof document === 'undefined') return;
    if (this.previousBodyOverflow === null) {
      this.previousBodyOverflow = document.body.style.overflow;
    }
    document.body.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    if (typeof document === 'undefined') return;
    if (this.previousBodyOverflow !== null) {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }
  }
}
