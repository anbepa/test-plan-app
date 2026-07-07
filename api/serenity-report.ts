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

async function findRunByJobId(jobId: string): Promise<string | null> {
  try {
    const res = await gh(`/repos/${GH_OWNER}/${GH_REPO}/actions/runs?event=repository_dispatch&per_page=10`);
    if (res.ok) {
      const data = await res.json() as any;
      const match = data.workflow_runs?.find(
        (r: any) => (r.name?.includes('Serenity') || r.display_title?.includes('Serenity'))
          && (r.name?.includes(jobId) || r.display_title?.includes(jobId))
      );
      if (match) return String(match.id);
    }

    const wfRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${encodeURIComponent(GH_WORKFLOW_ID)}/runs?per_page=5`);
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
    return res.status(500).json({ error: 'GH_DISPATCH_TOKEN, GH_DISPATCH_OWNER y GH_DISPATCH_REPO son requeridos' });
  }

  if (req.method === 'GET') return handlePoll(req, res);
  if (req.method === 'POST') return handleStart(req, res);
  return res.status(405).json({ error: 'Method not allowed.' });
}

async function handleStart(req: VercelRequest, res: VercelResponse) {
  try {
    // Read binary body (gzipped bundle JSON)
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const compressed = Buffer.concat(chunks);

    if (compressed.length === 0) {
      return res.status(400).json({ error: 'Body vacio' });
    }

    const jobId = `serenity-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Base64-encode the gzipped content for Gist storage
    const contentBase64 = compressed.toString('base64');

    console.log(`[serenity-report] Bundle comprimido: ${compressed.length} bytes, base64: ${contentBase64.length} chars`);

    // Create Gist with the compressed bundle
    let gistId: string;
    try {
      const gistRes = await gh('/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: `Serenity bundle — ${jobId}`,
          public: false,
          files: {
            'bundle.json.gz': { content: contentBase64 },
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

    // Dispatch workflow
    try {
      const dispRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'serenity-report',
          client_payload: {
            job_id: jobId,
            bundle_url: `https://gist.githubusercontent.com/${GH_OWNER}/${gistId}/raw/bundle.json.gz`,
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

    await new Promise(r => setTimeout(r, 3000));
    const runId = await findRunByJobId(jobId);

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
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

async function handlePoll(req: VercelRequest, res: VercelResponse) {
  let { runId, gistId, jobId } = req.query as Record<string, string>;

  if (!runId && jobId) {
    const foundRunId = await findRunByJobId(jobId);
    if (foundRunId) { runId = foundRunId; }
  }

  if (!runId) {
    return res.status(202).json({ status: 'running', phase: 'queued', conclusion: null, message: 'Buscando run...' });
  }

  try {
    const runRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`);
    if (!runRes.ok) {
      return res.status(502).json({ status: 'error', message: `Error consultando run: ${runRes.status}` });
    }

    const runData = await runRes.json() as any;
    const status = runData.status as string;
    const conclusion = runData.conclusion as string | null;

    if (status === 'completed') {
      if (conclusion === 'success') {
        const artifactsRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}/artifacts`);
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

        const dlRes = await gh(`/repos/${GH_OWNER}/${GH_REPO}/actions/artifacts/${targetArtifact.id}/zip`, { redirect: 'manual' });
        const artifactDownloadUrl = dlRes.headers.get('location') || '';

        if (gistId) { try { await gh(`/gists/${gistId}`, { method: 'DELETE' }); } catch (_) {} }

        return res.status(200).json({ status: 'done', phase: 'completed', conclusion, artifactDownloadUrl });
      }

      if (gistId) { try { await gh(`/gists/${gistId}`, { method: 'DELETE' }); } catch (_) {} }
      return res.status(200).json({ status: 'done', phase: 'failed', conclusion });
    }

    return res.status(200).json({ status: 'running', phase: status, conclusion: null });
  } catch (e: any) {
    console.error('[serenity-report] Error en handlePoll:', e);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
