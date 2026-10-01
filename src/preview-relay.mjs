import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
const PUBLIC_CONTROL_ALLOW = new Set(['/__preview/widget.js', '/__preview/feedback']);

function token(size = 24) {
  return randomBytes(size).toString('base64url');
}

function bearer(headers = {}) {
  const raw = String(headers.authorization || '');
  return raw.startsWith('Bearer ') ? raw.slice(7) : '';
}

function equalSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Relay request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function filteredHeaders(headers = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower.startsWith('x-forwarded-')) continue;
    out[lower] = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
  }
  return out;
}

function filteredResponseHeaders(headers = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    out[lower] = String(raw ?? '');
  }
  return out;
}

function sessionPublicView(session) {
  return {
    sessionId: session.id,
    slug: session.slug,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    state: session.closed ? 'closed' : 'active'
  };
}

export function createPreviewRelay({
  operatorKey,
  defaultTtlMs = 15 * 60_000,
  maxTtlMs = 60 * 60_000,
  maxPendingPerSession = 24,
  maxBodyBytes = 512_000,
  requestTimeoutMs = 30_000,
  pollTimeoutMs = 20_000,
  nowMs = () => Date.now(),
  idFactory = () => randomUUID(),
  tokenFactory = token
} = {}) {
  if (!operatorKey || String(operatorKey).length < 8) throw new TypeError('operatorKey of at least 8 characters is required');
  const sessions = new Map();
  const slugs = new Map();
  let server;

  function expire(session, reason = 'expired') {
    if (!session || session.closed) return;
    session.closed = true;
    sessions.delete(session.id);
    slugs.delete(session.slug);
    if (session.pollWaiter) {
      clearTimeout(session.pollWaiter.timer);
      session.pollWaiter.resolve(null);
      session.pollWaiter = null;
    }
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error(`Tunnel session ${reason}`), { statusCode: 410 }));
    }
    session.pending.clear();
    session.queue.length = 0;
  }

  function activeSession(id) {
    const session = sessions.get(id);
    if (!session) return null;
    if (session.expiresAtMs <= nowMs()) {
      expire(session);
      return null;
    }
    return session;
  }

  function bySlug(slug) {
    const id = slugs.get(slug);
    return id ? activeSession(id) : null;
  }

  function authorizedOperator(req) {
    return equalSecret(bearer(req.headers), operatorKey);
  }

  function authorizedAgent(req, session) {
    return Boolean(session) && equalSecret(bearer(req.headers), session.agentToken);
  }

  function deliver(session, request) {
    if (session.pollWaiter) {
      const waiter = session.pollWaiter;
      session.pollWaiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve(request);
    } else {
      session.queue.push(request);
    }
  }

  async function poll(session) {
    if (session.queue.length) return session.queue.shift();
    if (session.pollWaiter) throw Object.assign(new Error('Only one agent poll may be outstanding per session'), { statusCode: 409 });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (session.pollWaiter?.timer === timer) session.pollWaiter = null;
        resolve(null);
      }, pollTimeoutMs);
      session.pollWaiter = { resolve, timer };
    });
  }

  async function handleControl(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/__relay/sessions') {
      if (!authorizedOperator(req)) { json(res, 401, { error: 'Unauthorized' }); return true; }
      const body = await readBody(req, 32_000);
      let input = {};
      if (body.length) {
        try { input = JSON.parse(body.toString('utf8')); }
        catch { json(res, 400, { error: 'Invalid JSON' }); return true; }
      }
      const requestedTtl = Number(input.ttlMs ?? defaultTtlMs);
      if (!Number.isFinite(requestedTtl) || requestedTtl < 1_000 || requestedTtl > maxTtlMs) {
        json(res, 400, { error: `ttlMs must be between 1000 and ${maxTtlMs}` });
        return true;
      }
      let slug;
      do slug = tokenFactory(9); while (slugs.has(slug));
      const created = nowMs();
      const session = {
        id: idFactory(),
        slug,
        agentToken: tokenFactory(24),
        createdAt: new Date(created).toISOString(),
        expiresAt: new Date(created + requestedTtl).toISOString(),
        expiresAtMs: created + requestedTtl,
        queue: [],
        pending: new Map(),
        pollWaiter: null,
        closed: false
      };
      sessions.set(session.id, session);
      slugs.set(session.slug, session.id);
      json(res, 201, { ...sessionPublicView(session), agentToken: session.agentToken, publicPath: `/t/${session.slug}` });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/__relay/status') {
      if (!authorizedOperator(req)) { json(res, 401, { error: 'Unauthorized' }); return true; }
      for (const session of [...sessions.values()]) activeSession(session.id);
      json(res, 200, { ok: true, activeSessions: sessions.size, sessions: [...sessions.values()].map(sessionPublicView) });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/__relay/agent/poll') {
      const session = activeSession(url.searchParams.get('session'));
      if (!authorizedAgent(req, session)) { json(res, 401, { error: 'Unauthorized' }); return true; }
      const request = await poll(session);
      if (!request) { res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return true; }
      json(res, 200, { request });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/__relay/agent/respond') {
      const session = activeSession(url.searchParams.get('session'));
      if (!authorizedAgent(req, session)) { json(res, 401, { error: 'Unauthorized' }); return true; }
      const body = await readBody(req, maxBodyBytes * 2);
      let input;
      try { input = JSON.parse(body.toString('utf8')); }
      catch { json(res, 400, { error: 'Invalid JSON' }); return true; }
      const pending = session.pending.get(String(input.requestId || ''));
      if (!pending) { json(res, 404, { error: 'Unknown or expired request' }); return true; }
      const responseBody = Buffer.from(String(input.bodyBase64 || ''), 'base64');
      if (responseBody.length > maxBodyBytes) { json(res, 413, { error: 'Relay response body too large' }); return true; }
      const status = Number(input.status);
      if (!Number.isInteger(status) || status < 100 || status > 599) { json(res, 400, { error: 'Invalid response status' }); return true; }
      clearTimeout(pending.timer);
      session.pending.delete(String(input.requestId));
      pending.resolve({ status, headers: filteredResponseHeaders(input.headers || {}), body: responseBody });
      json(res, 202, { ok: true });
      return true;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/__relay/sessions/')) {
      const id = decodeURIComponent(url.pathname.slice('/__relay/sessions/'.length));
      const session = activeSession(id);
      if (!session) { json(res, 404, { error: 'Unknown session' }); return true; }
      if (!authorizedOperator(req) && !authorizedAgent(req, session)) { json(res, 401, { error: 'Unauthorized' }); return true; }
      expire(session, 'closed');
      json(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  async function handlePublic(req, res, url) {
    const match = url.pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
    if (!match) return false;
    const session = bySlug(match[1]);
    if (!session) { json(res, 410, { error: 'Tunnel session is unavailable or expired' }); return true; }
    const path = match[2] || '/';
    if (path.startsWith('/__preview/') && !PUBLIC_CONTROL_ALLOW.has(path)) {
      json(res, 404, { error: 'Preview control endpoint is not public' });
      return true;
    }
    if (session.pending.size + session.queue.length >= maxPendingPerSession) {
      json(res, 429, { error: 'Tunnel session is busy' });
      return true;
    }
    const body = await readBody(req, maxBodyBytes);
    const requestId = idFactory();
    const request = {
      id: requestId,
      method: String(req.method || 'GET').toUpperCase(),
      path: `${path}${url.search}`,
      headers: filteredHeaders(req.headers),
      bodyBase64: body.toString('base64')
    };
    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(requestId);
        reject(Object.assign(new Error('Tunnel agent response timed out'), { statusCode: 504 }));
      }, requestTimeoutMs);
      session.pending.set(requestId, { resolve, reject, timer });
    });
    deliver(session, request);
    const response = await responsePromise;
    res.writeHead(response.status, response.headers);
    res.end(response.body);
    return true;
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://relay.local');
      if (url.pathname.startsWith('/__relay/') && await handleControl(req, res, url)) return;
      if (await handlePublic(req, res, url)) return;
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      json(res, error.statusCode || 500, { error: error.message || 'Relay failure' });
    }
  }

  return {
    async listen({ port = 0, host = '127.0.0.1' } = {}) {
      if (server) throw new Error('Relay is already listening');
      server = http.createServer(handler);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      for (const session of [...sessions.values()]) expire(session, 'relay-stopped');
      if (!server) return;
      const active = server;
      server = undefined;
      await new Promise((resolve, reject) => active.close((error) => error ? reject(error) : resolve()));
    }
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let parsed = {};
  if (text) {
    try { parsed = JSON.parse(text); }
    catch { throw new Error(`Relay returned non-JSON status ${response.status}`); }
  }
  if (!response.ok) throw Object.assign(new Error(parsed.error || `Relay returned ${response.status}`), { statusCode: response.status });
  return parsed;
}

export function createTunnelAgent({ relayUrl, operatorKey, previewUrl, ttlMs = 15 * 60_000, pollDelayMs = 25 } = {}) {
  if (!relayUrl || !operatorKey || !previewUrl) throw new TypeError('relayUrl, operatorKey and previewUrl are required');
  const relay = new URL(relayUrl);
  const preview = new URL(previewUrl);
  let session;

  async function register() {
    if (session) return session;
    const response = await fetch(new URL('/__relay/sessions', relay), {
      method: 'POST',
      headers: { authorization: `Bearer ${operatorKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttlMs })
    });
    const data = await parseJsonResponse(response);
    session = { ...data, publicUrl: new URL(data.publicPath, relay).toString().replace(/\/$/, '') };
    return session;
  }

  async function pollOnce() {
    if (!session) await register();
    const pollUrl = new URL('/__relay/agent/poll', relay);
    pollUrl.searchParams.set('session', session.sessionId);
    const response = await fetch(pollUrl, { headers: { authorization: `Bearer ${session.agentToken}` } });
    if (response.status === 204) return false;
    const { request } = await parseJsonResponse(response);
    const target = new URL(request.path, `${preview.origin}/`);
    const body = Buffer.from(request.bodyBase64 || '', 'base64');
    const headers = new Headers(request.headers || {});
    headers.delete('host');
    headers.delete('content-length');
    let localResponse;
    try {
      localResponse = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) || !body.length ? undefined : body,
        redirect: 'manual'
      });
      const responseBody = Buffer.from(await localResponse.arrayBuffer());
      const responseHeaders = {};
      localResponse.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) responseHeaders[key] = value;
      });
      const respondUrl = new URL('/__relay/agent/respond', relay);
      respondUrl.searchParams.set('session', session.sessionId);
      const ack = await fetch(respondUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.agentToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, status: localResponse.status, headers: responseHeaders, bodyBase64: responseBody.toString('base64') })
      });
      await parseJsonResponse(ack);
    } catch {
      const respondUrl = new URL('/__relay/agent/respond', relay);
      respondUrl.searchParams.set('session', session.sessionId);
      const bodyBuffer = Buffer.from(JSON.stringify({ error: 'Local preview unavailable' }));
      await fetch(respondUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.agentToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: request.id, status: 502, headers: { 'content-type': 'application/json; charset=utf-8' }, bodyBase64: bodyBuffer.toString('base64') })
      });
    }
    return true;
  }

  async function run({ signal } = {}) {
    await register();
    while (!signal?.aborted) {
      try { await pollOnce(); }
      catch (error) {
        if (signal?.aborted) break;
        if ([401, 404, 410].includes(error.statusCode)) throw error;
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      }
    }
  }

  async function close() {
    if (!session) return;
    const url = new URL(`/__relay/sessions/${encodeURIComponent(session.sessionId)}`, relay);
    await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${session.agentToken}` } });
    session = undefined;
  }

  return { register, pollOnce, run, close, get session() { return session; } };
}
