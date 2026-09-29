import { authorize, rateLimit, safeJsonSize } from '../security.mjs';
import { catalog, validateRequest } from './registry.mjs';
import { runComparison } from './service.mjs';

/** HTTP response deliberately uses incremental SSE through the same code on local Node and Vercel. */
export function catalogResponse(headers = {}, env = process.env) {
  if (!authorize(headers).ok) return { status: 401, body: { error: 'Unauthorized' } };
  return { status: 200, body: catalog(env) };
}

export function formatSSE(event) { return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`; }

export async function streamComparison({ req, res, body, env = process.env, clientKey = 'anonymous', runner = runComparison } = {}) {
  if (!authorize(req.headers || {}).ok) return res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'Unauthorized' }));
  // Existing lightweight per-instance demo protection is not a distributed SaaS quota.
  if (!rateLimit(`compare:${clientKey}`, 12, 60_000).ok) return res.writeHead(429, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'Too many comparison requests' }));
  if (!safeJsonSize(body)) return res.writeHead(413, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: 'Request too large' }));
  let input;
  try { input = validateRequest(body, env); }
  catch (error) { return res.writeHead(error.statusCode || 400, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: error.message })); }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no', connection: 'keep-alive' });
  res.flushHeaders?.();
  const controller = new AbortController();
  const close = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', close);
  try {
    res.write(': connected\n\n');
    await runner(input, { env, signal: controller.signal, onEvent: event => {
      if (res.destroyed || controller.signal.aborted) return;
      try { res.write(formatSSE(event)); } catch { controller.abort(); }
    }});
    if (!res.destroyed && !res.writableEnded) res.end();
  } catch {
    if (!res.destroyed && !res.writableEnded) {
      res.write('event: error\ndata: {"error":"Comparison could not be completed"}\n\n');
      res.end();
    }
  } finally { res.off('close', close); }
}
