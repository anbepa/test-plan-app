import { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

const GH_TOKEN = process.env['GH_DISPATCH_TOKEN'] || '';
const GH_OWNER = process.env['GH_DISPATCH_OWNER'] || '';
const GH_REPO = process.env['GH_DISPATCH_REPO'] || '';
const GH_WORKFLOW_ID = process.env['GH_DISPATCH_WORKFLOW_ID'] || 'serenity-report.yml';

function gh(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `token ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'test-plan-app',
      ...(opts.headers || {}),
    },
  });
}

interface JobIdPayload {
  jobId: string;
  gistId: string;
  runId: string;
}

async function findRunByJobId(jobId: string): Promise<string | null> {
  try {
    // Buscar en runs de repository_dispatch recientes
    const res = await gh(
      `/repos/${GH_OWNER}/${GH_REPO}/actions/runs?event=repository_dispatch&per_page=10`
    );
    if (res.ok) {
      const data = await res.json() as any;
      const match = data.workflow_runs?.find(
        (r: any) => (r.name?.includes('Serenity') || r.display_title?.includes('Serenity'))
          && (r.name?.includes(jobId) || r.display_title?.includes(jobId))
      );
      if (match) return String(match.id);
    }

    // Fallback: buscar en el workflow específico
    const wfRes = await gh(
      `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${encodeURIComponent(GH_WORKFLOW_ID)}/runs?per_page=5`
    );
    if (wfRes.ok) {
      const wfData = await wfRes.json() as any;
      const match = wfData.workflow_runs?.find(
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

// POST /api/serenity-report  →  start pipeline
// GET  /api/serenity-report?runId=...&gistId=...&jobId=...  →  poll / download artifact

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({
      error: 'GH_DISPATCH_TOKEN, GH_DISPATCH_OWNER y GH_DISPATCH_REPO son requeridos en Vercel env vars',
    });
  }

  if (req.method === 'POST') {
    return handleStart(req, res);
  }
  if (req.method === 'GET') {
    return handlePoll(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed. Use POST or GET.' });
}

// ── START ──
async function handleStart(req: VercelRequest, res: VercelResponse) {
  try {
    const { bundle } = req.body || {};
    if (!bundle) {
      return res.status(400).json({ error: 'Se requiere un bundle en el body' });
    }

    const jobId = `serenity-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const runName = bundle?.run?.name || 'Reporte Serenity';

    // 1. Crear gist secreto
    let gistId: string;
    try {
      const gistRes = await gh('/gists', {
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
        return res.status(502).json({ error: `Error al crear gist: ${gistRes.status}` });
      }

      const gist = await gistRes.json() as any;
      gistId = gist.id;
      console.log(`[serenity-report] Gist creado: ${gistId}`);
    } catch (e: any) {
      console.error('[serenity-report] Excepción creando gist:', e);
      return res.status(502).json({ error: 'Error al crear gist' });
    }

    // 2. Disparar repository_dispatch
    try {
      const dispRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'serenity-report',
          client_payload: {
            job_id: jobId,
            bundle_url: `https://gist.githubusercontent.com/${GH_OWNER}/${gistId}/raw/serenity-bundle.json`,
          },
        }),
      });

      if (dispRes.status !== 204) {
        const err = await dispRes.text();
        console.error('[serenity-report] Error en dispatch:', dispRes.status, err);
        return res.status(502).json({ error: `Error al disparar workflow: ${dispRes.status}` });
      }
    } catch (e: any) {
      console.error('[serenity-report] Excepción en dispatch:', e);
      return res.status(502).json({ error: 'Error al disparar workflow' });
    }

    // 3. Buscar el run generado (por nombre Serenity <jobId>)
    await new Promise(r => setTimeout(r, 3000));
    const runId = await findRunByJobId(jobId);

    if (!runId) {
      // No pudimos encontrar el run, pero el dispatch fue exitoso.
      // Devolvemos jobId y el cliente puede reintentar.
      return res.status(200).json({
        success: true,
        phase: 'dispatched',
        jobId,
        gistId,
        runId: null,
        message: 'Workflow disparado. Run no encontrado aún, reintenta en unos segundos.',
      });
    }

    return res.status(200).json({
      success: true,
      phase: 'running',
      jobId,
      gistId,
      runId,
      runName,
    });
  } catch (e: any) {
    console.error('[serenity-report] Error fatal en handleStart:', e);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// ── POLL ──
async function handlePoll(req: VercelRequest, res: VercelResponse) {
  let { runId, gistId, jobId } = req.query as Record<string, string>;

  if (!runId && jobId) {
    // Buscar el run por jobId (el dispatch pudo no haber creado el run al momento del POST)
    const foundRunId = await findRunByJobId(jobId);
    if (foundRunId) {
      runId = foundRunId;
      console.log(`[serenity-report] Run encontrado por jobId: ${runId}`);
    }
  }

  if (!runId) {
    return res.status(202).json({
      status: 'running',
      phase: 'queued',
      conclusion: null,
      message: 'Buscando run del workflow...',
    });
  }

  try {
    // 1. Consultar estado del run
    const runRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`);

    if (!runRes.ok) {
      return res.status(502).json({
        status: 'error',
        message: `Error consultando run: ${runRes.status}`,
      });
    }

    const runData = await runRes.json() as any;
    const status = runData.status as string;  // queued | in_progress | completed
    const conclusion = runData.conclusion as string | null; // success | failure | null

    console.log(`[serenity-report] Run ${runId}: status=${status}, conclusion=${conclusion}`);

    if (status === 'completed') {
      if (conclusion === 'success') {
        // 2. Obtener artifact (target.zip)
        const artifactsRes = await gh(
          `/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}/artifacts`
        );

        if (!artifactsRes.ok) {
          return res.status(502).json({
            status: 'done',
            phase: 'completed_no_artifacts',
            conclusion,
            message: 'Workflow completado pero no se pudieron listar los artifacts.',
          });
        }

        const artifactsData = await artifactsRes.json() as any;
        const targetArtifact = artifactsData.artifacts?.find(
          (a: any) => a.name === 'target' || a.name === 'target.zip' || a.name === 'serenity-report'
        );

        if (!targetArtifact) {
          return res.status(200).json({
            status: 'done',
            phase: 'completed_no_target',
            conclusion,
            artifacts: artifactsData.artifacts?.map((a: any) => a.name) || [],
            message: 'Workflow completado pero no se encontró el artifact target.zip.',
          });
        }

        // 3. Obtener la URL de descarga del artifact (redirect a Azure)
        const dlRes = await gh(
          `/repos/${GH_OWNER}/${GH_REPO}/actions/artifacts/${targetArtifact.id}/zip`,
          { redirect: 'manual' }
        );

        const artifactDownloadUrl = dlRes.headers.get('location') || '';

        // 4. Borrar gist
        if (gistId) {
          try {
            await gh(`/gists/${gistId}`, { method: 'DELETE' });
            console.log(`[serenity-report] Gist ${gistId} eliminado`);
          } catch (e: any) {
            console.error('[serenity-report] Error borrando gist:', e);
          }
        }

        return res.status(200).json({
          status: 'done',
          phase: 'completed',
          conclusion,
          artifactName: targetArtifact.name,
          artifactDownloadUrl,
          message: 'Reporte generado exitosamente.',
        });
      }

      // Falló
      if (gistId) {
        try {
          await gh(`/gists/${gistId}`, { method: 'DELETE' });
        } catch (_) {}
      }

      return res.status(200).json({
        status: 'done',
        phase: 'failed',
        conclusion,
        message: `El workflow falló con conclusión: ${conclusion}.`,
      });
    }

    // Si está queued o in_progress
    return res.status(200).json({
      status: 'running',
      phase: status,
      conclusion: null,
      message: status === 'queued' ? 'Workflow en cola...' : 'Generando reporte...',
    });
  } catch (e: any) {
    console.error('[serenity-report] Error en handlePoll:', e);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
