import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  devicePoll,
  getAuthenticatedUser,
  toConnectionView,
  toErrorResponse,
  upsertGithubConnection,
  validateGithubToken,
} from '../shared';

// POST /api/integrations/github-models/device/poll
// Paso 2 del Device Flow: sondea GitHub. Si el usuario autorizó, valida el token
// y lo persiste cifrado (Vault) ligado al user_id de la sesión.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ message: 'Método no permitido.' });
      return;
    }

    const user = await getAuthenticatedUser(req.headers);
    const body = req.body || {};
    const deviceCode = String(body.deviceCode || '').trim();
    if (!deviceCode) {
      throw new ApiError(400, 'Falta el deviceCode.');
    }

    const result = await devicePoll(deviceCode);
    if (result.pending) {
      res.status(202).json({ pending: true, slowDown: !!result.slowDown });
      return;
    }

    // Autorizado: validar y persistir el token del usuario.
    await validateGithubToken(result.accessToken as string);
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
    const selectedModel = body.selectedModel ? String(body.selectedModel) : null;

    const row = await upsertGithubConnection(user.id, {
      token: result.accessToken,
      enabled,
      selectedModel,
      status: 'connected',
    });

    res.status(200).json({ pending: false, connection: toConnectionView(row) });
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}
