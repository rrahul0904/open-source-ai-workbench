import http from 'node:http';
import { randomUUID } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization']);
const CONTROL_PREFIX = '/__preview';

function isLoopbackHostname(hostname) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return value === 'localhost' || value === '::1' || value.startsWith('127.');
}

function safeUpstreamTarget(origin, requestPath) {
  const sentinel = new URL('http://preview-request.invalid/');
  let parsed;
  try {
    parsed = new URL(String(requestPath || '/'), sentinel);
  } catch {
    throw Object.assign(new Error('Invalid preview request target'), { statusCode: 400 });
  }
  if (parsed.origin !== sentinel.origin) {
    throw Object.assign(new Error('Absolute and scheme-relative preview targets are not allowed'), { statusCode: 400 });
  }
  const target = new URL(origin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = '';
  return target;
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') throw new TypeError('Mutation allowlist rules must be objects');
  const method = String(rule.method || '').toUpperCase();
  const path = String(rule.path || '');
  if (!method || !path.startsWith('/')) throw new TypeError('Mutation allowlist rules require method and absolute path');
  if (SAFE_METHODS.has(method)) throw new TypeError('Mutation allowlist rules are only for non-read methods');
  return Object.freeze({ method, path });
}

export function createDemoPolicy({ allowedMutations = [] } = {}) {
  const rules = Object.freeze(allowedMutations.map(normalizeRule));
  return Object.freeze({
    rules,
    evaluate(method, path) {
      const normalizedMethod = String(method || 'GET').toUpperCase();
      if (SAFE_METHODS.has(normalizedMethod)) return { allowed: true, reason: 'read-method' };
      const allowed = rules.some((rule) => rule.method === normalizedMethod && rule.path === path);
      return allowed ? { allowed: true, reason: 'explicit-mutation-allowlist' } : { allowed: false, reason: 'demo-policy-deny-write' };
    }
  });
}

export function redactHeaders(headers = {}) {
  const result = {};
  const entries = typeof headers.entries === 'function' ? headers.entries() : Object.entries(headers);
  for (const [key, raw] of entries) {
    const lower = String(key).toLowerCase();
    if (SENSITIVE_HEADERS.has(lower)) {
      result[lower] = '[REDACTED]';
      continue;
    }
    result[lower] = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
  }
  return result;
}

function headersForReplay(headers = {}) {
  const result = {};
  for (const [key, raw] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower) || HOP_BY_HOP.has(lower)) continue;
    result[lower] = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
  }
  return result;
}

function headersForUpstream(headers = {}) {
  const result = new Headers();
  for (const [key, raw] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) result.append(key, value);
    } else if (raw !== undefined) {
      result.set(key, String(raw));
    }
  }
  return result;
}

function responseHeaders(response) {
  const result = {};
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) result[key] = value;
  });
  return result;
}

function cacheableHeaders(headers) {
  const result = { ...headers };
  delete result['set-cookie'];
  delete result['content-length'];
  delete result.date;
  return result;
}

function appendBounded(array, value, limit) {
  array.push(value);
  if (array.length > limit) array.splice(0, array.length - limit);
}

async function readRequestBody(req, maxBytes) {
  if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Preview request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readResponseBody(response, maxBytes) {
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) throw Object.assign(new Error('Upstream response too large for preview runtime'), { statusCode: 502 });
  return data;
}

function writeResponse(res, status, headers, body) {
  const outgoing = { ...headers };
  delete outgoing['content-length'];
  delete outgoing['transfer-encoding'];
  res.writeHead(status, outgoing);
  if (body && body.length) res.end(body);
  else res.end();
}

function jsonResponse(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  writeResponse(res, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders }, body);
}

export function injectFeedbackWidget(html) {
  if (html.includes('data-agent-preview-feedback')) return html;
  const tag = '<script src="/__preview/widget.js" data-agent-preview-feedback defer></script>';
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${tag}</body>`) : `${html}${tag}`;
}

const WIDGET_JS = `(() => {
  if (document.querySelector('[data-agent-preview-feedback-button]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Feedback';
  button.setAttribute('data-agent-preview-feedback-button', '');
  Object.assign(button.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647', padding: '9px 13px', borderRadius: '999px', border: '1px solid #777', background: '#fff', color: '#111', font: '13px system-ui', boxShadow: '0 2px 10px rgba(0,0,0,.16)', cursor: 'pointer' });
  button.addEventListener('click', async () => {
    const message = window.prompt('Preview feedback');
    if (!message) return;
    try {
      const response = await fetch('/__preview/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, path: location.pathname + location.search }) });
      if (!response.ok) throw new Error('feedback rejected');
      button.textContent = 'Sent';
      setTimeout(() => { button.textContent = 'Feedback'; }, 1200);
    } catch { button.textContent = 'Retry'; }
  });
  document.body.appendChild(button);
})();`;

export function createPreviewRuntime({
  upstream,
  demo = true,
  freeze = true,
  injectWidget = true,
  allowedMutations = [],
  captureLimit = 100,
  feedbackLimit = 100,
  maxRequestBytes = 256_000,
  maxResponseBytes = 2_000_000,
  maxFrozenEntries = 20,
  captureBodies = false,
  mutationReplayEnabled = false,
  allowRemoteUpstream = false,
  now = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  if (!upstream) throw new TypeError('upstream is required');
  const upstreamUrl = new URL(upstream);
  if (!['http:', 'https:'].includes(upstreamUrl.protocol)) throw new TypeError('upstream must use http or https');
  if (upstreamUrl.username || upstreamUrl.password) throw new TypeError('upstream credentials are not allowed in the URL');
  if (!allowRemoteUpstream && !isLoopbackHostname(upstreamUrl.hostname)) throw new Error('Phase A preview upstream must be loopback-only');
  if (!Number.isInteger(captureLimit) || captureLimit < 1) throw new TypeError('captureLimit must be a positive integer');

  const policy = createDemoPolicy({ allowedMutations });
  const requests = [];
  const feedback = [];
  const frozen = new Map();
  const replayBodies = new Map();
  const replayHeaders = new Map();
  let server;

  function cacheSet(key, value) {
    if (frozen.has(key)) frozen.delete(key);
    frozen.set(key, value);
    while (frozen.size > maxFrozenEntries) frozen.delete(frozen.keys().next().value);
  }

  function record({ id = idFactory(), method, path, decision, reason, requestHeaders, bodyBytes = 0, responseStatus, upstreamStatus = null, frozenResponse = false }) {
    const receipt = Object.freeze({
      id,
      at: now(),
      method,
      path,
      decision,
      reason,
      requestHeaders: redactHeaders(requestHeaders),
      bodyBytes,
      responseStatus,
      upstreamStatus,
      frozenResponse,
      replayable: SAFE_METHODS.has(method) || mutationReplayEnabled
    });
    appendBounded(requests, receipt, captureLimit);
    return receipt;
  }

  async function fetchUpstream(method, requestPath, headers, body) {
    const target = safeUpstreamTarget(upstreamUrl.origin, requestPath);
    const init = { method, headers: headersForUpstream(headers), redirect: 'manual' };
    if (!SAFE_METHODS.has(method) && body?.length) init.body = body;
    const response = await fetch(target, init);
    return { status: response.status, headers: responseHeaders(response), body: await readResponseBody(response, maxResponseBytes) };
  }

  function prepareHtml(result) {
    const contentType = String(result.headers['content-type'] || '').toLowerCase();
    if (!injectWidget || !contentType.includes('text/html') || result.headers['content-encoding']) return result;
    const body = Buffer.from(injectFeedbackWidget(result.body.toString('utf8')));
    return { ...result, headers: { ...result.headers, 'content-length': undefined }, body };
  }

  async function replay(id, { allowMutation = false } = {}) {
    const receipt = requests.find((item) => item.id === id);
    if (!receipt) throw Object.assign(new Error('Unknown preview request receipt'), { statusCode: 404 });
    const safe = SAFE_METHODS.has(receipt.method);
    if (!safe && (!allowMutation || !mutationReplayEnabled)) throw Object.assign(new Error('Mutation replay is disabled'), { statusCode: 403 });
    const body = replayBodies.get(id) || Buffer.alloc(0);
    if (!safe && !captureBodies) throw Object.assign(new Error('Mutation body was not captured'), { statusCode: 409 });
    const result = await fetchUpstream(receipt.method, receipt.path, replayHeaders.get(id) || {}, body);
    record({ method: receipt.method, path: receipt.path, decision: 'replayed', reason: safe ? 'explicit-safe-replay' : 'explicit-mutation-replay', requestHeaders: replayHeaders.get(id) || {}, bodyBytes: body.length, responseStatus: result.status, upstreamStatus: result.status });
    return prepareHtml(result);
  }

  async function handleControl(req, res, url) {
    if (req.method === 'GET' && url.pathname === `${CONTROL_PREFIX}/status`) {
      jsonResponse(res, 200, { ok: true, upstream: upstreamUrl.origin, demo, freeze, injectWidget, capturedRequests: requests.length, feedbackCount: feedback.length, frozenPages: frozen.size });
      return true;
    }
    if (req.method === 'GET' && url.pathname === `${CONTROL_PREFIX}/requests`) {
      jsonResponse(res, 200, { requests });
      return true;
    }
    if (req.method === 'GET' && url.pathname === `${CONTROL_PREFIX}/widget.js`) {
      writeResponse(res, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }, Buffer.from(WIDGET_JS));
      return true;
    }
    if (req.method === 'POST' && url.pathname === `${CONTROL_PREFIX}/feedback`) {
      const body = await readRequestBody(req, maxRequestBytes);
      let parsed;
      try { parsed = body.length ? JSON.parse(body.toString('utf8')) : {}; }
      catch { jsonResponse(res, 400, { error: 'Invalid JSON' }); return true; }
      const message = String(parsed.message || '').trim();
      if (!message || message.length > 4000) { jsonResponse(res, 400, { error: 'message must be 1-4000 characters' }); return true; }
      const item = Object.freeze({ id: idFactory(), at: now(), message, path: String(parsed.path || '').slice(0, 1000) });
      appendBounded(feedback, item, feedbackLimit);
      jsonResponse(res, 201, { ok: true, feedback: item });
      return true;
    }
    return false;
  }

  async function handler(req, res) {
    try {
      const rawTarget = req.url || '/';
      if (!rawTarget.startsWith('/') || rawTarget.startsWith('//') || rawTarget.includes('\\')) {
        throw Object.assign(new Error('Preview requests must use a local origin-form target'), { statusCode: 400 });
      }
      const url = new URL(rawTarget, 'http://preview.local');
      if (url.pathname.startsWith(CONTROL_PREFIX) && await handleControl(req, res, url)) return;

      const method = String(req.method || 'GET').toUpperCase();
      const requestPath = `${url.pathname}${url.search}`;
      const body = await readRequestBody(req, maxRequestBytes);
      const id = idFactory();
      replayHeaders.set(id, headersForReplay(req.headers));
      if (captureBodies && body.length) replayBodies.set(id, Buffer.from(body));

      const verdict = demo ? policy.evaluate(method, url.pathname) : { allowed: true, reason: 'demo-disabled' };
      if (!verdict.allowed) {
        const payload = { ok: true, intercepted: true, reason: verdict.reason, method, path: url.pathname };
        record({ id, method, path: requestPath, decision: 'intercepted', reason: verdict.reason, requestHeaders: req.headers, bodyBytes: body.length, responseStatus: 200 });
        jsonResponse(res, 200, payload, { 'x-preview-demo-blocked': '1', 'x-preview-receipt-id': id });
        return;
      }

      let result;
      try {
        result = await fetchUpstream(method, requestPath, req.headers, body);
      } catch (error) {
        const cached = freeze && method === 'GET' ? frozen.get(requestPath) : null;
        if (!cached) throw error;
        const prepared = prepareHtml({ ...cached, headers: { ...cached.headers, 'x-preview-frozen': '1', 'x-preview-upstream-error': 'unreachable' } });
        record({ id, method, path: requestPath, decision: 'frozen', reason: 'upstream-unreachable', requestHeaders: req.headers, bodyBytes: body.length, responseStatus: prepared.status, frozenResponse: true });
        writeResponse(res, prepared.status, { ...prepared.headers, 'x-preview-receipt-id': id }, prepared.body);
        return;
      }

      const contentType = String(result.headers['content-type'] || '').toLowerCase();
      const cacheEligible = freeze && method === 'GET' && result.status >= 200 && result.status < 300 && contentType.includes('text/html') && !result.headers['content-encoding'];
      if (cacheEligible) cacheSet(requestPath, { status: result.status, headers: cacheableHeaders(result.headers), body: Buffer.from(result.body) });

      if (freeze && method === 'GET' && result.status >= 500 && frozen.has(requestPath)) {
        const cached = frozen.get(requestPath);
        const prepared = prepareHtml({ ...cached, headers: { ...cached.headers, 'x-preview-frozen': '1', 'x-preview-upstream-status': String(result.status) } });
        record({ id, method, path: requestPath, decision: 'frozen', reason: 'upstream-5xx', requestHeaders: req.headers, bodyBytes: body.length, responseStatus: prepared.status, upstreamStatus: result.status, frozenResponse: true });
        writeResponse(res, prepared.status, { ...prepared.headers, 'x-preview-receipt-id': id }, prepared.body);
        return;
      }

      const prepared = prepareHtml(result);
      record({ id, method, path: requestPath, decision: 'forwarded', reason: verdict.reason, requestHeaders: req.headers, bodyBytes: body.length, responseStatus: prepared.status, upstreamStatus: result.status });
      writeResponse(res, prepared.status, { ...prepared.headers, 'x-preview-receipt-id': id }, prepared.body);
    } catch (error) {
      jsonResponse(res, error.statusCode || 502, { error: error.message || 'Preview proxy failed' });
    }
  }

  return {
    config: Object.freeze({ upstream: upstreamUrl.origin, demo, freeze, injectWidget, mutationReplayEnabled }),
    listRequests: () => requests.slice(),
    listFeedback: () => feedback.slice(),
    replay,
    async listen({ port = 0, host = '127.0.0.1' } = {}) {
      if (server) throw new Error('Preview runtime is already listening');
      server = http.createServer(handler);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      if (!server) return;
      const active = server;
      server = undefined;
      await new Promise((resolve, reject) => active.close((error) => error ? reject(error) : resolve()));
    }
  };
}
