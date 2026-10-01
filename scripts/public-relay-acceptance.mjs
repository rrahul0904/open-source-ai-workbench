#!/usr/bin/env node
import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import { createPreviewRuntime } from '../src/preview-runtime.mjs';
import { createTunnelAgent } from '../src/preview-relay.mjs';

const relayUrl = process.env.RELAY_URL;
const operatorKey = process.env.PREVIEW_RELAY_OPERATOR_KEY;
if (!relayUrl || !operatorKey) throw new Error('RELAY_URL and PREVIEW_RELAY_OPERATOR_KEY are required');

let writes = 0;
const app = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/write-count') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(writes));
    return;
  }
  if (req.method === 'POST') {
    writes += 1;
    for await (const _ of req) { /* consume */ }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end('{"stored":true}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<html><body><main>public relay acceptance fixture</main></body></html>');
});

await new Promise((resolve, reject) => {
  app.once('error', reject);
  app.listen(0, '127.0.0.1', resolve);
});
const appAddress = app.address();
const preview = createPreviewRuntime({ upstream: `http://127.0.0.1:${appAddress.port}` });
const previewAddress = await preview.listen({ host: '127.0.0.1', port: 0 });
const agent = createTunnelAgent({
  relayUrl,
  operatorKey,
  previewUrl: `http://127.0.0.1:${previewAddress.port}`,
  ttlMs: 10 * 60_000,
  pollDelayMs: 20
});
const session = await agent.register();
await writeFile('/tmp/public-preview-url', session.publicUrl);
console.log(`public acceptance share ready: ${session.publicUrl}`);

const abort = new AbortController();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  abort.abort();
  await agent.close().catch(() => {});
  await preview.close().catch(() => {});
  await new Promise((resolve) => app.close(() => resolve()));
}
process.on('SIGTERM', () => { void close().then(() => process.exit(0)); });
process.on('SIGINT', () => { void close().then(() => process.exit(0)); });

try {
  await agent.run({ signal: abort.signal });
} finally {
  await close();
}
