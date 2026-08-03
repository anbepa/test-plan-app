import { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, getAuthenticatedUser, getAzureConnectionWithSecret, toErrorResponse, maskTokenHint } from '../azure-devops/shared';
import {
  AzureSerenityRuntimeConfig,
  disconnectAzureSerenityConnection,
  getAzureSerenityConnectionWithSecret,
  upsertAzureSerenityConnection,
  validateAzureSerenityPipeline,
} from '../serenity/shared';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      await handleGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      await handleSave(req, res);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDelete(req, res);
      return;
    }

    res.status(405).json({ message: 'Método no permitido.' });
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const connection = await getAzureSerenityConnectionWithSecret(user.id);

  if (!connection) {
    res.status(200).json(null);
    return;
  }

  res.status(200).json({
    id: connection.id,
    azureOrganization: connection.azure_organization,
    azureProject: connection.azure_project,
    releaseDefinitionId: connection.release_definition_id,
    pipelineName: connection.pipeline_name,
    branch: connection.branch,
    status: connection.status,
    tokenHint: connection.token_hint,
    lastValidatedAt: connection.last_validated_at,
    updatedAt: connection.updated_at,
  });
}

async function handleSave(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const body = req.body || {};

  const azureOrganization = String(body.azureOrganization || '').trim();
  const azureProject = String(body.azureProject || '').trim();
  const releaseDefinitionId = Number(body.releaseDefinitionId || 0);
  const pipelineName = String(body.pipelineName || 'Serenity Report CD').trim() || 'Serenity Report CD';
  const branch = String(body.branch || 'trunk').trim() || 'trunk';

  if (!azureOrganization) {
    throw new ApiError(400, 'La organización de Azure DevOps es obligatoria.');
  }

  if (!azureProject) {
    throw new ApiError(400, 'El proyecto de Azure DevOps es obligatorio.');
  }

  if (!releaseDefinitionId || releaseDefinitionId <= 0) {
    throw new ApiError(400, 'El Release Definition ID es obligatorio.');
  }

  // Se reutiliza el mismo PAT de la conexión principal de Azure DevOps.
  const mainConnection = await getAzureConnectionWithSecret(user.id, azureOrganization);
  const finalToken = mainConnection?.personal_access_token || '';

  if (!finalToken) {
    throw new ApiError(400, 'Debes conectar primero Azure DevOps con un PAT válido antes de configurar Serenity.');
  }

  await validateAzureSerenityPipeline({
    azureOrganization,
    azureProject,
    releaseDefinitionId,
    personalAccessToken: finalToken,
  });

  const savedConnection = await upsertAzureSerenityConnection(user.id, {
    azureOrganization,
    azureProject,
    releaseDefinitionId,
    pipelineName,
    branch,
    personalAccessToken: finalToken,
  }, 'connected');

  res.status(200).json({
    id: savedConnection.id,
    azureOrganization: savedConnection.azure_organization,
    azureProject: savedConnection.azure_project,
    releaseDefinitionId: savedConnection.release_definition_id,
    pipelineName: savedConnection.pipeline_name,
    branch: savedConnection.branch,
    status: savedConnection.status,
    tokenHint: savedConnection.token_hint || maskTokenHint(finalToken),
    lastValidatedAt: savedConnection.last_validated_at,
  });
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  await disconnectAzureSerenityConnection(user.id);
  res.status(200).json({ success: true });
}
