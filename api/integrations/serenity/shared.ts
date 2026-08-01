import { ApiError, getAuthenticatedUser, getSupabaseClients } from '../azure-devops/shared';

export interface SerenityConnectionRecord {
  id: string;
  user_id: string;
  github_username: string;
  repository_owner: string;
  repository_name: string;
  workflow_file_name: string;
  branch: string;
  repository_url: string;
  workflow_name: string;
  status: 'connected' | 'invalid' | 'expired' | 'disconnected';
  token_hint: string;
  last_validated_at: string | null;
  updated_at: string | null;
}

export interface SerenitySecretRecord extends SerenityConnectionRecord {
  personal_access_token: string;
  secret_id: string;
}

export interface SerenityRuntimeConfig {
  githubUsername: string;
  repositoryOwner: string;
  repositoryName: string;
  workflowFileName: string;
  branch: string;
  repositoryUrl: string;
  workflowName: string;
  personalAccessToken: string;
}

export interface SerenityDefaultPublicConfig {
  githubUsername: string;
  repositoryOwner: string;
  repositoryName: string;
  workflowFileName: string;
  branch: string;
  repositoryUrl: string;
  workflowName: string;
  tokenHint: string;
  hasToken: boolean;
}

const DEFAULT_SERENITY_OWNER = 'anbepa';
const DEFAULT_SERENITY_REPO = 'ManualTest';
const DEFAULT_SERENITY_WORKFLOW = 'serenity-report.yml';
const DEFAULT_SERENITY_BRANCH = 'main';
const DEFAULT_SERENITY_WORKFLOW_NAME = 'Serenity Report';

function gh(path: string, token: string, opts: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'test-plan-app',
      ...(opts.headers || {}),
    },
  });
}

export function maskTokenHint(personalAccessToken: string): string {
  const lastFour = personalAccessToken.slice(-4).toUpperCase();
  return `••••${lastFour || '----'}`;
}

export function normalizeRepositoryOwner(input: string): string {
  const value = (input || '').trim();
  if (!value) {
    throw new ApiError(400, 'El owner del repositorio es obligatorio.');
  }

  return value;
}

export function normalizeRepositoryName(input: string): string {
  const value = (input || '').trim();
  if (!value) {
    throw new ApiError(400, 'El nombre del repositorio es obligatorio.');
  }

  return value;
}

export function normalizeWorkflowFileName(input: string): string {
  const value = (input || '').trim();
  if (!value) {
    throw new ApiError(400, 'El nombre del workflow es obligatorio.');
  }

  return value.endsWith('.yml') || value.endsWith('.yaml') ? value : `${value}.yml`;
}

export function normalizeBranch(input: string): string {
  const value = (input || '').trim();
  if (!value) {
    throw new ApiError(400, 'La rama es obligatoria.');
  }

  return value;
}

export function normalizeRepositoryUrl(input: string): string {
  return (input || '').trim();
}

export function buildRepositoryUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

function buildSerenityEnvFallbackConfig(): SerenityRuntimeConfig {
  const repositoryOwner = process.env['GH_DISPATCH_OWNER'] || DEFAULT_SERENITY_OWNER;
  const repositoryName = process.env['GH_DISPATCH_REPO'] || DEFAULT_SERENITY_REPO;
  const workflowFileName = process.env['GH_DISPATCH_WORKFLOW_ID'] || DEFAULT_SERENITY_WORKFLOW;
  const branch = process.env['GH_DISPATCH_BRANCH'] || DEFAULT_SERENITY_BRANCH;
  const githubUsername = process.env['GH_DISPATCH_GITHUB_USERNAME'] || repositoryOwner || DEFAULT_SERENITY_OWNER;
  const workflowName = process.env['GH_DISPATCH_WORKFLOW_NAME'] || DEFAULT_SERENITY_WORKFLOW_NAME;
  const repositoryUrl = process.env['GH_DISPATCH_REPOSITORY_URL'] || buildRepositoryUrl(repositoryOwner, repositoryName);
  const personalAccessToken = process.env['GH_DISPATCH_TOKEN'] || process.env['GH_TOKEN'] || '';

  return {
    githubUsername,
    repositoryOwner,
    repositoryName,
    workflowFileName,
    branch,
    repositoryUrl,
    workflowName,
    personalAccessToken,
  };
}

export function resolveSerenityDefaultPublicConfig(): SerenityDefaultPublicConfig {
  const config = buildSerenityEnvFallbackConfig();
  return {
    githubUsername: config.githubUsername,
    repositoryOwner: config.repositoryOwner,
    repositoryName: config.repositoryName,
    workflowFileName: config.workflowFileName,
    branch: config.branch,
    repositoryUrl: config.repositoryUrl,
    workflowName: config.workflowName,
    hasToken: !!config.personalAccessToken,
    tokenHint: config.personalAccessToken ? maskTokenHint(config.personalAccessToken) : '',
  };
}

export function resolveSerenityDefaultToken(): string {
  return buildSerenityEnvFallbackConfig().personalAccessToken;
}

export async function validateSerenityGithubAccess(config: Pick<SerenityRuntimeConfig, 'repositoryOwner' | 'repositoryName' | 'workflowFileName' | 'personalAccessToken'>): Promise<void> {
  const repositoryResponse = await gh(`/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}`, config.personalAccessToken);
  if (repositoryResponse.status === 401) {
    throw new ApiError(401, 'El Personal Access Token de GitHub es inválido o no tiene permisos suficientes.');
  }
  if (repositoryResponse.status === 403) {
    throw new ApiError(403, 'GitHub rechazó el token o los permisos del repositorio.');
  }
  if (repositoryResponse.status === 404) {
    throw new ApiError(404, 'No se encontró el repositorio de Serenity.');
  }
  if (!repositoryResponse.ok) {
    throw new ApiError(502, 'No fue posible validar el repositorio de GitHub.');
  }

  const workflowResponse = await gh(
    `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/workflows/${encodeURIComponent(config.workflowFileName)}`,
    config.personalAccessToken
  );
  if (workflowResponse.status === 401) {
    throw new ApiError(401, 'El Personal Access Token de GitHub es inválido o no tiene permisos suficientes.');
  }
  if (workflowResponse.status === 403) {
    throw new ApiError(403, 'GitHub rechazó el acceso al workflow.');
  }
  if (workflowResponse.status === 404) {
    throw new ApiError(404, 'No se encontró el workflow Serenity configurado.');
  }
  if (!workflowResponse.ok) {
    throw new ApiError(502, 'No fue posible validar el workflow de GitHub.');
  }
}

export async function getSerenityConnectionWithSecret(userId: string): Promise<SerenitySecretRecord | null> {
  const { adminClient } = getSupabaseClients();

  const { data, error } = await adminClient.rpc('serenity_get_connection_secret', {
    p_user_id: userId,
  });

  if (error) {
    throw new ApiError(500, 'Error al consultar la configuración de Serenity.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export async function upsertSerenityConnection(
  userId: string,
  config: SerenityRuntimeConfig,
  status: SerenityConnectionRecord['status'] = 'connected'
): Promise<SerenityConnectionRecord> {
  const { adminClient } = getSupabaseClients();

  const { data, error } = await adminClient.rpc('serenity_upsert_connection', {
    p_user_id: userId,
    p_github_username: config.githubUsername,
    p_repository_owner: config.repositoryOwner,
    p_repository_name: config.repositoryName,
    p_workflow_file_name: config.workflowFileName,
    p_branch: config.branch,
    p_repository_url: config.repositoryUrl,
    p_workflow_name: config.workflowName,
    p_personal_access_token: config.personalAccessToken,
    p_status: status,
  });

  if (error) {
    throw new ApiError(500, 'Error al guardar la configuración de Serenity.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) {
    throw new ApiError(500, 'No se pudo guardar la configuración de Serenity.');
  }

  return row as SerenityConnectionRecord;
}

export interface AzureSerenityConnectionRecord {
  id: string;
  user_id: string;
  azure_organization: string;
  azure_project: string;
  release_definition_id: number;
  pipeline_name: string;
  branch: string;
  status: 'connected' | 'invalid' | 'expired' | 'disconnected';
  token_hint: string;
  last_validated_at: string | null;
  updated_at: string | null;
}

export interface AzureSerenitySecretRecord extends AzureSerenityConnectionRecord {
  personal_access_token: string;
  secret_id: string;
}

export interface AzureSerenityRuntimeConfig {
  azureOrganization: string;
  azureProject: string;
  releaseDefinitionId: number;
  pipelineName: string;
  branch: string;
  personalAccessToken: string;
}

export async function getAzureSerenityConnectionWithSecret(userId: string): Promise<AzureSerenitySecretRecord | null> {
  const { adminClient } = getSupabaseClients();

  const { data, error } = await adminClient.rpc('azure_serenity_get_connection_secret', {
    p_user_id: userId,
  });

  if (error) {
    throw new ApiError(500, 'Error al consultar la configuración de Serenity Azure.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export async function upsertAzureSerenityConnection(
  userId: string,
  config: AzureSerenityRuntimeConfig,
  status: AzureSerenityConnectionRecord['status'] = 'connected'
): Promise<AzureSerenityConnectionRecord> {
  const { adminClient } = getSupabaseClients();

  const { data, error } = await adminClient.rpc('azure_serenity_upsert_connection', {
    p_user_id: userId,
    p_azure_organization: config.azureOrganization,
    p_azure_project: config.azureProject,
    p_release_definition_id: config.releaseDefinitionId,
    p_pipeline_name: config.pipelineName || 'Serenity Report CD',
    p_branch: config.branch || 'trunk',
    p_personal_access_token: config.personalAccessToken,
    p_status: status,
  });

  if (error) {
    console.error('[SERENITY_AZURE][UPSERT_CONNECTION][RPC_ERROR]', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new ApiError(500, 'Error al guardar la configuración de Serenity Azure.', {
      source: 'supabase-rpc:azure_serenity_upsert_connection',
      code: error.code,
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) {
    throw new ApiError(500, 'No se pudo guardar la configuración de Serenity Azure.');
  }

  return row as AzureSerenityConnectionRecord;
}

export async function disconnectAzureSerenityConnection(userId: string): Promise<void> {
  const { adminClient } = getSupabaseClients();

  const { error } = await adminClient.rpc('azure_serenity_disconnect_connection', {
    p_user_id: userId,
  });

  if (error) {
    throw new ApiError(500, 'No se pudo eliminar la configuración de Serenity Azure.');
  }
}

export async function validateAzureSerenityPipeline(
  config: Pick<AzureSerenityRuntimeConfig, 'azureOrganization' | 'azureProject' | 'releaseDefinitionId' | 'personalAccessToken'>
): Promise<void> {
  const basicToken = Buffer.from(`:${config.personalAccessToken}`).toString('base64');
  const url = `https://vsrm.dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_apis/release/definitions/${config.releaseDefinitionId}?api-version=7.1`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${basicToken}`,
      Accept: 'application/json',
      'User-Agent': 'test-plan-app',
    },
  });

  if (response.status === 401) {
    throw new ApiError(401, 'El PAT de Azure DevOps es inválido o no tiene permisos.');
  }
  if (response.status === 403) {
    throw new ApiError(403, 'Azure DevOps rechazó el acceso al Release Definition.');
  }
  if (response.status === 404) {
    throw new ApiError(404, 'No se encontró el Release Definition en Azure DevOps. Verifica el Project y Release Definition ID.');
  }
  if (!response.ok) {
    throw new ApiError(502, 'No fue posible validar el Release Definition de Azure DevOps.');
  }
}

export async function resolveAzureSerenityRuntimeConfig(headers?: Record<string, string | string[] | undefined>): Promise<AzureSerenityRuntimeConfig | null> {
  try {
    if (headers) {
      const user = await getAuthenticatedUser(headers);
      const connection = await getAzureSerenityConnectionWithSecret(user.id);
      if (connection?.personal_access_token) {
        return {
          azureOrganization: connection.azure_organization,
          azureProject: connection.azure_project,
          releaseDefinitionId: connection.release_definition_id,
          pipelineName: connection.pipeline_name,
          branch: connection.branch,
          personalAccessToken: connection.personal_access_token,
        };
      }
    }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.warn('[serenity-azure] No se pudo cargar la configuración Azure por usuario.', error);
    }
  }

  return null;
}

export async function disconnectSerenityConnection(userId: string): Promise<void> {
  const { adminClient } = getSupabaseClients();

  const { error } = await adminClient.rpc('serenity_disconnect_connection', {
    p_user_id: userId,
  });

  if (error) {
    throw new ApiError(500, 'No se pudo eliminar la configuración de Serenity.');
  }
}

export async function resolveSerenityRuntimeConfig(headers?: Record<string, string | string[] | undefined>): Promise<SerenityRuntimeConfig> {
  try {
    if (headers) {
      const user = await getAuthenticatedUser(headers);
      const connection = await getSerenityConnectionWithSecret(user.id);
      if (connection?.personal_access_token) {
        return {
          githubUsername: connection.github_username,
          repositoryOwner: connection.repository_owner,
          repositoryName: connection.repository_name,
          workflowFileName: connection.workflow_file_name,
          branch: connection.branch,
          repositoryUrl: connection.repository_url,
          workflowName: connection.workflow_name,
          personalAccessToken: connection.personal_access_token,
        };
      }
    }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.warn('[serenity] No se pudo cargar la configuración por usuario, usando variables de entorno.', error);
    }
  }

  const {
    personalAccessToken,
    repositoryOwner,
    repositoryName,
    workflowFileName,
    branch,
    githubUsername,
    workflowName,
    repositoryUrl,
  } = buildSerenityEnvFallbackConfig();

  if (!personalAccessToken || !repositoryOwner || !repositoryName) {
    throw new ApiError(500, 'No hay configuración de Serenity disponible para este usuario ni variables de entorno de respaldo.');
  }

  return {
    githubUsername,
    repositoryOwner,
    repositoryName,
    workflowFileName,
    branch,
    repositoryUrl,
    workflowName,
    personalAccessToken,
  };
}
