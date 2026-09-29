import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_MODELS, createDemoAdapters, validateComparison, compareDemo } from '../src/model-compare.mjs';

const prompt = 'Plan an original model comparison tool';

test('all four deterministic adapters run concurrently and yield attributable monotonic events', async () => {
  const seen = [];
  const run = await compareDemo({ prompt }, { runId: 'test-run', onEvent: (event) => seen.push(event) });
  assert.equal(run.providerDispatch, 'none');
  assert.equal(run.mode, 'deterministic-demo');
  assert.equal(run.transport, 'snapshot');
  assert.equal(run.models.length, 4);
  assert.deepEqual(run.models.map((x) => x.status), Array(4).fill('completed'));
  assert.ok(run.models.every((x) => x.text.includes('synthetic:')));
  assert.deepEqual(seen, run.events);
  assert.deepEqual(run.events.map((e, i) => e.eventId), run.events.map((_, i) => `test-run:${i + 1}`));
  const starts = run.events.filter((e) => e.type === 'provider.started');
  const firstCompletion = run.events.findIndex((e) => e.type === 'provider.completed');
  assert.equal(starts.length, 4);
  assert.ok(starts.every((e) => run.events.indexOf(e) < firstCompletion));
  assert.equal(run.synthesis.eligibility, 'eligible');
  assert.equal(run.synthesis.generated, false);
  const rerun = await compareDemo({ prompt }, { runId: 'another-run' });
  assert.deepEqual(rerun.models.map((m) => m.text), run.models.map((m) => m.text));
});

test('model selection is an exact registry subset with no duplicates or unknown providers', async () => {
  assert.equal(DEMO_MODELS.length, 4);
  assert.deepEqual(validateComparison({ prompt, models: ['demo-creative'] }).models, ['demo-creative']);
  for (const input of [{ prompt: '' }, { prompt: 'x'.repeat(4001) }, { prompt, models: [] },
    { prompt, models: ['demo-analysis', 'demo-analysis'] }, { prompt, models: ['unknown'] },
    { prompt, models: 'demo-analysis' }]) {
    assert.throws(() => validateComparison(input), { statusCode: 400 });
  }
});

test('one adapter failure retains independent successful results and any partial delta', async () => {
  const adapters = createDemoAdapters();
  adapters['demo-creative'] = { async *stream() { yield 'partial'; throw new Error('secret: do not disclose'); } };
  const run = await compareDemo({ prompt }, { adapters });
  const failed = run.models.find((m) => m.id === 'demo-creative');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.text, 'partial');
  assert.equal(failed.error, 'Demo adapter failed');
  assert.equal(run.models.filter((m) => m.status === 'completed').length, 3);
  assert.ok(!JSON.stringify(run).includes('secret:'));
  assert.equal(run.synthesis.eligibility, 'eligible');
});

test('parent cancellation terminates every provider without waiting on hung iterator', async () => {
  const controller = new AbortController();
  const adapters = Object.fromEntries(DEMO_MODELS.map(({ id }) => [id, {
    async *stream() { yield 'partial'; await new Promise(() => {}); }
  }]));
  const run = await compareDemo({ prompt }, {
    adapters, signal: controller.signal,
    onEvent: (event) => { if (event.type === 'provider.delta') controller.abort(); }
  });
  assert.equal(run.models.filter((m) => m.status === 'cancelled').length, 4);
  assert.equal(run.synthesis.eligibility, 'insufficient-completed-providers');
});

test('coordinator enforces deadlines even if an injected adapter ignores the abort signal', async () => {
  const adapters = createDemoAdapters();
  adapters['demo-analysis'] = { async *stream() { await new Promise(() => {}); } };
  const run = await compareDemo({ prompt, models: ['demo-analysis'] }, { adapters, timeoutMs: 10 });
  assert.equal(run.models[0].status, 'timeout');
  assert.equal(run.synthesis.eligibility, 'insufficient-completed-providers');
});

test('single completed provider does not claim synthesis or evidence verification', async () => {
  const run = await compareDemo({ prompt, models: ['demo-cautious'] });
  assert.equal(run.models[0].status, 'completed');
  assert.equal(run.synthesis.eligibility, 'insufficient-completed-providers');
  assert.equal(run.synthesis.generated, false);
});
