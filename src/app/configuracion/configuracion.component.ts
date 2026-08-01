import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import { AzureDevOpsIntegrationService } from '../services/integrations/azure-devops-integration.service';
import { AzureSerenityIntegrationResponse, SerenityIntegrationResponse, SerenityIntegrationService } from '../services/integrations/serenity-integration.service';
import { AzureDevOpsConnectionResponse, AzureDevOpsConnectionView } from '../models/azure-devops.model';
import { ToastService } from '../services/core/toast.service';
import { GeneralSectionsConfigService } from '../services/core/general-sections-config.service';

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

  githubUsername = '';
  repositoryOwner = '';
  repositoryName = '';
  workflowFileName = 'serenity-report.yml';
  branch = 'main';
  repositoryUrl = '';
  workflowName = 'Serenity Report';
  serenityPersonalAccessToken = '';

  connection: AzureDevOpsConnectionView | null = null;
  serenityConnection: SerenityIntegrationResponse | null = null;

  azureSerenityOrg = '';
  azureSerenityProject = '';
  azureSerenityReleaseDefinitionId: number | null = null;
  azureSerenityPipelineName = 'Serenity Report CD';
  azureSerenityBranch = 'trunk';
  azureSerenityPat = '';
  azureSerenityConnection: AzureSerenityIntegrationResponse | null = null;

  loadingConnection = false;
  savingConnection = false;
  validatingConnection = false;
  disconnectingConnection = false;

  loadingSerenityConnection = false;
  savingSerenityConnection = false;
  disconnectingSerenityConnection = false;

  loadingAzureSerenityConnection = false;
  savingAzureSerenityConnection = false;
  disconnectingAzureSerenityConnection = false;

  infoMessage: string | null = null;
  errorMessage: string | null = null;
  serenityInfoMessage: string | null = null;
  serenityErrorMessage: string | null = null;

  azureSerenityInfoMessage: string | null = null;
  azureSerenityErrorMessage: string | null = null;

  isDisconnectConfirmOpen = false;
  disconnectTarget: 'azure' | 'serenity' | 'azure_serenity' | null = null;
  disconnectConfirmTitle = 'Confirmar desconexión';
  disconnectConfirmMessage = '¿Estás seguro de que deseas desconectar esta integración?';

  accordionOpen: Record<'azure' | 'serenity' | 'azure_serenity' | 'global' | 'status', boolean> = {
    azure: true,
    serenity: false,
    azure_serenity: false,
    global: false,
    status: false,
  };

  constructor(
    private azureService: AzureDevOpsIntegrationService,
    private serenityService: SerenityIntegrationService,
    private toastService: ToastService,
    private generalSectionsConfigService: GeneralSectionsConfigService
  ) {}

  ngOnInit(): void {
    this.fetchConnection();
    this.fetchSerenityConnection();
    this.fetchAzureSerenityConnection();
    this.loadGeneralSectionsConfig();
  }

  toggleSection(section: 'azure' | 'serenity' | 'azure_serenity' | 'global' | 'status'): void {
    const shouldOpen = !this.accordionOpen[section];

    (Object.keys(this.accordionOpen) as Array<'azure' | 'serenity' | 'azure_serenity' | 'global' | 'status'>)
      .forEach((key) => this.accordionOpen[key] = false);

    this.accordionOpen[section] = shouldOpen;
  }

  get isBusy(): boolean {
    return this.loadingConnection || this.savingConnection || this.validatingConnection || this.disconnectingConnection
      || this.loadingSerenityConnection || this.savingSerenityConnection || this.disconnectingSerenityConnection
      || this.loadingAzureSerenityConnection || this.savingAzureSerenityConnection || this.disconnectingAzureSerenityConnection;
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

  requestDisconnect(target: 'azure' | 'serenity' | 'azure_serenity'): void {
    this.disconnectTarget = target;
    this.disconnectConfirmTitle = target === 'azure'
      ? 'Desconectar Azure DevOps'
      : target === 'azure_serenity'
        ? 'Desconectar Azure DevOps + Serenity'
        : 'Desconectar GitHub + Serenity';
    this.disconnectConfirmMessage = target === 'azure'
      ? '¿Deseas desconectar la integración de Azure DevOps?'
      : target === 'azure_serenity'
        ? '¿Deseas desconectar la integración de Azure DevOps + Serenity?'
        : '¿Deseas desconectar la integración de GitHub + Serenity?';
    this.isDisconnectConfirmOpen = true;
  }

  confirmDisconnect(): void {
    const target = this.disconnectTarget;
    this.closeDisconnectConfirm();

    if (target === 'azure') {
      this.disconnect();
      return;
    }

    if (target === 'serenity') {
      this.disconnectSerenityConfig();
    }

    if (target === 'azure_serenity') {
      this.disconnectAzureSerenityConfig();
    }
  }

  closeDisconnectConfirm(): void {
    this.isDisconnectConfirmOpen = false;
    this.disconnectTarget = null;
  }

  saveSerenityConfig(): void {
    this.serenityInfoMessage = null;
    this.serenityErrorMessage = null;

    const payload = this.buildSerenityPayload();
    if (!payload) {
      return;
    }

    this.savingSerenityConnection = true;
    this.serenityService.saveConfig(payload)
      .pipe(finalize(() => this.savingSerenityConnection = false))
      .subscribe({
        next: (connection) => {
          this.applySerenityConnection(connection);
          this.serenityPersonalAccessToken = '';
          this.serenityInfoMessage = 'Configuración Serenity guardada y validada correctamente.';
          this.toastService.success('Configuración Serenity guardada.');
        },
        error: (error: unknown) => {
          this.serenityErrorMessage = this.getErrorMessage(error, 'No se pudo completar la operación con Serenity.');
          this.toastService.error(this.serenityErrorMessage);
        }
      });
  }

  disconnectSerenityConfig(): void {
    this.serenityInfoMessage = null;
    this.serenityErrorMessage = null;

    this.disconnectingSerenityConnection = true;
    this.serenityService.disconnect()
      .pipe(finalize(() => this.disconnectingSerenityConnection = false))
      .subscribe({
        next: () => {
          this.serenityConnection = null;
          this.serenityPersonalAccessToken = '';
          this.serenityInfoMessage = 'Configuración Serenity desconectada.';
          this.toastService.success('Configuración Serenity desconectada.');
          this.fetchSerenityConnection();
        },
        error: (error: unknown) => {
          this.serenityErrorMessage = this.getErrorMessage(error, 'No se pudo desconectar Serenity.');
          this.toastService.error(this.serenityErrorMessage);
        }
      });
  }

  saveAzureSerenityConfig(): void {
    this.azureSerenityInfoMessage = null;
    this.azureSerenityErrorMessage = null;

    const org = this.azureSerenityOrg.trim();
    const project = this.azureSerenityProject.trim();
    const releaseDefinitionId = this.azureSerenityReleaseDefinitionId ?? 0;
    const pat = this.azureSerenityPat.trim();

    if (!org) {
      this.azureSerenityErrorMessage = 'La organización es obligatoria.';
      return;
    }

    if (!project) {
      this.azureSerenityErrorMessage = 'El proyecto es obligatorio.';
      return;
    }

    if (!releaseDefinitionId || releaseDefinitionId <= 0) {
      this.azureSerenityErrorMessage = 'El Release Definition ID es obligatorio.';
      return;
    }

    this.savingAzureSerenityConnection = true;
    this.serenityService.saveAzureSerenityConfig({
      azureOrganization: org,
      azureProject: project,
      releaseDefinitionId,
      pipelineName: this.azureSerenityPipelineName.trim() || 'Serenity Report CD',
      branch: this.azureSerenityBranch.trim() || 'trunk',
      personalAccessToken: pat || undefined,
    })
      .pipe(finalize(() => this.savingAzureSerenityConnection = false))
      .subscribe({
        next: (connection) => {
          this.azureSerenityConnection = connection;
          this.azureSerenityPat = '';
          this.azureSerenityInfoMessage = 'Pipeline de Azure DevOps + Serenity guardado y validado correctamente.';
          this.toastService.success('Pipeline Azure DevOps + Serenity guardado.');
        },
        error: (error: unknown) => {
          this.azureSerenityErrorMessage = this.getErrorMessage(error, 'No se pudo guardar la configuración de Azure DevOps + Serenity.');
          this.toastService.error(this.azureSerenityErrorMessage);
        }
      });
  }

  disconnectAzureSerenityConfig(): void {
    this.azureSerenityInfoMessage = null;
    this.azureSerenityErrorMessage = null;

    this.disconnectingAzureSerenityConnection = true;
    this.serenityService.disconnectAzureSerenity()
      .pipe(finalize(() => this.disconnectingAzureSerenityConnection = false))
      .subscribe({
        next: () => {
          this.azureSerenityConnection = null;
          this.azureSerenityPat = '';
          this.azureSerenityInfoMessage = 'Pipeline Azure DevOps + Serenity desconectado.';
          this.toastService.success('Pipeline Azure DevOps + Serenity desconectado.');
          this.fetchAzureSerenityConnection();
        },
        error: (error: unknown) => {
          this.azureSerenityErrorMessage = this.getErrorMessage(error, 'No se pudo desconectar Azure DevOps + Serenity.');
          this.toastService.error(this.azureSerenityErrorMessage);
        }
      });
  }

  private fetchAzureSerenityConnection(): void {
    this.loadingAzureSerenityConnection = true;
    this.serenityService.getAzureSerenityConfig()
      .pipe(finalize(() => this.loadingAzureSerenityConnection = false))
      .subscribe({
        next: (connection) => {
          this.azureSerenityConnection = connection;
          if (connection) {
            this.azureSerenityOrg = connection.azureOrganization;
            this.azureSerenityProject = connection.azureProject;
            this.azureSerenityReleaseDefinitionId = connection.releaseDefinitionId;
            this.azureSerenityPipelineName = connection.pipelineName;
            this.azureSerenityBranch = connection.branch;
          }
        },
        error: (error: unknown) => {
          this.azureSerenityErrorMessage = this.getErrorMessage(error, 'No se pudo cargar la configuración de Azure DevOps + Serenity.');
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

  private fetchSerenityConnection(): void {
    this.loadingSerenityConnection = true;
    this.serenityService.getConfig()
      .pipe(finalize(() => this.loadingSerenityConnection = false))
      .subscribe({
        next: (connection) => {
          this.serenityConnection = connection;
          if (connection) {
            this.githubUsername = connection.githubUsername;
            this.repositoryOwner = connection.repositoryOwner;
            this.repositoryName = connection.repositoryName;
            this.workflowFileName = connection.workflowFileName;
            this.branch = connection.branch;
            this.repositoryUrl = connection.repositoryUrl;
            this.workflowName = connection.workflowName;
          }
        },
        error: (error: unknown) => {
          this.serenityErrorMessage = this.getErrorMessage(error, 'No se pudo cargar la configuración Serenity.');
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

  private applySerenityConnection(connection: SerenityIntegrationResponse): void {
    this.serenityConnection = connection;
    this.githubUsername = connection.githubUsername;
    this.repositoryOwner = connection.repositoryOwner;
    this.repositoryName = connection.repositoryName;
    this.workflowFileName = connection.workflowFileName;
    this.branch = connection.branch;
    this.repositoryUrl = connection.repositoryUrl;
    this.workflowName = connection.workflowName;
  }

  private buildSerenityPayload(): {
    githubUsername: string;
    repositoryOwner: string;
    repositoryName: string;
    workflowFileName: string;
    branch: string;
    repositoryUrl: string;
    workflowName: string;
    personalAccessToken?: string;
  } | null {
    const githubUsername = this.githubUsername.trim();
    const repositoryOwner = this.repositoryOwner.trim();
    const repositoryName = this.repositoryName.trim();
    const workflowFileName = this.workflowFileName.trim() || 'serenity-report.yml';
    const branch = this.branch.trim() || 'main';
    const repositoryUrl = this.repositoryUrl.trim() || `https://github.com/${repositoryOwner}/${repositoryName}`;
    const workflowName = this.workflowName.trim() || 'Serenity Report';
    const personalAccessToken = this.serenityPersonalAccessToken.trim();

    if (!githubUsername) {
      this.serenityErrorMessage = 'El GitHub Username es obligatorio.';
      return null;
    }

    if (!repositoryOwner) {
      this.serenityErrorMessage = 'El Repository Owner es obligatorio.';
      return null;
    }

    if (!repositoryName) {
      this.serenityErrorMessage = 'El Repository Name es obligatorio.';
      return null;
    }

    return {
      githubUsername,
      repositoryOwner,
      repositoryName,
      workflowFileName,
      branch,
      repositoryUrl,
      workflowName,
      personalAccessToken: personalAccessToken || undefined,
    };
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

  get azureSerenityStatusLabel(): string {
    if (!this.azureSerenityConnection) {
      return 'No configurado';
    }

    switch (this.azureSerenityConnection.status) {
      case 'connected':
        return 'Conectado';
      case 'disconnected':
      case 'default':
        return 'Pendiente';
      case 'invalid':
      case 'expired':
        return 'Error';
      default:
        return 'No configurado';
    }
  }

  get azureSerenityStatusTone(): 'success' | 'warning' | 'danger' | 'neutral' {
    if (!this.azureSerenityConnection) {
      return 'neutral';
    }

    switch (this.azureSerenityConnection.status) {
      case 'connected':
        return 'success';
      case 'disconnected':
      case 'default':
        return 'warning';
      case 'invalid':
      case 'expired':
        return 'danger';
      default:
        return 'neutral';
    }
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

  get serenityStatusLabel(): string {
    if (!this.serenityConnection) {
      return 'No configurado';
    }

    switch (this.serenityConnection.status) {
      case 'connected':
        return 'Conectado';
      case 'disconnected':
      case 'default':
        return 'Pendiente';
      case 'invalid':
      case 'expired':
        return 'Error';
      default:
        return 'No configurado';
    }
  }

  get serenityStatusTone(): 'success' | 'warning' | 'danger' | 'neutral' {
    if (!this.serenityConnection) {
      return 'neutral';
    }

    switch (this.serenityConnection.status) {
      case 'connected':
        return 'success';
      case 'disconnected':
      case 'default':
        return 'warning';
      case 'invalid':
      case 'expired':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
