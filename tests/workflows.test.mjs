import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilities } from '../src/catalog.mjs';
import { handleApi } from '../src/http.mjs';
import { executeWorkflow } from '../src/workflows.mjs';

test('all catalog capabilities execute in demo mode', async () => {
  for (const capability of capabilities) {
    const input = {
      symbol: 'TEST', prompt: 'Hello', topic: 'AI agents', audience: 'builders', text: 'Hello world', goal: 'Ship safely',
      subject: 'Follow up', body: 'Please reply today', entities: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], relationships: []
    };
    const run = await executeWorkflow(capability.id, input);
    assert.equal(run.status, 'succeeded', capability.id);
    assert.ok(run.output);
  }
});

test('agentic inbox requires approval before send boundary', async () => {
  const draft = await executeWorkflow('agentic-inbox', { subject: 'Please approve', body: 'Please reply' });
  assert.equal(draft.output.requiresApproval, true);
  assert.equal(draft.output.sendState, 'approval-required');
  const approved = await executeWorkflow('agentic-inbox', { subject: 'Please approve', body: 'Please reply', approved: true });
  assert.equal(approved.output.requiresApproval, false);
});

test('voice studio returns playable wav data URI', async () => {
  const run = await executeWorkflow('voice-studio', { text: 'Hello' });
  assert.match(run.output.audioDataUrl, /^data:audio\/wav;base64,/);
});

test('unknown workflow fails closed', async () => {
  await assert.rejects(() => executeWorkflow('not-real', {}), /Unknown workflow/);
});

test('HTTP health and workflow API operate without secrets', async () => {
  const health = await handleApi({ method: 'GET', path: '/api/health', clientKey: 'workflow-health-test' });
  assert.equal(health.status, 200);
  const run = await handleApi({ method: 'POST', path: '/api/workflows/run', clientKey: 'workflow-run-test', body: { workflowId: 'engineering-agent', input: { goal: 'Verify release' } } });
  assert.equal(run.status, 200);
  assert.equal(run.body.status, 'succeeded');
  const acceptance = await handleApi({ method: 'GET', path: '/api/acceptance', clientKey: 'workflow-acceptance-test' });
  assert.equal(acceptance.status, 200);
  assert.equal(acceptance.body.ok, true);
  assert.equal(acceptance.body.externalActionTaken, false);
});

test('evidence document HTTP API proves ingest, retrieval and citation resolution', async () => {
  const tenantId = 'http-tenant-a';
  const ingest = await handleApi({
    method: 'POST',
    path: '/api/documents/ingest',
    clientKey: 'documents-ingest-test',
    body: {
      tenantId,
      documentId: 'quarterly-note',
      mediaType: 'text/markdown',
      content: '# Quarterly note\nNorth generated 42 units.\n--- page:2 ---\n| Region | Units |\n| --- | --- |\n| South | 17 |',
    },
  });
  assert.equal(ingest.status, 200);
  assert.equal(ingest.body.receipt.indexReceipt.status, 'complete');

  const retrieve = await handleApi({
    method: 'POST',
    path: '/api/documents/retrieve',
    clientKey: 'documents-retrieve-test',
    body: { tenantId, query: 'North 42 units' },
  });
  assert.equal(retrieve.status, 200);
  assert.ok(retrieve.body.retrieval.hits.length > 0);
  const citation = retrieve.body.retrieval.hits[0].evidenceCitation;

  const resolve = await handleApi({
    method: 'POST',
    path: '/api/documents/citation/resolve',
    clientKey: 'documents-resolve-test',
    body: { tenantId, citation },
  });
  assert.equal(resolve.status, 200);
  assert.equal(resolve.body.evidence.verified, true);
  assert.equal(resolve.body.evidence.sourceDigest, citation.sourceDigest);
});

test('evidence document HTTP API fails closed across tenant boundary', async () => {
  const tenantId = 'http-tenant-source';
  await handleApi({
    method: 'POST',
    path: '/api/documents/ingest',
    clientKey: 'documents-isolation-ingest-test',
    body: { tenantId, mediaType: 'text/plain', content: 'Private source fact is 8842.' },
  });
  const source = await handleApi({
    method: 'POST',
    path: '/api/documents/retrieve',
    clientKey: 'documents-isolation-source-test',
    body: { tenantId, query: 'Private source 8842' },
  });
  assert.ok(source.body.retrieval.hits.length > 0);

  const other = await handleApi({
    method: 'POST',
    path: '/api/documents/retrieve',
    clientKey: 'documents-isolation-other-test',
    body: { tenantId: 'http-tenant-other', query: 'Private source 8842' },
  });
  assert.equal(other.status, 200);
  assert.equal(other.body.retrieval.hits.length, 0);

  const crossResolve = await handleApi({
    method: 'POST',
    path: '/api/documents/citation/resolve',
    clientKey: 'documents-isolation-resolve-test',
    body: { tenantId: 'http-tenant-other', citation: source.body.retrieval.hits[0].evidenceCitation },
  });
  assert.equal(crossResolve.status, 404);
});
