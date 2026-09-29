import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { compareDemo, createDemoAdapters } from '../src/model-compare.mjs';
import { createMockComparisonSessions } from '../src/model-compare-sessions.mjs';
import { createMockComparisonHttp } from '../src/model-compare-http.mjs';

async function fixture(options = {}) {
  const sessions = createMockComparisonSessions(options);
  const handle = createMockComparisonHttp({ sessions });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = null;
    try { if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { res.writeHead(400); res.end(); return; }
    await handle(req, res, url, body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, sessions, close: () => new Promise((resolve) => server.close(resolve)) };
}
async function start(base, models = ['demo-analysis', 'demo-creative'], prompt = 'Evaluate a mock testing plan') {
  const response = await fetch(base + '/api/compare/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, models })
  });
  return { response, body: await response.json() };
}
function parseFrames(raw) {
  return raw.split(/\r?\n\r?\n/).map((part) => {
    const id = /^id: (.+)$/m.exec(part)?.[1];
    const type = /^event: (.+)$/m.exec(part)?.[1];
    const data = /^data: (.+)$/m.exec(part)?.[1];
    return id && type && data ? { id, type, data: JSON.parse(data) } : null;
  }).filter(Boolean);
}
async function stream(base, path, headers = {}) {
  const response = await fetch(base + path, { headers });
  return { response, frames: parseFrames(await response.text()) };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('live HTTP SSE has ordered run-local IDs, independent deltas and terminal event', async (t) => {
  const app = await fixture(); t.after(app.close);
  const catalog = await fetch(app.base + '/api/compare/catalog').then((r) => r.json());
  assert.equal(catalog.mode, 'synthetic-only');
  assert.ok(catalog.models.every((m) => m.mode === 'synthetic'));
  const { response, body } = await start(app.base);
  assert.equal(response.status, 201);
  assert.equal(body.mode, 'synthetic-only');
  const { response: events, frames } = await stream(app.base, body.eventsUrl);
  assert.match(events.headers.get('content-type'), /text\/event-stream/);
  assert.equal(frames[0].type, 'run.started');
  assert.equal(frames.at(-1).type, 'run.completed');
  assert.deepEqual(frames.map((frame, i) => frame.id), frames.map((_, i) => `${body.runId}:${i + 1}`));
  assert.ok(frames.filter((frame) => frame.type === 'provider.delta').length >= 4);
  const firstComplete = frames.findIndex((frame) => frame.type === 'provider.completed');
  assert.equal(frames.filter((frame) => frame.type === 'provider.started').length, 2);
  assert.ok(frames.filter((frame) => frame.type === 'provider.started').every((frame) =>
    frames.indexOf(frame) < firstComplete));
  assert.equal(frames.at(-1).data.synthesisEligibility, 'eligible');
  assert.ok(!JSON.stringify(frames).includes('api_key'));
  const invalid = await start(app.base, ['real-provider']);
  assert.equal(invalid.response.status, 400);
});

test('partial failure is sanitized over SSE while another mock adapter completes', async (t) => {
  const adapters = createDemoAdapters();
  adapters['demo-analysis'] = {
    async *stream() { yield 'partial synthetic output'; throw new Error('SECRET upstream detail'); }
  };
  const app = await fixture({ execute: compareDemo, adapters }); t.after(app.close);
  const { body } = await start(app.base);
  const { frames } = await stream(app.base, body.eventsUrl);
  assert.ok(frames.some((f) => f.type === 'provider.delta' &&
    f.data.modelId === 'demo-analysis' && f.data.text === 'partial synthetic output'));
  assert.ok(frames.some((f) => f.type === 'provider.terminal' &&
    f.data.modelId === 'demo-analysis' && f.data.status === 'failed'));
  assert.ok(frames.some((f) => f.type === 'provider.completed' &&
    f.data.modelId === 'demo-creative'));
  assert.ok(!JSON.stringify(frames).includes('SECRET'));
  assert.equal(frames.at(-1).data.completedCount, 1);
});

test('HTTP DELETE cancels hung iterators, preserving partial output and final ordering', async (t) => {
  const adapters = Object.fromEntries(['demo-analysis', 'demo-creative'].map((id) => [id, {
    async *stream() { yield `partial ${id}`; await new Promise(() => {}); }
  }]));
  const app = await fixture({ adapters, timeoutMs: 2_000 }); t.after(app.close);
  const { body } = await start(app.base);
  await pause(10);
  const cancel = await fetch(app.base + body.cancelUrl, { method: 'DELETE' });
  assert.equal(cancel.status, 202);
  const { frames } = await stream(app.base, body.eventsUrl);
  assert.equal(frames.filter((f) => f.type === 'provider.terminal' &&
    f.data.status === 'cancelled').length, 2);
  assert.equal(frames.filter((f) => f.type === 'provider.delta').length, 2);
  assert.equal(frames.at(-1).type, 'run.completed');
  assert.equal(frames.at(-1).data.completedCount, 0);
});

test('disconnect does not cancel server run; Last-Event-ID replays only unseen events', async (t) => {
  const adapters = Object.fromEntries(['demo-analysis', 'demo-creative'].map((id) => [id, {
    async *stream() {
      for (const part of ['one', 'two', 'three']) { await pause(20); yield `${id}-${part}`; }
    }
  }]));
  const app = await fixture({ adapters }); t.after(app.close);
  const { body } = await start(app.base);
  const first = await fetch(app.base + body.eventsUrl);
  const reader = first.body.getReader();
  let raw = '';
  while (!parseFrames(raw).some((f) => f.type === 'provider.delta')) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    raw += new TextDecoder().decode(value);
  }
  const initial = parseFrames(raw);
  const lastId = initial.at(-1).id;
  await reader.cancel();
  const { response, frames } = await stream(app.base, body.eventsUrl,
    { 'Last-Event-ID': lastId });
  assert.equal(response.status, 200);
  assert.ok(frames.length > 0);
  assert.equal(Number(frames[0].id.split(':').at(-1)), Number(lastId.split(':').at(-1)) + 1);
  assert.equal(frames.at(-1).type, 'run.completed');
  const combined = [...initial, ...frames];
  assert.deepEqual(combined.map((f, i) => f.id), combined.map((_, i) => `${body.runId}:${i + 1}`));
  const bad = await fetch(app.base + body.eventsUrl, { headers: { 'Last-Event-ID': 'another-run:1' } });
  assert.equal(bad.status, 400);
  const empty = await stream(app.base, body.eventsUrl, { 'Last-Event-ID': frames.at(-1).id });
  assert.equal(empty.frames.length, 0);
});

test('catalog and streaming respect existing bearer protection', async (t) => {
  const prior = process.env.WORKBENCH_API_KEY;
  process.env.WORKBENCH_API_KEY = 'test-only-secret';
  t.after(() => { if (prior === undefined) delete process.env.WORKBENCH_API_KEY;
    else process.env.WORKBENCH_API_KEY = prior; });
  const app = await fixture(); t.after(app.close);
  assert.equal((await fetch(app.base + '/api/compare/catalog')).status, 401);
  assert.equal((await start(app.base)).response.status, 401);
  const ok = await fetch(app.base + '/api/compare/catalog',
    { headers: { authorization: 'Bearer test-only-secret' } });
  assert.equal(ok.status, 200);
});
