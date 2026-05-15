import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EvidenceDatabaseService } from '../services/database/evidence-database.service';
import { EvidenceExcelService } from '../services/core/evidence-excel.service';
import { ToastService } from '../services/core/toast.service';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-evidence-report-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ConfirmationModalComponent],
  template: `
    <div class="list-container fade-in">
      <!-- ... (previous header code) ... -->
      <header class="page-header">
        <h1>Escenarios de Prueba</h1>
        <p class="subtitle">Consulta y gestiona los escenarios generados por Historia de Usuario</p>
      </header>

      <!-- ... (filters code) ... -->
      <section class="section-card filter-section">
        <h2 class="section-title">FILTROS DE BÚSQUEDA</h2>
        <div class="filter-grid">
          <div class="filter-group">
            <label>Historia de Usuario</label>
            <div class="search-input-wrapper">
              <i class="pi pi-search search-icon"></i>
              <input type="text" [(ngModel)]="huFilter" placeholder="Buscar por número de HU..." (keyup.enter)="loadReports()">
              <button class="btn-search-action" (click)="loadReports()">Buscar</button>
            </div>
          </div>
          
          <div class="filter-group">
            <label>Filtrar Escenarios</label>
            <div class="search-input-wrapper">
              <i class="pi pi-search search-icon"></i>
              <input type="text" [(ngModel)]="textFilter" placeholder="Buscar por nombre o ID de escenario...">
            </div>
          </div>
        </div>
      </section>

      <section class="section-card results-section" *ngIf="appliedHuFilter">
        <div class="results-meta">
          <div class="hu-header-info">
            <h2 class="hu-title">{{ appliedHuFilter }}</h2>
            <span class="hu-name-display" *ngIf="huName">{{ huName }}</span>
          </div>
          <span class="pagination-info">Mostrando 1-{{ filteredReports.length }} de {{ filteredReports.length }} elementos</span>
        </div>

        <div class="results-actions-bar">
          <div class="current-selection">
          </div>

          <div class="action-buttons">
            <button class="btn-outline btn-excel" (click)="exportAll()" [disabled]="filteredReports.length === 0">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              Exportar Excel
            </button>
            <button class="btn-outline btn-delete" (click)="requestDeleteHU()" [disabled]="!appliedHuFilter">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Eliminar HU
            </button>
            <button class="btn-outline btn-clear" (click)="clearFilters()">
              Limpiar filtros
            </button>
          </div>
        </div>

        <!-- ... (table code) ... -->
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th class="col-check">
                  <div class="custom-checkbox" [class.checked]="areAllVisibleSelected()" (click)="toggleSelectAllVisible()">
                    <svg *ngIf="areAllVisibleSelected()" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                </th>
                <th class="col-id">ID CASO</th>
                <th class="col-hu">HU</th>
                <th class="col-name">NOMBRE DEL ESCENARIO</th>
                <th class="col-steps">PASOS</th>
                <th class="col-status">ESTADO</th>
                <th class="col-date">FECHA CREACIÓN</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let report of filteredReports" (click)="goToDetail(report.id)">
                <td class="col-check" (click)="$event.stopPropagation()">
                  <div class="custom-checkbox" [class.checked]="selectedReports.includes(report.id)" (click)="toggleSelection(report.id)">
                    <svg *ngIf="selectedReports.includes(report.id)" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                </td>
                <td class="col-id">{{ report.id_caso || '1' }}</td>
                <td class="col-hu">
                  <span class="hu-badge">{{ report.historia_usuario || 'N/A' }}</span>
                </td>
                <td class="col-name">{{ report.nombre_del_escenario }}</td>
                <td class="col-steps">
                  <span class="steps-badge">{{ report.steps_count }}</span>
                </td>
                <td class="col-status">
                  <span class="status-badge" [class.success]="report.estado_general === 'Exitoso'">
                    <span class="dot"></span> {{ report.estado_general || 'Exitoso' }}
                  </span>
                </td>
                <td class="col-date">{{ report.created_at | date:'dd/MM/yyyy' }}</td>
              </tr>
            </tbody>
          </table>

          <div class="empty-state" *ngIf="filteredReports.length === 0">
            <p>No se encontraron escenarios para la historia <strong>{{ appliedHuFilter }}</strong>.</p>
          </div>
        </div>
      </section>

      <!-- Floating bulk action bar -->
      <div class="bulk-delete-bar" *ngIf="selectedReports.length > 0">
        <span class="bulk-count">{{ selectedReports.length }} escenario{{ selectedReports.length !== 1 ? 's' : '' }} seleccionado{{ selectedReports.length !== 1 ? 's' : '' }}</span>
        <button class="bulk-delete-btn" (click)="requestDeleteSelected()">
          <span class="icon-trash-white"></span>
          Eliminar seleccionados
        </button>
        <button class="bulk-cancel-btn" (click)="clearSelection()">
          Cancelar
        </button>
      </div>

      <!-- Estado inicial sin búsqueda -->
      <section class="section-card search-placeholder" *ngIf="!appliedHuFilter">
        <div class="placeholder-content">
          <i class="pi pi-search placeholder-icon"></i>
          <h3>Busca por Historia de Usuario</h3>
          <p>Ingresa el número de una HU en los filtros superiores para visualizar sus escenarios de prueba generados.</p>
        </div>
      </section>

      <!-- Modal de Confirmación -->
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
    .list-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2.5rem 3.5rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f5f5f7;
      min-height: 100vh;
      color: #1d1d1f;
    }

    .page-header {
      margin-bottom: 2.5rem;
    }

    .page-header h1 {
      font-size: 2.4rem;
      font-weight: 700;
      margin: 0 0 0.5rem 0;
      letter-spacing: -0.01em;
    }

    .page-header .subtitle {
      font-size: 1.1rem;
      color: #86868b;
      margin: 0;
    }

    .section-card {
      background: #ffffff;
      border-radius: 20px;
      padding: 1.8rem 2.2rem;
      box-shadow: 0 4px 25px rgba(0,0,0,0.03);
      margin-bottom: 2rem;
    }

    .section-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: #86868b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 1.5rem 0;
    }

    /* Filters Styling */
    .filter-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2.5rem;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }

    .filter-group label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #6e6e73;
    }

    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      background: #ffffff;
      border: 1px solid #d2d2d7;
      border-radius: 14px;
      overflow: hidden;
      transition: all 0.2s;
    }

    .search-input-wrapper:focus-within {
      border-color: #0071e3;
      box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.1);
    }

    .search-icon {
      position: absolute;
      left: 1rem;
      color: #86868b;
      font-size: 1rem;
    }

    .search-input-wrapper input {
      border: none;
      background: none;
      padding: 0.9rem 1rem 0.9rem 2.8rem;
      font-size: 1rem;
      width: 100%;
      outline: none;
      color: #1d1d1f;
    }

    .search-input-wrapper input::placeholder {
      color: #c7c7cc;
    }

    .btn-search-action {
      background: #0071e3;
      color: white;
      border: none;
      padding: 0.7rem 1.4rem;
      margin-right: 0.4rem;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.2s;
    }

    .btn-search-action:hover {
      background: #0077ed;
    }

    /* Results Styling */
    .results-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
    }

    .hu-header-info {
      display: flex;
      align-items: center;
      gap: 1.2rem;
    }

    .hu-title {
      font-size: 1.6rem;
      font-weight: 800;
      margin: 0;
      color: #1d1d1f;
    }

    .hu-name-display {
      font-size: 1.1rem;
      color: #6e6e73;
      font-weight: 500;
      padding-left: 1.2rem;
      border-left: 2px solid #d2d2d7;
    }

    .new-tag {
      font-size: 0.75rem;
      font-weight: 700;
      color: #86868b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .pagination-info {
      font-size: 0.75rem;
      color: #c7c7cc;
      font-weight: 500;
    }

    .results-actions-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    .current-selection {
      display: flex;
      align-items: center;
      gap: 0.8rem;
    }

    .hu-selection-name {
      font-size: 1.3rem;
      font-weight: 700;
    }

    .selection-badge {
      background: #e1e9ff;
      color: #004ecc;
      padding: 0.3rem 0.8rem;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 700;
    }

    .selection-status {
      font-size: 0.85rem;
      font-weight: 600;
      color: #86868b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .action-buttons {
      display: flex;
      gap: 0.8rem;
    }

    .btn-outline {
      background: white;
      border: 1px solid #d2d2d7;
      padding: 0.6rem 1.2rem;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #1d1d1f;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-outline:hover {
      background: #f5f5f7;
      border-color: #86868b;
    }

    .btn-excel { color: #21a366; }
    .btn-excel:hover { background: #f0faf4; border-color: #21a366; }
    
    .btn-delete { color: #ff3b30; }
    .btn-delete:hover { background: #fff2f1; border-color: #ff3b30; }

    /* Table Styling */
    .table-container {
      margin: 0 -2.2rem;
      border-top: 1px solid #f2f2f7;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
    }

    .data-table th {
      text-align: left;
      padding: 1.2rem 1.5rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: #86868b;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid #f2f2f7;
    }

    .data-table tr {
      cursor: pointer;
      transition: background 0.15s;
    }

    .data-table tr:hover {
      background: #f9f9fb;
    }

    .data-table td {
      padding: 1.2rem 1.5rem;
      font-size: 0.95rem;
      color: #1d1d1f;
      border-bottom: 1px solid #f9f9fb;
    }

    .col-check { width: 60px; text-align: center; }
    .col-id { width: 100px; font-weight: 600; color: #1d1d1f; }
    .col-hu { width: 110px; }
    .col-name { font-weight: 500; }
    .col-steps { width: 100px; text-align: center; }
    .col-status { width: 140px; }
    .col-date { width: 160px; color: #86868b; }

    .custom-checkbox {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 2.5px solid #d2d2d7;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .custom-checkbox.checked {
      background: #0071e3;
      border-color: #0071e3;
    }

    .hu-badge {
      background: #f0f0f5;
      color: #0071e3;
      padding: 0.3rem 0.7rem;
      border-radius: 6px;
      font-weight: 700;
      font-size: 0.75rem;
    }

    .steps-badge {
      background: #f5f5f7;
      color: #86868b;
      padding: 0.3rem 0.8rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.85rem;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #f0faf4;
      color: #21a366;
      padding: 0.4rem 1rem;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.8rem;
    }

    .status-badge .dot {
      width: 7px;
      height: 7px;
      background: #34c759;
      border-radius: 50%;
    }

    .empty-state {
      padding: 4rem;
      text-align: center;
      color: #86868b;
      font-size: 1rem;
    }

    /* Search Placeholder */
    .search-placeholder {
      padding: 6rem 2rem;
      text-align: center;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #ffffff;
      border: 2px dashed #d2d2d7;
    }

    .placeholder-content {
      max-width: 400px;
    }

    .placeholder-icon {
      font-size: 3.5rem;
      color: #d2d2d7;
      margin-bottom: 1.5rem;
    }

    .placeholder-content h3 {
      font-size: 1.4rem;
      font-weight: 700;
      margin: 0 0 0.8rem 0;
      color: #1d1d1f;
    }

    .placeholder-content p {
      font-size: 1rem;
      color: #86868b;
      line-height: 1.5;
      margin: 0;
    }

    /* ── Barra flotante borrado masivo ── */
    .bulk-delete-bar {
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.5rem 0.5rem 1.1rem;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 999px;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.12), 0 1px 4px rgba(15, 23, 42, 0.06);
      z-index: 150;
      animation: slideUpFade 0.2s ease;
    }

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
  `]
})
export class EvidenceReportListComponent implements OnInit {
  reports: any[] = [];
  huFilter: string = '';
  appliedHuFilter: string = '';
  huName: string = '';
  textFilter: string = '';
  selectedReports: string[] = [];

  constructor(
    private router: Router,
    private dbService: EvidenceDatabaseService,
    private excelService: EvidenceExcelService,
    private toast: ToastService
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
      const matchesText = !this.textFilter || r.nombre_del_escenario?.toLowerCase().includes(this.textFilter.toLowerCase()) || r.id_caso?.includes(this.textFilter);
      return matchesText;
    });
  }

  clearFilters() {
    this.huFilter = '';
    this.appliedHuFilter = '';
    this.huName = '';
    this.textFilter = '';
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

  async exportAll() {
    if (this.filteredReports.length === 0) return;
    this.toast.info('Preparando exportación masiva con imágenes...');
    
    const fullReports = [];
    for (const report of this.filteredReports) {
      const full = await this.dbService.getReportById(report.id);
      fullReports.push(full);
    }

    const success = await this.excelService.downloadBulkExcelReport(fullReports);
    if (success) {
      this.toast.success('Matriz masiva generada con éxito');
    } else {
      this.toast.error('Error al generar la matriz masiva');
    }
  }
}
