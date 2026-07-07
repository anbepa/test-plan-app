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

// ── Routing ──
// POST /api/serenity-report?action=start  → upload bundle ref + dispatch workflow
// GET  /api/serenity-report?runId=...      → poll / download artifact

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

// ── START: upload bundle to Supabase → dispatch workflow ──
async function handleStart(req: VercelRequest, res: VercelResponse) {
  try {
    const { jobId: clientJobId, storagePath } = req.body || {};
    if (!storagePath) {
      return res.status(400).json({ error: 'Se requiere storagePath' });
    }

    const jobId = clientJobId || `serenity-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Generar signed URL desde Supabase Storage (válido 2 horas)
    let bundleUrl: string;
    try {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        throw new Error('SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados en Vercel');
      }

      // Usar REST API directamente (evita dependencia de @supabase/supabase-js)
      const bucket = 'execution-evidence';
      const signRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${encodeURIComponent(storagePath)}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expiresIn: 7200 }),
        }
      );

      if (!signRes.ok) {
        const signErr = await signRes.text();
        console.error('[serenity-report] Error creando signed URL:', signRes.status, signErr);
        throw new Error(`Supabase sign error: ${signRes.status}`);
      }

      const signData = await signRes.json() as any;
      bundleUrl = signData.signedURL || signData.signedUrl;
      if (!bundleUrl) throw new Error('No se recibio signedURL de Supabase');

      console.log(`[serenity-report] Signed URL generada para ${storagePath}`);
    } catch (e: any) {
      console.error('[serenity-report] Error signed URL:', e.message);
      return res.status(502).json({ error: `Error generando URL firmada: ${e.message}` });
    }

    // Disparar repository_dispatch con la URL firmada del bundle
    try {
      const dispRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'serenity-report',
          client_payload: {
            job_id: jobId,
            bundle_url: bundleUrl,
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

    // Buscar el run
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

// ── POLL ──
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
