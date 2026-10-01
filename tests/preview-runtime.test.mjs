import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPreviewRuntime, createDemoPolicy, injectFeedbackWidget, redactHeaders } from '../src/preview-runtime.mjs';

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

async function rawRequest(origin, requestPath) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: url.port,
      method: 'GET',
      path: requestPath
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withRuntime(upstreamHandler, options, fn) {
  const upstream = http.createServer(upstreamHandler);
  const upstreamUrl = await listen(upstream);
  const runtime = createPreviewRuntime({ upstream: upstreamUrl, ...options });
  const address = await runtime.listen();
  const previewUrl = `http://127.0.0.1:${address.port}`;
  try { await fn({ upstream, runtime, previewUrl }); }
  finally { await runtime.close(); await close(upstream); }
}

test('demo policy denies mutations unless method and route are explicitly allowed', () => {
  const policy = createDemoPolicy({ allowedMutations: [{ method: 'POST', path: '/safe' }] });
  assert.equal(policy.evaluate('GET', '/anything').allowed, true);
  assert.equal(policy.evaluate('POST', '/unsafe').allowed, false);
  assert.equal(policy.evaluate('POST', '/safe').allowed, true);
  assert.equal(policy.evaluate('DELETE', '/safe').allowed, false);
});

test('sensitive request headers are redacted from receipts', () => {
  const redacted = redactHeaders({ authorization: 'Bearer secret', cookie: 'session=secret', 'x-api-key': 'secret', accept: 'text/html' });
  assert.equal(redacted.authorization, '[REDACTED]');
  assert.equal(redacted.cookie, '[REDACTED]');
  assert.equal(redacted['x-api-key'], '[REDACTED]');
  assert.equal(redacted.accept, 'text/html');
});

test('feedback widget injection is idempotent', () => {
  const once = injectFeedbackWidget('<html><body><h1>Hi</h1></body></html>');
  const twice = injectFeedbackWidget(once);
  assert.equal(once, twice);
  assert.match(once, /data-agent-preview-feedback/);
});

test('GET is proxied, HTML widget is injected, and request receipt is captured', async () => {
  await withRuntime((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>working</body></html>');
  }, {}, async ({ runtime, previewUrl }) => {
    const response = await fetch(`${previewUrl}/demo?x=1`, { headers: { authorization: 'Bearer secret', cookie: 'a=b' } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /working/);
    assert.match(html, /__preview\/widget\.js/);
    const [receipt] = runtime.listRequests();
    assert.equal(receipt.decision, 'forwarded');
    assert.equal(receipt.path, '/demo?x=1');
    assert.equal(receipt.requestHeaders.authorization, '[REDACTED]');
    assert.equal(receipt.requestHeaders.cookie, '[REDACTED]');
  });
});

test('demo mutation is intercepted and never reaches upstream', async () => {
  let writes = 0;
  await withRuntime((req, res) => {
    if (req.method === 'POST') writes += 1;
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end('{"stored":true}');
  }, {}, async ({ runtime, previewUrl }) => {
    const response = await fetch(`${previewUrl}/api/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":1}' });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-preview-demo-blocked'), '1');
    assert.equal(body.intercepted, true);
    assert.equal(writes, 0);
    assert.equal(runtime.listRequests()[0].decision, 'intercepted');
  });
});

test('explicitly allowlisted mutation reaches upstream', async () => {
  let writes = 0;
  await withRuntime(async (req, res) => {
    if (req.method === 'POST') {
      writes += 1;
      for await (const _ of req) { /* consume */ }
    }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end('{"stored":true}');
  }, { allowedMutations: [{ method: 'POST', path: '/api/safe-preview-state' }] }, async ({ runtime, previewUrl }) => {
    const response = await fetch(`${previewUrl}/api/safe-preview-state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"value":1}' });
    assert.equal(response.status, 201);
    assert.equal(writes, 1);
    assert.equal(runtime.listRequests()[0].reason, 'explicit-mutation-allowlist');
  });
});

test('freeze serves last-good HTML on later upstream 5xx', async () => {
  let healthy = true;
  await withRuntime((req, res) => {
    if (healthy) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>last good</body></html>');
    } else {
      res.writeHead(503, { 'content-type': 'text/html' });
      res.end('<html><body>broken</body></html>');
    }
  }, {}, async ({ runtime, previewUrl }) => {
    const first = await fetch(`${previewUrl}/page`);
    assert.match(await first.text(), /last good/);
    healthy = false;
    const second = await fetch(`${previewUrl}/page`);
    const html = await second.text();
    assert.equal(second.status, 200);
    assert.equal(second.headers.get('x-preview-frozen'), '1');
    assert.equal(second.headers.get('x-preview-upstream-status'), '503');
    assert.match(html, /last good/);
    assert.doesNotMatch(html, /broken/);
    assert.equal(runtime.listRequests().at(-1).decision, 'frozen');
  });
});

test('freeze never masks JSON API failures', async () => {
  let healthy = true;
  await withRuntime((req, res) => {
    if (healthy) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"value":1}');
    } else {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"down"}');
    }
  }, {}, async ({ previewUrl }) => {
    assert.equal((await fetch(`${previewUrl}/api/data`)).status, 200);
    healthy = false;
    const failed = await fetch(`${previewUrl}/api/data`);
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('x-preview-frozen'), null);
  });
});

test('feedback is captured locally without reaching the app', async () => {
  let upstreamHits = 0;
  await withRuntime((req, res) => {
    upstreamHits += 1;
    res.writeHead(404);
    res.end();
  }, {}, async ({ runtime, previewUrl }) => {
    const response = await fetch(`${previewUrl}/__preview/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Move the button', path: '/home' }) });
    assert.equal(response.status, 201);
    assert.equal(upstreamHits, 0);
    assert.deepEqual(runtime.listFeedback().map(({ message, path }) => ({ message, path })), [{ message: 'Move the button', path: '/home' }]);
  });
});

test('safe GET replay is explicit and produces a replay receipt', async () => {
  let hits = 0;
  await withRuntime((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`hit-${hits}`);
  }, {}, async ({ runtime, previewUrl }) => {
    await fetch(`${previewUrl}/read`);
    const original = runtime.listRequests()[0];
    const replayed = await runtime.replay(original.id);
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.toString('utf8'), 'hit-2');
    assert.equal(hits, 2);
    assert.equal(runtime.listRequests().at(-1).decision, 'replayed');
  });
});

test('mutation replay remains doubly gated', async () => {
  await withRuntime((req, res) => {
    res.writeHead(200);
    res.end('ok');
  }, { captureBodies: true }, async ({ runtime, previewUrl }) => {
    await fetch(`${previewUrl}/write`, { method: 'POST', body: 'x' });
    const receipt = runtime.listRequests()[0];
    await assert.rejects(() => runtime.replay(receipt.id, { allowMutation: true }), /Mutation replay is disabled/);
  });
});

test('remote upstreams are rejected by default', () => {
  assert.throws(() => createPreviewRuntime({ upstream: 'https://example.com' }), /loopback-only/);
});


test('upstream URLs cannot embed credentials', () => {
  assert.throws(
    () => createPreviewRuntime({ upstream: 'http://user:password@127.0.0.1:3000' }),
    /credentials are not allowed/
  );
});

test('scheme-relative request targets cannot escape the configured loopback upstream', async () => {
  let attackerHits = 0;
  const attacker = http.createServer((req, res) => {
    attackerHits += 1;
    res.writeHead(200);
    res.end('attacker');
  });
  const attackerUrl = await listen(attacker);
  const attackerPort = new URL(attackerUrl).port;

  try {
    await withRuntime((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('upstream');
    }, {}, async ({ previewUrl }) => {
      const result = await rawRequest(previewUrl, `//127.0.0.1:${attackerPort}/escape`);
      assert.equal(result.status, 400);
      assert.equal(attackerHits, 0);
      assert.match(result.body, /scheme-relative/);
    });
  } finally {
    await close(attacker);
  }
});
