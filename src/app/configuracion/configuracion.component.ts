import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { AzureDevOpsIntegrationService } from '../services/integrations/azure-devops-integration.service';
import { AzureDevOpsConnectionResponse, AzureDevOpsConnectionView } from '../models/azure-devops.model';
import { ToastService } from '../services/core/toast.service';
import { GeneralSectionsConfigService } from '../services/core/general-sections-config.service';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.css'
})
export class ConfiguracionComponent {
  organization = 'GrupoBancolombia';
  personalAccessToken = '';
  repositoryLink = '';
  teamContent = '';

  connection: AzureDevOpsConnectionView | null = null;

  loadingConnection = false;
  savingConnection = false;
  validatingConnection = false;
  disconnectingConnection = false;

  infoMessage: string | null = null;
  errorMessage: string | null = null;

  constructor(
    private azureService: AzureDevOpsIntegrationService,
    private toastService: ToastService,
    private generalSectionsConfigService: GeneralSectionsConfigService
  ) {}

  ngOnInit(): void {
    this.fetchConnection();
    this.loadGeneralSectionsConfig();
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

  saveGeneralSectionsConfig(): void {
    const repositoryLink = this.repositoryLink.trim();
    const teamContent = this.teamContent.trim();

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
    this.infoMessage = 'Configuración de secciones generales guardada correctamente.';
    this.errorMessage = null;
    this.toastService.success('Parámetros de secciones generales guardados.');
  }

  private loadGeneralSectionsConfig(): void {
    const config = this.generalSectionsConfigService.getConfig();
    this.repositoryLink = config.repositoryLink;
    this.teamContent = config.teamContent;
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

  private getErrorMessage(error: unknown): string {
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

    return 'No se pudo completar la operación con Azure DevOps.';
  }
}
