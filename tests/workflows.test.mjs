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

test('workflow studio executes retrieval -> llm -> output with node traces', async () => {
  const run = await executeWorkflow('workflow-studio', {
    question: 'What makes external actions safe?',
    documents: [
      { id: 'security', title: 'Security', text: 'External actions remain behind explicit approval gates.' },
      { id: 'runtime', title: 'Runtime', text: 'The service can run with deterministic demo providers.' }
    ]
  });
  assert.equal(run.status, 'succeeded');
  assert.equal(run.output.graph.nodeCount, 4);
  assert.equal(run.output.trace.length, 4);
  assert.equal(run.output.trace.every((step) => step.status === 'succeeded'), true);
  assert.match(run.output.output.retrieval, /security/);
});

test('workflow studio rejects cycles and unsupported executable nodes', async () => {
  await assert.rejects(() => executeWorkflow('workflow-studio', {
    graph: {
      nodes: [{ id: 'a', type: 'input' }, { id: 'b', type: 'output', config: { fields: {} } }],
      edges: [['a', 'b'], ['b', 'a']]
    }
  }), /cycle/);

  await assert.rejects(() => executeWorkflow('workflow-studio', {
    graph: { nodes: [{ id: 'unsafe', type: 'code' }], edges: [] }
  }), /Unsupported workflow node type/);
});

test('unknown workflow fails closed', async () => {
  await assert.rejects(() => executeWorkflow('not-real', {}), /Unknown workflow/);
});

test('HTTP health and workflow API operate without secrets', async () => {
  const health = await handleApi({ method: 'GET', path: '/api/health' });
  assert.equal(health.status, 200);
  const run = await handleApi({ method: 'POST', path: '/api/workflows/run', body: { workflowId: 'engineering-agent', input: { goal: 'Verify release' } } });
  assert.equal(run.status, 200);
  assert.equal(run.body.status, 'succeeded');
  const acceptance = await handleApi({ method: 'GET', path: '/api/acceptance' });
  assert.equal(acceptance.status, 200);
  assert.equal(acceptance.body.ok, true);
  assert.equal(acceptance.body.externalActionTaken, false);
});
