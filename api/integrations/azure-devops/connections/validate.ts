import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  getAuthenticatedUser,
  getAzureConnectionWithSecret,
  normalizeOrganization,
  toErrorResponse,
  updateAzureConnectionStatus,
  validateAzureConnection,
} from '../shared';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método no permitido.' });
    return;
  }

  try {
    const user = await getAuthenticatedUser(req.headers);
    const body = req.body || {};
    const organization = body.organization ? normalizeOrganization(String(body.organization)) : null;

    const connection = await getAzureConnectionWithSecret(user.id, organization);
    if (!connection) {
      throw new ApiError(404, 'Azure DevOps no está configurado para tu usuario.');
    }

    try {
      await validateAzureConnection(connection.organization, connection.personal_access_token);
      await updateAzureConnectionStatus(user.id, connection.organization, 'connected');

      res.status(200).json({
        id: connection.id,
        organization: connection.organization,
        status: 'connected',
        tokenHint: connection.token_hint,
        lastValidatedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const status = error instanceof ApiError && error.status === 401 ? 'invalid' : 'expired';
      await updateAzureConnectionStatus(user.id, connection.organization, status);
      throw error;
    }
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}
