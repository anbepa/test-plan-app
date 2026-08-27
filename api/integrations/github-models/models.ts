import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  getAuthenticatedUser,
  getGithubConnectionWithSecret,
  listGithubModels,
  toErrorResponse,
} from './shared';

// GET /api/integrations/github-models/models -> catálogo de modelos disponibles
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ message: 'Método no permitido.' });
      return;
    }
    const user = await getAuthenticatedUser(req.headers);
    const secret = await getGithubConnectionWithSecret(user.id);
    if (!secret || !secret.token) {
      throw new ApiError(404, 'Conecta primero con GitHub para listar los modelos.');
    }
    const models = await listGithubModels(secret.token);
    res.status(200).json({ models });
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}
