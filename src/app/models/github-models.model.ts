// Modelo para la integración de "GitHub Models" (vía GitHub Copilot).
// La autenticación se realiza mediante el GitHub OAuth Device Flow: el usuario
// autoriza en github.com/login/device y el backend obtiene su token efímero.

export type GitHubModelsConnectionStatus = 'connected' | 'invalid' | 'expired' | 'disconnected';

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

// ── Device Flow OAuth de GitHub ─────────────────────────────────────────────

/** Respuesta de /device/start: datos para que el usuario autorice en GitHub. */
export interface GitHubDeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Respuesta de /device/poll mientras se espera la autorización del usuario. */
export interface GitHubDevicePollResponse {
  pending: boolean;
  slowDown?: boolean;
  connection?: GitHubModelsConnectionResponse;
}
