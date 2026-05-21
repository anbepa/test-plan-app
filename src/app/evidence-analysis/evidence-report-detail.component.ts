import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EvidenceDatabaseService } from '../services/database/evidence-database.service';
import { EvidenceAnalysisService } from '../services/ai/evidence-analysis.service';
import { EvidenceExcelService } from '../services/core/evidence-excel.service';
import { ToastService } from '../services/core/toast.service';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-evidence-report-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ConfirmationModalComponent],
  template: `
    <div class="detail-page fade-in" [class.drawer-open]="showRefiner">
      <!-- Navigation Header (Sticky Breadcrumb Bar) -->
      <header class="nav-breadcrumb-header">
        <div class="header-inner">
            <div class="breadcrumb-row">
              <button type="button" class="back-pill" (click)="goBack()">‹</button>
            </div>
        </div>
      </header>

      <!-- Main Body Container -->
      <div class="detail-body" [class.drawer-open]="showRefiner">
        
        <!-- Primary Title Card (Sticky) -->
        <div class="title-card sticky-title">
          <div class="title-card-left">
            <h2 class="scenario-title">Detalle del Escenario</h2>
            <p class="scenario-subtitle">{{ report?.nombre_del_escenario }}</p>
          </div>

          <div class="title-card-right">
            <!-- Navigation Controls -->
            <div class="report-nav-tool">
              <button class="nav-tool-btn" (click)="navigateReport(-1)" [disabled]="!canNavigate(-1)" title="Anterior">
                <span class="nav-arrow">&lsaquo;</span>
              </button>
              <div class="nav-tool-info">
                <span class="current">{{ currentReportIndex + 1 }}</span>
                <span class="sep">/</span>
                <span class="total">{{ totalReports }}</span>
              </div>
              <button class="nav-tool-btn" (click)="navigateReport(1)" [disabled]="!canNavigate(1)" title="Siguiente">
                <span class="nav-arrow">&rsaquo;</span>
              </button>
            </div>

            <div class="card-divider"></div>

            <!-- Main Actions -->
            <div class="card-actions">
              <button class="btn-export-card" (click)="exportToExcel()" title="Exportar Matriz">
                <span class="btn-symbol">↓</span>
                Exportar Matriz
              </button>
              <button class="btn-refiner-card" (click)="toggleRefiner()" [class.active]="showRefiner" title="Refinar con IA">
                <span class="btn-symbol">★</span>
                Refinar con IA
              </button>
              <button class="btn-danger-card" (click)="showDeleteModal = true" title="Eliminar escenario">
                <span style="font-size: 1.2rem;">🗑</span>
              </button>
            </div>
          </div>
        </div>

      <!-- Floating Refinement FAB -->
      <button class="fab-refiner" (click)="toggleRefiner()" [class.active]="showRefiner" title="Refinar con IA">
        <span class="fab-icon">★</span>
      </button>

      <!-- Collapsible Refinement Drawer/Panel -->
      <div class="refinement-drawer" [class.open]="showRefiner">
        <header class="drawer-header">
          <div class="header-title-group">
            <h3>Refinar con IA</h3>
            <button class="btn-history" (click)="showHistory = !showHistory" title="Historial de instrucciones">
              <span>🕒</span>
            </button>
          </div>
          <button class="btn-close-drawer" (click)="toggleRefiner()">&times;</button>
        </header>
        <div class="drawer-body">
          <!-- History List (Collapsible) -->
          <div class="history-list" *ngIf="showHistory">
            <div class="history-item" *ngFor="let h of promptHistory" (click)="setPrompt(h)">
              {{ h }}
            </div>
            <div class="empty-history" *ngIf="promptHistory.length === 0">No hay historial aún.</div>
          </div>

          <p class="drawer-hint">Ingresa instrucciones para ajustar este escenario.</p>
          <textarea 
            class="refiner-input" 
            placeholder="Ej: Ajusta los pasos para que sean más técnicos..."
            [(ngModel)]="refinementInstruction"
            [disabled]="isRefining"
          ></textarea>
          <button class="btn-execute-refine" (click)="refine()" [disabled]="isRefining || !refinementInstruction">
            <span class="spinner" *ngIf="isRefining"></span>
            {{ isRefining ? 'Aplicar Refinamiento' : 'Procesar Cambios' }}
          </button>
        </div>
      </div>

      <main class="main-content" *ngIf="report">

        <div class="content-body">
        <!-- Scenario Card -->
        <section class="section-card">
          <header class="card-header">
            <div class="header-left">
              <span class="scenario-id">CASO #{{ report.id_caso || '1' }}</span>
              <h2 class="scenario-title">{{ report.nombre_del_escenario }}</h2>
              <span class="steps-count">{{ report.test_scenario_steps?.length || 0 }} Pasos analizados</span>
            </div>
            <div class="header-right">
              <div class="status-badge" [class.success]="report.estado_general === 'Exitoso'">
                <div class="dot"></div>
                <span class="status-icon" *ngIf="report.estado_general === 'Exitoso'">✓</span>
                {{ report.estado_general }}
              </div>
            </div>
          </header>

          <div class="table-container">
            <table class="steps-table">
              <thead>
                <tr>
                  <th class="col-num">PASO</th>
                  <th>DESCRIPCIÓN DE LA ACCIÓN OBSERVADA</th>
                  <th style="width: 120px; text-align: center;">EVIDENCIA</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let step of report.test_scenario_steps">
                  <td class="col-num">
                    <div class="col-num-inner">
                      <div class="step-index">{{ step.numero_paso }}</div>
                      <button *ngIf="showRefiner" class="btn-delete-step" (click)="deleteStep(step, $event)" title="Eliminar este paso">
                        <span style="font-size: 10px;">🗑</span>
                      </button>
                    </div>
                  </td>
                  <td>
                    <div 
                      class="step-text" 
                      [class.regenerating]="isRefining"
                      contenteditable="true" 
                      (blur)="onStepBlur(step, $event)"
                      title="Haz clic para editar manualmente"
                    >
                      <ng-container *ngIf="!isRefining && (!step.originalText || step.originalText === step.descripcion_accion_observada)">
                        {{ step.descripcion_accion_observada }}
                      </ng-container>
                      <div class="diff-view" *ngIf="!isRefining && step.originalText && step.originalText !== step.descripcion_accion_observada">
                        <span class="diff-removed">{{ step.originalText }}</span>
                        <span class="diff-added">{{ step.descripcion_accion_observada }}</span>
                      </div>
                      <div class="refining-placeholder" *ngIf="isRefining">Regenerando paso...</div>
                    </div>
                  </td>
                  <td style="text-align: center;">
                    <div 
                      class="evidence-cell" 
                      [draggable]="showRefiner && getImageForStep(step)"
                      (dragstart)="onDragStart($event, step)"
                      (dragover)="onDragOver($event)"
                      (drop)="onDrop($event, step)"
                      [class.dragging-over]="draggedStep && draggedStep.id !== step.id"
                    >
                      <ng-container *ngIf="getImageForStep(step) as img">
                        <div
                          class="evidence-thumb-container"
                          [attr.data-img-url]="img.image_url"
                          (click)="onThumbClick(step, img)"
                        >
                          <!-- ESTADO 1: No activada aún (src no asignado, cero descargas) -->
                          <div class="thumb-placeholder" *ngIf="!isActivated(img)">
                            <span class="placeholder-icon">🖼</span>
                          </div>

                          <!-- ESTADO 2 + 3: Activada → img con src real -->
                          <ng-container *ngIf="isActivated(img)">
                            <img
                              [src]="getThumbSrc(img)"
                              class="step-thumb"
                              [class.thumb-fading]="!isLoaded(img)"
                              alt="Evidencia"
                              decoding="async"
                              (load)="onImageLoad(img)"
                              (error)="onImageError(img)"
                            >
                            <!-- ESTADO 2: Descargando (spinner girando) -->
                            <div class="thumb-load-overlay" *ngIf="!isLoaded(img)">
                              <div class="thumb-spinner"></div>
                              <span class="thumb-load-hint">Cargando...</span>
                            </div>
                          </ng-container>

                          <button *ngIf="showRefiner" class="btn-delete-evidence" (click)="deleteEvidence(img, $event)" title="Eliminar evidencia">
                            <span style="font-size: 10px;">🗑</span>
                          </button>
                        </div>
                      </ng-container>

                      <ng-container *ngIf="!getImageForStep(step)">
                        <div class="empty-evidence-slot" *ngIf="showRefiner">
                          <span style="font-size: 1.5rem;">↑</span>
                          <span>Soltar</span>
                        </div>
                        <button *ngIf="!showRefiner" class="btn-view-no-evidence" disabled>
                          <span style="font-size: 1.2rem;">🖼</span>
                        </button>
                      </ng-container>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="!report.test_scenario_steps || report.test_scenario_steps.length === 0">
                  <td colspan="3" style="text-align: center; padding: 3rem; color: #86868b;">
                    <i class="pi pi-info-circle" style="font-size: 2rem; margin-bottom: 1rem; display: block;"></i>
                    No se encontraron pasos para este escenario.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Result Card -->
        <section class="section-card">
          <div class="result-card" [class.success]="report.estado_general === 'Exitoso'">
            <div class="result-header">
              <div class="result-icon">
                <span style="font-size: 1.5rem; font-weight: 700;">{{ report.estado_general === 'Exitoso' ? '✓' : '⚠' }}</span>
              </div>
              <div class="result-titles">
                <label>Resultado Obtenido</label>
                <span class="status-text">{{ report.estado_general }}</span>
              </div>
            </div>
            <div class="result-body">
              <p [innerHTML]="formatTechnicalText(report.resultado_obtenido)"></p>
            </div>
          </div>
        </section>
      </div>
    </main>

      <!-- Image Modal -->
      <div class="modal-overlay" *ngIf="selectedImage" (click)="selectedImage = null">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <header class="modal-header">
            <span>{{ selectedImage.file_name }}</span>
            <button class="btn-close-modal" (click)="selectedImage = null"><i class="pi pi-times"></i></button>
          </header>
          <div class="modal-body">
            <img [src]="selectedImage.image_url" [alt]="selectedImage.file_name">
          </div>
        </div>
      </div>

      <!-- Modal de Confirmación -->
      <app-confirmation-modal
        [isOpen]="showDeleteModal"
        [title]="'¿Eliminar escenario?'"
        [message]="'Estás a punto de eliminar este escenario de prueba permanentemente. Esta acción no se puede deshacer.'"
        [confirmText]="'Eliminar permanentemente'"
        [cancelText]="'Cancelar'"
        [type]="'danger'"
        (confirm)="confirmDelete()"
        (cancel)="showDeleteModal = false"
      ></app-confirmation-modal>

      <!-- Modal de Confirmación para borrar Paso -->
      <app-confirmation-modal
        [isOpen]="showDeleteStepModal"
        [title]="'¿Eliminar paso de prueba?'"
        [message]="'Estás a punto de eliminar este paso permanentemente. Los pasos restantes se reordenarán de forma consecutiva.'"
        [confirmText]="'Eliminar paso'"
        [cancelText]="'Cancelar'"
        [type]="'danger'"
        (confirm)="confirmDeleteStep()"
        (cancel)="showDeleteStepModal = false"
      ></app-confirmation-modal>
    </div>
  `,
  styles: [`
    .detail-page {
      background-color: #f5f5f7;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1d1d1f;
    }

    .fade-in { animation: fadeIn 0.5s ease-in; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .detail-page {
      background-color: #f5f5f7;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Navigation Breadcrumb Bar */
    .nav-breadcrumb-header {
      background: #ffffff;
      border-bottom: 1px solid #d2d2d7;
      padding: 12px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header-inner { max-width: 1600px; margin: 0 auto; width: 95%; }
    .breadcrumb-row { display: flex; align-items: center; gap: 1rem; color: #86868b; font-size: 0.9rem; }
    .back-pill { width: 32px; height: 32px; border-radius: 10px; border: 1.5px solid #d2d2d7; background: white; color: #007AFF; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .back-pill:hover { background: #f5f5f7; border-color: #007AFF; }
    .breadcrumb-link { color: #007AFF; cursor: pointer; font-weight: 500; }
    .breadcrumb-link:hover { text-decoration: underline; }
    .breadcrumb-separator { color: #d2d2d7; margin: 0 -0.25rem; }
    .breadcrumb-current { color: #1d1d1f; font-weight: 600; }

    /* Main Body */
    .detail-body {
      flex: 1;
      max-width: 1600px;
      margin: 0 auto;
      width: 95%;
      padding: 24px 24px 40px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      transition: padding-right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .detail-body.drawer-open {
      padding-right: 400px;
    }

    .title-card {
      background: #ffffff;
      border-radius: 14px;
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      border: 1px solid rgba(0,0,0,0.02);
      transition: all 0.3s;
    }

    .sticky-title {
      position: sticky;
      top: 60px; /* Debajo del breadcrumb */
      z-index: 90;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }

    .title-card-left { display: flex; flex-direction: column; gap: 6px; }
    .scenario-title { font-size: 24px; font-weight: 800; color: #1d1d1f; margin: 0; letter-spacing: -0.02em; }
    .scenario-subtitle { font-size: 15px; color: #86868b; margin: 0; font-weight: 500; }

    .title-card-right { display: flex; align-items: center; gap: 16px; }

    /* Report Navigation Tool */
    .report-nav-tool {
      display: flex; align-items: center; gap: 4px;
      background: #f5f5f7; padding: 4px; border-radius: 10px; border: 1px solid #e5e5e7;
    }
    .nav-tool-btn {
      width: 28px; height: 28px; background: white; border: 1px solid #d2d2d7; border-radius: 6px;
      display: flex; align-items: center; justify-content: center; cursor: pointer; color: #4b5563; transition: all 0.2s;
    }
    .nav-tool-btn i { font-size: 0.75rem; }
    .nav-tool-btn:hover:not(:disabled) { background: #f9fafb; border-color: #86868b; color: #1d1d1f; }
    .nav-tool-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    
    .nav-arrow {
      font-size: 20px;
      line-height: 1;
      font-weight: 400;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: -2px; /* Ajuste visual para centrar verticalmente */
    }
    
    .nav-tool-info { display: flex; align-items: center; gap: 3px; padding: 0 10px; font-size: 13px; font-weight: 700; color: #111827; }
    .nav-tool-info .sep { color: #9ca3af; font-weight: 400; font-size: 11px; }

    .card-divider { width: 1px; height: 32px; background: #e5e5e7; }

    .card-actions { display: flex; align-items: center; gap: 8px; }

    .btn-refiner-card, .btn-export-card {
      height: 36px; padding: 0 16px; border-radius: 10px; font-weight: 700; font-size: 13px;
      display: flex; align-items: center; gap: 8px; cursor: pointer; transition: all 0.2s; border: none;
    }

    .btn-refiner-card { 
      background: #ffffff; color: #0071e3; border: 1.5px solid #0071e3;
    }
    .btn-refiner-card:hover { background: rgba(0,113,227,0.05); }
    .btn-refiner-card.active { background: #0071e3; color: #ffffff; }

    .btn-export-card { 
      background: #0071e3; color: #ffffff; box-shadow: 0 4px 12px rgba(0,113,227,0.2);
    }
    .btn-export-card:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,113,227,0.3); }

    .btn-danger-card {
      width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      background: #ffffff; color: #ff3b30; border: 1.5px solid #ffccc7;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-danger-card:hover { background: #fff1f0; border-color: #ff3b30; }

    /* Action Bar */
    .action-bar-container { padding: 1.5rem 2.5rem; }
    .action-buttons { display: flex; gap: 1rem; }

    .btn-primary, .btn-secondary {
      padding: 0.7rem 1.4rem;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }

    .btn-primary { background: #0071e3; color: #ffffff; }
    .btn-primary:hover { background: #0077ed; box-shadow: 0 4px 12px rgba(0, 113, 227, 0.2); }

    .btn-secondary { background: #ffffff; color: #1d1d1f; border: 1px solid #d2d2d7; }
    .btn-secondary:hover { background: #f5f5f7; }

    /* Refiner Section */
    .refiner-section { padding: 0 2.5rem 1.5rem 2.5rem; }
    .refiner-card { background: #ffffff; border-radius: 18px; border: 1px solid #d2d2d7; box-shadow: 0 10px 30px rgba(0,0,0,0.05); overflow: hidden; }
    .refiner-header { padding: 1rem 1.5rem; border-bottom: 1px solid #f5f5f7; display: flex; justify-content: space-between; align-items: center; }
    .refiner-header h3 { margin: 0; font-size: 0.95rem; font-weight: 700; }
    .btn-close-refiner { background: none; border: none; color: #86868b; cursor: pointer; }
    .refiner-body { padding: 1.5rem; }
    .refiner-input { width: 100%; height: 100px; border: 1px solid #d2d2d7; border-radius: 12px; padding: 1rem; font-family: inherit; font-size: 1rem; outline: none; margin-bottom: 1rem; resize: none; }
    .refiner-input:focus { border-color: #0071e3; box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.1); }
    .refiner-footer { display: flex; justify-content: flex-end; }
    .btn-execute { background: #0071e3; color: white; border: none; padding: 0.7rem 1.5rem; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; }

    .main-content { 
      padding: 0 24px 40px; 
      display: flex; 
      gap: 32px; 
      align-items: flex-start;
      transition: all 0.4s;
    }
    
    .content-body { flex: 1; display: flex; flex-direction: column; gap: 24px; min-width: 0; }

    .section-card { 
      background: #ffffff; border-radius: 24px; padding: 2.5rem; 
      box-shadow: 0 4px 30px rgba(0,0,0,0.02); 
      border: 2px solid transparent;
      transition: all 0.3s;
    }
    .drawer-open .section-card {
      border-color: rgba(0, 113, 227, 0.1);
      box-shadow: 0 8px 40px rgba(0, 113, 227, 0.05);
    }

    /* Report Card Header */
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2.5rem; }
    .header-left { display: flex; flex-direction: column; gap: 0.5rem; }
    .scenario-id { font-size: 0.75rem; font-weight: 700; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; }
    .scenario-title { font-size: 1.8rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; line-height: 1.2; color: #1d1d1f; }
    .steps-count { font-size: 0.75rem; font-weight: 700; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; }

    .status-badge { display: flex; align-items: center; gap: 0.6rem; background: #f5f5f7; padding: 0.4rem 1.2rem; border-radius: 20px; font-weight: 700; font-size: 0.8rem; color: #1d1d1f; }
    .status-badge.success { background: #f0faf4; color: #21a366; }
    .status-badge .dot { width: 8px; height: 8px; background: #34c759; border-radius: 50%; }
    .status-icon { font-size: 1rem; font-weight: 800; margin-right: -2px; }

    /* Steps Table */
    .table-container { border-top: 1px solid #f2f2f7; margin: 0 -0.5rem; }
    .steps-table { width: 100%; border-collapse: collapse; }
    .steps-table th { text-align: left; padding: 1.2rem 1rem; color: #86868b; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #f2f2f7; }
    .steps-table td { padding: 1.5rem 1rem; vertical-align: middle; border-bottom: 1px solid #f9f9fb; }

    .col-num { width: 70px; position: relative; }
    .col-num-inner { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .step-index { width: 34px; height: 34px; background: #f5f5f7; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #86868b; font-size: 0.9rem; }
    
    .btn-delete-step {
      background: #ff3b30; color: white; border: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s; box-shadow: 0 2px 5px rgba(255, 59, 48, 0.3); opacity: 0; transform: scale(0.8);
    }
    tr:hover .btn-delete-step { opacity: 1; transform: scale(1); }
    .btn-delete-step:hover { transform: scale(1.1) !important; background: #d70015; }

    .step-text { font-size: 1rem; line-height: 1.6; color: #1d1d1f; font-weight: 500; outline: none; padding: 0.4rem; border-radius: 8px; transition: background 0.2s; }
    .step-text:focus { background: #f5f5f7; }

    .btn-view-evidence {
      background: #0071e3; color: white; border: none; width: 44px; height: 44px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; cursor: pointer; transition: transform 0.2s;
    }
    .btn-view-evidence:hover { transform: scale(1.05); }
    .btn-view-evidence span { font-size: 0.65rem; font-weight: 800; letter-spacing: 0.05em; }
    .btn-view-no-evidence {
      background: #f5f5f7; color: #d2d2d7; border: 1px dashed #d2d2d7; width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: default;
    }

    /* Premium Drag & Drop Evidence Styles */
    .evidence-cell {
      min-height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 16px;
      transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1);
      padding: 6px;
      position: relative;
    }
    
    .evidence-cell[draggable="true"] { cursor: grab; }
    .evidence-cell[draggable="true"]:active { cursor: grabbing; }

    .dragging-over {
      background: rgba(0, 113, 227, 0.08);
      transform: scale(1.02);
      box-shadow: inset 0 0 0 2px #0071e3;
    }
    
    /* Placeholder (imagen aún no activada - cero descargas) */
    .thumb-placeholder {
      width: 74px;
      height: 74px;
      border-radius: 14px;
      background: #f0f0f5;
      border: 1.5px dashed #d2d2d7;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .evidence-thumb-container:hover .thumb-placeholder {
      background: #e8edf5;
      border-color: #0071e3;
    }
    .placeholder-icon {
      font-size: 1.4rem;
      opacity: 0.35;
      filter: grayscale(1);
      transition: all 0.2s;
    }
    .evidence-thumb-container:hover .placeholder-icon {
      opacity: 0.6;
      filter: none;
    }

    /* Overlay de descarga activa */
    .thumb-load-overlay {
      position: absolute;
      inset: 0;
      border-radius: 14px;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(2px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      z-index: 3;
    }
    .thumb-load-hint {
      font-size: 9px;
      font-weight: 700;
      color: rgba(255,255,255,0.9);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    /* Spinner siempre activo cuando está descargando */
    .thumb-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    /* Imagen difuminada mientras descarga */
    .thumb-fading {
      opacity: 0.1;
    }
    .evidence-thumb-container {
      position: relative;
      width: 74px;
      height: 74px;
      transition: transform 0.2s ease;
      z-index: 1;
      cursor: pointer;
    }
    .evidence-thumb-container:hover { transform: translateY(-2px); }

    .step-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 14px;
      cursor: pointer;
      border: 2px solid #ffffff;
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      background: #f5f5f7;
      transition: opacity 0.3s ease;
    }
    
    .btn-delete-evidence {
      position: absolute;
      top: -6px;
      right: -6px;
      background: rgba(30, 30, 30, 0.7);
      backdrop-filter: blur(4px);
      color: white;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 50%;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      cursor: pointer;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      z-index: 5;
      opacity: 0.85;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-delete-evidence:hover { 
      transform: scale(1.15) rotate(90deg); 
      background: #ff3b30; 
      opacity: 1;
      box-shadow: 0 4px 12px rgba(255, 59, 48, 0.3);
    }
    .btn-delete-evidence i { font-size: 10px !important; }
    
    .empty-evidence-slot {
      font-size: 0.65rem;
      color: #86868b;
      border: 2px dashed #e5e5ea;
      width: 74px;
      height: 74px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border-radius: 14px;
      transition: all 0.3s;
      background: #fafafa;
    }
    .empty-evidence-slot i { font-size: 1.1rem; color: #d2d2d7; }
    .empty-evidence-slot span { font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; }
    
    .dragging-over .empty-evidence-slot { 
      border-color: #0071e3; 
      background: rgba(0, 113, 227, 0.05);
      color: #0071e3;
    }
    .dragging-over .empty-evidence-slot i { color: #0071e3; }

    /* Result Card */
    .result-card { display: flex; flex-direction: column; gap: 1.5rem; }
    .result-card.success { background: #f0faf4; border: 1px solid #e0f2e9; }
    .result-header { display: flex; align-items: center; gap: 1.2rem; }
    .result-icon { width: 44px; height: 44px; background: #ffffff; color: #34c759; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(52, 199, 89, 0.15); }
    .result-titles label { display: block; font-size: 0.75rem; font-weight: 700; color: #21a366; text-transform: uppercase; margin-bottom: 0.2rem; }
    .status-text { font-size: 0.95rem; font-weight: 700; color: #21a366; }
    .result-body p { font-size: 1.1rem; line-height: 1.6; color: #1e6144; margin: 0; font-weight: 500; }

    /* Modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .modal-content { background: white; border-radius: 20px; max-width: 90vw; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
    .modal-header { padding: 1rem 1.5rem; border-bottom: 1px solid #f5f5f7; display: flex; justify-content: space-between; align-items: center; }
    .modal-header span { font-size: 0.9rem; font-weight: 600; color: #86868b; }
    .btn-close-modal { background: none; border: none; font-size: 1.1rem; color: #86868b; cursor: pointer; }
    .modal-body { overflow: auto; padding: 1rem; display: flex; align-items: center; justify-content: center; }
    .modal-body img { max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); }

    .tech-badge {
      background: #f0f0f5;
      color: #0071e3;
      padding: 1px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace;
      font-size: 0.9em;
      font-weight: 600;
      border: 1px solid rgba(0,113,227,0.1);
    }
    
    .tech-value {
      color: #bf40bf;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace;
      font-weight: 600;
    }

    .btn-symbol { 
      font-size: 1.2rem; 
      line-height: 1; 
      display: inline-flex; 
      align-items: center; 
      justify-content: center;
      background: none !important;
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
      box-shadow: none !important;
    }

    .step-thumb:hover { transform: scale(1.1); box-shadow: 0 8px 24px rgba(0,0,0,0.2); z-index: 10; }

    .spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Step Navigator */

    /* Refinement FAB & Drawer */
    .fab-refiner {
      position: fixed; bottom: 32px; right: 32px; width: 60px; height: 60px;
      background: #0071e3; color: white; border: none; border-radius: 50%;
      box-shadow: 0 8px 24px rgba(0, 113, 227, 0.4); cursor: pointer; z-index: 500;
      display: flex; align-items: center; justify-content: center; transition: all 0.3s;
    }
    .fab-refiner:hover { transform: scale(1.1) translateY(-4px); box-shadow: 0 12px 32px rgba(0, 113, 227, 0.5); }
    .fab-refiner.active { background: #1d1d1f; transform: rotate(45deg); }
    .fab-icon { font-size: 1.5rem; }

    .refinement-drawer {
      position: fixed; top: 0; right: -400px; width: 380px; height: 100vh;
      background: #ffffff; border-left: 1px solid #d2d2d7; z-index: 600;
      box-shadow: -10px 0 30px rgba(0,0,0,0.05); transition: right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex; flex-direction: column;
    }
    .refinement-drawer.open { right: 0; }
    .drawer-header { padding: 24px; border-bottom: 1px solid #f5f5f7; display: flex; justify-content: space-between; align-items: center; }
    .header-title-group { display: flex; align-items: center; gap: 12px; }
    .btn-history { background: #f5f5f7; border: none; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; }
    .btn-history:hover { background: #e5e5e7; }
    .drawer-header h3 { margin: 0; font-size: 1.2rem; font-weight: 700; }
    .btn-close-drawer { background: none; border: none; font-size: 2rem; color: #86868b; cursor: pointer; }
    .drawer-body { padding: 24px; flex: 1; display: flex; flex-direction: column; gap: 16px; position: relative; }
    
    .history-list {
      background: #f5f5f7; border-radius: 12px; padding: 8px; margin-bottom: 8px;
      max-height: 200px; overflow-y: auto; border: 1px solid #e5e5e7;
    }
    .history-item { 
      padding: 10px; border-radius: 8px; font-size: 13px; cursor: pointer; 
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .history-item:hover { background: #ffffff; color: #0071e3; }
    .empty-history { font-size: 12px; color: #86868b; text-align: center; padding: 10px; }

    .drawer-hint { font-size: 13px; color: #86868b; line-height: 1.5; margin: 0; }
    .btn-execute-refine {
      background: #0071e3; color: white; border: none; padding: 14px; border-radius: 12px;
      font-weight: 700; cursor: pointer; transition: all 0.2s;
    }
    .btn-execute-refine:hover { opacity: 0.9; }
    .btn-execute-refine:disabled { background: #d2d2d7; cursor: not-allowed; }

    /* Diff View Styles */
    .diff-view { display: flex; flex-direction: column; gap: 8px; }
    .diff-removed { color: #ff3b30; text-decoration: line-through; background: rgba(255, 59, 48, 0.05); padding: 4px; border-radius: 4px; font-size: 0.9rem; }
    .diff-added { color: #34c759; background: rgba(52, 199, 89, 0.05); padding: 4px; border-radius: 4px; font-weight: 600; }

    .regenerating { filter: blur(4px); opacity: 0.5; pointer-events: none; transition: all 0.4s; }
    .refining-placeholder { color: #0071e3; font-weight: 700; font-style: italic; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
  `]
})
export class EvidenceReportDetailComponent implements OnInit {
  report: any;
  selectedImage: any = null;
  
  showRefiner = false;
  isRefining = false;
  refinementInstruction = '';
  showDeleteModal = false;
  showDeleteStepModal = false;
  stepToDelete: any = null;

  // AI Drawer state
  showHistory = false;
  promptHistory: string[] = [];

  // Navigation state
  allReportIds: string[] = [];
  currentReportIndex: number = 0;
  totalReports: number = 0;

  // Lazy image loading — dos niveles:
  /** URLs cuyo [src] ya fue asignado (descarga en curso o completa) */
  private activatedUrls = new Set<string>();
  /** URLs que el browser ya terminó de descargar */
  private loadedUrls = new Set<string>();
  /** ID del step cuya imagen está pendiente de abrir en modal tras descarga */
  pendingImageStep: string | null = null;
  /** IntersectionObserver para activar imágenes al entrar al viewport */
  private imgObserver: IntersectionObserver | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private dbService: EvidenceDatabaseService,
    private aiService: EvidenceAnalysisService,
    private excelService: EvidenceExcelService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}


  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      await this.loadReport(id);
      if (this.report) {
        await this.loadNavigationState(id, this.report.historia_usuario);
      }
    }
    this.loadPromptHistory();
  }

  ngOnDestroy() {
    this.imgObserver?.disconnect();
  }

  loadPromptHistory() {
    const saved = localStorage.getItem('ai_prompt_history');
    if (saved) this.promptHistory = JSON.parse(saved);
  }

  savePromptHistory(prompt: string) {
    if (!prompt || this.promptHistory.includes(prompt)) return;
    this.promptHistory.unshift(prompt);
    if (this.promptHistory.length > 5) this.promptHistory.pop();
    localStorage.setItem('ai_prompt_history', JSON.stringify(this.promptHistory));
  }

  setPrompt(prompt: string) {
    this.refinementInstruction = prompt;
    this.showHistory = false;
  }

  async loadNavigationState(currentId: string, huFilter?: string) {
    try {
      this.allReportIds = await this.dbService.getReportIds(huFilter);
      this.totalReports = this.allReportIds.length;
      this.currentReportIndex = this.allReportIds.indexOf(currentId);
    } catch (e) {
      console.error('Error al cargar estado de navegación', e);
    }
  }

  async loadReport(id: string) {
    try {
      // Resetear estado de imágenes al cambiar de escenario
      this.activatedUrls.clear();
      this.loadedUrls.clear();
      this.pendingImageStep = null;
      this.imgObserver?.disconnect();
      this.report = await this.dbService.getReportById(id);
      // Iniciar el observer después de que Angular renderice las filas
      setTimeout(() => this.initImageObserver(), 300);
    } catch (e) {
      this.toast.error('Error al cargar el reporte');
    }
  }

  /**
   * IntersectionObserver: activa el [src] de las imágenes conforme
   * sus filas entran al viewport. Así nunca se descargan imágenes
   * fuera de pantalla sin interacción del usuario.
   */
  private initImageObserver() {
    if (this.imgObserver) this.imgObserver.disconnect();

    this.imgObserver = new IntersectionObserver((entries) => {
      let changed = false;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const url = (entry.target as HTMLElement).dataset['imgUrl'];
          if (url && !this.activatedUrls.has(url)) {
            this.activatedUrls.add(url);
            changed = true;
          }
        }
      });
      if (changed) this.cdr.detectChanges();
    }, {
      // Empieza a cargar cuando la fila está 50px antes de entrar al viewport
      rootMargin: '50px 0px',
      threshold: 0
    });

    // Observar cada contenedor de thumbnail que tenga data-img-url
    const cells = document.querySelectorAll<HTMLElement>('[data-img-url]');
    cells.forEach(cell => this.imgObserver!.observe(cell));
  }

  canNavigate(direction: number): boolean {
    const nextIndex = this.currentReportIndex + direction;
    return nextIndex >= 0 && nextIndex < this.totalReports;
  }

  async navigateReport(direction: number) {
    if (!this.canNavigate(direction)) return;
    
    const nextIndex = this.currentReportIndex + direction;
    const nextId = this.allReportIds[nextIndex];
    
    this.router.navigate(['/evidence-analysis/report', nextId]);
    this.currentReportIndex = nextIndex;
    await this.loadReport(nextId);
  }

  /**
   * Formatea texto técnico resaltando tablas, campos y valores
   */
  formatTechnicalText(text: string | null | undefined): string {
    if (!text) return '';

    // Escapar HTML básico
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Resaltar tablas y esquemas (ej: schsaf.tbl_finance_charges)
    formatted = formatted.replace(
      /([a-zA-Z_]+\.[a-zA-Z_0-9]+)/g,
      '<span class="tech-badge">$1</span>'
    );

    // Resaltar valores numéricos específicos o IDs (ej: 18086)
    // Buscamos números rodeados de espacios, comas o al final de frase
    formatted = formatted.replace(
      /(\s|'|=)(\d{4,})(\s|,|\.|'|$)/g,
      '$1<span class="tech-value">$2</span>$3'
    );

    // Resaltar términos entre comillas simples (campos o valores de texto)
    formatted = formatted.replace(
      /'([^']+)'/g,
      "'<span class=\"tech-value\">$1</span>'"
    );

    // Resaltar palabras clave SQL (solo si parecen parte de una frase técnica)
    const sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'DESC', 'NULL'];
    sqlKeywords.forEach(kw => {
      const reg = new RegExp(`\\b(${kw})\\b`, 'gi');
      formatted = formatted.replace(reg, '<strong>$1</strong>');
    });

    return formatted;
  }



  goBack() {
    this.router.navigate(['/evidence-reports']);
  }

  getImageForStep(step: any) {
    if (!this.report) return null;
    let img = this.report.report_images?.find((i: any) => i.step_id === step.id);
    
    if (!img && step.imagen_referencia) {
      const match = step.imagen_referencia.match(/\d+/);
      if (match) {
        const order = parseInt(match[0], 10);
        img = this.report.report_images?.find((i: any) => i.image_order === order);
      }
    }
    return img;
  }

  viewImageForStep(step: any) {
    const img = this.getImageForStep(step);
    if (img) {
      this.selectedImage = img;
    } else {
      this.toast.info('No hay imagen asociada a este paso');
    }
  }

  // ─── Helpers de estado de imagen ────────────────────────────────────────────

  /** El [src] ya fue asignado (descarga iniciada o completa) */
  isActivated(img: any): boolean {
    return this.activatedUrls.has(img.image_url);
  }

  /** La imagen ya terminó de descargarse en el browser */
  isLoaded(img: any): boolean {
    return this.loadedUrls.has(img.image_url);
  }

  /** Devuelve la URL solo cuando está activada; string vacío si no */
  getThumbSrc(img: any): string {
    return this.activatedUrls.has(img.image_url) ? img.image_url : '';
  }

  /** Evento nativo (load): imagen terminó de descargarse */
  onImageLoad(img: any) {
    this.loadedUrls.add(img.image_url);
    // Si el usuario hizo clic antes de que terminara, abrir modal ahora
    const stepId = this.report?.test_scenario_steps?.find(
      (s: any) => this.getImageForStep(s)?.image_url === img.image_url
    )?.id;
    if (stepId && this.pendingImageStep === stepId) {
      this.pendingImageStep = null;
      this.selectedImage = img;
    }
    this.cdr.detectChanges();
  }

  /** Evento nativo (error): falló la descarga */
  onImageError(img: any) {
    this.loadedUrls.add(img.image_url); // quitar spinner
    if (this.pendingImageStep) {
      this.pendingImageStep = null;
      this.toast.error('No se pudo cargar la imagen');
    }
    this.cdr.detectChanges();
  }

  /**
   * Clic en el thumbnail:
   * - Imagen descargada → abre modal
   * - Activada pero descargando → registra pending, el (load) abrirá el modal
   * - No activada → activa ahora (fuerza descarga) + registra pending
   */
  onThumbClick(step: any, img: any) {
    if (this.isLoaded(img)) {
      this.selectedImage = img;
      return;
    }
    this.pendingImageStep = step.id;
    if (!this.isActivated(img)) {
      // Activar ahora para asignar el src y disparar la descarga
      this.activatedUrls.add(img.image_url);
      this.cdr.detectChanges();
    }
  }

  // --- Drag & Drop Handlers ---
  draggedStep: any = null;

  onDragStart(event: DragEvent, step: any) {
    if (!this.showRefiner) return;
    const img = this.getImageForStep(step);
    if (!img) {
      event.preventDefault();
      return;
    }
    this.draggedStep = step;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Necesario para Firefox
      event.dataTransfer.setData('text/plain', step.id);
    }
  }

  onDragOver(event: DragEvent) {
    if (!this.showRefiner) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  async onDrop(event: DragEvent, targetStep: any) {
    if (!this.showRefiner || !this.draggedStep || this.draggedStep.id === targetStep.id) {
      this.draggedStep = null;
      return;
    }
    event.preventDefault();

    const sourceStep = this.draggedStep;
    const sourceImage = this.getImageForStep(sourceStep);
    const targetImage = this.getImageForStep(targetStep);

    try {
      if (targetImage) {
        // Intercambiar (Swap)
        await this.dbService.swapStepImages(sourceImage.id, sourceStep.id, targetImage.id, targetStep.id);
        this.toast.success('Evidencias intercambiadas');
      } else {
        // Copiar (como pidió el usuario)
        await this.dbService.copyImageToStep(sourceImage, targetStep.id);
        this.toast.success('Evidencia copiada al paso');
      }
      
      // Forzar recarga de los datos para ver cambios
      await this.loadReport(this.report.id);
    } catch (e) {
      console.error('Error al mover evidencia:', e);
      this.toast.error('Error al mover la evidencia');
    } finally {
      this.draggedStep = null;
    }
  }

  async deleteEvidence(image: any, event: MouseEvent) {
    event.stopPropagation();
    try {
      await this.dbService.deleteReportImage(image.id);
      this.toast.success('Evidencia eliminada');
      await this.loadReport(this.report.id);
    } catch (e) {
      this.toast.error('Error al eliminar evidencia');
    }
  }

  deleteStep(step: any, event: MouseEvent) {
    event.stopPropagation();
    this.stepToDelete = step;
    this.showDeleteStepModal = true;
  }

  async confirmDeleteStep() {
    if (!this.stepToDelete) return;
    this.showDeleteStepModal = false;
    const step = this.stepToDelete;
    this.stepToDelete = null;

    try {
      await this.dbService.deleteStep(step.id);
      
      // Re-indexar los pasos restantes para que sean continuos
      const remainingSteps = this.report.test_scenario_steps
        .filter((s: any) => s.id !== step.id)
        .map((s: any, index: number) => ({
          ...s,
          numero_paso: index + 1
        }));

      for (const s of remainingSteps) {
        const originalStep = this.report.test_scenario_steps.find((orig: any) => orig.id === s.id);
        if (originalStep && originalStep.numero_paso !== s.numero_paso) {
          await this.dbService.updateStepNumber(s.id, s.numero_paso);
        }
      }

      this.toast.success('Paso eliminado y secuencia actualizada');
      await this.loadReport(this.report.id);
    } catch (e) {
      console.error(e);
      this.toast.error('Error al eliminar el paso');
    }
  }

  toggleRefiner() {
    this.showRefiner = !this.showRefiner;
    if (!this.showRefiner) this.refinementInstruction = '';
  }

  async onStepBlur(step: any, event: any) {
    const newText = event.target.innerText.trim();
    if (newText !== step.descripcion_accion_observada) {
      try {
        await this.dbService.updateStep(step.id, newText);
        step.descripcion_accion_observada = newText;
        this.toast.success('Cambio guardado');
      } catch (e) {
        this.toast.error('Error al guardar cambio');
      }
    }
  }

  async exportToExcel() {
    this.toast.info('Generando matriz de pruebas...');
    const success = await this.excelService.downloadExcelReport(this.report);
    if (success) this.toast.success('Excel exportado');
  }

  async refine() {
    if (!this.refinementInstruction || this.isRefining) return;

    this.isRefining = true;
    try {
      this.toast.info('Gemini está procesando...');
      const refinedData = await this.aiService.refineAnalysis(this.report, this.refinementInstruction).toPromise();
      
      if (!refinedData) throw new Error('Sin respuesta');

      await this.dbService.updateScenario(this.report.id, {
        nombre_del_escenario: refinedData.escenario_prueba,
        precondiciones: refinedData.precondiciones,
        resultado_obtenido: refinedData.resultado_obtenido,
        estado_general: refinedData.estado_general
      }, refinedData.pasos);

      this.toast.success('Escenario refinado');
      this.showRefiner = false;
      this.refinementInstruction = '';
      this.loadReport(this.report.id);
      
    } catch (e) {
      this.toast.error('Fallo al refinar');
    } finally {
      this.isRefining = false;
    }
  }

  async confirmDelete() {
    if (!this.report) return;
    this.showDeleteModal = false;
    try {
      await this.dbService.deleteReport(this.report.id);
      this.toast.success('Escenario eliminado correctamente');
      this.router.navigate(['/evidence-reports']);
    } catch (e) {
      this.toast.error('Error al eliminar el escenario');
    }
  }
}
