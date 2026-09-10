import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlanExecution, HUData, TestRun } from '../../../models/hu-data.model';
import { EvidenceDownloadModalComponent } from '../evidence-download-modal/evidence-download-modal.component';
import { EvidenceUploadModalComponent } from '../evidence-upload-modal/evidence-upload-modal.component';
import { SerenityReportService, SerenityReportRecord } from '../../../services/export/serenity-report.service';
import { AzureDevOpsEvidenceService } from '../../../services/integrations/azure-devops-evidence.service';
import { ToastService } from '../../../services/core/toast.service';

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

  /** Último reporte Serenity (para mostrar su estado al cargar a Azure). */
  serenityReport: SerenityReportRecord | null = null;
  isLoadingSerenityReport = false;
  private isAttachingSerenity = false;
  private serenityPollTimer: any = null;

  private previousBodyOverflow: string | null = null;
  private lastFocusedElement: HTMLElement | null = null;

  constructor(
    private hostRef: ElementRef<HTMLElement>,
    private serenityReportService: SerenityReportService,
    private azureEvidence: AzureDevOpsEvidenceService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.stopSerenityPolling();
    this.unlockBodyScroll();
  }

  /** ¿Hay alguna operación en curso? Combina los estados de ambos subcomponentes. */
  get isBusy(): boolean {
    return this.isProcessing
      || this.isAttachingSerenity
      || !!this.down?.isDownloading
      || !!this.up?.isValidating
      || !!this.up?.isUploading;
  }

  /** Formato de descarga que se está generando actualmente (word|pdf|excel|serenity|null). */
  get downloadingFormat(): 'word' | 'pdf' | 'excel' | 'serenity' | null {
    return this.down?.downloadingFormat ?? null;
  }

  /** ¿El reporte Serenity está listo para cargar a Azure? */
  get serenityReady(): boolean {
    return !!this.serenityReport?.artifactDownloadUrl;
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
    this.stopSerenityPolling();
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
    if (mode === 'serenity') {
      this.loadSerenityReport();
    }
  }

  closeUploadModal(): void {
    if (this.isBusy) return;
    this.showUploadModal = false;
    this.uploadMode = null;
    this.stopSerenityPolling();
  }

  /** Carga el último reporte Serenity para mostrar su estado en el sub-modal. */
  async loadSerenityReport(): Promise<void> {
    this.isLoadingSerenityReport = true;
    try {
      const list = await this.serenityReportService.loadHistory(this.execution?.id);
      this.serenityReport = list[0] || null;
      if (this.serenityReport?.status === 'pending') {
        this.startSerenityPolling();
      } else {
        this.stopSerenityPolling();
      }
    } finally {
      this.isLoadingSerenityReport = false;
    }
  }

  /** Refresco manual del estado del reporte Serenity. */
  async refreshSerenityReport(): Promise<void> {
    if (this.isLoadingSerenityReport) return;
    await this.loadSerenityReport();
  }

  private startSerenityPolling(): void {
    this.stopSerenityPolling();
    this.serenityPollTimer = setInterval(async () => {
      if (!this.serenityReport) { this.stopSerenityPolling(); return; }
      const updated = await this.serenityReportService.checkReportStatus(this.serenityReport.id);
      if (updated) this.serenityReport = updated;
      if (this.serenityReport && this.serenityReport.status !== 'pending') {
        this.stopSerenityPolling();
      }
    }, 5000);
  }

  private stopSerenityPolling(): void {
    if (this.serenityPollTimer) {
      clearInterval(this.serenityPollTimer);
      this.serenityPollTimer = null;
    }
  }

  // ── Validación de plan ──
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

  /** Carga a Azure el último reporte Serenity generado (sin regenerarlo). */
  async attachSerenity(): Promise<void> {
    const report = this.serenityReport;
    if (!report?.artifactDownloadUrl) return;
    if (!this.up) return;
    const fileName = (this.up.serenityFileName || '').trim();
    if (!fileName) return;

    const ready = await this.ensurePlanValidated();
    if (!ready) return;

    // Cierra el sub-modal y deja el aviso de proceso en el modal principal.
    this.showUploadModal = false;
    this.uploadMode = null;
    this.stopSerenityPolling();

    this.isProcessing = true;
    this.processingMessage = 'Cargando reporte Serenity...';
    try {
      const validated = this.up.validatedPlan!;
      const blob = await this.fetchAsBlob(report.artifactDownloadUrl);
      const base64 = await this.blobToBase64(blob);
      await this.azureEvidence.uploadAttachment(
        validated.planId,
        validated.areaPath,
        fileName,
        base64,
        validated.planTitle,
        validated.projectId
      );
      this.toastService.success(`Reporte Serenity cargado al plan ${validated.planId}`);
    } catch (err: any) {
      this.toastService.error('Error al cargar el reporte: ' + (err?.message || 'Error desconocido'));
    } finally {
      this.isProcessing = false;
      this.processingMessage = '';
    }
  }

  /** Acción del botón "Cargar" del sub-modal. */
  async confirmUpload(): Promise<void> {
    const mode = this.uploadMode;
    if (mode === 'serenity') {
      await this.attachSerenity();
    } else {
      this.closeUploadModal();
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

  // ── Formato de fechas / estado ──
  formatSerenityDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  formatSerenityRelative(iso: string): string {
    if (!iso) return '';
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return '';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 0) return '';
    if (diffSec < 60) return 'hace unos segundos';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'ayer';
    if (days < 30) return `hace ${days} días`;
    return '';
  }

  serenityStatusLabel(status: string): string {
    if (status === 'pending') return 'Generando...';
    if (status === 'completed') return 'Completado';
    if (status === 'error') return 'Error';
    return status;
  }

  private async fetchAsBlob(url: string): Promise<Blob> {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo descargar el reporte');
    return res.blob();
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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
