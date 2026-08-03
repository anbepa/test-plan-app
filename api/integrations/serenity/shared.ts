import { ApiError, getAuthenticatedUser, getSupabaseClients } from '../azure-devops/shared';

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

      const serenityConnection = await getAzureSerenityConnectionWithSecret(user.id);
      if (!serenityConnection) return null;

      let pat = serenityConnection.personal_access_token;

      try {
        const { adminClient } = getSupabaseClients();
        const { data: azData, error: azError } = await adminClient.rpc('azure_get_connection_secret', {
          p_user_id: user.id,
          p_organization: null,
        });

        if (!azError && azData) {
          const azRow: any = Array.isArray(azData) ? azData[0] : azData;
          if (azRow?.personal_access_token) {
            pat = azRow.personal_access_token;
          }
        }
      } catch {
        // fallback al PAT de serenity si falla la consulta de azure_devops_connections
      }

      return {
        azureOrganization: serenityConnection.azure_organization,
        azureProject: serenityConnection.azure_project,
        releaseDefinitionId: serenityConnection.release_definition_id,
        pipelineName: serenityConnection.pipeline_name,
        branch: serenityConnection.branch,
        personalAccessToken: pat,
      };
    }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      console.warn('[serenity-azure] No se pudo cargar la configuración Azure por usuario.', error);
    }
  }

  return null;
}
