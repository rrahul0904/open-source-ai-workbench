import { randomUUID } from 'node:crypto';
import { DEMO, validateRequest, getLiveSpec } from './registry.mjs';
import { createAdapters } from './adapters.mjs';

const DEMO_MAP = new Map(DEMO.map(x => [x.id, x]));
const MAX_PROVIDER_CHARS = 16_000;
const MAX_EVENTS = 3_000;

function nextOrAbort(iterator, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new Error('abort'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Public-facing metadata explicitly separates distinct outputs from independently verified evidence. */
export function summarize(records) {
  const completed = records.filter(r => r.status === 'completed');
  return {
    generated: false,
    eligible: completed.length >= 2,
    completedModels: completed.map(r => r.id),
    statement: completed.length >= 2
      ? `${completed.length} model outputs available for human comparison. Agreement is not independent factual verification.`
      : 'Fewer than two providers completed; cross-model comparison is unavailable.',
    verification: 'not-performed'
  };
}

/** Concurrent, isolated, bounded model comparison. Providers are injected in tests. */
export async function runComparison(input, options = {}) {
  const env = options.env || process.env;
  const request = validateRequest(input, env);
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs ?? (request.mode === 'demo' ? 8_000 : 35_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 50_000) throw Object.assign(new Error('Invalid timeoutMs'), { statusCode: 400 });
  const adapters = options.adapters || createAdapters({ mode: request.mode, env, fetchImpl: options.fetchImpl || fetch });
  const runId = options.runId || randomUUID();
  const began = now();
  const started = new Date().toISOString();
  const models = request.models.map(id => ({ id, provider: request.mode === 'demo' ? DEMO_MAP.get(id).provider : id, model: request.mode === 'demo' ? DEMO_MAP.get(id).model : getLiveSpec(id, env)?.model, mode: request.mode, status: 'pending', text: '', usage: null, elapsedMs: 0, errorCode: null }));
  const eventSink = options.onEvent || (() => {});
  let seq = 0, eventCount = 0;
  const emit = (type, modelId, payload = {}) => {
    // Capping deltas never discards a terminal summary: the final event reconciles full model texts.
    if (eventCount++ > MAX_EVENTS && type === 'provider.delta') return;
    eventSink({ id: `${runId}:${++seq}`, runId, type, modelId, ...payload });
  };
  emit('run.started', null, { mode: request.mode, models: request.models, started, synthetic: request.mode === 'demo' });
  await Promise.all(models.map(async record => {
    const since = now();
    const controller = new AbortController();
    const parent = () => controller.abort('cancelled');
    if (options.signal?.aborted) parent();
    else options.signal?.addEventListener('abort', parent, { once: true });
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    let iterator;
    try {
      record.status = 'running';
      emit('provider.started', record.id, { provider: record.provider, model: record.model, mode: record.mode });
      if (!adapters[record.id] || typeof adapters[record.id].stream !== 'function') throw new Error('missing adapter');
      iterator = adapters[record.id].stream({ prompt: request.prompt, signal: controller.signal, maxOutputTokens: 512 })[Symbol.asyncIterator]();
      while (true) {
        const { done, value } = await nextOrAbort(iterator, controller.signal);
        if (controller.signal.aborted) throw new Error('aborted');
        if (done) break;
        const delta = typeof value === 'string' ? value : value?.delta;
        if (typeof delta === 'string' && delta) {
          if (record.text.length + delta.length > MAX_PROVIDER_CHARS) throw new Error('output_limit');
          record.text += delta;
          emit('provider.delta', record.id, { text: delta });
        }
        if (value && typeof value === 'object' && value.usage) {
          // Provider-reported only; no unverified USD conversion or cross-provider billing inference.
          record.usage = value.usage;
          emit('provider.usage', record.id, { usage: value.usage });
        }
      }
      record.status = 'completed';
      emit('provider.completed', record.id, { chars: record.text.length });
    } catch (error) {
      const reason = controller.signal.reason;
      record.status = reason === 'timeout' ? 'timeout' : reason === 'cancelled' ? 'cancelled' : 'failed';
      record.errorCode = record.status === 'timeout' ? 'TIMEOUT' : record.status === 'cancelled' ? 'CANCELLED' : (error?.code === 'OUTPUT_LIMIT' || error?.message === 'output_limit' ? 'OUTPUT_LIMIT' : error?.code === 'PROVIDER_RATE_LIMIT' ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_FAILURE');
      // Never emit raw upstream errors or credentials.
      emit('provider.terminal', record.id, { status: record.status, errorCode: record.errorCode });
    } finally {
      record.elapsedMs = Math.max(0, now() - since);
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', parent);
      if (controller.signal.aborted && iterator?.return) Promise.resolve().then(() => iterator.return()).catch(() => {});
    }
  }));
  const synthesis = summarize(models);
  const result = { runId, mode: request.mode, synthetic: request.mode === 'demo', started, elapsedMs: Math.max(0, now() - began), models, synthesis, costs: { usd: null, note: 'Provider token counts are informational; monetary billing is not enabled.' } };
  emit('run.completed', null, { result });
  return result;
}
