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

  private previousBodyOverflow: string | null = null;
  private lastFocusedElement: HTMLElement | null = null;

  constructor(private hostRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.unlockBodyScroll();
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

  // ── Publicación de evidencias ──

  /** Valida el plan si aún no está validado o si el ID cambió. Devuelve true si quedó listo para publicar. */
  private async ensurePlanValidated(): Promise<boolean> {
    if (!this.up) return false;
    const planId = (this.up.inputPlanId || '').trim();
    if (!planId) return false;

    const needsValidation = !this.up.planValidated || this.up.validatedPlan?.planId !== planId;
    if (needsValidation) {
      await this.up.validatePlan();
      if (!this.up.planValidated) return false;
    }
    return true;
  }

  /** Publica en DevOps los formatos Word/Excel/PDF seleccionados (juntos, como un único .zip). */
  async publishOfficeFormats(): Promise<void> {
    if (!this.up) return;
    if (!this.up.hasSelectedFormat()) return;
    const ready = await this.ensurePlanValidated();
    if (!ready) return;
    await this.up.startUpload();
  }

  /** Publica en DevOps el reporte Serenity (se empaqueta de forma independiente). */
  async publishSerenity(): Promise<void> {
    if (!this.up) return;
    if (!(this.up.serenityFileName || '').trim()) return;
    const ready = await this.ensurePlanValidated();
    if (!ready) return;
    await this.up.startSerenityUpload();
  }

  /** Permite al usuario cambiar el ID de plan tras haberlo validado. */
  changePlan(): void {
    this.up?.resetToPlantId?.();
  }

  handleOpenSerenityHistory(): void {
    this.showModal = false;
    this.unlockBodyScroll();
    this.openSerenityHistory.emit();
  }

  handlePlanValidated(event: { planId: string; planTitle: string }): void {
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
