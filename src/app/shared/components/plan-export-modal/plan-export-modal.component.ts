import { Component, Input, Output, EventEmitter, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HUData } from '../../../models/hu-data.model';
import { ValidatedPlanInfo, PlanValidationError } from '../../../models/azure-devops-evidence.model';
import { AzureDevOpsEvidenceService } from '../../../services/integrations/azure-devops-evidence.service';
import { ToastService } from '../../../services/core/toast.service';
import { WordExporterComponent } from '../../../word-exporter/word-exporter.component';

@Component({
  selector: 'app-plan-export-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, WordExporterComponent],
  templateUrl: './plan-export-modal.component.html',
  styleUrls: ['./plan-export-modal.component.css']
})
export class PlanExportModalComponent {
  @Input() testPlanTitle: string = '';
  @Input() previewHtmlContent: string = '';
  @Input() repositoryLink: string = '';
  @Input() outOfScopeContent: string = '';
  @Input() strategyContent: string = '';
  @Input() limitationsContent: string = '';
  @Input() assumptionsContent: string = '';
  @Input() teamContent: string = '';
  @Input() huList: HUData[] = [];

  @Output() onClose = new EventEmitter<void>();

  @ViewChild('wordExporter') wordExporter!: WordExporterComponent;

  activeTab: 'local' | 'azure' = 'local';
  isDownloadingPdf: boolean = false;
  isDownloadingDocx: boolean = false;

  // Copiar al portapapeles
  copiedToClipboard: boolean = false;

  // Estado de Azure DevOps
  inputPlanId: string = '';
  isValidating: boolean = false;
  isSending: boolean = false;
  planValidated: boolean = false;
  validatedPlan: ValidatedPlanInfo | null = null;
  validationError: PlanValidationError | null = null;
  sendCompleted: boolean = false;
  sendError: string = '';

  constructor(
    private evidenceService: AzureDevOpsEvidenceService,
    private toastService: ToastService
  ) {}

  closeIfClickOutside(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  close(): void {
    if (!this.isValidating && !this.isSending) {
      this.onClose.emit();
    }
  }

  selectTab(tab: 'local' | 'azure'): void {
    this.activeTab = tab;
  }

  // --- LÓGICA DE EXPORTACIÓN LOCAL ---

  private buildPlainTextFromPreviewHtml(): string {
    return (this.previewHtmlContent || '')
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, (match, title) => `\n\n${title.toUpperCase()}\n\n`)
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, (match, title) => `\n\n${title.toUpperCase()}\n\n`)
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, (match, title) => `\n\n${title}\n\n`)
      .replace(/<li[^>]*>(.*?)<\/li>/gi, ' • $1\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private buildApaClipboardHtml(): string {
    const safeContent = this.previewHtmlContent || '';
    return `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 2; margin: 1in; color: #000; }
        h1, h2, h3 { font-weight: bold; margin: 0 0 12pt 0; page-break-after: avoid; }
        h1 { font-size: 16pt; }
        h2 { font-size: 14pt; }
        h3 { font-size: 12pt; }
        p { margin: 0 0 12pt 0; text-align: left; }
        ul, ol { margin: 0 0 12pt 24pt; padding: 0; }
        li { margin: 0 0 6pt 0; }
    </style>
</head>
<body>
${safeContent}
</body>
</html>`;
  }

  async copyToClipboard(): Promise<void> {
    if (!this.previewHtmlContent) return;

    const textContent = this.buildPlainTextFromPreviewHtml();
    const htmlContent = this.buildApaClipboardHtml();

    try {
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (navigator.clipboard?.write && ClipboardItemCtor) {
        const item = new ClipboardItemCtor({
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([textContent], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        this.triggerCopied();
        return;
      }

      await navigator.clipboard.writeText(textContent);
      this.triggerCopied();
    } catch (err) {
      console.error('Error al copiar:', err);
      this.toastService.error('Error al copiar al portapapeles.');
    }
  }

  private triggerCopied(): void {
    this.copiedToClipboard = true;
    this.toastService.success('Copiado al portapapeles');
    setTimeout(() => { this.copiedToClipboard = false; }, 2500);
  }

  downloadPdf(): void {
    if (this.wordExporter) {
      this.wordExporter.downloadScenariosPdf();
    }
  }

  downloadDocx(): void {
    if (this.wordExporter) {
      this.wordExporter.exportToWord();
    }
  }

  // --- LÓGICA DE AZURE DEVOPS ---

  async validatePlan(): Promise<void> {
    if (!this.inputPlanId.trim()) return;

    this.isValidating = true;
    this.validationError = null;

    try {
      const result = await this.evidenceService.validateTestPlan(this.inputPlanId.trim());
      this.validatedPlan = result;
      this.planValidated = true;
      this.toastService.success('Plan de Azure DevOps validado correctamente');
    } catch (error: any) {
      console.error('Error al validar plan en Azure:', error);
      this.validationError = error || {
        code: 'UNKNOWN',
        message: 'Error desconocido al validar el plan en Azure DevOps'
      };
      this.toastService.error(this.getValidationErrorMessage());
    } finally {
      this.isValidating = false;
    }
  }

  getValidationErrorMessage(): string {
    if (!this.validationError) return '';
    return this.validationError.message || 'Error al validar el plan de Azure DevOps.';
  }

  resetValidation(): void {
    this.planValidated = false;
    this.validatedPlan = null;
    this.validationError = null;
    this.sendCompleted = false;
    this.sendError = '';
  }

  async sendPlanToAzure(): Promise<void> {
    if (!this.validatedPlan) {
      this.toastService.error('Debes validar el plan de Azure DevOps primero.');
      return;
    }

    this.isSending = true;
    this.sendError = '';
    this.sendCompleted = false;

    try {
      const planId = this.validatedPlan.planId;
      const titleToUpdate = this.testPlanTitle || `Plan de Pruebas ${planId}`;
      const descriptionToUpdate = this.previewHtmlContent || '';

      await this.evidenceService.updateTestPlanFields(planId, titleToUpdate, descriptionToUpdate);

      this.sendCompleted = true;
      this.toastService.success(`Plan ${planId} actualizado en Azure DevOps exitosamente`);
    } catch (error: any) {
      console.error('Error al enviar plan a Azure DevOps:', error);
      this.sendError = error?.message || 'Error al actualizar el plan en Azure DevOps.';
      this.toastService.error(this.sendError);
    } finally {
      this.isSending = false;
    }
  }
}
