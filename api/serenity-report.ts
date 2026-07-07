import { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

const GH_TOKEN = process.env['GH_DISPATCH_TOKEN'] || '';
const GH_OWNER = process.env['GH_DISPATCH_OWNER'] || '';
const GH_REPO = process.env['GH_DISPATCH_REPO'] || '';
const GH_WORKFLOW_ID = process.env['GH_DISPATCH_WORKFLOW_ID'] || 'serenity-report.yml';
const SUPABASE_URL = process.env['SUPABASE_URL'] || '';
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'] || '';

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

async function findRunByJobId(jobId: string): Promise<string | null> {
  try {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return res.status(500).json({
      error: 'GH_DISPATCH_TOKEN, GH_DISPATCH_OWNER y GH_DISPATCH_REPO son requeridos',
    });
  }

  if (req.method === 'GET') {
    return handlePoll(req, res);
  }

  if (req.method === 'POST') {
    return handleStart(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleStart(req: VercelRequest, res: VercelResponse) {
  try {
    const { jobId: clientJobId, storagePath, executionId } = req.body || {};
    if (!storagePath) {
      return res.status(400).json({ error: 'Se requiere storagePath' });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error('[serenity-report] Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en Vercel env vars');
      return res.status(500).json({ error: 'SUPABASE_URL y SUPABASE_SERVICE_KEY son requeridos en Vercel' });
    }

    const jobId = clientJobId || `serenity-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const bucket = 'execution-evidence';

    // Disparar workflow con la ruta del bundle en Supabase + credenciales
    // El workflow descarga el bundle directamente usando la service key (sin signed URL)
    try {
      const payload: Record<string, string> = {
        job_id: jobId,
        bundle_storage_path: `${bucket}/${storagePath}`,
        supabase_url: SUPABASE_URL,
        supabase_service_key: SUPABASE_SERVICE_KEY,
        evidence_bucket: bucket,
      };
      if (executionId) {
        payload.execution_id = executionId;
      }

      const dispRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'serenity-report',
          client_payload: payload,
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

    await new Promise(r => setTimeout(r, 3000));
    const runId = await findRunByJobId(jobId);

    return res.status(200).json({
      success: true,
      phase: runId ? 'running' : 'dispatched',
      jobId,
      runId: runId || null,
      message: runId ? 'Workflow en ejecución' : 'Workflow disparado.',
    });
  } catch (e: any) {
    console.error('[serenity-report] Error fatal:', e);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function handlePoll(req: VercelRequest, res: VercelResponse) {
  let { runId, gistId, jobId } = req.query as Record<string, string>;

  if (!runId && jobId) {
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
    const runRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`);

    if (!runRes.ok) {
      return res.status(502).json({
        status: 'error',
        message: `Error consultando run: ${runRes.status}`,
      });
    }

    const runData = await runRes.json() as any;
    const status = runData.status as string;
    const conclusion = runData.conclusion as string | null;

    console.log(`[serenity-report] Run ${runId}: status=${status}, conclusion=${conclusion}`);

    if (status === 'completed') {
      if (conclusion === 'success') {
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

        const dlRes = await gh(
          `/repos/${GH_OWNER}/${GH_REPO}/actions/artifacts/${targetArtifact.id}/zip`,
          { redirect: 'manual' }
        );

        const artifactDownloadUrl = dlRes.headers.get('location') || '';

        return res.status(200).json({
          status: 'done',
          phase: 'completed',
          conclusion,
          artifactName: targetArtifact.name,
          artifactDownloadUrl,
          message: 'Reporte generado exitosamente.',
        });
      }

      return res.status(200).json({
        status: 'done',
        phase: 'failed',
        conclusion,
        message: `El workflow falló con conclusión: ${conclusion}.`,
      });
    }

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
