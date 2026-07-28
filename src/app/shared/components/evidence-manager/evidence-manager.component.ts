import { Component, Input, OnInit, OnDestroy } from '@angular/core';
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

  showMenu = false;
  showDownloadModal = false;
  showUploadModal = false;
  isProcessing = false;
  processingMessage = '';

  ngOnInit(): void {
    // Cerrar menu si se hace clic afuera
    document.addEventListener('click', this.handleClickOutside);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.handleClickOutside);
  }

  private handleClickOutside = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.evidence-manager')) {
      this.showMenu = false;
    }
  };

  toggleMenu(): void {
    if (!this.isProcessing) {
      this.showMenu = !this.showMenu;
    }
  }

  selectDownload(): void {
    this.showMenu = false;
    this.showDownloadModal = true;
    this.showUploadModal = false;
  }

  selectUpload(): void {
    this.showMenu = false;
    this.showUploadModal = true;
    this.showDownloadModal = false;
  }

  handleDownloadClose(): void {
    this.showDownloadModal = false;
  }

  handleUploadClose(): void {
    this.showUploadModal = false;
  }

  setProcessing(event: any): void {
    this.isProcessing = event.isProcessing;
    this.processingMessage = event.message;
  }
}
