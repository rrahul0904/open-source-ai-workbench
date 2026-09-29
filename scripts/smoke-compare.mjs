/** Acceptance against a running local/Docker/preview deployment. No real model calls. */
import assert from 'node:assert/strict';
const base = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const authorization = process.env.SMOKE_WORKBENCH_API_KEY ? { authorization: `Bearer ${process.env.SMOKE_WORKBENCH_API_KEY}` } : {};
const page = await fetch(base + '/compare');
assert.equal(page.status, 200);
assert.match(await page.text(), /Evidence Lab/);
const css = await fetch(base + '/compare.css'); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /css/);
const script = await fetch(base + '/compare.js'); assert.equal(script.status, 200); assert.match(await script.text(), /api\/compare\/stream/);
const catalog = await fetch(base + '/api/compare/catalog', { headers: authorization });
assert.equal(catalog.status, 200); const data = await catalog.json(); assert.equal(data.modes.demo.length, 4);
const stream = await fetch(base + '/api/compare/stream', { method: 'POST', headers: { 'content-type': 'application/json', ...authorization }, body: JSON.stringify({ prompt: 'deployment smoke test', models: ['demo-analysis', 'demo-structured'] }) });
assert.equal(stream.status, 200); assert.match(stream.headers.get('content-type'), /text\/event-stream/);
const text = await stream.text(); assert.match(text, /event: provider.delta/); assert.match(text, /event: run.completed/); assert.match(text, /"synthetic":true/);
console.log('compare smoke: page, CSS, JS, catalog and two-provider streamed HTTP execution passed (synthetic only)');
