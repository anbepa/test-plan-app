import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EvidenceDatabaseService } from '../services/database/evidence-database.service';
import { EvidenceAnalysisService } from '../services/ai/evidence-analysis.service';
import { EvidenceExcelService } from '../services/core/evidence-excel.service';
import { ToastService } from '../services/core/toast.service';
import { SharedConfirmModalComponent } from '../shared/components/shared-confirm-modal.component';

@Component({
  selector: 'app-evidence-report-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, SharedConfirmModalComponent],
  template: `
    <div class="detail-page fade-in">
      <!-- Top Bar -->
      <header class="top-nav">
        <div class="nav-left">
          <button class="back-btn" routerLink="/evidence-reports">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Volver
          </button>
          <div class="title-meta">
            <h1>Detalle del Escenario</h1>
            <p>{{ report?.nombre_del_escenario }}</p>
          </div>
        </div>
        <div class="nav-right">
          <div class="pagination">
            <button class="nav-arrow" (click)="navigateReport(-1)" [disabled]="!canNavigate(-1)"><i class="pi pi-chevron-left"></i></button>
            <span class="page-info">{{ currentReportIndex + 1 }} / {{ totalReports }}</span>
            <button class="nav-arrow" (click)="navigateReport(1)" [disabled]="!canNavigate(1)"><i class="pi pi-chevron-right"></i></button>
          </div>
          <button class="delete-top-btn" (click)="showDeleteModal = true">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          <button class="close-btn" routerLink="/evidence-reports">
            <i class="pi pi-times"></i>
          </button>
        </div>
      </header>

      <!-- Main Actions -->
      <div class="action-bar-container">
        <div class="action-buttons">
          <button class="btn-secondary" (click)="toggleRefiner()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
            Refinar con IA
          </button>
          <button class="btn-primary" (click)="exportToExcel()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Exportar Matriz
          </button>
        </div>
      </div>

      <!-- Refiner Section -->
      <div class="refiner-section" *ngIf="showRefiner">
        <div class="refiner-card fade-in">
          <header class="refiner-header">
            <h3>Instrucciones de Refinamiento</h3>
            <button class="btn-close-refiner" (click)="toggleRefiner()"><i class="pi pi-times"></i></button>
          </header>
          <div class="refiner-body">
            <textarea 
              class="refiner-input" 
              placeholder="Ej: Ajusta los pasos para que sean más técnicos, o añade una validación de base de datos..."
              [(ngModel)]="refinementInstruction"
              [disabled]="isRefining"
            ></textarea>
            <div class="refiner-footer">
              <button class="btn-execute" (click)="refine()" [disabled]="isRefining || !refinementInstruction">
                <span class="spinner" *ngIf="isRefining"></span>
                {{ isRefining ? 'Procesando...' : 'Aplicar Refinamiento' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main class="main-content" *ngIf="report">
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
                    <div class="step-index">{{ step.numero_paso }}</div>
                  </td>
                  <td>
                    <div 
                      class="step-text" 
                      contenteditable="true" 
                      (blur)="onStepBlur(step, $event)"
                    >{{ step.descripcion_accion_observada }}</div>
                  </td>
                  <td style="text-align: center;">
                    <button class="btn-view-evidence" (click)="viewImageForStep(step)">
                      <i class="pi pi-image"></i>
                      <span>VER</span>
                    </button>
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
                <i class="pi" [ngClass]="report.estado_general === 'Exitoso' ? 'pi-check-circle' : 'pi-exclamation-triangle'"></i>
              </div>
              <div class="result-titles">
                <label>Resultado Obtenido</label>
                <span class="status-text">{{ report.estado_general }}</span>
              </div>
            </div>
            <div class="result-body">
              <p>{{ report.resultado_obtenido }}</p>
            </div>
          </div>
        </section>
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
      <app-shared-confirm-modal
        [isOpen]="showDeleteModal"
        [title]="'¿Eliminar escenario?'"
        [message]="'Estás a punto de eliminar este escenario de prueba permanentemente. Esta acción no se puede deshacer.'"
        [confirmText]="'Eliminar permanentemente'"
        (onClose)="showDeleteModal = false"
        (onConfirm)="confirmDelete()"
      ></app-shared-confirm-modal>
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

    /* Top Nav */
    .top-nav {
      background: #ffffff;
      height: 60px;
      padding: 0 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #d2d2d7;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .nav-left, .nav-right { display: flex; align-items: center; gap: 1.5rem; }

    .back-btn {
      background: #ffffff;
      border: 1px solid #d2d2d7;
      padding: 0.5rem 1rem;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      color: #1d1d1f;
      transition: all 0.2s;
    }

    .back-btn:hover { background: #f5f5f7; }

    .title-meta h1 { font-size: 1.05rem; font-weight: 800; margin: 0; }
    .title-meta p { font-size: 0.75rem; color: #86868b; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }

    .pagination { display: flex; align-items: center; gap: 1rem; background: #f5f5f7; padding: 0.4rem 0.8rem; border-radius: 10px; }
    .nav-arrow { background: none; border: none; color: #86868b; cursor: pointer; padding: 0.2rem; }
    .nav-arrow:disabled { opacity: 0.3; cursor: not-allowed; }
    .page-info { font-size: 0.8rem; font-weight: 700; color: #1d1d1f; }

    .delete-top-btn {
      background: none;
      border: none;
      color: #ff3b30;
      cursor: pointer;
      padding: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      border-radius: 8px;
    }
    .delete-top-btn:hover { background: rgba(255, 59, 48, 0.1); }

    .close-btn { background: none; border: none; font-size: 1.2rem; color: #86868b; cursor: pointer; }

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

    /* Main Content */
    .main-content { padding: 0 2.5rem 3rem 2.5rem; display: flex; flex-direction: column; gap: 2rem; }
    .section-card { background: #ffffff; border-radius: 24px; padding: 2.5rem; box-shadow: 0 4px 30px rgba(0,0,0,0.02); }

    /* Report Card Header */
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2.5rem; }
    .header-left { display: flex; flex-direction: column; gap: 0.5rem; }
    .scenario-id { font-size: 0.75rem; font-weight: 700; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; }
    .scenario-title { font-size: 1.8rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; line-height: 1.2; color: #1d1d1f; }
    .steps-count { font-size: 0.75rem; font-weight: 700; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; }

    .status-badge { display: flex; align-items: center; gap: 0.6rem; background: #f5f5f7; padding: 0.4rem 1.2rem; border-radius: 20px; font-weight: 700; font-size: 0.8rem; color: #1d1d1f; }
    .status-badge.success { background: #f0faf4; color: #21a366; }
    .status-badge .dot { width: 8px; height: 8px; background: #34c759; border-radius: 50%; }

    /* Steps Table */
    .table-container { border-top: 1px solid #f2f2f7; margin: 0 -0.5rem; }
    .steps-table { width: 100%; border-collapse: collapse; }
    .steps-table th { text-align: left; padding: 1.2rem 1rem; color: #86868b; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #f2f2f7; }
    .steps-table td { padding: 1.5rem 1rem; vertical-align: middle; border-bottom: 1px solid #f9f9fb; }

    .col-num { width: 70px; }
    .step-index { width: 34px; height: 34px; background: #f5f5f7; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #86868b; font-size: 0.9rem; }

    .step-text { font-size: 1rem; line-height: 1.6; color: #1d1d1f; font-weight: 500; outline: none; padding: 0.4rem; border-radius: 8px; transition: background 0.2s; }
    .step-text:focus { background: #f5f5f7; }

    .btn-view-evidence {
      background: #0071e3; color: white; border: none; width: 54px; height: 54px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; cursor: pointer; transition: transform 0.2s;
    }
    .btn-view-evidence:hover { transform: scale(1.05); }
    .btn-view-evidence span { font-size: 0.65rem; font-weight: 800; letter-spacing: 0.05em; }

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
    .modal-body img { max-width: 100%; height: auto; border-radius: 8px; }

    .spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class EvidenceReportDetailComponent implements OnInit {
  report: any;
  selectedImage: any = null;
  
  showRefiner = false;
  isRefining = false;
  refinementInstruction = '';
  showDeleteModal = false;

  // Navigation state
  allReportIds: string[] = [];
  currentReportIndex: number = 0;
  totalReports: number = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private dbService: EvidenceDatabaseService,
    private aiService: EvidenceAnalysisService,
    private excelService: EvidenceExcelService,
    private toast: ToastService
  ) {}

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      await Promise.all([
        this.loadReport(id),
        this.loadNavigationState(id)
      ]);
    }
  }

  async loadNavigationState(currentId: string) {
    try {
      this.allReportIds = await this.dbService.getReportIds();
      this.totalReports = this.allReportIds.length;
      this.currentReportIndex = this.allReportIds.indexOf(currentId);
    } catch (e) {
      console.error('Error al cargar estado de navegación', e);
    }
  }

  async loadReport(id: string) {
    try {
      this.report = await this.dbService.getReportById(id);
    } catch (e) {
      this.toast.error('Error al cargar el reporte');
    }
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

  viewImageForStep(step: any) {
    let img = this.report?.report_images?.find((i: any) => i.step_id === step.id);
    
    if (!img && step.imagen_referencia) {
      const match = step.imagen_referencia.match(/\d+/);
      if (match) {
        const order = parseInt(match[0], 10);
        img = this.report?.report_images?.find((i: any) => i.image_order === order);
      }
    }

    if (img) {
      this.selectedImage = img;
    } else {
      this.toast.info('No hay imagen asociada a este paso');
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
