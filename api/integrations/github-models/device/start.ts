import { VercelRequest, VercelResponse } from '@vercel/node';
import { deviceStart, getAuthenticatedUser, toErrorResponse } from '../shared';

// POST /api/integrations/github-models/device/start
// Paso 1 del Device Flow: exige sesión válida y devuelve el user_code.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ message: 'Método no permitido.' });
      return;
    }
    // Exige sesión válida (identidad del usuario).
    await getAuthenticatedUser(req.headers);

    const dev = await deviceStart();
    res.status(200).json({
      deviceCode: dev.deviceCode,
      userCode: dev.userCode,
      verificationUri: dev.verificationUri,
      expiresIn: dev.expiresIn,
      interval: dev.interval,
    });
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}
