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
  @Output() closeRequested = new EventEmitter<void>();

  isDownloading = false;
  downloadingFormat: 'word' | 'pdf' | 'serenity' | null = null;
  downloadProgressMessage = '';
  downloadProgressPercent = 0;

  private serenityStateCheckInterval: any = null;

  /**
   * TestRun efectivo: usa el recibido o construye uno desde la ejecución.
   * Word/PDF no necesitan un TestRun real; Serenity requiere executionId.
   */
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

  ngOnInit(): void {}

  ngOnDestroy(): void {
    if (this.serenityStateCheckInterval) {
      clearInterval(this.serenityStateCheckInterval);
    }
    this.serenityReportService.stopPolling();
  }

  closeModal(): void {
    this.closeRequested.emit();
  }

  /**
   * Descarga evidencias en formato Word
   */
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

  /**
   * Descarga evidencias en formato PDF
   */
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

  /**
   * Descarga reporte Serenity
   */
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

    this.isDownloading = true;
    this.downloadingFormat = 'serenity';
    this.downloadProgressMessage = 'Iniciando generación del reporte Serenity...';
    this.downloadProgressPercent = 0;
    this.cdr.detectChanges();

    // Monitorear estado cada 300ms
    this.serenityStateCheckInterval = setInterval(() => {
      const state = this.serenityReportService.state;
      
      // Actualizar mensaje según fase
      const phaseMessages: Record<string, string> = {
        'hydrating': 'Descargando evidencias...',
        'building': 'Construyendo y comprimiendo imágenes...',
        'dispatching': 'Enviando bundle al servidor...',
        'polling': 'Esperando generación del reporte...',
        'downloading': 'Descargando reporte generado...',
        'done': 'Reporte completado',
        'error': 'Error en generación de reporte'
      };

      this.downloadProgressMessage = phaseMessages[state.phase] || state.statusMessage || 'Procesando...';
      
      if (state.hydrateProgress?.percentage) {
        this.downloadProgressPercent = state.hydrateProgress.percentage;
      } else if (state.phase === 'done' || state.phase === 'downloading') {
        this.downloadProgressPercent = 100;
      }

      this.cdr.detectChanges();

      if (state.phase === 'done') {
        clearInterval(this.serenityStateCheckInterval);
        this.isDownloading = false;
        this.downloadingFormat = null;
        this.downloadProgressMessage = '';
        this.downloadProgressPercent = 0;
        this.toastService.success('Reporte Serenity descargado');
        this.cdr.detectChanges();
      }

      if (state.phase === 'error') {
        clearInterval(this.serenityStateCheckInterval);
        this.isDownloading = false;
        this.downloadingFormat = null;
        this.downloadProgressMessage = '';
        this.downloadProgressPercent = 0;
        this.toastService.error(state.error || 'Error al generar reporte Serenity');
        this.cdr.detectChanges();
      }
    }, 300);

    // Timeout de 10 minutos
    setTimeout(() => {
      if (this.isDownloading && this.downloadingFormat === 'serenity') {
        clearInterval(this.serenityStateCheckInterval);
        this.isDownloading = false;
        this.downloadingFormat = null;
        this.downloadProgressMessage = '';
        this.downloadProgressPercent = 0;
        this.serenityReportService.stopPolling();
        this.toastService.warning('Timeout: el reporte está tardando demasiado');
        this.cdr.detectChanges();
      }
    }, 600000);

    try {
      await this.serenityReportService.generateReport(run);
    } catch (error: any) {
      clearInterval(this.serenityStateCheckInterval);
      this.isDownloading = false;
      this.downloadingFormat = null;
      this.downloadProgressMessage = '';
      this.downloadProgressPercent = 0;
      console.error('Error starting Serenity report:', error);
      this.toastService.error('Error al iniciar generación Serenity: ' + (error.message || 'Error desconocido'));
      this.cdr.detectChanges();
    }
  }
}

