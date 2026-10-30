import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ApiError,
  getAuthenticatedUser,
  getAzureConnectionWithSecret,
  toErrorResponse,
} from '../azure-devops/_shared';

// Núcleo CommonJS compartido con local-api-server.js (ver _azure-repos-core.js).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('./_azure-repos-core.js');

/**
 * Router catch-all del Agente de exploración de código (Azure Repos).
 * Una sola Serverless Function para todas las rutas (límite Hobby: 12).
 *
 * El ciclo del agente (LLM + herramientas) se orquesta desde el frontend:
 * cada request aquí es corto (lectura de árbol/archivos/búsqueda), por lo que
 * nunca se acerca al maxDuration de Vercel.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const route = normalizePath(req.query['path']).join('/');
    const method = String(req.method || 'GET').toUpperCase();

    if (method !== 'GET' && method !== 'POST') {
      res.status(405).json({ message: 'Método no permitido.' });
      return;
    }

    const user = await getAuthenticatedUser(req.headers);
    const connection = await getAzureConnectionWithSecret(user.id, null);
    if (!connection || connection.status === 'disconnected') {
      throw new ApiError(404, 'Azure DevOps no está configurado para este usuario.');
    }

    const result = await core.handleCodeAgentRoute({
      route,
      method,
      query: req.query,
      body: req.body,
      organization: connection.organization,
      pat: connection.personal_access_token,
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    const normalized = toErrorResponse(toApiError(error));
    res.status(normalized.status).json(normalized.body);
  }
}

function toApiError(error: unknown): unknown {
  if (error instanceof core.CodeAgentError) {
    return new ApiError((error as any).status, (error as Error).message);
  }
  return error;
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
