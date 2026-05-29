import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EvidenceDatabaseService } from '../services/database/evidence-database.service';
import { EvidenceAnalysisService } from '../services/ai/evidence-analysis.service';
import { EvidenceExcelService } from '../services/core/evidence-excel.service';
import { ToastService } from '../services/core/toast.service';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import * as XLSX from 'xlsx';

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
          <div class="drawer-actions">
            <button class="btn-execute-refine" (click)="refine()" [disabled]="isRefining || !refinementInstruction">
              <span class="spinner" *ngIf="isRefining"></span>
              {{ isRefining ? 'Aplicar Refinamiento' : 'Procesar Cambios con IA' }}
            </button>
            <button class="btn-save-manual" (click)="saveManualChanges()" [disabled]="isRefining">
              <span>💾</span> Guardar Cambios Manuales
            </button>
          </div>
        </div>
      </div>

      <main class="main-content" *ngIf="report">

        <div class="content-body">
        <!-- Scenario Card -->
        <section class="section-card">
          <header class="card-header">
            <div class="header-left">
              <span class="scenario-id">CASO #{{ report.id_caso || '1' }}</span>
              <h2 class="scenario-title"
                  contenteditable="true"
                  (blur)="onFieldBlur('nombre_del_escenario', $event)"
                  title="Haz clic para editar el título">
                {{ report.nombre_del_escenario }}
              </h2>
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
                    <div style="font-size: 10px; color: red; margin-bottom: 4px;">[Ref: {{ step.imagen_referencia }}]</div>
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
                      <!-- Mostrar TODAS las evidencias del paso -->
                      <ng-container *ngIf="getImagesForStep(step).length > 0">
                        <div class="multi-evidence-row">
                          <div
                            *ngFor="let img of getImagesForStep(step)"
                            class="evidence-thumb-container"
                            [attr.data-img-url]="img.image_url"
                            (click)="onThumbClick(step, img)"
                          >
                            <!-- ESTADO 1: No activada aún -->
                            <div class="thumb-placeholder" *ngIf="!isActivated(img)">
                              <span class="placeholder-icon" *ngIf="img.file_type?.includes('csv')">📄 CSV</span>
                              <span class="placeholder-icon" *ngIf="img.file_type?.includes('sheet') || img.file_type?.includes('excel')">📊 XLSX</span>
                              <span class="placeholder-icon" *ngIf="!img.file_type?.includes('csv') && !img.file_type?.includes('sheet') && !img.file_type?.includes('excel')">🖼</span>
                            </div>

                            <!-- ESTADO 2 + 3: Activada -->
                            <ng-container *ngIf="isActivated(img)">
                              <img
                                *ngIf="!img.file_type?.includes('csv') && !img.file_type?.includes('sheet') && !img.file_type?.includes('excel')"
                                [src]="getThumbSrc(img)"
                                class="step-thumb"
                                [class.thumb-fading]="!isLoaded(img)"
                                alt="Evidencia"
                                decoding="async"
                                (load)="onImageLoad(img)"
                                (error)="onImageError(img)"
                              >

                              <!-- Si es CSV/XLSX -->
                              <div
                                *ngIf="img.file_type?.includes('csv') || img.file_type?.includes('sheet') || img.file_type?.includes('excel')"
                                class="step-doc-icon"
                                [class.csv]="img.file_type?.includes('csv')"
                                [class.xlsx]="img.file_type?.includes('sheet') || img.file_type?.includes('excel')"
                              >
                                <span class="doc-badge">{{ getExtension(img.file_name) }}</span>
                                <span class="doc-emoji">📊</span>
                              </div>

                              <!-- Spinner descargando -->
                              <div class="thumb-load-overlay" *ngIf="!isLoaded(img) && !img.file_type?.includes('csv') && !img.file_type?.includes('sheet') && !img.file_type?.includes('excel')">
                                <div class="thumb-spinner"></div>
                                <span class="thumb-load-hint">Cargando...</span>
                              </div>
                            </ng-container>

                            <button *ngIf="showRefiner" class="btn-delete-evidence" (click)="deleteEvidence(img, $event)" title="Eliminar evidencia">
                              <span style="font-size: 10px;">🗑</span>
                            </button>
                          </div>
                          <!-- Botón para añadir más evidencias al paso -->
                          <div
                            *ngIf="showRefiner"
                            class="evidence-thumb-container add-more-slot"
                            (click)="triggerImageUpload(step)"
                            title="Añadir más evidencia (img, CSV, XLSX)"
                          >
                            <span style="font-size: 1.2rem; color: #888;">+</span>
                          </div>
                        </div>
                      </ng-container>

                      <ng-container *ngIf="getImagesForStep(step).length === 0">
                        <div class="empty-evidence-slot" *ngIf="showRefiner" (click)="triggerImageUpload(step)" title="Subir imagen, CSV o XLSX">
                          <span style="font-size: 1.2rem;">+</span>
                          <span>Subir</span>
                          <span style="font-size: 0.65rem; color: #aaa; display: block; line-height: 1.1;">img / csv / xlsx</span>
                        </div>
                        <button *ngIf="!showRefiner" class="btn-view-no-evidence" disabled>
                          <span style="font-size: 1.2rem;">🖼</span>
                        </button>
                      </ng-container>
                    </div>
                  </td>
                </tr>
                <!-- Añadir Paso Manual -->
                <tr *ngIf="showRefiner">
                  <td class="col-num">
                    <div class="col-num-inner">
                      <button class="btn-add-step" (click)="addNewStep()" title="Añadir nuevo paso">
                        <span>+</span>
                      </button>
                    </div>
                  </td>
                  <td colspan="2">
                    <button class="btn-add-step-text" (click)="addNewStep()">Añadir un nuevo paso manual...</button>
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
              <div
                class="result-text-editable"
                contenteditable="true"
                (blur)="onFieldBlur('resultado_obtenido', $event)"
                title="Haz clic para editar el resultado obtenido"
                [innerHTML]="formatTechnicalText(report.resultado_obtenido)">
              </div>
            </div>
          </div>
        </section>

        <input type="file" #stepImageInput style="display: none;" (change)="onStepImageSelected($event)" accept="image/*,.csv,.xlsx,.xls">
      </div>
    </main>

      <!-- Image/Spreadsheet Modal -->
      <div class="modal-overlay" *ngIf="selectedImage" (click)="selectedImage = null">
        <div class="modal-content" [class.spreadsheet-modal]="selectedImage.file_type?.includes('csv') || selectedImage.file_type?.includes('sheet') || selectedImage.file_type?.includes('excel')" (click)="$event.stopPropagation()">
          <header class="modal-header">
            <span>{{ selectedImage.file_name }}</span>
            <div class="modal-header-actions">
              <ng-container *ngIf="selectedImage.file_type?.includes('csv') || selectedImage.file_type?.includes('sheet') || selectedImage.file_type?.includes('excel')">
                <div class="spreadsheet-search-wrap">
                  <input type="text" class="spreadsheet-search-input" placeholder="Buscar en datos..." [(ngModel)]="spreadsheetSearchTerm">
                </div>
                <a [href]="selectedImage.image_url" target="_blank" download class="btn-download-sm" title="Descargar archivo original">
                  📥 Descargar
                </a>
              </ng-container>
              <button class="btn-close-modal" (click)="selectedImage = null">&times;</button>
            </div>
          </header>
          <div class="modal-body">
            <!-- Si es imagen -->
            <img *ngIf="!selectedImage.file_type?.includes('csv') && !selectedImage.file_type?.includes('sheet') && !selectedImage.file_type?.includes('excel')" [src]="selectedImage.image_url" [alt]="selectedImage.file_name">

            <!-- Si es CSV/XLSX - Visor de tabla -->
            <div *ngIf="selectedImage.file_type?.includes('csv') || selectedImage.file_type?.includes('sheet') || selectedImage.file_type?.includes('excel')" class="spreadsheet-viewer">
              <div class="spreadsheet-loading" *ngIf="isLoadingSpreadsheet">
                <div class="spreadsheet-spinner"></div>
                <span>Cargando datos del archivo...</span>
              </div>
              <div class="spreadsheet-empty" *ngIf="!isLoadingSpreadsheet && spreadsheetData.length === 0">
                <div class="doc-download-card">
                  <div class="doc-card-icon" [class.csv]="selectedImage.file_type?.includes('csv')" [class.xlsx]="selectedImage.file_type?.includes('sheet') || selectedImage.file_type?.includes('excel')">
                    📊
                  </div>
                  <div class="doc-card-info">
                    <h3>{{ selectedImage.file_name }}</h3>
                    <p>No se pudo previsualizar. Puedes descargarlo directamente.</p>
                    <a [href]="selectedImage.image_url" target="_blank" download class="btn-download-file">
                      <span>📥</span> Descargar archivo
                    </a>
                  </div>
                </div>
              </div>
              <div class="spreadsheet-table-wrap" *ngIf="!isLoadingSpreadsheet && spreadsheetData.length > 0">
                <table class="spreadsheet-table">
                  <thead *ngIf="filteredSpreadsheetRows.length > 0">
                    <tr>
                      <th class="row-num-header">#</th>
                      <th *ngFor="let cell of filteredSpreadsheetRows[0]">{{ cell }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of filteredSpreadsheetRows.slice(1); let i = index">
                      <td class="row-num">{{ i + 1 }}</td>
                      <td *ngFor="let cell of row" [class.cell-numeric]="isNumericCell(cell)">{{ cell }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="spreadsheet-footer">
                  <span class="spreadsheet-count">{{ filteredSpreadsheetRows.length - 1 }} filas · {{ (filteredSpreadsheetRows[0] || []).length }} columnas</span>
                </div>
              </div>
            </div>
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

    .multi-evidence-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      align-items: center;
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

    .add-more-slot {
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px dashed #555;
      border-radius: 14px;
      background: rgba(255,255,255,0.04);
      color: #888;
      transition: border-color 0.2s, background 0.2s;
      flex-shrink: 0;
    }
    .add-more-slot:hover {
      border-color: #a78bfa;
      background: rgba(167,139,250,0.08);
      color: #a78bfa;
    }

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

    .btn-add-step {
      width: 34px; height: 34px; background: #0071e3; color: white; border: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; cursor: pointer; transition: all 0.2s;
    }
    .btn-add-step:hover { transform: scale(1.1); background: #0077ed; }

    .btn-add-step-text {
      width: 100%; text-align: left; background: none; border: 1px dashed #d2d2d7; padding: 1rem; border-radius: 12px; color: #86868b; font-weight: 500; cursor: pointer; transition: all 0.2s;
    }
    .btn-add-step-text:hover { background: #f5f5f7; border-color: #0071e3; color: #0071e3; }

    .result-text-editable {
      font-size: 1.1rem; line-height: 1.6; color: #1e6144; margin: 0; font-weight: 500; outline: none; padding: 0.5rem; border-radius: 8px; transition: background 0.2s;
    }
    .result-text-editable:focus { background: rgba(255,255,255,0.5); }

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

    .drawer-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }

    .btn-execute-refine {
      background: #0071e3; color: white; border: none; padding: 14px; border-radius: 12px;
      font-weight: 700; cursor: pointer; transition: all 0.2s;
    }

    .btn-save-manual {
      background: #f5f5f7; color: #1d1d1f; border: 1px solid #d2d2d7; padding: 12px; border-radius: 12px;
      font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .btn-save-manual:hover { background: #e5e5e7; }

    /* Diff View Styles */
    .diff-view { display: flex; flex-direction: column; gap: 8px; }
    .diff-removed { color: #ff3b30; text-decoration: line-through; background: rgba(255, 59, 48, 0.05); padding: 4px; border-radius: 4px; font-size: 0.9rem; }
    .diff-added { color: #34c759; background: rgba(52, 199, 89, 0.05); padding: 4px; border-radius: 4px; font-weight: 600; }

    .regenerating { filter: blur(4px); opacity: 0.5; pointer-events: none; transition: all 0.4s; }
    .refining-placeholder { color: #0071e3; font-weight: 700; font-style: italic; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }

    /* CSS para documentos en reporte */
    .step-doc-icon {
      width: 74px;
      height: 74px;
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      background: linear-gradient(135deg, #f5f5f7 0%, #e5e5e7 100%);
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
      border: 2px solid #ffffff;
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .step-doc-icon:hover {
      transform: scale(1.1);
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      z-index: 10;
    }
    .step-doc-icon.csv {
      background: linear-gradient(135deg, #e6f4ea 0%, #ceead6 100%);
    }
    .step-doc-icon.xlsx {
      background: linear-gradient(135deg, #e6f4ea 0%, #a7f3d0 100%);
    }
    .step-doc-icon .doc-badge {
      position: absolute;
      top: 6px;
      right: 6px;
      font-size: 8px;
      font-weight: 800;
      color: white;
      padding: 1px 4px;
      border-radius: 4px;
    }
    .step-doc-icon.csv .doc-badge { background-color: #217346; }
    .step-doc-icon.xlsx .doc-badge { background-color: #107c41; }
    .step-doc-icon .doc-emoji { font-size: 24px; }

    /* Modal download card */
    .doc-download-card {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 32px;
      background: #f5f5f7;
      border-radius: 16px;
      min-width: 350px;
    }
    .doc-card-icon {
      font-size: 48px;
      width: 80px;
      height: 80px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      box-shadow: 0 8px 16px rgba(0,0,0,0.06);
    }
    .doc-card-icon.csv { background: #e6f4ea; color: #217346; }
    .doc-card-icon.xlsx { background: #e6f4ea; color: #107c41; }
    .doc-card-info h3 { margin: 0 0 6px 0; font-size: 16px; font-weight: 700; color: #1d1d1f; }
    .doc-card-info p { margin: 0 0 16px 0; font-size: 13px; color: #86868b; }
    .btn-download-file {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #0071e3;
      color: white;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0,113,227,0.25);
      transition: all 0.2s;
    }
    .btn-download-file:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(0,113,227,0.35);
    }

    /* Spreadsheet Modal */
    .spreadsheet-modal { width: 95vw; max-width: 95vw; height: 85vh; max-height: 85vh; }
    .spreadsheet-modal .modal-body { flex: 1; padding: 0; overflow: hidden; display: flex; flex-direction: column; }
    .modal-header-actions { display: flex; align-items: center; gap: 12px; }
    .spreadsheet-search-wrap { position: relative; }
    .spreadsheet-search-input {
      background: #f5f5f7; border: 1px solid #e5e5ea; border-radius: 8px;
      padding: 6px 12px; font-size: 13px; color: #1d1d1f; width: 220px;
      transition: all 0.2s;
    }
    .spreadsheet-search-input:focus { outline: none; border-color: #0071e3; background: white; box-shadow: 0 0 0 3px rgba(0,113,227,0.1); }
    .btn-download-sm {
      display: inline-flex; align-items: center; gap: 4px;
      background: #0071e3; color: white; text-decoration: none;
      padding: 6px 14px; border-radius: 8px; font-weight: 600; font-size: 12px;
      transition: all 0.2s; white-space: nowrap;
    }
    .btn-download-sm:hover { background: #0077ED; transform: translateY(-1px); }

    /* Spreadsheet Viewer */
    .spreadsheet-viewer { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
    .spreadsheet-loading {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 16px; padding: 60px; color: #86868b; font-size: 14px;
    }
    .spreadsheet-spinner {
      width: 32px; height: 32px; border: 3px solid #e5e5ea;
      border-top-color: #0071e3; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spreadsheet-empty { display: flex; align-items: center; justify-content: center; padding: 40px; }
    .spreadsheet-table-wrap { flex: 1; overflow: auto; padding: 0; }
    .spreadsheet-table {
      width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0;
      font-size: 12px; font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
    }
    .spreadsheet-table thead { position: sticky; top: 0; z-index: 2; }
    .spreadsheet-table th {
      background: #1d1d1f; color: white; padding: 8px 14px;
      text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; white-space: nowrap; border-right: 1px solid rgba(255,255,255,0.1);
    }
    .spreadsheet-table .row-num-header {
      background: #1d1d1f; color: #86868b; width: 50px; text-align: center;
      position: sticky; left: 0; z-index: 3;
    }
    .spreadsheet-table td {
      padding: 6px 14px; border-bottom: 1px solid #f0f0f2; white-space: nowrap;
      max-width: 300px; overflow: hidden; text-overflow: ellipsis; color: #1d1d1f;
    }
    .spreadsheet-table .row-num {
      background: #fafafa; color: #86868b; text-align: center; font-size: 10px;
      position: sticky; left: 0; z-index: 1; border-right: 1px solid #e5e5ea;
    }
    .spreadsheet-table tbody tr:nth-child(even) { background: #fafbfc; }
    .spreadsheet-table tbody tr:hover { background: #e8f0fe; }
    .spreadsheet-table .cell-numeric { text-align: right; font-variant-numeric: tabular-nums; }
    .spreadsheet-footer {
      padding: 8px 16px; background: #f5f5f7; border-top: 1px solid #e5e5ea;
      font-size: 11px; color: #86868b; display: flex; align-items: center;
    }
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

  @ViewChild('stepImageInput') stepImageInput!: any;
  currentStepForImage: any = null;

  // Spreadsheet viewer state
  spreadsheetData: any[][] = [];
  isLoadingSpreadsheet = false;
  spreadsheetSearchTerm = '';

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



  getExtension(filename: string): string {
    if (!filename) return 'FILE';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()!.toUpperCase() : 'FILE';
  }

  goBack() {
    this.router.navigate(['/evidence-reports']);
  }

  getImageForStep(step: any) {
    if (!this.report) return null;

    // 1. Prioridad: Vínculo directo por ID de paso (asignado al subir o por la IA)
    let img = this.report.report_images?.find((i: any) => i.step_id === step.id);

    // 2. Fallback: Vínculo por número de orden (fuente Gemini)
    if (!img && step.imagen_referencia) {
      const match = step.imagen_referencia.match(/\d+/);
      if (match) {
        const order = parseInt(match[0], 10);
        // Solo recuperar por orden si la imagen no está ya asignada a un paso diferente
        img = this.report.report_images?.find((i: any) =>
          i.image_order === order && (!i.step_id || i.step_id === step.id)
        );
      }
    }
    return img;
  }

  /**
   * Devuelve TODAS las evidencias asociadas a un paso (imagen, CSV, XLSX, etc.).
   */
  getImagesForStep(step: any): any[] {
    if (!this.report) return [];

    // 1. Todas las que tienen step_id directo
    const byId = (this.report.report_images || []).filter((i: any) => i.step_id === step.id);
    if (byId.length > 0) return byId;

    // 2. Fallback por imagen_referencia (solo si ninguna imagen tiene step_id asignado a este paso)
    if (step.imagen_referencia) {
      const fallbacks: any[] = [];
      
      // A. Buscar por nombre de archivo
      const byName = this.report.report_images?.find((i: any) => i.file_name && (i.file_name === step.imagen_referencia || step.imagen_referencia.includes(i.file_name)));
      if (byName && (!byName.step_id || byName.step_id === step.id)) {
        fallbacks.push(byName);
      } else {
        // B. Extraer número limpiando fechas y extensiones comunes
        const cleanRef = step.imagen_referencia
          .replace(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/g, '')
          .replace(/\(\d+\)\.(?:xlsx|csv|jpg|png|jpeg)/gi, '');
          
        const matches = cleanRef.match(/\d+/g);
        if (matches) {
          matches.forEach((m: string) => {
            const order = parseInt(m, 10);
            const fallback = this.report.report_images?.find((i: any) =>
              i.image_order === order && (!i.step_id || i.step_id === step.id)
            );
            if (fallback) fallbacks.push(fallback);
          });
        }
      }
      
      if (fallbacks.length > 0) return fallbacks;
    }
    return [];
  }

  viewImageForStep(step: any) {
    const img = this.getImageForStep(step);
    if (img) {
      if (img.file_type?.includes('csv') || img.file_type?.includes('sheet') || img.file_type?.includes('excel')) {
        this.openSpreadsheetModal(img);
      } else {
        this.selectedImage = img;
      }
    } else {
      this.toast.info('No hay imagen asociada a este paso');
    }
  }

  // ─── Helpers de estado de imagen ────────────────────────────────────────────

  /** El [src] ya fue asignado (descarga iniciada o completa) */
  isActivated(img: any): boolean {
    return this.activatedUrls.has(img.image_url);
  }

  /** La imagen ya terminó de descargarse en el browser o es un documento CSV/XLSX */
  isLoaded(img: any): boolean {
    if (img.file_type?.includes('csv') || img.file_type?.includes('sheet') || img.file_type?.includes('excel')) {
      return true;
    }
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
   * - Imagen descargada o documento → abre modal
   * - Activada pero descargando → registra pending, el (load) abrirá el modal
   * - No activada → activa ahora (fuerza descarga) + registra pending
   */
  onThumbClick(step: any, img: any) {
    if (img.file_type?.includes('csv') || img.file_type?.includes('sheet') || img.file_type?.includes('excel')) {
      this.openSpreadsheetModal(img);
      return;
    }
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

  // ─── Spreadsheet viewer ────────────────────────────────────────────
  async openSpreadsheetModal(img: any) {
    this.selectedImage = img;
    this.spreadsheetData = [];
    this.isLoadingSpreadsheet = true;
    this.spreadsheetSearchTerm = '';
    this.cdr.detectChanges();

    try {
      const response = await fetch(img.image_url);
      const arrayBuffer = await response.arrayBuffer();

      const isCSV = img.file_type?.includes('csv') || img.file_name?.toLowerCase().endsWith('.csv');

      let workbook: XLSX.WorkBook;
      if (isCSV) {
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
        } catch {
          text = new TextDecoder('windows-1252').decode(arrayBuffer);
        }
        workbook = XLSX.read(text, { type: 'string', cellDates: true });
      } else {
        workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: true });
      }

      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      const headers = json[0] || [];
      this.spreadsheetData = json.map((row, rIndex) => {
        if (rIndex === 0) return row.map((h: any) => h !== undefined && h !== null ? String(h) : '');
        return (row || []).map((cell: any, cIndex: number) => {
          const header = String(headers[cIndex] || '').toLowerCase();
          if (typeof cell === 'number') {
            const isDateCol = header.includes('date') || header.includes('_at');
            if (isDateCol && cell > 30000) {
              cell = new Date(Math.round((cell - 25569) * 86400 * 1000));
            } else {
              const isIdOrCode = header.includes('account') ||
                header === 'nit' ||
                header.includes('product_id') ||
                header.includes('id_reference') ||
                header.includes('transactional_id');
              if (isIdOrCode) return String(cell);
              return cell.toLocaleString('en-US', { maximumFractionDigits: 3 });
            }
          }
          if (cell instanceof Date) {
            const d = cell;
            const pad = (n: number) => n.toString().padStart(2, '0');
            const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            return `${dateStr} ${timeStr}`;
          }
          return cell !== undefined && cell !== null ? String(cell) : '';
        });
      });
    } catch (err) {
      console.error('Error loading spreadsheet:', err);
      this.toast.error('Error al cargar el archivo. Puedes descargarlo directamente.');
    } finally {
      this.isLoadingSpreadsheet = false;
      this.cdr.detectChanges();
    }
  }

  get filteredSpreadsheetRows(): any[][] {
    if (!this.spreadsheetSearchTerm || !this.spreadsheetData.length) return this.spreadsheetData;
    const term = this.spreadsheetSearchTerm.toLowerCase();
    const [header, ...dataRows] = this.spreadsheetData;
    const filtered = dataRows.filter(row =>
      row.some((cell: any) => String(cell).toLowerCase().includes(term))
    );
    return [header, ...filtered];
  }

  isNumericCell(value: any): boolean {
    if (value === null || value === undefined || value === '') return false;
    const str = String(value).replace(/,/g, '');
    return !isNaN(Number(str)) && str.trim() !== '';
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

  async onFieldBlur(field: string, event: any) {
    const newValue = event.target.innerText.trim();
    if (this.report[field] !== newValue) {
      try {
        const updateData: any = {};
        updateData[field] = newValue;
        await this.dbService.updateScenario(this.report.id, updateData);
        this.report[field] = newValue;
        this.toast.success('Cambio guardado');
      } catch (e) {
        this.toast.error('Error al guardar el cambio');
      }
    }
  }

  async addNewStep() {
    try {
      const nextNum = (this.report.test_scenario_steps?.length || 0) + 1;
      const newStep = await this.dbService.addStep(this.report.id, nextNum, 'Nuevo paso manual...');

      if (!this.report.test_scenario_steps) this.report.test_scenario_steps = [];
      this.report.test_scenario_steps.push(newStep);
      this.toast.success('Nuevo paso añadido');
      this.cdr.detectChanges();
    } catch (e) {
      this.toast.error('Error al añadir el paso');
    }
  }

  triggerImageUpload(step: any) {
    this.currentStepForImage = step;
    this.stepImageInput.nativeElement.click();
  }

  async onStepImageSelected(event: any) {
    const file: File = event.target.files[0];
    const step = this.currentStepForImage;

    if (!file || !step) {
      this.currentStepForImage = null;
      return;
    }

    try {
      this.toast.info('Subiendo evidencia...');

      // Detect the real file type
      const fileName = file.name.toLowerCase();
      const isCSV = file.type.includes('csv') || fileName.endsWith('.csv');
      const isXLSX = file.type.includes('sheet') || file.type.includes('excel') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      const mimeType = isCSV
        ? 'text/csv'
        : isXLSX
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : file.type || 'image/png';

      const reader = new FileReader();

      reader.onload = async (e: any) => {
        try {
          const base64 = e.target.result;
          const order = step.numero_paso;

          await this.dbService.saveImageForStep(this.report.id, step.id, base64, file.name, order, mimeType);

          this.toast.success('Evidencia cargada exitosamente');
          await this.loadReport(this.report.id);
        } catch (err) {
          console.error('Error al procesar la evidencia:', err);
          this.toast.error('Error al subir la evidencia');
        }
      };

      reader.onerror = () => {
        this.toast.error('Error al leer el archivo');
      };

      reader.readAsDataURL(file);
    } catch (e) {
      console.error('Error en onStepImageSelected:', e);
      this.toast.error('Error al cargar la evidencia');
    } finally {
      this.currentStepForImage = null;
      event.target.value = '';
    }
  }

  async saveManualChanges() {
    if (!this.report) return;

    try {
      this.toast.info('Guardando cambios manuales...');

      const scenarioData = {
        nombre_del_escenario: this.report.nombre_del_escenario,
        resultado_obtenido: this.report.resultado_obtenido,
        precondiciones: this.report.precondiciones,
        estado_general: this.report.estado_general
      };

      // Si hay pasos, sincronizarlos
      const steps = this.report.test_scenario_steps || [];

      await this.dbService.updateScenario(this.report.id, scenarioData, steps);

      this.toast.success('Cambios manuales guardados exitosamente');
      await this.loadReport(this.report.id);
    } catch (e) {
      console.error('Error al guardar cambios manuales:', e);
      this.toast.error('Error al guardar los cambios');
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
