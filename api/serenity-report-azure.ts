import { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, getAuthenticatedUser, getSupabaseClients } from './integrations/azure-devops/shared';
import { AzureSerenityRuntimeConfig, resolveAzureSerenityRuntimeConfig } from './integrations/serenity/shared';

function azureGet(url: string, personalAccessToken: string): Promise<Response> {
  const basicToken = Buffer.from(`:${personalAccessToken}`).toString('base64');
  return fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${basicToken}`,
      Accept: 'application/json',
      'User-Agent': 'test-plan-app',
    },
  });
}

function azurePost(url: string, personalAccessToken: string, body: any): Promise<Response> {
  const basicToken = Buffer.from(`:${personalAccessToken}`).toString('base64');
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'test-plan-app',
    },
    body: JSON.stringify(body),
  });
}

function resolveArtifactDownloadUrlFromRelease(data: any): string | null {
  const candidates = [
    data?.artifactDownloadUrl,
    data?.reportZipUrl,
    data?.variables?.SERENITY_REPORT_ZIP_URL?.value,
    data?.variables?.REPORT_ZIP_URL?.value,
    data?.variables?.ARTIFACT_DOWNLOAD_URL?.value,
    data?.environments?.[0]?.variables?.SERENITY_REPORT_ZIP_URL?.value,
    data?.environments?.[0]?.variables?.REPORT_ZIP_URL?.value,
    data?.environments?.[0]?.variables?.ARTIFACT_DOWNLOAD_URL?.value,
  ];

  for (const v of candidates) {
    const s = String(v || '').trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return null;
}

async function uploadBundleToStorage(bundleJson: string, userId: string, jobId: string): Promise<string> {
  const { adminClient } = getSupabaseClients();
  const bucket = 'execution-evidence';
  const path = `serenity-bundles/${userId}/${jobId}.json`;

  const { error } = await adminClient.storage.from(bucket).upload(path, bundleJson, {
    contentType: 'application/json',
    upsert: true,
  });

  if (error) {
    console.error('[serenity-report-azure] Error subiendo bundle:', error);
    throw new ApiError(500, 'Error al subir el bundle a Supabase Storage.');
  }

  const { data: signedData, error: signedError } = await adminClient.storage.from(bucket).createSignedUrl(path, 3600);

  if (signedError || !signedData?.signedUrl) {
    throw new ApiError(500, 'Error al generar URL firmada para el bundle.');
  }

  return signedData.signedUrl;
}

async function deleteBundleFromStorage(userId: string, jobId: string): Promise<void> {
  try {
    const { adminClient } = getSupabaseClients();
    const bucket = 'execution-evidence';
    const path = `serenity-bundles/${userId}/${jobId}.json`;
    await adminClient.storage.from(bucket).remove([path]);
  } catch (_) { /* no-op */ }
}

/**
 * Elimina reportes previos del mismo usuario/ejecución antes de insertar uno nuevo.
 * Así solo se conserva el último reporte generado (no se guarda histórico).
 */
async function replacePreviousReports(userId: string, executionId: string | null): Promise<void> {
  try {
    const { adminClient } = getSupabaseClients();

    let query = adminClient
      .from('serenity_report_results')
      .select('id')
      .eq('user_id', userId);

    query = executionId ? query.eq('execution_id', executionId) : query.is('execution_id', null);

    const { data: oldRows } = await query;

    if (oldRows && oldRows.length > 0) {
      await Promise.all(oldRows.map((row: any) => deleteBundleFromStorage(userId, row.id).catch(() => {})));

      let deleteQuery = adminClient
        .from('serenity_report_results')
        .delete()
        .eq('user_id', userId);

      deleteQuery = executionId ? deleteQuery.eq('execution_id', executionId) : deleteQuery.is('execution_id', null);

      await deleteQuery;
    }
  } catch (_) { /* no-op */ }
}

async function triggerAzureRelease(
  config: AzureSerenityRuntimeConfig,
  bundleUrl: string,
  jobId: string,
): Promise<number> {
  const url = `https://vsrm.dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_apis/release/releases?api-version=7.1`;

  const body = {
    definitionId: config.releaseDefinitionId,
    description: `Serenity report — ${jobId}`,
    variables: {
      BUNDLE_URL: { value: bundleUrl },
      RUN_ID: { value: jobId },
      RUN_NAME: { value: jobId },
    },
  };

  const response = await azurePost(url, config.personalAccessToken, body);

  if (!response.ok) {
    const errText = await response.text();
    console.error('[serenity-report-azure] Error al crear release:', response.status, errText);
    const hint = response.status === 401 || response.status === 403
      ? ' Verifica que el PAT tenga permisos Release (Read, Write, & Execute) en Azure DevOps.'
      : '';
    throw new ApiError(502, `Error al crear release: ${response.status}.${hint}`.trim());
  }

  const data = await response.json() as any;
  const releaseId = data?.id;
  if (!releaseId) {
    throw new ApiError(502, 'No se pudo obtener el ID del release de Azure DevOps.');
  }

  console.log(`[serenity-report-azure] Release creado: ${releaseId}`);
  return releaseId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return handlePoll(req, res);
  if (req.method === 'POST') return handleStart(req, res);
  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleStart(req: VercelRequest, res: VercelResponse) {
  try {
    const config = await resolveAzureSerenityRuntimeConfig(req.headers);
    if (!config) {
      return res.status(400).json({ error: 'No hay configuración de Serenity Azure para este usuario.' });
    }

    if (!config.personalAccessToken) {
      return res.status(400).json({
        error: 'No se encontró un Personal Access Token (PAT) de Azure DevOps para este usuario. Conecta primero la integración de Azure DevOps con un PAT válido con permisos Release (Read, Write & Execute).',
      });
    }

    const { bundle, bundleUrl: providedBundleUrl, executionId } = req.body || {};
    if (!bundle && !providedBundleUrl) {
      return res.status(400).json({ error: 'Se requiere un bundle' });
    }

    const user = await getAuthenticatedUser(req.headers);
    const jobId = `serenity-azure-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // El cliente puede subir el bundle DIRECTAMENTE a Supabase Storage (evita el
    // límite de 4.5MB del body de Vercel cuando las evidencias pesan mucho) y
    // enviar solo la URL firmada. Como fallback, aceptamos el bundle inline.
    let bundleUrl: string;
    let bundleUploadedHere = false;
    if (providedBundleUrl) {
      bundleUrl = String(providedBundleUrl);
      console.log(`[serenity-report-azure] Usando bundle URL provista por el cliente`);
    } else {
      const bundleJson = JSON.stringify(bundle);
      try {
        bundleUrl = await uploadBundleToStorage(bundleJson, user.id, jobId);
        bundleUploadedHere = true;
        console.log(`[serenity-report-azure] Bundle subido: ${bundleUrl}`);
      } catch (e: any) {
        console.error('[serenity-report-azure] Error subiendo bundle:', e);
        return res.status(502).json({ error: 'Error al almacenar el bundle.' });
      }
    }

    let releaseId: number;
    try {
      releaseId = await triggerAzureRelease(config, bundleUrl, jobId);
    } catch (e: any) {
      if (bundleUploadedHere) {
        await deleteBundleFromStorage(user.id, jobId).catch(() => {});
      }
      const message = e instanceof ApiError
        ? e.message
        : (e?.message ? `Error al crear release: ${e.message}` : 'Error al crear release.');
      return res.status(502).json({ error: message });
    }

    // Insertar fila pendiente para que el pipeline haga PATCH luego
    try {
      const { adminClient } = getSupabaseClients();

      // Solo se conserva el último reporte: se elimina cualquier reporte previo
      // de este usuario/ejecución antes de insertar el nuevo.
      await replacePreviousReports(user.id, executionId || null);

      await adminClient
        .from('serenity_report_results')
        .upsert({
          id: jobId,
          user_id: user.id,
          execution_id: executionId || null,
          backend: 'azure',
          status: 'pending',
          progress: 0,
        }, { onConflict: 'id' });
    } catch (_) { /* no-op */ }

    return res.status(200).json({
      success: true,
      phase: 'running',
      jobId,
      releaseId,
      message: 'Release de Azure DevOps creado.',
    });
  } catch (e: any) {
    console.error('[serenity-report-azure] Error fatal:', e);
    return res.status(500).json({ error: e instanceof ApiError ? e.message : 'Error interno del servidor' });
  }
}

async function handlePoll(req: VercelRequest, res: VercelResponse) {
  try {
    const config = await resolveAzureSerenityRuntimeConfig(req.headers);
    if (!config) {
      return res.status(400).json({ error: 'No hay configuración de Serenity Azure para este usuario.' });
    }

    const { releaseId, jobId } = req.query as Record<string, string>;
    if (!releaseId) {
      return res.status(400).json({ error: 'Falta releaseId.' });
    }

    const url = `https://vsrm.dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_apis/release/releases/${releaseId}?api-version=7.1`;
    const response = await azureGet(url, config.personalAccessToken);

    if (!response.ok) {
      return res.status(502).json({ status: 'error', message: `Error consultando release: ${response.status}` });
    }

    const data = await response.json() as any;
    const environments: any[] = data?.environments || [];
    const status: string = environments[0]?.status || 'unknown';

    if (status === 'succeeded' || status === 'rejected') {
      if (jobId) {
        try {
          const user = await getAuthenticatedUser(req.headers);
          await deleteBundleFromStorage(user.id, jobId).catch(() => {});
        } catch (_) {}
      }

      if (status === 'succeeded') {
        const releaseUrl = `https://dev.azure.com/${encodeURIComponent(config.azureOrganization)}/${encodeURIComponent(config.azureProject)}/_releaseProgress?_a=release-pipeline-progress&releaseId=${releaseId}`;
        const artifactDownloadUrl = resolveArtifactDownloadUrlFromRelease(data);

        return res.status(200).json({
          status: 'done',
          phase: 'completed',
          result: status,
          artifactDownloadUrl,
          releaseUrl,
          message: 'Release completado exitosamente.',
        });
      }

      return res.status(200).json({ status: 'done', phase: 'failed', result: status });
    }

    if (status === 'inProgress') {
      return res.status(200).json({ status: 'running', phase: 'inProgress', result: null });
    }

    return res.status(200).json({ status: 'running', phase: status, result: null });
  } catch (e: any) {
    console.error('[serenity-report-azure] Error en handlePoll:', e);
    return res.status(500).json({ error: e instanceof ApiError ? e.message : 'Error interno del servidor' });
  }
}
