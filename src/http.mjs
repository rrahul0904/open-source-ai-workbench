import { capabilities } from './catalog.mjs';
import { providerStatus } from './providers.mjs';
import { authorize, rateLimit, safeJsonSize } from './security.mjs';
import { listRuns } from './storage.mjs';
import { executeWorkflow } from './workflows.mjs';

function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  return headers;
}

export function healthPayload() {
  return {
    ok: true,
    service: 'open-source-ai-workbench',
    version: '1.0.0',
    runtime: process.version,
    providers: providerStatus(),
    capabilities: capabilities.length,
    timestamp: new Date().toISOString()
  };
}

export async function handleApi({ method, path, headers = {}, body = null, clientKey = 'anonymous' }) {
  const auth = authorize(headersToObject(headers));
  if (!auth.ok) return { status: 401, body: { error: 'Unauthorized' } };
  const rate = rateLimit(clientKey);
  if (!rate.ok) return { status: 429, body: { error: 'Rate limit exceeded' } };
  if (!safeJsonSize(body)) return { status: 413, body: { error: 'Request body too large' } };

  if (method === 'GET' && path === '/api/health') return { status: 200, body: healthPayload() };
  if (method === 'GET' && path === '/api/capabilities') return { status: 200, body: { capabilities, providers: providerStatus(), authMode: auth.mode } };
  if (method === 'GET' && path === '/api/runs') return { status: 200, body: { runs: await listRuns(25) } };
  if (method === 'GET' && path === '/api/acceptance') {
    const run = await executeWorkflow('launch-campaign', { topic: 'production acceptance', audience: 'operators', provider: 'demo' });
    return { status: 200, body: { ok: run.status === 'succeeded', workflowId: run.workflowId, status: run.status, durationMs: run.durationMs, externalActionTaken: run.output.externalActionTaken } };
  }
  if (method === 'POST' && path === '/api/workflows/run') {
    const workflowId = body?.workflowId;
    if (!workflowId) return { status: 400, body: { error: 'workflowId is required' } };
    try {
      const run = await executeWorkflow(workflowId, body?.input || {});
      return { status: 200, body: run };
    } catch (error) {
      return { status: error.statusCode || 500, body: { error: error.message, run: error.run || null } };
    }
  }
  return { status: 404, body: { error: 'Not found' } };
}
