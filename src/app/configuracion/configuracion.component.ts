import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import { AzureDevOpsIntegrationService } from '../services/integrations/azure-devops-integration.service';
import { AzureDevOpsConnectionResponse, AzureDevOpsConnectionView } from '../models/azure-devops.model';
import { ToastService } from '../services/core/toast.service';
import { GeneralSectionsConfigService } from '../services/core/general-sections-config.service';
import { CellsConfigService } from '../services/core/cells-config.service';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmationModalComponent],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.css'
})
export class ConfiguracionComponent {
  organization = 'GrupoBancolombia';
  personalAccessToken = '';
  repositoryLink = '';
  teamContent = '';
  teamRows: Array<{ role: string; name: string }> = [];

  connection: AzureDevOpsConnectionView | null = null;

  loadingConnection = false;
  savingConnection = false;
  validatingConnection = false;
  disconnectingConnection = false;

  infoMessage: string | null = null;
  errorMessage: string | null = null;

  isDisconnectConfirmOpen = false;
  disconnectTarget: 'azure' | null = null;
  disconnectConfirmTitle = 'Confirmar desconexión';
  disconnectConfirmMessage = '¿Estás seguro de que deseas desconectar esta integración?';

  accordionOpen: Record<'azure' | 'global' | 'status' | 'cells', boolean> = {
    azure: true,
    global: false,
    status: false,
    cells: false,
  };

  // ── Estado CRUD de "Nombre Célula" ──
  cellRows: string[] = [];
  savingCells = false;
  cellsInfoMessage: string | null = null;
  cellsErrorMessage: string | null = null;

  constructor(
    private azureService: AzureDevOpsIntegrationService,
    private toastService: ToastService,
    private generalSectionsConfigService: GeneralSectionsConfigService,
    private cellsConfigService: CellsConfigService
  ) {}

  ngOnInit(): void {
    this.fetchConnection();
    this.loadGeneralSectionsConfig();
    this.loadCellsConfig();
  }

  toggleSection(section: 'azure' | 'global' | 'status' | 'cells'): void {
    const shouldOpen = !this.accordionOpen[section];

    (Object.keys(this.accordionOpen) as Array<'azure' | 'global' | 'status' | 'cells'>)
      .forEach((key) => this.accordionOpen[key] = false);

    this.accordionOpen[section] = shouldOpen;
  }

  get isBusy(): boolean {
    return this.loadingConnection || this.savingConnection || this.validatingConnection || this.disconnectingConnection;
  }

  saveConnection(): void {
    this.infoMessage = null;
    this.errorMessage = null;

    const organization = this.organization.trim();
    const pat = this.personalAccessToken.trim();

    if (!organization) {
      this.errorMessage = 'La organización es obligatoria.';
      return;
    }

    if (!pat) {
      this.errorMessage = 'Debes ingresar un PAT para guardar o reemplazar la conexión.';
      return;
    }

    this.savingConnection = true;
    this.azureService.saveConnection({ organization, personalAccessToken: pat })
      .pipe(finalize(() => this.savingConnection = false))
      .subscribe({
        next: (connection) => {
          this.applyConnection(connection);
          this.personalAccessToken = '';
          this.infoMessage = 'Conexión guardada y validada correctamente.';
          this.toastService.success('Conexión Azure DevOps guardada.');
        },
        error: (error: unknown) => {
          this.errorMessage = this.getErrorMessage(error);
          this.toastService.error(this.errorMessage);
        }
      });
  }

  validateConnection(): void {
    this.infoMessage = null;
    this.errorMessage = null;

    const organization = this.organization.trim() || this.connection?.organization || '';
    if (!organization) {
      this.errorMessage = 'Indica la organización para validar la conexión.';
      return;
    }

    this.validatingConnection = true;
    this.azureService.validateConnection(organization)
      .pipe(finalize(() => this.validatingConnection = false))
      .subscribe({
        next: (connection) => {
          this.applyConnection(connection);
          this.infoMessage = 'Conexión validada correctamente.';
          this.toastService.success('Conexión validada.');
        },
        error: (error: unknown) => {
          this.errorMessage = this.getErrorMessage(error);
          this.toastService.error(this.errorMessage);
        }
      });
  }

  disconnect(): void {
    this.infoMessage = null;
    this.errorMessage = null;

    const organization = this.connection?.organization || this.organization.trim();
    if (!organization) {
      this.errorMessage = 'No hay organización para desconectar.';
      return;
    }

    this.disconnectingConnection = true;
    this.azureService.disconnectConnection(organization)
      .pipe(finalize(() => this.disconnectingConnection = false))
      .subscribe({
        next: () => {
          this.connection = null;
          this.personalAccessToken = '';
          this.infoMessage = 'Conexión de Azure DevOps desconectada.';
          this.toastService.success('Conexión desconectada.');
          this.fetchConnection();
        },
        error: (error: unknown) => {
          this.errorMessage = this.getErrorMessage(error);
          this.toastService.error(this.errorMessage);
        }
      });
  }

  requestDisconnect(target: 'azure'): void {
    this.disconnectTarget = target;
    this.disconnectConfirmTitle = 'Desconectar Azure DevOps';
    this.disconnectConfirmMessage = '¿Deseas desconectar la integración de Azure DevOps?';
    this.isDisconnectConfirmOpen = true;
  }

  confirmDisconnect(): void {
    const target = this.disconnectTarget;
    this.closeDisconnectConfirm();

    if (target === 'azure') {
      this.disconnect();
    }
  }

  closeDisconnectConfirm(): void {
    this.isDisconnectConfirmOpen = false;
    this.disconnectTarget = null;
  }

  addTeamRow(): void {
    this.teamRows.push({ role: '', name: '' });
  }

  removeTeamRow(index: number): void {
    this.teamRows.splice(index, 1);
    if (this.teamRows.length === 0) {
      this.addTeamRow();
    }
  }

  private parseTeamContent(content: string): Array<{ role: string; name: string }> {
    const raw = (content || '').trim();
    if (!raw) {
      return [{ role: '', name: '' }];
    }
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const idx = line.lastIndexOf(':');
        if (idx === -1) {
          return { role: line, name: '' };
        }
        return { role: line.slice(0, idx).trim(), name: line.slice(idx + 1).trim() };
      });
  }

  private serializeTeamRows(): string {
    return this.teamRows
      .map(r => ({ role: (r.role || '').trim(), name: (r.name || '').trim() }))
      .filter(r => r.role || r.name)
      .map(r => (r.name ? `${r.role}: ${r.name}` : r.role))
      .join('\n');
  }

  saveGeneralSectionsConfig(): void {
    const repositoryLink = this.repositoryLink.trim();
    const teamContent = this.serializeTeamRows();

    if (!repositoryLink) {
      this.errorMessage = 'El campo Repositorio Pruebas VSTS es obligatorio.';
      return;
    }

    if (!teamContent) {
      this.errorMessage = 'El campo Equipo de Trabajo es obligatorio.';
      return;
    }

    const updated = this.generalSectionsConfigService.saveConfig({
      repositoryLink,
      teamContent
    });

    this.repositoryLink = updated.repositoryLink;
    this.teamContent = updated.teamContent;
    this.teamRows = this.parseTeamContent(updated.teamContent);
    this.infoMessage = 'Configuración de secciones generales guardada correctamente.';
    this.errorMessage = null;
    this.toastService.success('Parámetros de secciones generales guardados.');
  }

  private loadGeneralSectionsConfig(): void {
    const config = this.generalSectionsConfigService.getConfig();
    this.repositoryLink = config.repositoryLink;
    this.teamContent = config.teamContent;
    this.teamRows = this.parseTeamContent(config.teamContent);
  }

  // ── CRUD "Nombre Célula" ─────────────────────────────────────────────
  private loadCellsConfig(): void {
    const cells = this.cellsConfigService.getCurrent();
    this.cellRows = cells.length ? [...cells] : this.cellsConfigService.getDefaults();
    // Refrescar cuando el servicio actualice (login / carga desde BD).
    this.cellsConfigService.cells$.subscribe((list) => {
      // Solo reflejamos cambios externos si el usuario no está editando manualmente.
      if (!this.savingCells) {
        this.cellRows = list.length ? [...list] : this.cellsConfigService.getDefaults();
      }
    });
  }

  addCellRow(): void {
    this.cellRows.push('');
  }

  removeCellRow(index: number): void {
    this.cellRows.splice(index, 1);
    if (this.cellRows.length === 0) {
      this.addCellRow();
    }
  }

  private normalizeCellRows(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of this.cellRows) {
      const value = (raw || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  }

  saveCellsConfig(): void {
    this.cellsInfoMessage = null;
    this.cellsErrorMessage = null;

    const cells = this.normalizeCellRows();
    if (!cells.length) {
      this.cellsErrorMessage = 'Debes definir al menos una célula.';
      return;
    }

    this.savingCells = true;
    this.cellsConfigService.saveForCurrentUser(cells)
      .then((saved) => {
        this.cellRows = [...saved];
        this.cellsInfoMessage = 'Lista de células guardada correctamente.';
        this.toastService.success('Nombre Célula actualizado.');
      })
      .catch((error: unknown) => {
        this.cellsErrorMessage = this.getErrorMessage(error, 'No se pudo guardar la lista de células.');
        this.toastService.error(this.cellsErrorMessage);
      })
      .finally(() => {
        this.savingCells = false;
      });
  }

  resetCellsConfig(): void {
    this.cellsInfoMessage = null;
    this.cellsErrorMessage = null;

    this.savingCells = true;
    this.cellsConfigService.resetForCurrentUser()
      .then((defaults) => {
        this.cellRows = [...defaults];
        this.cellsInfoMessage = 'Lista restaurada a los valores por defecto.';
        this.toastService.success('Nombre Célula restaurado.');
      })
      .catch((error: unknown) => {
        this.cellsErrorMessage = this.getErrorMessage(error, 'No se pudo restaurar la lista de células.');
        this.toastService.error(this.cellsErrorMessage);
      })
      .finally(() => {
        this.savingCells = false;
      });
  }

  private fetchConnection(): void {
    this.loadingConnection = true;
    this.azureService.getConnection(this.organization)
      .pipe(finalize(() => this.loadingConnection = false))
      .subscribe({
        next: (connection) => {
          this.connection = connection;
          if (connection?.organization) {
            this.organization = connection.organization;
          }
        },
        error: (error: unknown) => {
          this.errorMessage = this.getErrorMessage(error);
        }
      });
  }

  private applyConnection(connection: AzureDevOpsConnectionResponse): void {
    this.connection = {
      ...connection,
      updatedAt: connection.lastValidatedAt
    };
    this.organization = connection.organization;
  }

  private getErrorMessage(error: unknown, fallback = 'No se pudo completar la operación con Azure DevOps.'): string {
    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    if (error && typeof error === 'object') {
      const anyError = error as Record<string, any>;
      const nested = anyError['error'];
      const candidate = nested?.['message'] || anyError['message'] || anyError['userMessage'];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }

    return fallback;
  }

  get azureStatusLabel(): string {
    if (!this.connection) {
      return 'No configurado';
    }

    switch (this.connection.status) {
      case 'connected':
        return 'Conectado';
      case 'disconnected':
        return 'Pendiente';
      case 'invalid':
      case 'expired':
        return 'Error';
      default:
        return 'No configurado';
    }
  }

  get azureStatusTone(): 'success' | 'warning' | 'danger' | 'neutral' {
    if (!this.connection) {
      return 'neutral';
    }

    switch (this.connection.status) {
      case 'connected':
        return 'success';
      case 'disconnected':
        return 'warning';
      case 'invalid':
      case 'expired':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
