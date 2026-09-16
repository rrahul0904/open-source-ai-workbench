const buckets = new Map();

export function authorize(headers = {}) {
  const required = process.env.WORKBENCH_API_KEY;
  if (!required) return { ok: true, mode: 'public-demo' };
  const supplied = headers.authorization || headers.Authorization || '';
  const token = supplied.startsWith('Bearer ') ? supplied.slice(7) : '';
  return token === required ? { ok: true, mode: 'protected' } : { ok: false, mode: 'protected' };
}

export function rateLimit(key = 'anonymous', limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    buckets.set(key, { count: 1, startedAt: now });
    return { ok: true, remaining: limit - 1 };
  }
  current.count += 1;
  return { ok: current.count <= limit, remaining: Math.max(0, limit - current.count) };
}

export function safeJsonSize(value, maxBytes = 256_000) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') <= maxBytes;
}

export function requireApproval(input = {}) {
  return input.approved === true || input.approval === 'APPROVE';
}
