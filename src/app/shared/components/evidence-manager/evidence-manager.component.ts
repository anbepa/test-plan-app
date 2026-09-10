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
  /** Se emite para descargar el reporte Serenity (.zip) generado. */
  @Output() downloadSerenityZip = new EventEmitter<void>();
  /** Se emite cuando el usuario valida un Plan ID de Azure DevOps, para recordarlo y no volver a pedirlo. */
  @Output() planValidated = new EventEmitter<{ planId: string; planTitle: string }>();

  /** Referencias a los subcomponentes embebidos (ocultos): reutilizamos su lógica sin duplicarla. */
  @ViewChild('down') down!: EvidenceDownloadModalComponent;
  @ViewChild('up') up!: EvidenceUploadModalComponent;

  showModal = false;
  isProcessing = false;
  processingMessage = '';
  /** Menú ⋮ abierto actualmente (formato), o null si ninguno. */
  activeMenu: 'word' | 'pdf' | 'excel' | 'serenity' | null = null;
  /** Sub-modal de "Cargar Azure" abierto. */
  showUploadModal = false;
  uploadMode: 'office' | 'serenity' | null = null;

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

  /** Cerrar con Escape: sub-modal → menú ⋮ → modal principal. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showUploadModal) {
      this.closeUploadModal();
      return;
    }
    if (this.activeMenu) {
      this.activeMenu = null;
      return;
    }
    if (this.showModal) this.closeModal();
  }

  /** Cierra el menú ⋮ al hacer clic fuera de él. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.activeMenu) return;
    const target = event.target as HTMLElement;
    const wraps = this.hostRef.nativeElement.querySelectorAll('.row-menu-wrap');
    let inside = false;
    wraps.forEach(w => { if (w.contains(target)) inside = true; });
    if (!inside) this.activeMenu = null;
  }

  closeModal(): void {
    if (this.isBusy) return;
    this.showModal = false;
    this.showUploadModal = false;
    this.activeMenu = null;
    this.unlockBodyScroll();
    this.lastFocusedElement?.focus?.();
    this.lastFocusedElement = null;
  }

  // ── Descargas (reutilizan la lógica del download-modal) ──
  downloadWord(): void { this.activeMenu = null; this.down?.downloadWord(); }
  downloadPDF(): void { this.activeMenu = null; this.down?.downloadPDF(); }
  downloadExcel(): void { this.activeMenu = null; this.down?.downloadExcel(); }

  // ── Reporte Serenity ──
  /** Generar reporte Serenity (dispatch al pipeline). */
  generateSerenity(): void {
    this.activeMenu = null;
    this.down?.downloadSerenity();
  }

  /** Descargar el reporte Serenity (.zip) ya generado. */
  downloadSerenityZipEmit(): void {
    this.activeMenu = null;
    this.downloadSerenityZip.emit();
  }

  // ── Menú ⋮ ──
  toggleMenu(format: 'word' | 'pdf' | 'excel' | 'serenity'): void {
    if (this.isBusy) return;
    this.activeMenu = this.activeMenu === format ? null : format;
  }

  // ── Sub-modal "Cargar Azure" ──
  openUploadModal(mode: 'office' | 'serenity'): void {
    this.activeMenu = null;
    this.uploadMode = mode;
    this.showUploadModal = true;
  }

  closeUploadModal(): void {
    if (this.isBusy) return;
    this.showUploadModal = false;
    this.uploadMode = null;
  }

  /** Valida el plan si aún no está validado o si el ID cambió. */
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

  /** Publica en DevOps los formatos Word/Excel/PDF marcados (juntos, como un único .zip). */
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

  /** Acción del botón "Cargar" del sub-modal. */
  async confirmUpload(): Promise<void> {
    const mode = this.uploadMode;
    this.closeUploadModal();
    if (mode === 'serenity') {
      await this.publishSerenity();
    } else {
      await this.publishOfficeFormats();
    }
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
