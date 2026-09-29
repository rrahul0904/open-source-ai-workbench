/** RE-334 P2: bounded, process-local, synthetic comparison sessions only. */
import { randomUUID } from 'node:crypto';
import { compareDemo, validateComparison } from './model-compare.mjs';

export function createMockComparisonSessions({
  execute = compareDemo, adapters, timeoutMs = 5_000,
  ttlMs = 300_000, maxSessions = 32, maxActive = 8
} = {}) {
  const sessions = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.finished && session.finishedAt + ttlMs <= now) sessions.delete(id);
    }
  };

  function start(input) {
    // Validation happens before allocating a session; provider names can only be demo IDs.
    const request = validateComparison(input);
    prune();
    if (sessions.size >= maxSessions ||
        [...sessions.values()].filter((session) => !session.finished).length >= maxActive) {
      throw Object.assign(new Error('Synthetic comparison capacity reached'), { statusCode: 503 });
    }
    const id = randomUUID();
    const controller = new AbortController();
    const session = {
      id, events: [], subscribers: new Set(), controller,
      finished: false, finishedAt: null, status: 'running', done: null
    };
    sessions.set(id, session);
    const publish = (event) => {
      // The built-in demo produces at most 22 events. Abort a misbehaving injected
      // adapter instead of retaining an unbounded event history.
      if (session.events.length >= 128) {
        controller.abort({ kind: 'cancelled' });
        return;
      }
      session.events.push(event);
      for (const subscriber of session.subscribers) subscriber.event(event);
    };
    session.done = Promise.resolve().then(() => execute(request, {
      runId: id, signal: controller.signal, onEvent: publish, timeoutMs,
      ...(adapters ? { adapters } : {})
    })).then(() => { session.status = 'completed'; }, () => {
      // Never send raw exception messages, prompts or adapter details to clients.
      session.status = 'failed';
      publish({ runId: id, eventId: `${id}:${session.events.length + 1}`,
        type: 'run.failed', modelId: null, error: 'Synthetic comparison unavailable' });
    }).finally(() => {
      session.finished = true;
      session.finishedAt = Date.now();
      for (const subscriber of session.subscribers) subscriber.finish();
      session.subscribers.clear();
    });
    return session;
  }

  function get(id) {
    prune();
    return sessions.get(id) || null;
  }

  function cancel(id) {
    const session = get(id);
    if (!session) return null;
    if (!session.finished) {
      session.status = 'cancelling';
      session.controller.abort({ kind: 'cancelled' });
    }
    return session;
  }

  return { start, get, cancel };
}
