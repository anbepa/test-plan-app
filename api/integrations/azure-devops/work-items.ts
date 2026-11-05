/**
 * Endpoints para gestión de evidencias en Azure DevOps
 * Consulta de planes, carga de archivos, vinculación
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getAuthenticatedUser,
  toErrorResponse,
  getAzureConnectionWithSecret,
  respondAzureAuthFailure,
} from './_shared';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const { workItemId, action } = extractRouteParams(req);

    if (req.method === 'GET' && action === 'get-upload-config') {
      await handleGetUploadConfig(req, res, workItemId);
      return;
    }

    if (req.method === 'GET' && !['attachments', 'link-attachment'].includes(action || '')) {
      await handleGetWorkItem(req, res, workItemId);
      return;
    }

    if (req.method === 'POST' && action === 'attachments') {
      await handleUploadAttachment(req, res, workItemId);
      return;
    }

    if (req.method === 'POST' && action === 'upload-evidence') {
      await handleUploadEvidence(req, res, workItemId);
      return;
    }

    if (req.method === 'PATCH') {
      if (action === 'update-fields') {
        await handleUpdateFields(req, res, workItemId);
        return;
      }
      if (action === 'link-attachment' || !action) {
        await handleLinkAttachment(req, res, workItemId);
        return;
      }
    }

    res.status(405).json({ message: 'Método no permitido.' });
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}

function extractRouteParams(req: VercelRequest): { workItemId: string; action?: string } {
  const queryWorkItemId = typeof req.query['workItemId'] === 'string'
    ? req.query['workItemId'].trim()
    : '';
  const queryAction = typeof req.query['action'] === 'string'
    ? req.query['action'].trim()
    : undefined;

  if (queryWorkItemId) {
    return {
      workItemId: queryWorkItemId,
      action: queryAction
    };
  }

  const catchAllPath = req.query['path'];
  if (Array.isArray(catchAllPath) && catchAllPath.length > 0) {
    return {
      workItemId: String(catchAllPath[0] || ''),
      action: catchAllPath[1] ? String(catchAllPath[1]) : undefined
    };
  }

  if (typeof catchAllPath === 'string' && catchAllPath.trim()) {
    const segments = catchAllPath.split('/').filter(Boolean);
    return {
      workItemId: segments[0] || '',
      action: segments[1]
    };
  }

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
        await respondAzureAuthFailure(res, response.status, user.id, connection.organization);
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
 * GET /api/integrations/azure-devops/work-items?workItemId=:id&action=get-upload-config
 * Devuelve la configuración necesaria para que el cliente suba archivos
 * DIRECTAMENTE a Azure DevOps, sin pasar el archivo por Vercel (evita límite 4.5MB).
 */
async function handleGetUploadConfig(req: VercelRequest, res: VercelResponse, workItemId: string): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'].trim() : '';
  const areaPath = typeof req.query['areaPath'] === 'string' ? req.query['areaPath'].trim() : '';
  const fileName = typeof req.query['fileName'] === 'string' ? req.query['fileName'].trim() : 'Evidencia.zip';

  const connection = await getAzureConnectionWithSecret(user.id);
  if (!connection) {
    res.status(401).json({ error: 'No hay conexión configurada con Azure DevOps', code: 'NO_CONNECTION' });
    return;
  }

  // Devuelve la URL de upload directa a Azure DevOps y el token Basic codificado
  // El cliente puede usar esto para subir el archivo directamente sin pasar por Vercel
  const apiVersion = '7.1';

  if (!projectId) {
    res.status(400).json({ error: 'projectId requerido para construir la URL de carga', code: 'MISSING_PROJECT_ID' });
    return;
  }

  const uploadUrl = `https://dev.azure.com/${connection.organization}/${encodeURIComponent(projectId)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=Simple&areaPath=${encodeURIComponent(areaPath)}&api-version=${apiVersion}`;
  const basicToken = Buffer.from(`:${connection.personal_access_token}`).toString('base64');

  res.status(200).json({
    uploadUrl,
    authHeader: `Basic ${basicToken}`,
    organization: connection.organization,
    workItemId
  });
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
        await respondAzureAuthFailure(res, response.status, user.id, connection.organization);
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
 * POST /api/integrations/azure-devops/work-items?workItemId=:id&action=upload-evidence
 * Empaqueta Serenity + DOCX/PDF en un ZIP y lo carga a Azure DevOps para luego vincularlo.
 */
async function handleUploadEvidence(req: VercelRequest, res: VercelResponse, workItemId: string): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const artifactDownloadUrl = String(req.body?.artifactDownloadUrl || '').trim();
  const extraFiles = Array.isArray(req.body?.extraFiles) ? req.body.extraFiles : [];
  const projectId = String(req.body?.projectId || '').trim();
  const areaPath = String(req.body?.areaPath || '').trim();
  const planTitle = String(req.body?.planTitle || '').trim();
  let fileName = String(req.body?.fileName || 'Evidencia.zip').trim();

  if (!workItemId) {
    res.status(400).json({ error: 'workItemId requerido' });
    return;
  }
  if (!projectId) {
    res.status(400).json({ error: 'projectId requerido' });
    return;
  }
  if (!artifactDownloadUrl && extraFiles.length === 0) {
    res.status(400).json({ error: 'No hay evidencias para cargar' });
    return;
  }

  const connection = await getAzureConnectionWithSecret(user.id);
  if (!connection) {
    res.status(401).json({ error: 'No hay conexión configurada' });
    return;
  }

  if (!/\.zip$/i.test(fileName)) {
    fileName += '.zip';
  }

  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // NOTA sobre límites:
    // El límite de 4.5MB de Vercel aplica SOLO al body de entrada de la request.
    // Aquí el artifact de Serenity NO viaja en el body: solo llega su URL y el
    // servidor lo descarga (fetch saliente) y lo sube a Azure (fetch saliente),
    // ninguno de los cuales está sujeto a ese límite. Por eso no validamos 4MB.
    // El único límite real es la memoria/tiempo de la función serverless.
    let totalInputSize = 0;

    // 1) Incluir artifact Serenity original como target.zip
    if (artifactDownloadUrl) {
      const artifactRes = await fetch(artifactDownloadUrl);
      if (!artifactRes.ok) {
        throw new Error(`No fue posible descargar el reporte de Serenity (${artifactRes.status}).`);
      }
      const artifactBuffer = Buffer.from(await artifactRes.arrayBuffer());
      totalInputSize += artifactBuffer.length;
      zip.file('target.zip', artifactBuffer);
    }

    // 2) Incluir extras generados en cliente (DOCX/PDF)
    for (const f of extraFiles) {
      const name = String(f?.name || '').trim();
      const base64 = String(f?.base64 || '').trim();
      if (!name || !base64) continue;

      const fileBuffer = Buffer.from(base64, 'base64');
      totalInputSize += fileBuffer.length;
      zip.file(name, fileBuffer);
    }

    // Generar ZIP con máxima compresión
    const zipBuffer = await zip.generateAsync({ 
      type: 'nodebuffer', 
      compression: 'DEFLATE',
      compressionOptions: { level: 9 } // Máxima compresión (0-9)
    });

    const basicToken = Buffer.from(`:${connection.personal_access_token}`).toString('base64');
    const apiVersion = '7.1';

    // 3) Cargar ZIP a Azure DevOps
    const attachmentUrl = `https://dev.azure.com/${connection.organization}/${encodeURIComponent(projectId)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=Simple&areaPath=${encodeURIComponent(areaPath || '')}&api-version=${apiVersion}`;
    const uploadRes = await fetch(attachmentUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicToken}`,
        'Content-Type': 'application/octet-stream',
        Accept: 'application/json'
      },
      body: zipBuffer as any
    });

    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      if (uploadRes.status === 401 || uploadRes.status === 403) {
        await respondAzureAuthFailure(res, uploadRes.status, user.id, connection.organization);
        return;
      }
      throw new Error(`Azure DevOps upload error: ${uploadRes.status}`);
    }

    // 4) Vincular adjunto al plan
    const patchUrl = `https://dev.azure.com/${connection.organization}/_apis/wit/workitems/${workItemId}?api-version=${apiVersion}`;
    const patchBody = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: uploadData.url,
          attributes: {
            comment: `Evidencia adjunta al plan: ${planTitle || workItemId}`
          }
        }
      }
    ];

    const linkRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Basic ${basicToken}`,
        'Content-Type': 'application/json-patch+json',
        Accept: 'application/json'
      },
      body: JSON.stringify(patchBody)
    });

    const linkData = await linkRes.json().catch(() => ({}));
    if (!linkRes.ok) {
      if (linkRes.status === 401 || linkRes.status === 403) {
        await respondAzureAuthFailure(res, linkRes.status, user.id, connection.organization);
        return;
      }
      throw new Error(`Azure DevOps link error: ${linkRes.status}`);
    }

    res.status(200).json({
      success: true,
      attachmentId: uploadData.id,
      attachmentUrl: uploadData.url,
      fileName,
      workItemId: linkData.id,
      message: `Evidencia "${fileName}" cargada y vinculada al plan ${workItemId}`
    });
  } catch (error: any) {
    console.error('Error uploading evidence ZIP:', error);
    res.status(500).json({ error: error?.message || 'Error cargando evidencias a Azure DevOps' });
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
        await respondAzureAuthFailure(res, response.status, user.id, connection.organization);
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

async function handleUpdateFields(
  req: VercelRequest,
  res: VercelResponse,
  workItemId: string
): Promise<void> {
  try {
    const user = await getAuthenticatedUser(req.headers);
    const apiVersion = '7.1';
    const connection = await getAzureConnectionWithSecret(user.id, null);

    if (!connection || connection.status === 'disconnected') {
      res.status(404).json({ error: 'Azure DevOps no configurado' });
      return;
    }

    const { title, description } = req.body || {};
    const patchBody: any[] = [];

    if (typeof title === 'string' && title.trim()) {
      patchBody.push({
        op: 'add',
        path: '/fields/System.Title',
        value: title.trim()
      });
    }

    if (typeof description === 'string' && description.trim()) {
      // Las HUs marcadas en el HTML (data-azure-hu) se convierten en menciones
      // de work item (#ID), que Azure muestra como ficha con título y estado.
      const withMentions = await convertHuMarkersToMentions(
        description.trim(),
        connection.organization,
        connection.personal_access_token
      );
      patchBody.push({
        op: 'add',
        path: '/fields/System.Description',
        value: withMentions
      });
    }

    if (patchBody.length === 0) {
      res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
      return;
    }

    const patchUrl = `https://dev.azure.com/${encodeURIComponent(connection.organization)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}?api-version=${apiVersion}`;

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
        await respondAzureAuthFailure(res, response.status, user.id, connection.organization);
        return;
      }
      throw new Error(`Azure DevOps error: ${response.status}`);
    }

    const result = await response.json();
    res.status(200).json({
      success: true,
      id: result.id,
      rev: result.rev,
      message: `Plan ${workItemId} actualizado correctamente en Azure DevOps`
    });
  } catch (error: any) {
    console.error('Error updating work item fields:', error);
    res.status(500).json({ error: 'Error actualizando campos en Azure DevOps' });
  }
}


const HU_MARKER_REGEX = /<span data-azure-hu="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g;

/**
 * Reemplaza cada <span data-azure-hu="ID">…</span> por la mención de Azure
 * DevOps (la misma que se crea al escribir #ID en el editor). Solo se enlazan
 * los IDs que existen en Azure; el resto queda como texto, sin enlace roto.
 */
export async function convertHuMarkersToMentions(
  html: string,
  organization: string,
  personalAccessToken: string
): Promise<string> {
  const ids = Array.from(new Set(
    Array.from(html.matchAll(HU_MARKER_REGEX))
      .map(m => m[1].trim())
      .filter(id => /^\d{1,10}$/.test(id) && Number(id) > 0)
  ));

  let projects = new Map<string, string>();
  if (ids.length) {
    try {
      projects = await fetchWorkItemProjects(organization, personalAccessToken, ids);
    } catch (error) {
      // Sin validación no se enlaza nada: el plan se envía igual, con texto plano.
      console.warn('[azure-devops] No se pudieron validar las HUs para las menciones:', error);
    }
  }

  return applyHuMentions(html, organization, projects);
}

/** Parte pura (sin red) de la conversión, para poder probarla. */
export function applyHuMentions(html: string, organization: string, projects: Map<string, string>): string {
  return html.replace(HU_MARKER_REGEX, (_match, rawId: string, inner: string) => {
    const id = String(rawId).trim();
    const project = projects.get(id);
    if (!project) return inner;
    const href = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_workitems/edit/${id}/`;
    return `<a href="${href}" data-vss-mention="version:1.0">#${id}</a>`;
  });
}

/** Devuelve ID → proyecto de los work items que existen (los demás se omiten). */
async function fetchWorkItemProjects(
  organization: string,
  personalAccessToken: string,
  ids: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/workitems?ids=${chunk.join(',')}&fields=System.Id,System.TeamProject&errorPolicy=omit&api-version=7.1`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`:${personalAccessToken}`).toString('base64')}`,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} al validar work items`);
    const data = await response.json() as any;
    for (const item of (data?.value || [])) {
      const id = item?.id ?? item?.fields?.['System.Id'];
      const project = item?.fields?.['System.TeamProject'];
      if (id && project) result.set(String(id), String(project));
    }
  }
  return result;
}
