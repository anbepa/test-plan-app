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

/**
 * Lee la configuración de Azure DevOps + Serenity desde variables de entorno.
 * Se usa como fallback cuando no existe configuración por usuario en la base de datos.
 * Devuelve null si faltan las variables mínimas (organización, proyecto y release definition id).
 */
export function resolveAzureSerenityConfigFromEnv(): AzureSerenityRuntimeConfig | null {
  const azureOrganization = String(process.env['AZURE_SERENITY_ORGANIZATION'] || '').trim();
  const azureProject = String(process.env['AZURE_SERENITY_PROJECT'] || '').trim();
  const releaseDefinitionId = Number(process.env['AZURE_SERENITY_RELEASE_DEFINITION_ID'] || 0);
  const pipelineName = String(process.env['AZURE_SERENITY_PIPELINE_NAME'] || 'Serenity Report CD').trim() || 'Serenity Report CD';
  const branch = String(process.env['AZURE_SERENITY_BRANCH'] || 'trunk').trim() || 'trunk';
  const personalAccessToken = String(
    process.env['AZURE_SERENITY_PAT'] || process.env['AZURE_DEVOPS_PAT'] || ''
  ).trim();

  if (!azureOrganization || !azureProject || !releaseDefinitionId || releaseDefinitionId <= 0) {
    return null;
  }

  return {
    azureOrganization,
    azureProject,
    releaseDefinitionId,
    pipelineName,
    branch,
    personalAccessToken,
  };
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

export async function resolveAzureSerenityRuntimeConfig(headers?: Record<string, string | string[] | undefined>): Promise<AzureSerenityRuntimeConfig | null> {
  try {
    if (headers) {
      const user = await getAuthenticatedUser(headers);

      // Resuelve el PAT del usuario desde su conexión principal de Azure DevOps.
      const resolveUserAzurePat = async (): Promise<string> => {
        try {
          const { adminClient } = getSupabaseClients();
          const { data: azData, error: azError } = await adminClient.rpc('azure_get_connection_secret', {
            p_user_id: user.id,
            p_organization: null,
          });
          if (!azError && azData) {
            const azRow: any = Array.isArray(azData) ? azData[0] : azData;
            if (azRow?.personal_access_token) {
              return azRow.personal_access_token;
            }
          }
        } catch {
          // no-op
        }
        return '';
      };

      const serenityConnection = await getAzureSerenityConnectionWithSecret(user.id);

      // Sin config de Serenity por usuario: usar variables de entorno para
      // organización/proyecto/releaseDefId y el PAT de la conexión principal del usuario.
      if (!serenityConnection) {
        const envConfig = resolveAzureSerenityConfigFromEnv();
        if (!envConfig) return null;

        const userPat = await resolveUserAzurePat();
        return {
          ...envConfig,
          personalAccessToken: userPat || envConfig.personalAccessToken,
        };
      }

      let pat = serenityConnection.personal_access_token;

      const userPat = await resolveUserAzurePat();
      if (userPat) {
        pat = userPat;
      }

      // Si el PAT sigue vacío, intenta usar el configurado por variables de entorno.
      if (!pat) {
        const envConfig = resolveAzureSerenityConfigFromEnv();
        if (envConfig?.personalAccessToken) {
          pat = envConfig.personalAccessToken;
        }
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

  // Fallback global por variables de entorno (sin usuario o ante errores de BD).
  return resolveAzureSerenityConfigFromEnv();
}
