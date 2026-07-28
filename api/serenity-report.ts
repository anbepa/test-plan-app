import { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, toErrorResponse } from './integrations/azure-devops/shared';
import { resolveSerenityRuntimeConfig } from './integrations/serenity/shared';

function gh(path: string, token: string, opts: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'test-plan-app',
      ...(opts.headers || {}),
    },
  });
}

async function findRunByJobId(jobId: string, headers: Record<string, string | string[] | undefined>): Promise<string | null> {
  try {
    const config = await resolveSerenityRuntimeConfig(headers);
    const workflowRuns = await gh(
      `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/workflows/${encodeURIComponent(config.workflowFileName)}/runs?event=workflow_dispatch&per_page=10`,
      config.personalAccessToken
    );
    if (workflowRuns.ok) {
      const data = await workflowRuns.json() as any;
      const match = data.workflow_runs?.find(
        (r: any) => (r.name?.includes('Serenity') || r.display_title?.includes('Serenity'))
          && (r.name?.includes(jobId) || r.display_title?.includes(jobId))
      );
      if (match) return String(match.id);
    }

    const repoRuns = await gh(
      `/repos/${encodeURIComponent(config.repositoryOwner)}/${encodeURIComponent(config.repositoryName)}/actions/runs?event=repository_dispatch&per_page=10`,
      config.personalAccessToken
    );
    if (repoRuns.ok) {
      const data = await repoRuns.json() as any;
      const match = data.workflow_runs?.find(
        (r: any) => (r.name?.includes('Serenity') || r.display_title?.includes('Serenity'))
          && (r.name?.includes(jobId) || r.display_title?.includes(jobId))
      );
      if (match) return String(match.id);
    }
  } catch (e) {
    console.error('[serenity-report] Error en findRunByJobId:', e);
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return handlePoll(req, res);
  if (req.method === 'POST') return handleStart(req, res);
  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleStart(req: VercelRequest, res: VercelResponse) {
  try {
    const runtimeConfig = await resolveSerenityRuntimeConfig(req.headers);
    const { bundle } = req.body || {};
    if (!bundle) {
      return res.status(400).json({ error: 'Se requiere un bundle' });
    }

    const jobId = `serenity-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    let gistId: string;
    let bundleUrl: string;
    try {
      const gistRes = await gh('/gists', runtimeConfig.personalAccessToken, {
        method: 'POST',
        body: JSON.stringify({
          description: `Serenity bundle — ${jobId}`,
          public: false,
          files: {
            'serenity-bundle.json': {
              content: JSON.stringify(bundle, null, 2),
            },
          },
        }),
      });

      if (!gistRes.ok) {
        const err = await gistRes.text();
        console.error('[serenity-report] Error creando gist:', gistRes.status, err);
        const hint = gistRes.status === 401 || gistRes.status === 403
          ? ' Verifica que el token tenga permiso gist y acceso al repositorio.'
          : '';
        return res.status(502).json({ error: `Error al crear gist: ${gistRes.status}.${hint}`.trim() });
      }

      const gist = await gistRes.json() as any;
      gistId = gist.id;
      bundleUrl = gist?.files?.['serenity-bundle.json']?.raw_url || '';
      console.log(`[serenity-report] Gist creado: ${gistId}`);
    } catch (e: any) {
      console.error('[serenity-report] Excepción creando gist:', e);
      return res.status(502).json({ error: 'Error al crear gist' });
    }

    if (!bundleUrl) {
      return res.status(502).json({ error: 'No se pudo obtener la URL del bundle.' });
    }

    try {
      const dispRes = await gh(
        `/repos/${encodeURIComponent(runtimeConfig.repositoryOwner)}/${encodeURIComponent(runtimeConfig.repositoryName)}/actions/workflows/${encodeURIComponent(runtimeConfig.workflowFileName)}/dispatches`,
        runtimeConfig.personalAccessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            ref: runtimeConfig.branch,
            inputs: {
              job_id: jobId,
              bundle_url: bundleUrl,
            },
          }),
        }
      );

      if (dispRes.status !== 204) {
        const err = await dispRes.text();
        console.error('[serenity-report] Error en dispatch:', dispRes.status, err);
        const hint = dispRes.status === 401 || dispRes.status === 403
          ? ' Verifica que el token tenga permisos de Actions y acceso al repositorio.'
          : '';
        return res.status(502).json({ error: `Error al disparar workflow: ${dispRes.status}.${hint}`.trim() });
      }
    } catch (e: any) {
      console.error('[serenity-report] Excepción en dispatch:', e);
      return res.status(502).json({ error: 'Error al disparar workflow' });
    }

    await new Promise((r) => setTimeout(r, 3000));
    const runId = await findRunByJobId(jobId, req.headers);

    return res.status(200).json({
      success: true,
      phase: runId ? 'running' : 'dispatched',
      jobId,
      gistId,
      runId: runId || null,
      message: runId ? 'Workflow en ejecución' : 'Workflow disparado.',
    });
  } catch (e: any) {
    console.error('[serenity-report] Error fatal:', e);
    return res.status(500).json({ error: e instanceof ApiError ? e.message : 'Error interno del servidor' });
  }
}

async function handlePoll(req: VercelRequest, res: VercelResponse) {
  try {
    const runtimeConfig = await resolveSerenityRuntimeConfig(req.headers);
    let { runId, gistId, jobId } = req.query as Record<string, string>;

    if (!runId && jobId) {
      const foundRunId = await findRunByJobId(jobId, req.headers);
      if (foundRunId) { runId = foundRunId; }
    }

    if (!runId) {
      return res.status(202).json({ status: 'running', phase: 'queued', conclusion: null, message: 'Buscando run...' });
    }

    const runRes = await gh(
      `/repos/${encodeURIComponent(runtimeConfig.repositoryOwner)}/${encodeURIComponent(runtimeConfig.repositoryName)}/actions/runs/${runId}`,
      runtimeConfig.personalAccessToken
    );
    if (!runRes.ok) {
      return res.status(502).json({ status: 'error', message: `Error consultando run: ${runRes.status}` });
    }

    const runData = await runRes.json() as any;
    const status = runData.status as string;
    const conclusion = runData.conclusion as string | null;

    if (status === 'completed') {
      if (conclusion === 'success') {
        const artifactsRes = await gh(
          `/repos/${encodeURIComponent(runtimeConfig.repositoryOwner)}/${encodeURIComponent(runtimeConfig.repositoryName)}/actions/runs/${runId}/artifacts`,
          runtimeConfig.personalAccessToken
        );
        if (!artifactsRes.ok) {
          return res.status(502).json({ status: 'done', phase: 'completed_no_artifacts', conclusion });
        }

        const artifactsData = await artifactsRes.json() as any;
        const targetArtifact = artifactsData.artifacts?.find(
          (a: any) => a.name === 'target' || a.name === 'target.zip' || a.name === 'serenity-report'
        );

        if (!targetArtifact) {
          return res.status(200).json({
            status: 'done', phase: 'completed_no_target', conclusion,
            artifacts: artifactsData.artifacts?.map((a: any) => a.name) || [],
          });
        }

        const dlRes = await gh(
          `/repos/${encodeURIComponent(runtimeConfig.repositoryOwner)}/${encodeURIComponent(runtimeConfig.repositoryName)}/actions/artifacts/${targetArtifact.id}/zip`,
          runtimeConfig.personalAccessToken,
          { redirect: 'manual' }
        );
        const artifactDownloadUrl = dlRes.headers.get('location') || '';

        if (gistId) { try { await gh(`/gists/${gistId}`, runtimeConfig.personalAccessToken, { method: 'DELETE' }); } catch (_) {} }

        return res.status(200).json({ status: 'done', phase: 'completed', conclusion, artifactDownloadUrl });
      }

      if (gistId) { try { await gh(`/gists/${gistId}`, runtimeConfig.personalAccessToken, { method: 'DELETE' }); } catch (_) {} }
      return res.status(200).json({ status: 'done', phase: 'failed', conclusion });
    }

    return res.status(200).json({ status: 'running', phase: status, conclusion: null });
  } catch (e: any) {
    console.error('[serenity-report] Error en handlePoll:', e);
    return res.status(500).json({ error: e instanceof ApiError ? e.message : 'Error interno del servidor' });
  }
}
