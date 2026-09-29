/** RE-334: original fake-provider comparison engine. No third-party API calls or persistence. */
import { createHash, randomUUID } from 'node:crypto';

export const DEMO_MODELS = Object.freeze([
  { id: 'demo-analysis', provider: 'Demo adapter A', model: 'analysis-v1', capabilities: ['text'], mode: 'synthetic' },
  { id: 'demo-creative', provider: 'Demo adapter B', model: 'creative-v1', capabilities: ['text'], mode: 'synthetic' },
  { id: 'demo-structured', provider: 'Demo adapter C', model: 'structured-v1', capabilities: ['text'], mode: 'synthetic' },
  { id: 'demo-cautious', provider: 'Demo adapter D', model: 'cautious-v1', capabilities: ['text'], mode: 'synthetic' }
]);

const SPECS = new Map(DEMO_MODELS.map((spec) => [spec.id, spec]));
const MAX_PROMPT_CHARS = 4_000;

export function validateComparison({ prompt, models = DEMO_MODELS.map(({ id }) => id) } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    throw Object.assign(new Error(`prompt must be 1-${MAX_PROMPT_CHARS} characters`), { statusCode: 400 });
  }
  if (!Array.isArray(models) || models.length < 1 || models.length > DEMO_MODELS.length ||
      models.some((id) => typeof id !== 'string' || !SPECS.has(id)) || new Set(models).size !== models.length) {
    throw Object.assign(new Error('models must be a unique non-empty subset of the demo registry'), { statusCode: 400 });
  }
  return { prompt: prompt.trim(), models: [...models] };
}

function textFor(id, prompt) {
  const fingerprint = createHash('sha256').update(`${id}\u0000${prompt}`).digest('hex').slice(0, 8);
  const input = prompt.replace(/\s+/g, ' ').slice(0, 140);
  const samples = {
    'demo-analysis': `Analysis lens: clarify the assumptions in “${input}”. List measurable acceptance criteria.`,
    'demo-creative': `Creative lens: for “${input}”, explore an alternative approach and identify its tradeoffs.`,
    'demo-structured': `Structured lens: for “${input}”, outline inputs, dependencies, milestones and tests.`,
    'demo-cautious': `Cautious lens: for “${input}”, flag uncertainty and validate facts against independent evidence.`
  };
  return `${samples[id]} [synthetic:${fingerprint}]`;
}

export function createDemoAdapters() {
  return Object.fromEntries(DEMO_MODELS.map(({ id }) => [id, {
    async *stream({ prompt, signal }) {
      const full = textFor(id, prompt);
      const split = Math.ceil(full.length / 3);
      for (let i = 0; i < full.length; i += split) {
        if (signal?.aborted) throw signal.reason ?? new Error('aborted');
        await Promise.resolve();
        yield full.slice(i, i + split);
      }
    }
  }]));
}

/** Fail closed even when a custom adapter is uncooperative during iterator.next(). */
function nextOrAbort(iterator, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * Dispatch fake providers concurrently, recording events as they occur. onEvent is synchronous
 * and may be used by a future SSE transport; this Phase-1 HTTP endpoint returns a snapshot.
 * Injectable adapters and clock make the event/status behavior independently testable.
 */
export async function compareDemo(input, {
  adapters = createDemoAdapters(),
  signal,
  timeoutMs = 5_000,
  onEvent = () => {},
  runId = randomUUID(),
  now = () => Date.now()
} = {}) {
  const request = validateComparison(input);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw Object.assign(new Error('timeoutMs must be between 1 and 30000'), { statusCode: 400 });
  }
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
  const started = now();
  const events = [];
  const records = Object.fromEntries(request.models.map((id) => [id, {
    id, provider: SPECS.get(id).provider, model: SPECS.get(id).model,
    mode: 'synthetic', status: 'pending', text: '', elapsedMs: null, error: null
  }]));
  let sequence = 0;
  const emit = (type, modelId, detail = {}) => {
    const event = Object.freeze({ eventId: `${runId}:${++sequence}`, runId, type, modelId, ...detail });
    events.push(event);
    onEvent(event);
  };
  emit('run.started', null, { models: request.models });

  await Promise.all(request.models.map(async (id) => {
    const record = records[id];
    const startedModel = now();
    const controller = new AbortController();
    const abortFromParent = () => controller.abort({ kind: 'cancelled' });
    if (signal?.aborted) abortFromParent();
    else signal?.addEventListener('abort', abortFromParent, { once: true });
    const timer = setTimeout(() => controller.abort({ kind: 'timeout' }), timeoutMs);
    let iterator;
    try {
      record.status = 'running';
      emit('provider.started', id, { provider: record.provider, model: record.model, mode: record.mode });
      const adapter = adapters[id];
      if (!adapter || typeof adapter.stream !== 'function') throw new Error('missing demo adapter');
      iterator = adapter.stream({ prompt: request.prompt, signal: controller.signal })[Symbol.asyncIterator]();
      while (true) {
        const { value, done } = await nextOrAbort(iterator, controller.signal);
        if (controller.signal.aborted) throw controller.signal.reason;
        if (done) break;
        if (typeof value !== 'string') throw new Error('adapter emitted non-string delta');
        record.text += value;
        emit('provider.delta', id, { text: value });
      }
      record.status = 'completed';
      emit('provider.completed', id, { chars: record.text.length });
    } catch (error) {
      const reason = controller.signal.reason?.kind;
      record.status = reason === 'timeout' ? 'timeout' : reason === 'cancelled' ? 'cancelled' : 'failed';
      record.error = record.status === 'failed' ? 'Demo adapter failed' : (reason === 'timeout' ? 'Demo adapter timed out' : 'Run cancelled');
      // Never expose raw adapter exceptions or prompts in events or server logs.
      emit('provider.terminal', id, { status: record.status, error: record.error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromParent);
      // No awaiting an uncooperative iterator's return(): abort already releases the coordinator.
      if (controller.signal.aborted && iterator?.return) Promise.resolve().then(() => iterator.return()).catch(() => {});
      record.elapsedMs = Math.max(0, now() - startedModel);
    }
  }));
  const completedCount = Object.values(records).filter((r) => r.status === 'completed').length;
  const eligibility = completedCount >= 2 ? 'eligible' : 'insufficient-completed-providers';
  emit('run.completed', null, { completedCount, synthesisEligibility: eligibility });
  return {
    runId, mode: 'deterministic-demo', transport: 'snapshot',
    providerDispatch: 'none', // No external AI provider traffic.
    elapsedMs: Math.max(0, now() - started),
    models: request.models.map((id) => records[id]),
    synthesis: { eligibility, generated: false, note: 'Phase 1 does not generate a synthesis or assert factual agreement.' },
    events
  };
}
