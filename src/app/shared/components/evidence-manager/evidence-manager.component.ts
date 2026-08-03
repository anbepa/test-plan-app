import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
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

  ngOnInit(): void {}

  ngOnDestroy(): void {}

  openModal(tab: 'download' | 'upload' = 'download'): void {
    if (this.isProcessing) return;
    this.activeTab = tab;
    this.showModal = true;
  }

  selectTab(tab: 'download' | 'upload'): void {
    if (this.isProcessing) return;
    this.activeTab = tab;
  }

  closeModal(): void {
    if (this.isProcessing) return;
    this.showModal = false;
  }

  handleOpenSerenityHistory(): void {
    this.showModal = false;
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
}
