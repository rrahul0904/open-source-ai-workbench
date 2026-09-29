import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, catalog, validateRequest } from '../src/compare/registry.mjs';
import { parseSSE, createAdapters } from '../src/compare/adapters.mjs';
import { runComparison } from '../src/compare/service.mjs';
import { formatSSE, catalogResponse, streamComparison } from '../src/compare/http.mjs';
import { createServer } from 'node:http';

const demo = { COMPARE_LIVE_ENABLED: 'false' };
const live = { WORKBENCH_API_KEY: 'operator', COMPARE_LIVE_ENABLED: 'true', OPENAI_COMPARE_API_KEY: 'secret-value-not-for-clients', OPENAI_COMPARE_MODEL: 'test-model' };

function fakeStream(chunks) {
  return new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });
}

test('public catalog exposes no credential values and live is fail closed', () => {
  assert.equal(catalog(demo).modes.demo.length, 4);
  assert.equal(catalog({ ...live, WORKBENCH_API_KEY: '' }).liveEnabled, false);
  assert.equal(catalog(live).modes.live[0].ready, true);
  assert.ok(!JSON.stringify(catalog(live)).includes('secret-value-not-for-clients'));
});
test('bad prompt, duplicates, unrecognized IDs and missing consent are rejected', () => {
  for (const value of [ {}, { prompt: ' ' }, { prompt: 'a'.repeat(4001) }, { prompt: 'ok', models: ['demo-analysis', 'demo-analysis'] }, { prompt: 'ok', models: ['evil'] }, { prompt: 'ok', mode: 'live', models: ['openai'], consent: false } ]) {
    assert.throws(() => validateRequest(value, live), { statusCode: 400 });
  }
  assert.throws(() => validateRequest({ prompt: 'hi', mode: 'live', models: ['openai'], consent: true }, demo), { statusCode: 403 });
  assert.deepEqual(validateRequest({ prompt: ' hello ' }, demo).models, DEMO.map(x => x.id));
});
test('real four-way demo produces attribution and terminal summary; never marks synthesis generated', async () => {
  const events = []; const result = await runComparison({ prompt: 'Reliable data pipeline', mode: 'demo' }, { env: demo, onEvent: e => events.push(e), runId: 'test-run' });
  assert.equal(result.models.length, 4); assert.equal(result.models.filter(x => x.status === 'completed').length, 4);
  assert.ok(result.models.every(m => m.text.includes('[synthetic:')));
  assert.equal(result.synthetic, true); assert.equal(result.synthesis.generated, false); assert.equal(result.synthesis.eligible, true);
  assert.equal(events.at(-1).type, 'run.completed'); assert.equal(events[0].id, 'test-run:1');
  assert.equal(events.filter(e => e.type === 'provider.completed').length, 4);
});
test('one failing adapter cannot abort the others', async () => {
  const adapters = {
    'demo-analysis': { async *stream() { yield 'A'; } },
    'demo-creative': { async *stream() { throw new Error('sensitive raw provider secret'); } },
    'demo-structured': { async *stream() { yield 'C'; } }
  };
  const events = [];
  const r = await runComparison({ prompt: 'x', models: Object.keys(adapters) }, { env: demo, adapters, onEvent: e => events.push(e) });
  assert.deepEqual(r.models.map(x => x.status), ['completed', 'failed', 'completed']);
  assert.equal(r.synthesis.eligible, true);
  assert.equal(JSON.stringify(events).includes('sensitive raw'), false);
});
test('non-cooperative adapter is terminated by per-model timeout', async () => {
  const adapter = { async *stream() { await new Promise(() => {}); yield 'never'; } };
  const r = await runComparison({ prompt: 'x', models: ['demo-analysis'] }, { env: demo, timeoutMs: 10, adapters: { 'demo-analysis': adapter } });
  assert.equal(r.models[0].status, 'timeout'); assert.equal(r.synthesis.eligible, false);
});
test('cancelled parent returns a terminal cancelled state', async () => {
  const controller = new AbortController(); controller.abort();
  const r = await runComparison({ prompt: 'x', models: ['demo-analysis'] }, { env: demo, signal: controller.signal });
  assert.equal(r.models[0].status, 'cancelled');
});
test('response length is capped per provider', async () => {
  const r = await runComparison({ prompt: 'x', models: ['demo-analysis'] }, { env: demo, adapters: { 'demo-analysis': { async *stream() { yield 'z'.repeat(16001); } } } });
  assert.equal(r.models[0].status, 'failed'); assert.equal(r.models[0].errorCode, 'OUTPUT_LIMIT');
});
test('SSE parser reassembles fragmented frames and handles DONE', async () => {
  const frames = ['data: {"choices":[{"delta":{"content":"abc', 'def"}}]}\r\n\r\n', 'data: [DONE]\n\n'];
  const messages = [];
  for await (const event of parseSSE(fakeStream(frames))) messages.push(event);
  assert.equal(messages.length, 2); assert.equal(messages[0].data.choices[0].delta.content, 'abcdef'); assert.equal(messages[1].event, 'done');
});
test('provider adapter sends only pinned URL with operator configured model and key', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return { ok: true, body: fakeStream(['data: {"choices":[{"delta":{"content":"provider response"}}]}\n\n', 'data: {"usage":{"prompt_tokens":4}}\n\n','data: [DONE]\n\n']) }; };
  const adapter = createAdapters({ mode: 'live', env: live, fetchImpl }).openai;
  const events = [];
  for await (const item of adapter.stream({ prompt: 'Hello', maxOutputTokens: 42 })) events.push(item);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(JSON.parse(requests[0].init.body).model, 'test-model');
  assert.equal(JSON.parse(requests[0].init.body).max_completion_tokens, 42);
  assert.equal(events[0].delta, 'provider response'); assert.equal(events[1].usage.prompt_tokens, 4);
});
test('truncated live stream cannot be presented as completed', async () => {
  const r = await runComparison({ prompt: 'Check', mode: 'live', models: ['openai'], consent: true }, { env: live, fetchImpl: async () => ({ ok: true, body: fakeStream(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']) }) });
  assert.equal(r.models[0].status, 'failed');
  assert.equal(r.models[0].text, 'partial');
});
test('provider HTTP failures are sanitized by runner', async () => {
  const events = [];
  const r = await runComparison({ prompt: 'Confidential', mode: 'live', models: ['openai'], consent: true }, { env: live, fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'secret upstream debug dump' }), onEvent: e => events.push(e) });
  assert.equal(r.models[0].status, 'failed'); assert.equal(r.models[0].errorCode, 'PROVIDER_FAILURE');
  assert.equal(JSON.stringify(r).includes('secret upstream debug dump'), false);
  assert.equal(JSON.stringify(events).includes('Confidential'), false);
});
test('live consent and authentication are enforced before response stream starts', async () => {
  const makeResponse = () => ({ status: 0, headers: {}, payload: '', writableEnded: false, destroyed: false, handlers: {}, writeHead(code, headers) { this.status = code; this.headers = headers; return this; }, end(payload = '') { this.payload += payload; this.writableEnded = true; return this; }, write(x) { this.payload += x; }, on(ev, fn) { this.handlers[ev] = fn; }, off(ev) { delete this.handlers[ev]; } });
  const original = process.env.WORKBENCH_API_KEY;
  process.env.WORKBENCH_API_KEY = 'private-test-token';
  try {
    const denied = makeResponse(); await streamComparison({ req: { headers: {} }, res: denied, body: { prompt: 'x' }, env: demo }); assert.equal(denied.status, 401);
    const res = makeResponse(); await streamComparison({ req: { headers: { authorization: 'Bearer private-test-token' } }, res, body: { prompt: 'x', mode: 'live', models: ['openai'], consent: false }, env: live }); assert.equal(res.status, 400);
  } finally { original === undefined ? delete process.env.WORKBENCH_API_KEY : process.env.WORKBENCH_API_KEY = original; }
});
test('HTTP transport streams attributable event frames and terminal result', async () => {
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    await streamComparison({ req, res, body: JSON.parse(body), env: demo, clientKey: 'test-' + Date.now() });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/compare/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test', models: ['demo-analysis', 'demo-cautious'] }) });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const result = await response.text(); assert.match(result, /event: provider.delta/); assert.match(result, /event: run.completed/); assert.match(result, /"synthetic":true/);
    assert.ok(result.indexOf('provider.started') < result.indexOf('run.completed'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('wire framing does not interpolate raw model output into SSE protocol', () => {
  const frame = formatSSE({ id: 'test:1', type: 'provider.delta', text: 'hello\nevent: evil\n\n' });
  assert.equal(frame.match(/\nevent: /g).length, 1);
  assert.equal(JSON.parse(frame.split('data: ')[1]).text, 'hello\nevent: evil\n\n');
});
