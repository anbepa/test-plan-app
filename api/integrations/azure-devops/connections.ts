import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  disconnectAzureConnection,
  getAuthenticatedUser,
  getAzureConnection,
  maskTokenHint,
  normalizeOrganization,
  toErrorResponse,
  upsertAzureConnection,
  validateAzureConnection,
} from './shared';

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
  const organization = typeof req.query['organization'] === 'string'
    ? normalizeOrganization(req.query['organization'])
    : null;

  const connection = await getAzureConnection(user.id, organization);
  if (!connection) {
    res.status(200).json(null);
    return;
  }

  res.status(200).json({
    id: connection.id,
    organization: connection.organization,
    status: connection.status,
    tokenHint: connection.token_hint,
    lastValidatedAt: connection.last_validated_at,
    updatedAt: connection.updated_at,
  });
}

async function handleSave(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const body = req.body || {};

  const organization = normalizeOrganization(String(body.organization || ''));
  const personalAccessToken = String(body.personalAccessToken || '').trim();

  if (!personalAccessToken) {
    throw new ApiError(400, 'El PAT es obligatorio para guardar la conexión.');
  }

  await validateAzureConnection(organization, personalAccessToken);

  const savedConnection = await upsertAzureConnection(
    user.id,
    organization,
    personalAccessToken,
    'connected'
  );

  res.status(200).json({
    id: savedConnection.id,
    organization: savedConnection.organization,
    status: savedConnection.status,
    tokenHint: savedConnection.token_hint || maskTokenHint(personalAccessToken),
    lastValidatedAt: savedConnection.last_validated_at,
  });
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const organizationParam = req.query['organization'];
  const organization = typeof organizationParam === 'string' ? normalizeOrganization(organizationParam) : '';

  if (!organization) {
    throw new ApiError(400, 'Debes indicar la organización para desconectar.');
  }

  await disconnectAzureConnection(user.id, organization);

  res.status(200).json({ success: true });
}
