import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlanExecution, HUData, TestRun } from '../../../models/hu-data.model';
import { EvidenceDownloadModalComponent } from '../evidence-download-modal/evidence-download-modal.component';
import { EvidenceUploadModalComponent } from '../evidence-upload-modal/evidence-upload-modal.component';

@Component({
  selector: 'app-evidence-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, EvidenceDownloadModalComponent, EvidenceUploadModalComponent],
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

  /** Referencias a los subcomponentes embebidos (ocultos): reutilizamos su lógica sin duplicarla. */
  @ViewChild('down') down!: EvidenceDownloadModalComponent;
  @ViewChild('up') up!: EvidenceUploadModalComponent;

  showModal = false;
  isProcessing = false;
  processingMessage = '';
  /** Último Plan ID validado en esta sesión, para precargarlo y evitar pedirlo de nuevo. */
  lastValidatedPlanId = '';
  /** ID de Test Plan que teclea el usuario en el modal unificado (flujo simplificado de carga a Azure). */
  planIdInput = '';
  /** Título del plan una vez validado, solo informativo para el usuario. */
  validatedPlanTitle = '';

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

  /** ¿Hay alguna operación en curso? Combina los estados de ambos subcomponentes. */
  get isBusy(): boolean {
    return this.isProcessing
      || !!this.down?.isDownloading
      || !!this.up?.isValidating
      || !!this.up?.isUploading;
  }

  /** Formato de descarga que se está generando actualmente (word|pdf|excel|serenity|null). */
  get downloadingFormat(): 'word' | 'pdf' | 'excel' | 'serenity' | null {
    return this.down?.downloadingFormat ?? null;
  }

  openModal(): void {
    if (this.isProcessing) return;
    this.lastFocusedElement = document.activeElement as HTMLElement;
    this.showModal = true;
    this.lockBodyScroll();
  }

  /** Cerrar con Escape (bloqueado mientras hay un proceso en curso). */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showModal) this.closeModal();
  }

  closeModal(): void {
    if (this.isBusy) return;
    this.showModal = false;
    this.unlockBodyScroll();
    this.lastFocusedElement?.focus?.();
    this.lastFocusedElement = null;
  }

  // ── Descargas Word / PDF / Excel (reutilizan la lógica del download-modal) ──
  downloadWord(): void { this.down?.downloadWord(); }
  downloadPDF(): void { this.down?.downloadPDF(); }
  downloadExcel(): void { this.down?.downloadExcel(); }

  // ── Reporte Serenity ──
  /** Generar reporte Serenity (mismo comportamiento actual). */
  generateSerenity(): void { this.down?.downloadSerenity(); }
  /** Descargar Reporte Serenity: mantiene el comportamiento actual de generación/envío. */
  downloadSerenity(): void { this.down?.downloadSerenity(); }
  /** Historial de reportes Serenity. */
  serenityHistory(): void { this.down?.openSerenityHistory(); }

  /**
   * Cargar a Azure un formato concreto (word/pdf/excel) usando el flujo de upload existente.
   * Simplificado: solo se solicita el ID del Test Plan; la validación y la carga se hacen
   * internamente y el subcomponente ya notifica éxito/error mediante toasts.
   */
  async uploadFormat(format: 'docx' | 'pdf' | 'excel'): Promise<void> {
    if (!this.up) return;
    const planId = (this.planIdInput || '').trim();
    if (!planId) return;

    this.up.inputPlanId = planId;

    // Valida el plan solo si aún no está validado o si el ID cambió.
    const needsValidation = !this.up.planValidated || this.up.validatedPlan?.planId !== planId;
    if (needsValidation) {
      await this.up.validatePlan();
      if (!this.up.planValidated) return; // el subcomponente ya mostró el error
    }

    // Fuerza únicamente el formato elegido y restaura el estado previo al terminar.
    const previousFormats = { ...this.up.selectedFormats };
    this.up.selectedFormats = {
      docx: format === 'docx',
      pdf: format === 'pdf',
      excel: format === 'excel'
    };
    try {
      await this.up.startUpload();
    } finally {
      this.up.selectedFormats = previousFormats;
    }
  }

  /**
   * Cargar el Reporte Serenity a Azure: usa el mismo flujo simplificado de carga,
   * solicitando únicamente el ID del Test Plan.
   */
  async uploadSerenity(): Promise<void> {
    if (!this.up) return;
    const planId = (this.planIdInput || '').trim();
    if (!planId) return;

    this.up.inputPlanId = planId;

    const needsValidation = !this.up.planValidated || this.up.validatedPlan?.planId !== planId;
    if (needsValidation) {
      await this.up.validatePlan();
      if (!this.up.planValidated) return;
    }

    // Carga sin formatos ofimáticos adicionales (el ZIP incluye las evidencias de la ejecución).
    const previousFormats = { ...this.up.selectedFormats };
    this.up.selectedFormats = { docx: false, pdf: false, excel: false };
    try {
      await this.up.startUpload();
    } finally {
      this.up.selectedFormats = previousFormats;
    }
  }

  /** Permite al usuario cambiar el ID de plan tras haberlo validado. */
  changePlan(): void {
    this.planIdInput = '';
    this.validatedPlanTitle = '';
    this.lastValidatedPlanId = '';
    this.up?.resetToPlantId?.();
  }

  handleOpenSerenityHistory(): void {
    this.showModal = false;
    this.unlockBodyScroll();
    this.openSerenityHistory.emit();
  }

  handlePlanValidated(event: { planId: string; planTitle: string }): void {
    this.lastValidatedPlanId = event.planId;
    this.validatedPlanTitle = event.planTitle;
    if (!this.planIdInput) this.planIdInput = event.planId;
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
