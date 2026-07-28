/**
 * Endpoints para gestión de evidencias en Azure DevOps
 * Consulta de planes, carga de archivos, vinculación
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getAuthenticatedUser,
  toErrorResponse,
  getAzureConnectionWithSecret
} from './shared';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const { workItemId, action } = extractRouteParams(req);

    if (req.method === 'GET' && !['attachments', 'link-attachment'].includes(action || '')) {
      await handleGetWorkItem(req, res, workItemId);
      return;
    }

    if (req.method === 'POST' && action === 'attachments') {
      await handleUploadAttachment(req, res, workItemId);
      return;
    }

    if (req.method === 'PATCH' && action === 'link-attachment') {
      await handleLinkAttachment(req, res, workItemId);
      return;
    }

    res.status(405).json({ message: 'Método no permitido.' });
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}

function extractRouteParams(req: VercelRequest): { workItemId: string; action?: string } {
  // Soporta ambientes donde req.query['0'] no existe y la ruta llega completa en req.url
  const rawQueryCatchAll = req.query['0'];
  if (typeof rawQueryCatchAll === 'string' && rawQueryCatchAll.trim()) {
    const segments = rawQueryCatchAll.split('/').filter(Boolean);
    return {
      workItemId: segments[0] || '',
      action: segments[1]
    };
  }

  const pathname = (req.url || '').split('?')[0];
  const marker = '/api/integrations/azure-devops/work-items/';
  const markerIndex = pathname.indexOf(marker);

  if (markerIndex >= 0) {
    const trailing = pathname.slice(markerIndex + marker.length);
    const segments = trailing.split('/').filter(Boolean);
    return {
      workItemId: segments[0] || '',
      action: segments[1]
    };
  }

  return { workItemId: '' };
}

/**
 * GET /api/integrations/azure-devops/work-items/:workItemId
 * Consulta un Work Item (plan) en Azure DevOps
 */
async function handleGetWorkItem(req: VercelRequest, res: VercelResponse, workItemId: string): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);

  if (!workItemId) {
    res.status(400).json({ error: 'workItemId requerido' });
    return;
  }

  // Obtener configuración de Azure DevOps del usuario (conexión guardada)
  // Por defecto, usar la organización por defecto
  const connection = await getAzureConnectionWithSecret(user.id);

  if (!connection) {
    res.status(401).json({
      error: 'No hay conexión configurada con Azure DevOps',
      code: 'NO_CONNECTION'
    });
    return;
  }

  try {
    const apiVersion = '7.1';
    const url = `https://dev.azure.com/${connection.organization}/_apis/wit/workitems/${workItemId}?$expand=all&api-version=${apiVersion}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`:${connection.personal_access_token}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Work Item no encontrado' });
        return;
      }
      if (response.status === 401 || response.status === 403) {
        res.status(401).json({ error: 'No autorizado' });
        return;
      }
      throw new Error(`Azure DevOps error: ${response.status}`);
    }

    const workItem = await response.json();
    res.status(200).json(workItem);
  } catch (error: any) {
    console.error('Error fetching work item:', error);
    res.status(500).json({ error: 'Error consultando plan en Azure DevOps' });
  }
}

/**
 * POST /api/integrations/azure-devops/work-items/:workItemId/attachments
 * Carga un archivo como adjunto en Azure DevOps
 */
async function handleUploadAttachment(req: VercelRequest, res: VercelResponse, workItemId: string): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const { fileName, areaPath, fileBlob } = req.body;

  if (!workItemId) {
    res.status(400).json({ error: 'workItemId requerido' });
    return;
  }

  if (!fileName || !fileBlob) {
    res.status(400).json({ error: 'fileName y fileBlob requeridos' });
    return;
  }

  const connection = await getAzureConnectionWithSecret(user.id);
  if (!connection) {
    res.status(401).json({ error: 'No hay conexión configurada' });
    return;
  }

  try {
    // Convertir fileBlob (base64) a Buffer
    const fileBuffer = Buffer.from(fileBlob, 'base64');

    const apiVersion = '7.1';
    const attachmentUrl = `https://dev.azure.com/${connection.organization}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=Simple&areaPath=${encodeURIComponent(areaPath || '')}&api-version=${apiVersion}`;

    const response = await fetch(attachmentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`:${connection.personal_access_token}`).toString('base64')}`,
        'Content-Type': 'application/octet-stream',
        'Accept': 'application/json'
      },
      body: fileBuffer
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        res.status(401).json({ error: 'No autorizado' });
        return;
      }
      throw new Error(`Azure DevOps error: ${response.status}`);
    }

    const attachment = await response.json();
    res.status(201).json({
      id: attachment.id,
      url: attachment.url,
      size: attachment.size
    });
  } catch (error: any) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({ error: 'Error cargando archivo a Azure DevOps' });
  }
}

/**
 * PATCH /api/integrations/azure-devops/work-items/:workItemId/link-attachment
 * Vincula un adjunto a un Work Item
 */
async function handleLinkAttachment(req: VercelRequest, res: VercelResponse, workItemId: string): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const { attachmentUrl, planTitle } = req.body;

  if (!workItemId) {
    res.status(400).json({ error: 'workItemId requerido' });
    return;
  }

  if (!attachmentUrl) {
    res.status(400).json({ error: 'attachmentUrl requerido' });
    return;
  }

  const connection = await getAzureConnectionWithSecret(user.id);
  if (!connection) {
    res.status(401).json({ error: 'No hay conexión configurada' });
    return;
  }

  try {
    const apiVersion = '7.1';
    const patchUrl = `https://dev.azure.com/${connection.organization}/_apis/wit/workitems/${workItemId}?api-version=${apiVersion}`;

    const patchBody = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: attachmentUrl,
          attributes: {
            comment: `Evidencia Serenity adjunta al plan de pruebas`
          }
        }
      }
    ];

    const response = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Basic ${Buffer.from(`:${connection.personal_access_token}`).toString('base64')}`,
        'Content-Type': 'application/json-patch+json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(patchBody)
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        res.status(401).json({ error: 'No autorizado' });
        return;
      }
      throw new Error(`Azure DevOps error: ${response.status}`);
    }

    const result = await response.json();
    res.status(200).json({
      success: true,
      workItemId: result.id,
      message: `Evidencia vinculada al plan ${workItemId}`
    });
  } catch (error: any) {
    console.error('Error linking attachment:', error);
    res.status(500).json({ error: 'Error vinculando archivo a plan' });
  }
}
