import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  deviceStart,
  devicePoll,
  disconnectGithubConnection,
  getAuthenticatedUser,
  getGithubConnection,
  getGithubConnectionWithSecret,
  listGithubModels,
  toConnectionView,
  toErrorResponse,
  updateGithubConnectionStatus,
  upsertGithubConnection,
  validateGithubToken,
} from './_shared';

/**
 * Router catch-all consolidado para GitHub Models.
 * Reúne en una sola Serverless Function los antiguos endpoints:
 *   - /api/integrations/github-models/connections              (GET | POST | DELETE)
 *   - /api/integrations/github-models/connections/validate     (POST)
 *   - /api/integrations/github-models/connections/preferences  (POST)
 *   - /api/integrations/github-models/models                   (GET)
 *   - /api/integrations/github-models/device/start             (POST)
 *   - /api/integrations/github-models/device/poll              (POST)
 *
 * Motivo: el plan Hobby de Vercel limita a 12 Serverless Functions.
 * Consolidando estos endpoints en 1 se respeta el límite sin tocar producción.
 * Las rutas públicas NO cambian: el frontend sigue llamando exactamente igual.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const segments = normalizePath(req.query['path']);
    const route = segments.join('/');

    switch (route) {
      case 'connections':
        await handleConnections(req, res);
        return;
      case 'connections/validate':
        await handleValidate(req, res);
        return;
      case 'connections/preferences':
        await handlePreferences(req, res);
        return;
      case 'models':
        await handleModels(req, res);
        return;
      case 'device/start':
        await handleDeviceStart(req, res);
        return;
      case 'device/poll':
        await handleDevicePoll(req, res);
        return;
      default:
        throw new ApiError(404, 'Recurso de GitHub Models no encontrado.');
    }
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}

function normalizePath(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s)).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.split('/').filter(Boolean);
  }
  return [];
}

// ---- /connections ---------------------------------------------------------
async function handleConnections(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'GET') {
    const user = await getAuthenticatedUser(req.headers);
    const row = await getGithubConnection(user.id);
    res.status(200).json(toConnectionView(row));
    return;
  }
  // POST directo a /connections también gestiona preferencias (retrocompatible),
  // y ?action=validate por si algún cliente lo usara.
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
    const user = await getAuthenticatedUser(req.headers);
    await disconnectGithubConnection(user.id);
    res.status(200).json({ success: true });
    return;
  }
  res.status(405).json({ message: 'Método no permitido.' });
}

async function handlePreferences(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método no permitido.' });
    return;
  }
  const user = await getAuthenticatedUser(req.headers);
  const body = req.body || {};
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : null;
  const selectedModel = body.selectedModel ? String(body.selectedModel) : null;

  const row = await upsertGithubConnection(user.id, { token: null, enabled, selectedModel, status: null });
  res.status(200).json(toConnectionView(row));
}

async function handleValidate(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Método no permitido.' });
    return;
  }
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

// ---- /models --------------------------------------------------------------
async function handleModels(req: VercelRequest, res: VercelResponse): Promise<void> {
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
}

// ---- /device/start --------------------------------------------------------
async function handleDeviceStart(req: VercelRequest, res: VercelResponse): Promise<void> {
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
}

// ---- /device/poll ---------------------------------------------------------
async function handleDevicePoll(req: VercelRequest, res: VercelResponse): Promise<void> {
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
}
