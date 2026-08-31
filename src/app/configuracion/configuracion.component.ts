import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { Subscription, timer } from 'rxjs';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import { AzureDevOpsIntegrationService } from '../services/integrations/azure-devops-integration.service';
import { AzureDevOpsConnectionResponse, AzureDevOpsConnectionView } from '../models/azure-devops.model';
import { GitHubModelsIntegrationService } from '../services/integrations/github-models-integration.service';
import {
  GitHubModelsConnectionResponse,
  GitHubModelsConnectionView,
  GitHubModel,
} from '../models/github-models.model';
import { AiProvidersService } from '../services/ai/ai-providers.service';
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

  // ── Estado GitHub Models (Copilot) ──────────────────────────────────
  githubEnabled = false;
  githubSelectedModel = '';
  githubModels: GitHubModel[] = [];
  githubConnection: GitHubModelsConnectionView | null = null;

  loadingGithub = false;
  validatingGithub = false;
  disconnectingGithub = false;
  loadingGithubModels = false;

  // ── Estado del Device Flow OAuth ──
  githubConnecting = false;          // true mientras dura el flujo de autorización
  githubUserCode = '';               // código que el usuario debe pegar en GitHub
  githubVerificationUri = '';        // URL de GitHub para autorizar
  private githubPollSub: Subscription | null = null;
  private githubDeviceCode = '';

  githubInfoMessage: string | null = null;
  githubErrorMessage: string | null = null;

  infoMessage: string | null = null;
  errorMessage: string | null = null;

  isDisconnectConfirmOpen = false;
  disconnectTarget: 'azure' | 'github' | null = null;
  disconnectConfirmTitle = 'Confirmar desconexión';
  disconnectConfirmMessage = '¿Estás seguro de que deseas desconectar esta integración?';

  accordionOpen: Record<'azure' | 'github' | 'global' | 'status' | 'cells', boolean> = {
    azure: true,
    github: false,
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
    private githubModelsService: GitHubModelsIntegrationService,
    private aiProvidersService: AiProvidersService,
    private toastService: ToastService,
    private generalSectionsConfigService: GeneralSectionsConfigService,
    private cellsConfigService: CellsConfigService
  ) {}

  ngOnInit(): void {
    this.fetchConnection();
    this.fetchGithubConnection();
    this.loadGeneralSectionsConfig();
    this.loadCellsConfig();
  }

  ngOnDestroy(): void {
    this.stopGithubPolling();
  }

  toggleSection(section: 'azure' | 'github' | 'global' | 'status' | 'cells'): void {
    const shouldOpen = !this.accordionOpen[section];

    (Object.keys(this.accordionOpen) as Array<'azure' | 'github' | 'global' | 'status' | 'cells'>)
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

  // ── GitHub Models (Copilot) — Device Flow OAuth ─────────────────────
  get isGithubBusy(): boolean {
    return this.loadingGithub || this.githubConnecting || this.validatingGithub
      || this.disconnectingGithub || this.loadingGithubModels;
  }

  private fetchGithubConnection(): void {
    this.loadingGithub = true;
    this.githubModelsService.getConnection()
      .pipe(finalize(() => this.loadingGithub = false))
      .subscribe({
        next: (connection) => {
          this.applyGithubConnection(connection);
          if (connection?.status === 'connected') {
            this.loadGithubModels();
          }
        },
        error: (error: unknown) => {
          this.githubErrorMessage = this.getErrorMessage(error, 'No se pudo cargar la conexión de GitHub Models.');
        }
      });
  }

  /**
   * Inicia el GitHub OAuth Device Flow: pide un código a GitHub, abre la página
   * de autorización y hace polling hasta que el usuario autorice (como DBeaver).
   */
  connectWithGithub(): void {
    this.githubInfoMessage = null;
    this.githubErrorMessage = null;
    this.stopGithubPolling();

    this.githubConnecting = true;
    this.githubModelsService.deviceStart().subscribe({
      next: (device) => {
        this.githubDeviceCode = device.deviceCode;
        this.githubUserCode = device.userCode;
        this.githubVerificationUri = device.verificationUri;

        // Abrimos la página de autorización de GitHub en una pestaña nueva.
        try {
          window.open(device.verificationUri, '_blank', 'noopener,noreferrer');
        } catch {
          // Si el navegador bloquea el popup, el usuario puede usar el enlace mostrado.
        }

        this.githubInfoMessage = `Autoriza en GitHub con el código ${device.userCode}. Esperando confirmación...`;
        this.startGithubPolling(device.interval || 5, device.expiresIn || 900);
      },
      error: (error: unknown) => {
        this.githubConnecting = false;
        this.githubErrorMessage = this.getErrorMessage(error, 'No se pudo iniciar la conexión con GitHub.');
        this.toastService.error(this.githubErrorMessage);
      }
    });
  }

  private startGithubPolling(intervalSeconds: number, expiresInSeconds: number): void {
    const deadline = Date.now() + expiresInSeconds * 1000;
    let periodMs = Math.max(intervalSeconds, 1) * 1000;

    const scheduleNext = () => {
      this.githubPollSub = timer(periodMs).subscribe(() => this.pollOnce(deadline, scheduleNext, (ms) => { periodMs = ms; }));
    };
    scheduleNext();
  }

  private pollOnce(deadline: number, scheduleNext: () => void, setPeriod: (ms: number) => void): void {
    if (Date.now() > deadline) {
      this.stopGithubPolling();
      this.githubConnecting = false;
      this.githubErrorMessage = 'El código expiró. Vuelve a iniciar la conexión con GitHub.';
      return;
    }

    this.githubModelsService.devicePoll(this.githubDeviceCode, {
      enabled: this.githubEnabled,
      selectedModel: this.githubSelectedModel || undefined,
    }).subscribe({
      next: (result) => {
        if (result.pending) {
          // GitHub pide reducir el ritmo del polling.
          if (result.slowDown) {
            setPeriod(7000);
          }
          scheduleNext();
          return;
        }
        // Autorizado: token guardado y conexión establecida.
        this.stopGithubPolling();
        this.githubConnecting = false;
        this.githubUserCode = '';
        this.githubVerificationUri = '';
        this.applyGithubConnection(result.connection ?? null);
        this.githubInfoMessage = 'Conexión de GitHub Models establecida correctamente.';
        this.toastService.success('Conectado con GitHub Copilot.');
        this.syncGithubProviderState();
        this.loadGithubModels();
      },
      error: (error: unknown) => {
        this.stopGithubPolling();
        this.githubConnecting = false;
        this.githubErrorMessage = this.getErrorMessage(error, 'No se pudo completar la autorización con GitHub.');
        this.toastService.error(this.githubErrorMessage);
      }
    });
  }

  private stopGithubPolling(): void {
    this.githubPollSub?.unsubscribe();
    this.githubPollSub = null;
  }

  cancelGithubConnect(): void {
    this.stopGithubPolling();
    this.githubConnecting = false;
    this.githubUserCode = '';
    this.githubVerificationUri = '';
    this.githubInfoMessage = null;
  }

  validateGithubConnection(): void {
    this.githubInfoMessage = null;
    this.githubErrorMessage = null;

    this.validatingGithub = true;
    this.githubModelsService.validateConnection()
      .pipe(finalize(() => this.validatingGithub = false))
      .subscribe({
        next: (connection) => {
          this.applyGithubConnection(connection);
          this.githubInfoMessage = 'Conexión de GitHub Models validada correctamente.';
          this.toastService.success('Conexión validada.');
          this.loadGithubModels();
        },
        error: (error: unknown) => {
          this.githubErrorMessage = this.getErrorMessage(error, 'No se pudo validar la conexión de GitHub Models.');
          this.toastService.error(this.githubErrorMessage);
        }
      });
  }

  loadGithubModels(): void {
    this.loadingGithubModels = true;
    this.githubModelsService.listModels()
      .pipe(finalize(() => this.loadingGithubModels = false))
      .subscribe({
        next: (response) => {
          this.githubModels = response?.models ?? [];
          // Si el modelo seleccionado ya no existe en el catálogo, resetear.
          if (this.githubSelectedModel && !this.githubModels.some(m => m.id === this.githubSelectedModel)) {
            this.githubSelectedModel = this.githubModels[0]?.id ?? '';
          }
        },
        error: (error: unknown) => {
          this.githubErrorMessage = this.getErrorMessage(error, 'No se pudo obtener el catálogo de modelos de GitHub.');
        }
      });
  }

  onGithubEnabledChange(): void {
    this.saveGithubPreferences();
  }

  onGithubModelChange(): void {
    this.saveGithubPreferences();
  }

  private saveGithubPreferences(): void {
    // Solo persistimos preferencias si ya hay conexión guardada.
    if (!this.githubConnection) {
      this.syncGithubProviderState();
      return;
    }

    this.loadingGithub = true;
    this.githubModelsService.updatePreferences({
      enabled: this.githubEnabled,
      selectedModel: this.githubSelectedModel || undefined
    })
      .pipe(finalize(() => this.loadingGithub = false))
      .subscribe({
        next: (connection) => {
          this.applyGithubConnection(connection);
          this.syncGithubProviderState();
          this.toastService.success('Preferencias de GitHub Models actualizadas.');
        },
        error: (error: unknown) => {
          this.githubErrorMessage = this.getErrorMessage(error, 'No se pudieron actualizar las preferencias.');
          this.toastService.error(this.githubErrorMessage);
        }
      });
  }

  /**
   * Activa GitHub Models como proveedor de IA si el usuario lo habilitó y la
   * conexión está OK; de lo contrario, vuelve a DeepSeek (fallback por defecto).
   */
  private syncGithubProviderState(): void {
    const canUseGithub = this.githubEnabled && this.githubConnection?.status === 'connected';
    if (canUseGithub) {
      this.aiProvidersService.setActiveProvider('github-models');
    } else if (this.aiProvidersService.getActiveProviderId() === 'github-models') {
      // Si estaba activo GitHub y se deshabilita, volvemos a DeepSeek.
      this.aiProvidersService.setActiveProvider('deepseek');
    }
  }

  disconnectGithub(): void {
    this.githubInfoMessage = null;
    this.githubErrorMessage = null;
    this.stopGithubPolling();

    this.disconnectingGithub = true;
    this.githubModelsService.disconnectConnection()
      .pipe(finalize(() => this.disconnectingGithub = false))
      .subscribe({
        next: () => {
          this.githubConnection = null;
          this.githubEnabled = false;
          this.githubSelectedModel = '';
          this.githubModels = [];
          this.githubConnecting = false;
          this.githubUserCode = '';
          this.githubVerificationUri = '';
          this.githubInfoMessage = 'Conexión de GitHub Models desconectada.';
          this.toastService.success('Conexión desconectada.');
          // Al desconectar, aseguramos DeepSeek como proveedor activo.
          if (this.aiProvidersService.getActiveProviderId() === 'github-models') {
            this.aiProvidersService.setActiveProvider('deepseek');
          }
          this.fetchGithubConnection();
        },
        error: (error: unknown) => {
          this.githubErrorMessage = this.getErrorMessage(error, 'No se pudo desconectar GitHub Models.');
          this.toastService.error(this.githubErrorMessage);
        }
      });
  }

  private applyGithubConnection(connection: GitHubModelsConnectionResponse | GitHubModelsConnectionView | null): void {
    if (!connection) {
      this.githubConnection = null;
      return;
    }
    this.githubConnection = {
      ...connection,
      updatedAt: (connection as GitHubModelsConnectionView).updatedAt ?? connection.lastValidatedAt
    };
    this.githubEnabled = !!connection.enabled;
    this.githubSelectedModel = connection.selectedModel ?? this.githubSelectedModel;
  }

  get githubStatusLabel(): string {
    if (!this.githubConnection) {
      return 'No configurado';
    }
    switch (this.githubConnection.status) {
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

  get githubStatusTone(): 'success' | 'warning' | 'danger' | 'neutral' {
    if (!this.githubConnection) {
      return 'neutral';
    }
    switch (this.githubConnection.status) {
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

  requestDisconnect(target: 'azure' | 'github'): void {
    this.disconnectTarget = target;
    if (target === 'azure') {
      this.disconnectConfirmTitle = 'Desconectar Azure DevOps';
      this.disconnectConfirmMessage = '¿Deseas desconectar la integración de Azure DevOps?';
    } else {
      this.disconnectConfirmTitle = 'Desconectar GitHub Models';
      this.disconnectConfirmMessage = '¿Deseas desconectar la integración de GitHub Models? Se volverá a DeepSeek como proveedor por defecto.';
    }
    this.isDisconnectConfirmOpen = true;
  }

  confirmDisconnect(): void {
    const target = this.disconnectTarget;
    this.closeDisconnectConfirm();

    if (target === 'azure') {
      this.disconnect();
    } else if (target === 'github') {
      this.disconnectGithub();
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
