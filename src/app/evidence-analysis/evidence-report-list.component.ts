import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EvidenceDatabaseService } from '../services/database/evidence-database.service';
import { EvidenceExcelService } from '../services/core/evidence-excel.service';
import { ExportService } from '../services/export/export.service';
import { ToastService } from '../services/core/toast.service';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-evidence-report-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ConfirmationModalComponent],
  template: `
    <div class="manual-exec-page fade-in">

      <div class="manual-exec-content">
        <!-- Title Bar -->
        <div class="title-bar">
          <div>
            <h2 class="section-title">Escenarios de Prueba</h2>
            <p class="section-subtitle-text">Consulta y gestiona los escenarios generados por Historia de Usuario</p>
          </div>
        </div>

        <!-- Filters Bar -->
        <div class="filters-bar">
          <div class="search-box" style="flex: 1.5;">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              class="search-input" 
              [(ngModel)]="huFilter" 
              placeholder="ID de HU (Ej: 15834)..." 
              (keyup.enter)="loadReports()"
            >
          </div>
          <div class="search-box" style="flex: 2.5;">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              class="search-input" 
              [(ngModel)]="textFilter" 
              placeholder="Filtrar por nombre del escenario o palabra clave..."
            >
          </div>
          <div class="search-box" style="width: 160px;">
            <select class="search-input filter-select" [(ngModel)]="statusFilter">
              <option value="">Todos los estados</option>
              <option value="Exitoso">Exitoso</option>
              <option value="Fallido">Fallido</option>
            </select>
          </div>
          <div class="filter-group">
            <button class="button-primary" (click)="loadReports()">Buscar HU</button>
            <button class="button-ghost" (click)="clearFilters()">Limpiar</button>
          </div>
        </div>

        <!-- HU Info & Bulk Actions -->
        <div class="hu-meta-bar" *ngIf="appliedHuFilter">
          <div class="hu-info-group">
            <div class="hu-pill-group">
              <span class="hu-pill">{{ appliedHuFilter }}</span>
              <span class="hu-display-name" *ngIf="huName">{{ huName }}</span>
            </div>
          </div>
          
          <div class="hu-actions-group">
            <div class="export-btn-group">
              <button class="export-trigger" (click)="exportAllExcel()" [disabled]="filteredReports.length === 0">
                Excel
              </button>
              <button class="export-trigger" (click)="exportAllDocx()" [disabled]="filteredReports.length === 0">
                Word
              </button>
            </div>
            <button class="btn-minimal-danger" (click)="requestDeleteHU()" [disabled]="!appliedHuFilter" title="Eliminar Historia de Usuario">
              🗑
            </button>
          </div>
        </div>

        <!-- Results Table -->
        <div class="table-results-wrapper" *ngIf="appliedHuFilter">
          <div class="table-container">
            <table class="plans-table">
              <thead>
                <tr>
                  <th class="check-col">
                    <input type="checkbox" [checked]="areAllVisibleSelected()" (change)="toggleSelectAllVisible()">
                  </th>
                  <th style="width: 100px;">ID CASO</th>
                  <th style="width: 100px;">HU</th>
                  <th>NOMBRE DEL ESCENARIO</th>
                  <th style="width: 100px; text-align: center;">PASOS</th>
                  <th style="width: 140px;">ESTADO</th>
                  <th style="width: 160px;">FECHA CREACIÓN</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let report of filteredReports" [class.row-selected]="selectedReports.includes(report.id)" (click)="goToDetail(report.id)">
                  <td class="check-col" (click)="$event.stopPropagation()">
                    <input type="checkbox" [checked]="selectedReports.includes(report.id)" (click)="toggleSelection(report.id)">
                  </td>
                  <td><strong>{{ report.id_caso || '1' }}</strong></td>
                  <td>
                    <span class="hu-pill-sm">{{ report.historia_usuario || 'N/A' }}</span>
                  </td>
                  <td class="scenario-name-cell">
                    <a class="scenario-link">{{ report.nombre_del_escenario }}</a>
                  </td>
                  <td style="text-align: center;">
                    <span class="steps-badge">{{ report.steps_count }}</span>
                  </td>
                  <td>
                    <span class="status-badge" [class.success]="report.estado_general === 'Exitoso'">
                      <span class="dot"></span> {{ report.estado_general || 'Exitoso' }}
                    </span>
                  </td>
                  <td>
                    <div class="date-cell">
                      <span class="date-bold">{{ report.created_at | date:'dd/MM/yyyy' }}</span>
                      <span class="time-grey">{{ report.created_at | date:'HH:mm' }}</span>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="filteredReports.length === 0">
                  <td colspan="7" class="empty-table-msg">
                    No se encontraron escenarios para la historia <strong>{{ appliedHuFilter }}</strong>.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Initial State Placeholder -->
        <div class="empty-state" *ngIf="!appliedHuFilter">
          <div class="empty-state-icon">🔍</div>
          <h3>Busca por Historia de Usuario</h3>
          <p>Ingresa el número de una HU en los filtros superiores para visualizar sus escenarios de prueba generados.</p>
        </div>

        <!-- Pagination -->
        <div class="pagination-container" *ngIf="appliedHuFilter && filteredReports.length > 0">
          <div class="pagination-info">
            <p>Mostrando <strong>1-{{ filteredReports.length }}</strong> de <strong>{{ filteredReports.length }}</strong> escenarios</p>
          </div>
          <div class="pagination-controls">
            <button class="pag-btn" disabled>‹</button>
            <div class="pag-pages">
              <span class="pag-page active">1</span>
            </div>
            <button class="pag-btn" disabled>›</button>
          </div>
        </div>
      </div>

      <!-- Bulk action bar -->
      <div class="bulk-delete-bar" *ngIf="selectedReports.length > 0">
        <span class="bulk-count">{{ selectedReports.length }} escenario{{ selectedReports.length !== 1 ? 's' : '' }} seleccionado{{ selectedReports.length !== 1 ? 's' : '' }}</span>
        <button class="bulk-delete-btn" (click)="requestDeleteSelected()">
          <span class="icon-trash-white"></span>
          Eliminar seleccionados
        </button>
        <button class="bulk-cancel-btn" (click)="clearSelection()">Cancelar</button>
      </div>

      <!-- Export Progress Overlay -->
      <div class="global-loading-overlay export-progress-overlay" *ngIf="isExporting">
        <div class="loading-box export-progress-box">
          <div class="export-icon">
            <i class="pi pi-cloud-download" style="font-size: 1.5rem;"></i>
          </div>
          <p class="export-title">Generando reporte {{ exportType }}</p>
          <p class="export-subtitle">Procesando escenario {{ exportProgress }} de {{ exportTotal }}…</p>
          <div class="export-progress-track">
            <div class="export-progress-fill" [style.width.%]="(exportTotal > 0 ? (exportProgress / exportTotal) * 100 : 0)"></div>
          </div>
        </div>
      </div>

      <app-confirmation-modal
        [isOpen]="showDeleteModal"
        [title]="deleteModalTitle"
        [message]="deleteModalMessage"
        [confirmText]="'Eliminar permanentemente'"
        [cancelText]="'Cancelar'"
        [type]="'danger'"
        (confirm)="confirmDeletion()"
        (cancel)="showDeleteModal = false"
      ></app-confirmation-modal>
    </div>
  `,
  styles: [`
    .manual-exec-page {
      min-height: 100vh;
      background: #f5f5f7;
      padding: 2rem;
    }

    .manual-exec-header {
      max-width: 1400px;
      margin: 0 auto 1rem auto;
    }

    .breadcrumb-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      color: #86868b;
      font-size: 0.9rem;
    }
    
    .back-pill {
      width: 32px; height: 32px; border-radius: 10px; border: 1.5px solid #d2d2d7;
      background: white; color: #007AFF; font-size: 1.2rem; cursor: pointer;
      display: flex; align-items: center; justify-content: center; transition: all 0.2s;
    }
    .back-pill:hover { background: #f5f5f7; border-color: #007AFF; }

    .breadcrumb-link { color: #007AFF; cursor: pointer; font-weight: 500; }
    .breadcrumb-link:hover { text-decoration: underline; }
    .breadcrumb-separator { color: #d2d2d7; margin: 0 -0.25rem; }
    .breadcrumb-current { color: #1d1d1f; font-weight: 600; }

    .manual-exec-content {
      max-width: 1400px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #d2d2d7;
      border-radius: 1.2rem;
      padding: 2rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.03);
    }

    /* Title Bar */
    .title-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
    }

    .section-title {
      margin: 0;
      font-size: 1.6rem;
      font-weight: 700;
      color: #1d1d1f;
    }

    .section-subtitle-text {
      margin: 0.4rem 0 0;
      color: #86868b;
      font-size: 0.95rem;
    }

    /* Filters Bar */
    .filters-bar {
      display: flex;
      gap: 1rem;
      align-items: center;
      margin-bottom: 1.5rem;
      background: #fbfbfc;
      padding: 1.25rem;
      border-radius: 1rem;
      border: 1px solid #f2f2f7;
    }

    .search-box {
      position: relative;
    }

    .search-icon {
      position: absolute;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      color: #9ca3af;
      font-size: 0.9rem;
    }

    .search-input {
      width: 100%;
      padding: 0.75rem 1rem 0.75rem 2.8rem;
      border: 1.5px solid #d2d2d7;
      border-radius: 12px;
      font-size: 0.95rem;
      outline: none;
      transition: all 0.2s;
    }

    .search-input:focus {
      border-color: #007AFF;
      box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.1);
    }

    .filter-group { display: flex; gap: 0.75rem; }

    /* Buttons */
    .button-primary {
      padding: 0.75rem 1.5rem;
      border-radius: 12px;
      font-weight: 700;
      background: #007AFF;
      color: white;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
    }

    .button-primary:hover { opacity: 0.9; transform: translateY(-1px); }

    .button-secondary {
      padding: 0.75rem 1.2rem;
      border-radius: 12px;
      font-weight: 600;
      background: white;
      border: 1.5px solid #d2d2d7;
      color: #1d1d1f;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .button-secondary:hover { background: #f5f5f7; border-color: #86868b; }

    .button-ghost {
      padding: 0.75rem 1.2rem;
      border-radius: 12px;
      font-weight: 600;
      background: transparent;
      border: 1px solid transparent;
      color: #007AFF;
      cursor: pointer;
      transition: all 0.2s;
    }
    .button-ghost:hover { background: rgba(0, 122, 255, 0.05); }

    .filter-select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; background-size: 16px; padding-right: 32px !important; }

    /* HU Meta Bar */
    .hu-meta-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding: 1.25rem;
      background: #f8f9fb;
      border-radius: 16px;
      border: 1px solid #f2f2f7;
    }

    .hu-info-group { display: flex; flex-direction: column; gap: 0.25rem; }
    .hu-pill-group { display: flex; align-items: center; gap: 0.75rem; }
    
    .hu-pill {
      background: #007AFF;
      color: white;
      padding: 0.3rem 0.8rem;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.85rem;
      box-shadow: 0 4px 10px rgba(0, 122, 255, 0.2);
    }

    .hu-display-name {
      font-size: 1.2rem;
      font-weight: 800;
      color: #1d1d1f;
      letter-spacing: -0.02em;
    }

    .hu-actions-group { display: flex; align-items: center; gap: 0.75rem; }
    
    .export-btn-group {
      display: flex;
      background: #ffffff;
      border: 1.5px solid #d2d2d7;
      border-radius: 10px;
      overflow: hidden;
    }
    .export-trigger {
      padding: 0.5rem 1rem;
      background: none;
      border: none;
      font-weight: 700;
      font-size: 12px;
      color: #1d1d1f;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: background 0.2s;
    }
    .export-trigger:first-child { border-right: 1.5px solid #d2d2d7; }
    .export-trigger:hover:not(:disabled) { background: #f5f5f7; }
    .export-trigger:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-minimal-danger {
      width: 32px; height: 32px; border-radius: 8px; border: none;
      background: #fff2f1; color: #ff3b30; font-size: 0.9rem;
      cursor: pointer; transition: all 0.2s;
      display: flex; align-items: center; justify-content: center;
    }
    .btn-minimal-danger:hover { background: #ff3b30; color: white; }

    /* Table */
    .table-results-wrapper { margin-top: 1rem; }

    .table-container {
      width: 100%;
      overflow-x: auto;
      border-radius: 1rem;
      border: 1px solid #e8edf5;
      background: #ffffff;
      box-shadow: 0 4px 20px rgba(0,0,0,0.02);
    }

    .plans-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }

    .plans-table th {
      background: #f8f9fb;
      padding: 1.1rem 1rem;
      text-align: left;
      font-size: 0.75rem;
      font-weight: 700;
      color: #86868b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #e8edf5;
    }

    .plans-table td {
      padding: 1.25rem 1rem;
      border-bottom: 1px solid #f8f9fb;
      font-size: 0.95rem;
      color: #1d1d1f;
      vertical-align: middle;
    }

    .plans-table tr { cursor: pointer; transition: background 0.15s; }
    .plans-table tr:hover { background: #f9fbff; }
    .plans-table tr.row-selected { background: #f0f7ff; }

    .check-col { width: 48px; text-align: center; }
    .check-col input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #007AFF; }

    .hu-pill-sm {
      background: #f0f0f5;
      color: #0071e3;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-weight: 700;
      font-size: 0.75rem;
    }

    .scenario-name-cell { font-weight: 500; }
    .scenario-link { color: #007AFF; cursor: pointer; text-decoration: none; font-weight: 600; transition: color 0.2s; }
    .scenario-link:hover { color: #004ecc; text-decoration: underline; }

    .steps-badge {
      background: #f0f0f5;
      color: #86868b;
      padding: 0.4rem 0.8rem;
      border-radius: 8px;
      font-weight: 700;
      font-size: 0.85rem;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #f5f5f7;
      padding: 0.4rem 1rem;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.8rem;
    }

    .status-badge.success { background: #f0faf4; color: #21a366; }
    .status-badge .dot { width: 7px; height: 7px; background: #34c759; border-radius: 50%; }

    .date-cell { display: flex; flex-direction: column; gap: 0.2rem; }
    .date-bold { font-weight: 800; font-size: 0.9rem; color: #1d1d1f; }
    .time-grey { color: #86868b; font-size: 0.8rem; font-weight: 500; }

    .empty-table-msg { padding: 4rem; text-align: center; color: #86868b; }

    /* Empty State */
    .empty-state {
      padding: 6rem 2rem;
      text-align: center;
      background: #fff;
      border: 2px dashed #d2d2d7;
      border-radius: 1.5rem;
      margin-top: 2rem;
    }

    .empty-state-icon { font-size: 3.5rem; margin-bottom: 1.5rem; color: #d2d2d7; }
    .empty-state h3 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.8rem; }
    .empty-state p { color: #86868b; max-width: 400px; margin: 0 auto; line-height: 1.5; }

    /* Pagination */
    .pagination-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 1.5rem;
      padding: 1rem 0.5rem;
    }

    .pagination-info p { margin: 0; font-size: 0.85rem; color: #86868b; }

    /* Bulk Delete Bar */
    .bulk-delete-bar {
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 999px;
      padding: 0.55rem 0.55rem 0.55rem 1.25rem;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15);
      z-index: 200;
      white-space: nowrap;
      animation: slideUp 0.3s ease;
    }

    @keyframes slideUp { from { bottom: -50px; opacity: 0; } to { bottom: 2rem; opacity: 1; } }

    .bulk-count { font-size: 0.88rem; font-weight: 600; color: #1d1d1f; }

    .bulk-delete-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.55rem 1.2rem;
      background: #ef4444;
      color: #fff;
      border: none;
      border-radius: 999px;
      font-weight: 700;
      cursor: pointer;
    }

    .bulk-cancel-btn {
      padding: 0.55rem 1rem;
      border: 1px solid #d1d5db;
      border-radius: 999px;
      background: #fff;
      font-weight: 600;
      cursor: pointer;
      color: #1d1d1f;
    }

    .icon-trash-white {
      display: block;
      width: 15px;
      height: 15px;
      background-color: #fff;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor'%3E%3Cpath fill-rule='evenodd' d='M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z' clip-rule='evenodd'/%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor'%3E%3Cpath fill-rule='evenodd' d='M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z' clip-rule='evenodd'/%3E%3C/svg%3E");
      -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
    }

    /* Export Progress */
    .export-progress-overlay { background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); }
    .export-progress-box { padding: 2.5rem; border-radius: 20px; max-width: 400px; text-align: center; }
    .export-icon { width: 60px; height: 60px; background: #e6f7ff; color: #1890ff; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; }
    .export-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem; }
    .export-subtitle { color: #86868b; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .export-progress-track { width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
    .export-progress-fill { height: 100%; background: #007AFF; transition: width 0.3s ease; }

    @keyframes slideUpFade {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .bulk-count {
      color: #374151;
      font-size: 0.8125rem;
      font-weight: 500;
      white-space: nowrap;
      padding-right: 0.25rem;
    }

    .bulk-delete-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 1rem;
      background: #ef4444;
      border: none;
      border-radius: 999px;
      color: white;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s ease;
      white-space: nowrap;
    }

    .bulk-delete-btn:hover {
      background: #dc2626;
    }

    .icon-trash-white {
      display: block;
      width: 15px;
      height: 15px;
      background-color: white;
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor'%3E%3Cpath fill-rule='evenodd' d='M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z' clip-rule='evenodd'/%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor'%3E%3Cpath fill-rule='evenodd' d='M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z' clip-rule='evenodd'/%3E%3C/svg%3E");
      -webkit-mask-size: contain;
      mask-size: contain;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
    }

    .bulk-cancel-btn {
      background: transparent;
      border: 1px solid #e2e8f0;
      border-radius: 999px;
      color: #6b7280;
      font-size: 0.8rem;
      font-weight: 500;
      padding: 0.4rem 0.875rem;
      cursor: pointer;
      font-family: inherit;
      transition: border-color 0.15s ease, color 0.15s ease;
      white-space: nowrap;
    }

    .bulk-cancel-btn:hover {
      border-color: #9ca3af;
      color: #374151;
    }

    @media (max-width: 1024px) {
      .filter-grid {
        grid-template-columns: 1fr;
        gap: 1.5rem;
      }
      .list-container {
        padding: 1.5rem;
      }
    }

    /* Progress Overlay Styles - Global scope */
    .global-loading-overlay { 
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; 
      background: rgba(0,0,0,.4); backdrop-filter: blur(8px); 
      display: flex; align-items: center; justify-content: center; z-index: 9999; 
    }
    .loading-box { 
      background: white; padding: 28px 44px; border-radius: 16px; 
      display: flex; flex-direction: column; align-items: center; gap: 18px; 
      box-shadow: 0 20px 25px -5px rgba(0,0,0,.1); 
    }
    .export-progress-overlay {
      background: rgba(0, 0, 0, 0.55);
    }
    .export-progress-box {
      padding: 36px 52px;
      gap: 14px;
      max-width: 360px;
      width: 100%;
      border-radius: 20px;
      text-align: center;
    }
    .export-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(0,122,255,.1);
      color: #007AFF;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 4px;
    }
    .export-title {
      font-size: 17px !important;
      font-weight: 800 !important;
      color: #0f172a !important;
      margin: 0 !important;
    }
    .export-subtitle {
      font-size: 13px !important;
      font-weight: 500 !important;
      color: #64748b !important;
      margin: 0 !important;
    }
    .export-progress-track {
      width: 100%;
      height: 6px;
      background: #f1f5f9;
      border-radius: 3px;
      overflow: hidden;
      margin: 8px 0;
    }
    .export-progress-fill {
      height: 100%;
      background: #007AFF;
      transition: width 0.3s ease;
    }
    .export-hint {
      font-size: 11px !important;
      color: #94a3b8 !important;
      margin: 0 !important;
      font-weight: 500 !important;
    }
  `]
})
export class EvidenceReportListComponent implements OnInit {
  reports: any[] = [];
  huFilter: string = '';
  appliedHuFilter: string = '';
  huName: string = '';
  textFilter: string = '';
  statusFilter: string = '';
  selectedReports: string[] = [];
  
  // Estado de exportación
  isExporting = false;
  exportProgress = 0;
  exportTotal = 0;
  exportType: 'DOCX' | 'Excel' = 'DOCX';

  constructor(
    private router: Router,
    private dbService: EvidenceDatabaseService,
    private excelService: EvidenceExcelService,
    private exportService: ExportService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // No cargamos nada al inicio para evitar llamadas innecesarias a la BD
    // El usuario debe buscar por HU
  }

  toggleSelection(id: string) {
    const index = this.selectedReports.indexOf(id);
    if (index > -1) {
      this.selectedReports.splice(index, 1);
    } else {
      this.selectedReports.push(id);
    }
  }

  async loadReports() {
    if (!this.huFilter) {
      this.reports = [];
      this.appliedHuFilter = '';
      this.huName = '';
      return;
    }
    
    try {
      // 1. Intentar obtener el nombre de la HU desde la BD
      let foundHU = null;
      try {
        const stories = await this.dbService.searchEvidenceHU(this.huFilter);
        foundHU = stories.find(s => s.numero?.toString() === this.huFilter.toString());
      } catch (e) {
        console.warn('Error al buscar HU:', e);
      }

      // 2. Obtener escenarios
      const reports = await this.dbService.getReports(this.huFilter);

      // 3. VALIDACIÓN: Si no existe la HU en la BD Y no hay escenarios, no mostramos nada
      if (!foundHU && reports.length === 0) {
        this.toast.error(`La Historia de Usuario "${this.huFilter}" no existe.`);
        this.appliedHuFilter = '';
        this.reports = [];
        this.huName = '';
        return;
      }

      // 4. Si existe o tiene escenarios, activamos la vista
      this.reports = reports;
      this.appliedHuFilter = this.huFilter;
      this.huName = foundHU ? foundHU.title : '';
      
    } catch (e) {
      this.toast.error('Error al cargar la información');
    }
  }

  get filteredReports() {
    return this.reports.filter(r => {
      const matchesText = !this.textFilter || 
        r.nombre_del_escenario?.toLowerCase().includes(this.textFilter.toLowerCase()) || 
        r.id_caso?.includes(this.textFilter);
      
      const matchesStatus = !this.statusFilter || r.estado_general === this.statusFilter;
      
      return matchesText && matchesStatus;
    });
  }

  clearFilters() {
    this.huFilter = '';
    this.appliedHuFilter = '';
    this.huName = '';
    this.textFilter = '';
    this.statusFilter = '';
    this.reports = [];
  }

  goToDetail(id: string) {
    this.router.navigate(['/evidence-analysis/report', id]);
  }

  async deleteReport(id: string, event: Event) {
    event.stopPropagation();
    if (confirm('¿Estás seguro de que deseas eliminar este escenario?')) {
      try {
        await this.dbService.deleteReport(id);
        this.toast.success('Escenario eliminado correctamente');
        this.loadReports();
      } catch (e) {
        this.toast.error('Error al eliminar el escenario');
      }
    }
  }

  showDeleteModal = false;
  deleteModalTitle = '';
  deleteModalMessage = '';
  deleteMode: 'single' | 'bulk' | 'hu' = 'bulk';
  reportToDeleteId: string | null = null;

  requestDeleteHU() {
    if (!this.appliedHuFilter) return;
    this.deleteMode = 'hu';
    this.deleteModalTitle = '¿Eliminar todos los escenarios?';
    this.deleteModalMessage = `Estás a punto de eliminar todos los escenarios de la HU ${this.appliedHuFilter}. Esta acción no se puede deshacer.`;
    this.showDeleteModal = true;
  }

  requestDeleteSelected() {
    if (this.selectedReports.length === 0) return;
    this.deleteMode = 'bulk';
    this.deleteModalTitle = 'Eliminar escenarios seleccionados';
    this.deleteModalMessage = `¿Deseas eliminar los ${this.selectedReports.length} escenarios seleccionados? Esta acción no se puede deshacer.`;
    this.showDeleteModal = true;
  }

  async confirmDeletion() {
    this.showDeleteModal = false;
    try {
      if (this.deleteMode === 'hu') {
        await this.dbService.deleteReportsByHU(this.appliedHuFilter);
        this.toast.success(`Todos los escenarios de la HU ${this.appliedHuFilter} han sido eliminados`);
        this.clearFilters(); // Limpiamos todo ya que la HU ya no existe
      } else if (this.deleteMode === 'bulk') {
        for (const id of this.selectedReports) {
          await this.dbService.deleteReport(id);
        }
        this.toast.success(`${this.selectedReports.length} escenarios eliminados correctamente`);
        this.selectedReports = [];
        this.loadReports(); // Recargamos para ver los que quedan
      }
    } catch (e) {
      this.toast.error('Error al realizar la eliminación');
    }
  }

  clearSelection() {
    this.selectedReports = [];
  }

  areAllVisibleSelected(): boolean {
    return this.filteredReports.length > 0 && this.filteredReports.every(r => this.selectedReports.includes(r.id));
  }

  toggleSelectAllVisible() {
    if (this.areAllVisibleSelected()) {
      this.filteredReports.forEach(r => {
        const index = this.selectedReports.indexOf(r.id);
        if (index > -1) this.selectedReports.splice(index, 1);
      });
    } else {
      this.filteredReports.forEach(r => {
        if (!this.selectedReports.includes(r.id)) {
          this.selectedReports.push(r.id);
        }
      });
    }
  }

  async exportAllExcel() {
    if (this.filteredReports.length === 0) return;
    
    this.isExporting = true;
    this.exportType = 'Excel';
    this.exportProgress = 0;
    this.exportTotal = this.filteredReports.length;
    this.cdr.detectChanges();

    try {
      const fullReports = [];
      for (let i = 0; i < this.filteredReports.length; i++) {
        const report = this.filteredReports[i];
        const full = await this.dbService.getReportById(report.id);
        fullReports.push(full);
        this.exportProgress = i + 1;
        this.cdr.detectChanges();
      }

      this.exportProgress = 0;
      this.cdr.detectChanges();

      const success = await this.excelService.downloadBulkExcelReport(fullReports, (current, total) => {
        this.exportProgress = current;
        this.exportTotal = total;
        this.cdr.detectChanges();
      });

      if (success) {
        this.toast.success('Matriz masiva generada con éxito');
      } else {
        this.toast.error('Error al generar la matriz masiva');
      }
    } catch (e) {
      console.error('Error en exportación Excel:', e);
      this.toast.error('Error al generar la matriz masiva');
    } finally {
      this.isExporting = false;
    }
  }

  async exportAllDocx() {
    if (this.filteredReports.length === 0) return;
    
    this.isExporting = true;
    this.exportType = 'DOCX';
    this.exportProgress = 0;
    this.exportTotal = this.filteredReports.length;
    this.cdr.detectChanges();

    try {
      const fullReports = [];
      for (let i = 0; i < this.filteredReports.length; i++) {
        const report = this.filteredReports[i];
        const full = await this.dbService.getReportById(report.id);
        fullReports.push(full);
        this.exportProgress = i + 1;
        this.cdr.detectChanges();
      }

      this.exportProgress = 0;
      this.cdr.detectChanges();

      await this.exportService.exportEvidenceAnalysisToDOCX(
        fullReports, 
        this.appliedHuFilter, 
        this.huName,
        (current, total) => {
          this.exportProgress = current;
          this.exportTotal = total;
          this.cdr.detectChanges();
        }
      );
      this.toast.success('Documento Word generado con éxito');
    } catch (e) {
      console.error('Error en exportación Word:', e);
      this.toast.error('Error al generar el documento Word');
    } finally {
      this.isExporting = false;
    }
  }
}
