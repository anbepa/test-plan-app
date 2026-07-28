import { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, getAuthenticatedUser, toErrorResponse } from '../azure-devops/shared';
import {
  buildRepositoryUrl,
  disconnectSerenityConnection,
  getSerenityConnectionWithSecret,
  maskTokenHint,
  normalizeBranch,
  normalizeRepositoryName,
  normalizeRepositoryOwner,
  normalizeRepositoryUrl,
  normalizeWorkflowFileName,
  resolveSerenityDefaultPublicConfig,
  resolveSerenityDefaultToken,
  upsertSerenityConnection,
  validateSerenityGithubAccess,
} from './shared';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      await handleGet(req, res);
      return;
    }

    if (req.method === 'POST') {
      await handleSave(req, res);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDelete(req, res);
      return;
    }

    res.status(405).json({ message: 'Método no permitido.' });
  } catch (error: unknown) {
    const normalized = toErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
}

async function handleGet(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const connection = await getSerenityConnectionWithSecret(user.id);

  if (!connection) {
    const fallback = resolveSerenityDefaultPublicConfig();
    res.status(200).json({
      id: 'global-default',
      githubUsername: fallback.githubUsername,
      repositoryOwner: fallback.repositoryOwner,
      repositoryName: fallback.repositoryName,
      workflowFileName: fallback.workflowFileName,
      branch: fallback.branch,
      repositoryUrl: fallback.repositoryUrl,
      workflowName: fallback.workflowName,
      status: 'default',
      tokenHint: fallback.tokenHint,
      lastValidatedAt: null,
      updatedAt: null,
    });
    return;
  }

  res.status(200).json({
    id: connection.id,
    githubUsername: connection.github_username,
    repositoryOwner: connection.repository_owner,
    repositoryName: connection.repository_name,
    workflowFileName: connection.workflow_file_name,
    branch: connection.branch,
    repositoryUrl: connection.repository_url,
    workflowName: connection.workflow_name,
    status: connection.status,
    tokenHint: connection.token_hint,
    lastValidatedAt: connection.last_validated_at,
    updatedAt: connection.updated_at,
  });
}

async function handleSave(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  const body = req.body || {};

  const githubUsername = String(body.githubUsername || '').trim();
  const repositoryOwner = normalizeRepositoryOwner(String(body.repositoryOwner || ''));
  const repositoryName = normalizeRepositoryName(String(body.repositoryName || ''));
  const workflowFileName = normalizeWorkflowFileName(String(body.workflowFileName || 'serenity-report.yml'));
  const branch = normalizeBranch(String(body.branch || 'main'));
  const workflowName = String(body.workflowName || 'Serenity Report').trim() || 'Serenity Report';
  const repositoryUrl = normalizeRepositoryUrl(String(body.repositoryUrl || '')) || buildRepositoryUrl(repositoryOwner, repositoryName);
  const typedPersonalAccessToken = String(body.personalAccessToken || '').trim();
  const existingConnection = await getSerenityConnectionWithSecret(user.id);
  const defaultToken = resolveSerenityDefaultToken();
  const personalAccessToken = typedPersonalAccessToken || existingConnection?.personal_access_token || defaultToken;

  if (!personalAccessToken) {
    throw new ApiError(400, 'No hay token disponible. Configura GH_DISPATCH_TOKEN o ingresa un token manualmente.');
  }

  await validateSerenityGithubAccess({
    repositoryOwner,
    repositoryName,
    workflowFileName,
    personalAccessToken,
  });

  const savedConnection = await upsertSerenityConnection(user.id, {
    githubUsername: githubUsername || repositoryOwner,
    repositoryOwner,
    repositoryName,
    workflowFileName,
    branch,
    repositoryUrl,
    workflowName,
    personalAccessToken,
  }, 'connected');

  res.status(200).json({
    id: savedConnection.id,
    githubUsername: savedConnection.github_username,
    repositoryOwner: savedConnection.repository_owner,
    repositoryName: savedConnection.repository_name,
    workflowFileName: savedConnection.workflow_file_name,
    branch: savedConnection.branch,
    repositoryUrl: savedConnection.repository_url,
    workflowName: savedConnection.workflow_name,
    status: savedConnection.status,
    tokenHint: savedConnection.token_hint || maskTokenHint(personalAccessToken),
    lastValidatedAt: savedConnection.last_validated_at,
  });
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const user = await getAuthenticatedUser(req.headers);
  await disconnectSerenityConnection(user.id);
  res.status(200).json({ success: true });
}
