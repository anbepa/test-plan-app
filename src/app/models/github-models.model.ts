// Modelo para la integración de "GitHub Models" (vía GitHub Copilot / PAT).
// Sigue el mismo patrón que azure-devops.model.ts.

export type GitHubModelsConnectionStatus = 'connected' | 'invalid' | 'expired' | 'disconnected';

export interface GitHubModelsConnectionPayload {
  /** Personal Access Token (PAT / OAuth) de GitHub. */
  personalAccessToken: string;
  /** Habilita explícitamente el uso de GitHub Models como proveedor. */
  enabled: boolean;
  /** Modelo seleccionado por el usuario (opcional al guardar por primera vez). */
  selectedModel?: string;
}

export interface GitHubModelsConnectionResponse {
  id: string;
  status: GitHubModelsConnectionStatus;
  tokenHint: string;
  enabled: boolean;
  selectedModel: string | null;
  lastValidatedAt: string | null;
}

export interface GitHubModelsConnectionView extends GitHubModelsConnectionResponse {
  updatedAt?: string | null;
}

/** Item de modelo devuelto por el catálogo de GitHub Models. */
export interface GitHubModel {
  id: string;
  displayName: string;
  publisher?: string;
}

export interface GitHubModelsListResponse {
  models: GitHubModel[];
}

export interface GitHubModelsApiError {
  message: string;
  code?: string;
}
