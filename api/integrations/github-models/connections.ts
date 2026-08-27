import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  disconnectGithubConnection,
  getAuthenticatedUser,
  getGithubConnection,
  getGithubConnectionWithSecret,
  toConnectionView,
  toErrorResponse,
  updateGithubConnectionStatus,
  upsertGithubConnection,
  validateGithubToken,
} from './shared';

// Maneja:
//   GET    /api/integrations/github-models/connections            -> ver conexión
//   POST   /api/integrations/github-models/connections            -> preferencias
//                                                                     (?action=validate para validar)
//   DELETE /api/integrations/github-models/connections            -> desconectar
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      await handleGet(req, res);
      return;
    }
    if (req.method === 'POST') {
      const action = typeof req.query['action'] === 'string' ? req.query['action'] : '';
      if (action === 'validate') {
        await handleValidate(req, res);
      } else {
        await handlePreferences(req, res);
      }
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
  const row = await getGithubConnection(user.id);
  res.status(200).json(toConnectionView(row));
}

async function handlePreferences(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const body = req.body || {};
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : null;
  const selectedModel = body.selectedModel ? String(body.selectedModel) : null;

  const row = await upsertGithubConnection(user.id, { token: null, enabled, selectedModel, status: null });
  res.status(200).json(toConnectionView(row));
}

async function handleValidate(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const secret = await getGithubConnectionWithSecret(user.id);
  if (!secret || !secret.token) {
    throw new ApiError(404, 'GitHub Models no está configurado para tu usuario.');
  }
  try {
    await validateGithubToken(secret.token);
    await updateGithubConnectionStatus(user.id, 'connected');
    const row = await getGithubConnection(user.id);
    res.status(200).json(toConnectionView(row));
  } catch (validationError: any) {
    const status = validationError?.status === 401 ? 'invalid' : 'expired';
    await updateGithubConnectionStatus(user.id, status);
    throw validationError;
  }
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  await disconnectGithubConnection(user.id);
  res.status(200).json({ success: true });
}
