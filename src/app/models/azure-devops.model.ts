export type AzureConnectionStatus = 'connected' | 'invalid' | 'expired' | 'disconnected';

export interface AzureDevOpsConnectionPayload {
  organization: string;
  personalAccessToken: string;
}

export interface AzureDevOpsConnectionResponse {
  id: string;
  organization: string;
  status: AzureConnectionStatus;
  tokenHint: string;
  lastValidatedAt: string | null;
}

export interface AzureDevOpsConnectionView extends AzureDevOpsConnectionResponse {
  updatedAt?: string | null;
}

export interface AzureDevOpsImportRequest {
  userStoryId: number;
}

export interface AzureDevOpsImportedUserStory {
  id: number;
  title: string;
  nodeName: string;
  sprint: string;
  description: string;
  acceptanceCriteria: string;
}

export interface AzureDevOpsApiError {
  message: string;
  code?: string;
}
