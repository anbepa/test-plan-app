import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  getAuthenticatedUser,
  getAzureConnectionWithSecret,
  importAzureUserStory,
  isAzurePatRejection,
  respondAzureAuthFailure,
  toErrorResponse,
} from '../_shared';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método no permitido.' });
    return;
  }

  try {
    const user = await getAuthenticatedUser(req.headers);
    const userStoryId = Number(req.body?.userStoryId);

    if (!Number.isInteger(userStoryId) || userStoryId <= 0) {
      throw new ApiError(400, 'ID de HU inválido. Debe ser un número entero positivo.');
    }

    const connection = await getAzureConnectionWithSecret(user.id, null);
    if (!connection || connection.status === 'disconnected') {
      throw new ApiError(404, 'Azure DevOps no está configurado para este usuario.');
    }

    let imported;
    try {
      imported = await importAzureUserStory(
        connection.organization,
        connection.personal_access_token,
        userStoryId
      );
    } catch (error) {
      if (isAzurePatRejection(error)) {
        await respondAzureAuthFailure(res, 401, user.id, connection.organization);
        return;
      }
      throw error;
    }

    res.status(200).json(imported);
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}
