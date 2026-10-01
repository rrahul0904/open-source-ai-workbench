import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentToolRuntime } from '../src/agent-runtime.mjs';
import { createPreviewRelay } from '../src/preview-relay.mjs';
import { dispatchMcpMessage, closeMcpRuntime } from '../scripts/mcp-server.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

test('modern server/discover advertises current stateless MCP tools capability', async () => {
  const result = await dispatchMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'server/discover',
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }
  });
  assert.equal(result.result.resultType, 'complete');
  assert.deepEqual(result.result.supportedVersions, ['2026-07-28']);
  assert.ok(result.result.capabilities.tools);
  assert.equal(result.result.cacheScope, 'private');
});

test('legacy initialize remains available for 2025-era clients', async () => {
  const result = await dispatchMcpMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
  });
  assert.equal(result.result.protocolVersion, '2025-11-25');
  assert.ok(result.result.capabilities.tools);
});

test('modern tools/list returns bounded tool schemas and modern result metadata', async () => {
  const result = await dispatchMcpMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }
  });
  assert.equal(result.result.resultType, 'complete');
  assert.ok(result.result.tools.some((tool) => tool.name === 'deploy_plan'));
  assert.ok(result.result.tools.some((tool) => tool.name === 'share_start'));
  assert.equal(result.result.cacheScope, 'private');
});

test('preview policy tool is pure and rejects writes by default', async () => {
  const result = await dispatchMcpMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'preview_policy_check',
      arguments: { method: 'POST', path: '/save' },
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' }
    }
  });
  assert.equal(result.result.isError, false);
  assert.equal(result.result.structuredContent.allowed, false);
  assert.equal(result.result.structuredContent.reason, 'demo-policy-deny-write');
});

test('deploy plan is confined to configured roots and never deploys', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'agent-outside-'));
  try {
    await writeFile(path.join(root, 'package.json'), '{"name":"agent-demo"}');
    await writeFile(path.join(outside, 'package.json'), '{"name":"outside"}');
    const runtime = createAgentToolRuntime({ allowedSourceRoots: [root] });
    const plan = await runtime.call('deploy_plan', { sourceRoot: root, sourceRevision: SHA });
    assert.equal(plan.source.revision, SHA);
    assert.equal(plan.approvalRequired, true);
    assert.equal(plan.sourceRoot, undefined);
    await assert.rejects(() => runtime.call('deploy_plan', { sourceRoot: outside, sourceRevision: SHA }), /outside the configured allowlist/);
    await runtime.close();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('public share is denied unless server policy explicitly enables it', async () => {
  const runtime = createAgentToolRuntime({ allowPublicShare: false });
  await assert.rejects(
    () => runtime.call('share_start', { upstream: 'http://127.0.0.1:3000', confirmExternalShare: true }),
    /disabled by server policy/
  );
  await runtime.close();
});

test('public share additionally requires per-call confirmation', async () => {
  const runtime = createAgentToolRuntime({
    allowPublicShare: true,
    relayUrl: 'http://127.0.0.1:1',
    relayOperatorKey: 'operator-test-key'
  });
  await assert.rejects(
    () => runtime.call('share_start', { upstream: 'http://127.0.0.1:3000', confirmExternalShare: false }),
    /confirmExternalShare=true/
  );
  await runtime.close();
});

test('enabled agent share traverses relay while preserving local mutation interception', async () => {
  let writes = 0;
  const app = http.createServer(async (req, res) => {
    if (req.method === 'POST') { writes += 1; for await (const _ of req) {} }
    res.writeHead(200, { 'content-type': req.method === 'GET' ? 'text/html' : 'application/json' });
    res.end(req.method === 'GET' ? '<html><body>agent share</body></html>' : '{"stored":true}');
  });
  const appUrl = await listen(app);
  const relay = createPreviewRelay({ operatorKey: 'operator-test-key', pollTimeoutMs: 25, requestTimeoutMs: 1000 });
  const relayAddress = await relay.listen();
  const relayUrl = `http://127.0.0.1:${relayAddress.port}`;
  const runtime = createAgentToolRuntime({
    allowPublicShare: true,
    relayUrl,
    relayOperatorKey: 'operator-test-key'
  });

  try {
    const started = await runtime.call('share_start', { upstream: appUrl, confirmExternalShare: true, ttlMs: 5000 });
    assert.equal(started.active, true);
    const get = await fetch(started.publicUrl + '/');
    assert.match(await get.text(), /agent share/);

    const post = await fetch(started.publicUrl + '/save', { method: 'POST', body: 'x' });
    assert.equal(post.headers.get('x-preview-demo-blocked'), '1');
    assert.equal(writes, 0);

    const requests = await runtime.call('share_requests', {});
    assert.equal(requests.requests.length >= 2, true);
    const stopped = await runtime.call('share_stop', { confirmStop: true });
    assert.equal(stopped.stopped, true);
  } finally {
    await runtime.close();
    await relay.close();
    await close(app);
  }
});

test.after(async () => {
  await closeMcpRuntime();
});
