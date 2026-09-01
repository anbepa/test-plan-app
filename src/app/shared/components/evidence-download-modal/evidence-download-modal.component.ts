import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestRun, HUData, PlanExecution } from '../../../models/hu-data.model';
import { ExportService } from '../../../services/export/export.service';
import { ToastService } from '../../../services/core/toast.service';
import { DatabaseService } from '../../../services/database/database.service';
import { SerenityReportService } from '../../../services/export/serenity-report.service';

@Component({
  selector: 'app-evidence-download-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './evidence-download-modal.component.html',
  styleUrl: './evidence-download-modal.component.css'
})
export class EvidenceDownloadModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() testRun: TestRun | null = null;
  @Input() execution: PlanExecution | null = null;
  @Input() huData: HUData | null = null;
  /** Cuando es true, el componente renderiza solo el contenido (sin backdrop ni header propios), para ser embebido en un modal contenedor. */
  @Input() embedded = false;
  @Output() closeRequested = new EventEmitter<void>();
  @Output() openSerenityHistoryRequested = new EventEmitter<void>();

  isDownloading = false;
  downloadingFormat: 'word' | 'pdf' | 'excel' | 'serenity' | null = null;
  downloadProgressMessage = '';
  downloadProgressPercent = 0;
  serenityHistoryCount = 0;
  serenityDispatched = false;
  serenityStatusMessage = '';
  private serenityStatusTimer: any = null;

  get effectiveTestRun(): TestRun | null {
    if (this.testRun) return this.testRun;
    if (!this.execution) return null;
    return {
      id: this.execution.id,
      executionId: this.execution.id,
      name: this.execution.huTitle || 'Reporte',
      huId: this.execution.huId || '',
      huTitle: this.execution.huTitle || '',
      testPlanId: '',
      testPlanTitle: '',
      status: 'In Progress',
      notes: '',
      tags: [],
      milestone: '',
      selectedTestCaseIds: [],
      includeAllTestCases: true,
      totalTestCases: 0,
      completedTestCases: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as TestRun;
  }

  constructor(
    private exportService: ExportService,
    private toastService: ToastService,
    private databaseService: DatabaseService,
    private serenityReportService: SerenityReportService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    try { this.serenityHistoryCount = (await this.serenityReportService.loadHistory(this.execution?.id)).length; } catch { this.serenityHistoryCount = 0; }
    this.serenityDispatched = false;
  }

  ngOnDestroy(): void {
    this.stopSerenityStatusPolling();
    this.serenityReportService.stopPolling();
  }

  openSerenityHistory(): void {
    this.openSerenityHistoryRequested.emit();
  }

  closeModal(): void {
    this.closeRequested.emit();
  }

  async downloadWord(): Promise<void> {
    if (!this.execution) {
      this.toastService.warning('No hay información disponible para descargar');
      return;
    }

    this.isDownloading = true;
    this.downloadingFormat = 'word';
    this.downloadProgressMessage = 'Generando documento Word...';
    this.downloadProgressPercent = 0;
    this.cdr.detectChanges();

    try {
      await this.exportService.exportExecutionToDOCX(
        this.execution,
        this.huData,
        (current, total) => {
          this.downloadProgressPercent = Math.round((current / total) * 100);
          this.cdr.detectChanges();
        }
      );
      this.toastService.success('Documento Word descargado exitosamente');
    } catch (error: any) {
      console.error('Error downloading Word:', error);
      this.toastService.error('Error al descargar documento Word: ' + (error.message || 'Error desconocido'));
    } finally {
      this.isDownloading = false;
      this.downloadingFormat = null;
      this.downloadProgressMessage = '';
      this.downloadProgressPercent = 0;
      this.cdr.detectChanges();
    }
  }

  async downloadPDF(): Promise<void> {
    if (!this.execution) {
      this.toastService.warning('No hay información disponible para descargar');
      return;
    }

    this.isDownloading = true;
    this.downloadingFormat = 'pdf';
    this.downloadProgressMessage = 'Generando documento PDF...';
    this.downloadProgressPercent = 0;
    this.cdr.detectChanges();

    try {
      await this.exportService.exportExecutionToPDF(
        this.execution,
        this.huData,
        (current, total) => {
          this.downloadProgressPercent = Math.round((current / total) * 100);
          this.cdr.detectChanges();
        }
      );
      this.toastService.success('Documento PDF descargado exitosamente');
    } catch (error: any) {
      console.error('Error downloading PDF:', error);
      this.toastService.error('Error al descargar documento PDF: ' + (error.message || 'Error desconocido'));
    } finally {
      this.isDownloading = false;
      this.downloadingFormat = null;
      this.downloadProgressMessage = '';
      this.downloadProgressPercent = 0;
      this.cdr.detectChanges();
    }
  }

  async downloadExcel(): Promise<void> {
    if (!this.execution) {
      this.toastService.warning('No hay información disponible para descargar');
      return;
    }

    this.isDownloading = true;
    this.downloadingFormat = 'excel';
    this.downloadProgressMessage = 'Generando documento Excel...';
    this.downloadProgressPercent = 0;
    this.cdr.detectChanges();

    try {
      await this.exportService.exportExecutionToXLSX(
        this.execution,
        this.huData,
        (current, total) => {
          this.downloadProgressPercent = Math.round((current / total) * 100);
          this.cdr.detectChanges();
        }
      );
      this.toastService.success('Documento Excel descargado exitosamente');
    } catch (error: any) {
      console.error('Error downloading Excel:', error);
      this.toastService.error('Error al descargar documento Excel: ' + (error.message || 'Error desconocido'));
    } finally {
      this.isDownloading = false;
      this.downloadingFormat = null;
      this.downloadProgressMessage = '';
      this.downloadProgressPercent = 0;
      this.cdr.detectChanges();
    }
  }

  async downloadSerenity(): Promise<void> {
    const run = this.effectiveTestRun;
    if (!run) {
      this.toastService.warning('No hay ejecución disponible');
      return;
    }

    if (!run.executionId) {
      this.toastService.warning('Ejecuta esta prueba y carga evidencias antes de generar el reporte.');
      return;
    }

    if (this.isDownloading && this.downloadingFormat === 'serenity') return;

    this.isDownloading = true;
    this.downloadingFormat = 'serenity';
    this.downloadProgressMessage = 'Enviando a pipeline de Azure...';
    this.serenityStatusMessage = 'Preparando reporte...';
    this.startSerenityStatusPolling();
    this.cdr.detectChanges();

    try {
      this.serenityReportService.backend = 'azure';
      await this.serenityReportService.generateReport(run, { autoDetectBackend: false });

      this.stopSerenityStatusPolling();
      this.isDownloading = false;
      this.downloadingFormat = null;
      this.serenityStatusMessage = '';
      this.serenityDispatched = true;
      this.toastService.success('Reporte Serenity enviado a Azure DevOps');
      this.serenityHistoryCount = (await this.serenityReportService.loadHistory(this.execution?.id)).length;
      this.cdr.detectChanges();
      // Abrir automáticamente la trazabilidad del reporte recién generado
      this.openSerenityHistory();
    } catch (error: any) {
      this.stopSerenityStatusPolling();
      this.isDownloading = false;
      this.downloadingFormat = null;
      this.serenityStatusMessage = '';
      console.error('Error starting Serenity report:', error);
      this.toastService.error('Error al iniciar generación Serenity: ' + (error.message || 'Error desconocido'));
      this.cdr.detectChanges();
    }
  }

  /**
   * Refresca periódicamente el mensaje de estado del servicio Serenity mientras
   * se genera el reporte, para que el usuario vea el avance real (descarga de
   * evidencias, empaquetado, subida) en lugar de un spinner sin contexto.
   */
  private startSerenityStatusPolling(): void {
    this.stopSerenityStatusPolling();
    this.serenityStatusTimer = setInterval(() => {
      const msg = this.serenityReportService.state?.statusMessage;
      if (msg) {
        this.serenityStatusMessage = msg;
        this.cdr.detectChanges();
      }
    }, 300);
  }

  private stopSerenityStatusPolling(): void {
    if (this.serenityStatusTimer) {
      clearInterval(this.serenityStatusTimer);
      this.serenityStatusTimer = null;
    }
  }
}
