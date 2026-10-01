import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewRuntime } from '../src/preview-runtime.mjs';
import { createPreviewRelay, createTunnelAgent } from '../src/preview-relay.mjs';

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
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function setup({ relay = {}, preview = {}, appHandler } = {}) {
  const app = http.createServer(appHandler || ((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>app</body></html>'); }));
  const appUrl = await listen(app);
  const runtime = createPreviewRuntime({ upstream: appUrl, ...preview });
  const previewAddress = await runtime.listen();
  const previewUrl = `http://127.0.0.1:${previewAddress.port}`;
  const relayRuntime = createPreviewRelay({ operatorKey: 'operator-test-key', pollTimeoutMs: 50, requestTimeoutMs: 1500, ...relay });
  const relayAddress = await relayRuntime.listen();
  const relayUrl = `http://127.0.0.1:${relayAddress.port}`;
  const agent = createTunnelAgent({ relayUrl, operatorKey: 'operator-test-key', previewUrl, ttlMs: relay.defaultTtlMs || 5000, pollDelayMs: 5 });
  const session = await agent.register();
  const abort = new AbortController();
  const loop = agent.run({ signal: abort.signal }).catch((error) => error);
  return {
    app,
    appUrl,
    runtime,
    previewUrl,
    relayRuntime,
    relayUrl,
    agent,
    session,
    async close() {
      abort.abort();
      await agent.close().catch(() => {});
      await loop.catch(() => {});
      await relayRuntime.close();
      await runtime.close();
      await close(app);
    }
  };
}

test('relay health endpoint is public but contains no session detail', async () => {
  const ctx = await setup();
  try {
    const response = await fetch(`${ctx.relayUrl}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, service: 'safe-preview-relay' });
  } finally { await ctx.close(); }
});

test('public GET traverses relay -> agent -> safe preview -> localhost app', async () => {
  const ctx = await setup();
  try {
    const response = await fetch(`${ctx.session.publicUrl}/hello?x=1`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /app/);
    assert.match(html, /__preview\/widget\.js/);
    const receipt = ctx.runtime.listRequests().at(-1);
    assert.equal(receipt.path, '/hello?x=1');
    assert.equal(receipt.decision, 'forwarded');
  } finally { await ctx.close(); }
});

test('public POST is still blocked by the local demo policy and never reaches app writes', async () => {
  let writes = 0;
  const ctx = await setup({ appHandler: async (req, res) => {
    if (req.method === 'POST') { writes += 1; for await (const _ of req) { /* consume */ } }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end('{"stored":true}');
  } });
  try {
    const response = await fetch(`${ctx.session.publicUrl}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":1}' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-preview-demo-blocked'), '1');
    assert.equal(writes, 0);
    assert.equal(ctx.runtime.listRequests().at(-1).decision, 'intercepted');
  } finally { await ctx.close(); }
});

test('public relay exposes widget/feedback but denies inspector controls', async () => {
  const ctx = await setup();
  try {
    const inspector = await fetch(`${ctx.session.publicUrl}/__preview/requests`);
    assert.equal(inspector.status, 404);
    const widget = await fetch(`${ctx.session.publicUrl}/__preview/widget.js`);
    assert.equal(widget.status, 200);
    assert.match(await widget.text(), /Preview feedback/);
    const feedback = await fetch(`${ctx.session.publicUrl}/__preview/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Looks good', path: '/' }) });
    assert.equal(feedback.status, 201);
    assert.equal(ctx.runtime.listFeedback().at(-1).message, 'Looks good');
  } finally { await ctx.close(); }
});

test('agent polling requires the per-session token', async () => {
  const ctx = await setup();
  try {
    const url = new URL('/__relay/agent/poll', ctx.relayUrl);
    url.searchParams.set('session', ctx.session.sessionId);
    const response = await fetch(url, { headers: { authorization: 'Bearer wrong-token' } });
    assert.equal(response.status, 401);
  } finally { await ctx.close(); }
});

test('session TTL expiration makes the public route unavailable', async () => {
  let clock = 1_000_000;
  const ctx = await setup({ relay: { defaultTtlMs: 1000, maxTtlMs: 5000, nowMs: () => clock } });
  try {
    clock += 1500;
    const response = await fetch(`${ctx.session.publicUrl}/after-expiry`);
    assert.equal(response.status, 410);
  } finally { await ctx.close(); }
});
