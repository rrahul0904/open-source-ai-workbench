import { capabilities } from './catalog.mjs';
import { EvidenceDocumentEngine } from './document-intelligence.mjs';
import { providerStatus } from './providers.mjs';
import { authorize, rateLimit, safeJsonSize } from './security.mjs';
import { listRuns } from './storage.mjs';
import { executeWorkflow } from './workflows.mjs';

const evidenceDocuments = globalThis.__WORKBENCH_EVIDENCE_DOCUMENTS__ || new EvidenceDocumentEngine();
globalThis.__WORKBENCH_EVIDENCE_DOCUMENTS__ = evidenceDocuments;

function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  return headers;
}

function evidenceApiError(error) {
  const message = error?.message || 'Evidence document request failed';
  const badRequest = /required|unsupported|empty|exceeds|invalid|no structural units/i.test(message);
  const notFound = /not found|does not resolve/i.test(message);
  return { status: badRequest ? 400 : notFound ? 404 : 500, body: { error: message } };
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
  if (method === 'GET' && path === '/api/documents/snapshot') {
    return { status: 200, body: { authMode: auth.mode, snapshot: evidenceDocuments.snapshot() } };
  }
  if (method === 'POST' && path === '/api/documents/ingest') {
    try {
      const receipt = evidenceDocuments.ingestAndIndex({
        tenantId: body?.tenantId,
        documentId: body?.documentId,
        sourceKind: body?.sourceKind || 'api',
        mediaType: body?.mediaType || 'text/plain',
        content: body?.content,
      });
      return { status: 200, body: { authMode: auth.mode, receipt } };
    } catch (error) {
      return evidenceApiError(error);
    }
  }
  if (method === 'POST' && path === '/api/documents/retrieve') {
    try {
      const retrieval = evidenceDocuments.retrieve({ tenantId: body?.tenantId, query: body?.query, limit: body?.limit });
      return { status: 200, body: { authMode: auth.mode, retrieval } };
    } catch (error) {
      return evidenceApiError(error);
    }
  }
  if (method === 'POST' && path === '/api/documents/citation/resolve') {
    try {
      const evidence = evidenceDocuments.resolveCitation({ tenantId: body?.tenantId, citation: body?.citation });
      return { status: 200, body: { authMode: auth.mode, evidence } };
    } catch (error) {
      return evidenceApiError(error);
    }
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
