/** Process-local SSE API for original synthetic comparison; not a provider gateway. */
import { DEMO_MODELS } from './model-compare.mjs';
import { createMockComparisonSessions } from './model-compare-sessions.mjs';
import { authorize, rateLimit } from './security.mjs';

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function frame(event) {
  return `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
function cursorFor(runId, value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'string' || !value.startsWith(runId + ':')) return null;
  const suffix = value.slice(runId.length + 1);
  if (!/^[1-9][0-9]*$/.test(suffix)) return null;
  const cursor = Number(suffix);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

export function createMockComparisonHttp({
  sessions = createMockComparisonSessions()
} = {}) {
  return async function handleMockComparison(req, res, url, body = null) {
    if (!url.pathname.startsWith('/api/compare/')) return false;
    // Same authorization boundary as the existing JSON API. No cross-origin SSE.
    if (!authorize(req.headers).ok) {
      json(res, 401, { error: 'Unauthorized' }); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/compare/catalog') {
      json(res, 200, { mode: 'synthetic-only', models: DEMO_MODELS,
        note: 'Deterministic demo adapters. No external AI provider traffic.' });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/compare/runs') {
      if (!rateLimit(req.socket.remoteAddress || 'local').ok) {
        json(res, 429, { error: 'Rate limit exceeded' }); return true;
      }
      try {
        const session = sessions.start(body);
        json(res, 201, { runId: session.id, mode: 'synthetic-only',
          eventsUrl: `/api/compare/runs/${session.id}/events`,
          cancelUrl: `/api/compare/runs/${session.id}` });
      } catch (error) {
        json(res, error.statusCode || 500, {
          error: error.statusCode ? error.message : 'Synthetic comparison unavailable'
        });
      }
      return true;
    }
    const match = /^\/api\/compare\/runs\/([0-9a-f-]{36})(\/events)?$/.exec(url.pathname);
    if (!match) { json(res, 404, { error: 'Not found' }); return true; }
    const [, id, eventsPath] = match;
    const session = sessions.get(id);
    if (!session) { json(res, 404, { error: 'Run not found or expired' }); return true; }
    if (req.method === 'DELETE' && !eventsPath) {
      const changed = sessions.cancel(id);
      json(res, changed.finished ? 200 : 202, {
        runId: id, status: changed.finished ? changed.status : 'cancelling'
      });
      return true;
    }
    if (req.method !== 'GET' || !eventsPath) {
      json(res, 405, { error: 'Method not allowed' }); return true;
    }
    const cursor = cursorFor(id, req.headers['last-event-id'] || url.searchParams.get('lastEventId'));
    if (cursor === null || cursor > session.events.length) {
      json(res, 400, { error: 'Invalid replay cursor' }); return true;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform', 'connection': 'keep-alive',
      'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' });
    res.flushHeaders?.();
    res.write(': synthetic comparison stream\n\n');
    // Replay and subscribe synchronously, with no await gap. Closing the socket
    // unsubscribes but does NOT abort the session, allowing Last-Event-ID replay.
    for (const event of session.events.slice(cursor)) res.write(frame(event));
    if (session.finished) { res.end(); return true; }
    const subscriber = {
      event: (event) => { if (!res.destroyed && !res.writableEnded) res.write(frame(event)); },
      finish: () => { if (!res.destroyed && !res.writableEnded) res.end(); }
    };
    session.subscribers.add(subscriber);
    const heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
    }, 15_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      session.subscribers.delete(subscriber);
    });
    return true;
  };
}
