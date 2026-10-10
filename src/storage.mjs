import crypto from 'node:crypto';

const memoryRuns = globalThis.__WORKBENCH_RUNS__ || [];
globalThis.__WORKBENCH_RUNS__ = memoryRuns;

const DATA_WORKBENCH_SECRET_KEY = /(password|passwd|token|secret|private.?key|api.?key|credential)/i;
const DATA_WORKBENCH_QUERY_KEY = /^(sql|query|rawSql|statement)$/i;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sanitizeDataWorkbenchValue(value, key = '') {
  if (DATA_WORKBENCH_SECRET_KEY.test(key)) return '[REDACTED]';
  if (DATA_WORKBENCH_QUERY_KEY.test(key) && typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, ' ');
    return {
      redacted: true,
      sha256: sha256(normalized),
      length: Buffer.byteLength(normalized, 'utf8')
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeDataWorkbenchValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeDataWorkbenchValue(child, childKey)]));
  }
  return value;
}

function sanitizeRunForPersistence(run) {
  if (!run || run.workflowId !== 'data-workbench') return run;
  return {
    ...run,
    input: sanitizeDataWorkbenchValue(run.input || {})
  };
}

async function redis(command) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return null;
  const response = await fetch(base, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Persistence provider returned ${response.status}.`);
  return response.json();
}

export async function saveRun(run) {
  const persistedRun = sanitizeRunForPersistence(run);
  memoryRuns.unshift(persistedRun);
  if (memoryRuns.length > 100) memoryRuns.length = 100;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    await redis(['SET', `workbench:run:${persistedRun.id}`, JSON.stringify(persistedRun), 'EX', 60 * 60 * 24 * 30]);
    await redis(['LPUSH', 'workbench:run_ids', persistedRun.id]);
    await redis(['LTRIM', 'workbench:run_ids', 0, 99]);
  }
  return persistedRun;
}

export async function listRuns(limit = 25) {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const idsResponse = await redis(['LRANGE', 'workbench:run_ids', 0, Math.max(0, limit - 1)]);
    const ids = idsResponse?.result || [];
    const values = await Promise.all(ids.map(async (id) => (await redis(['GET', `workbench:run:${id}`]))?.result));
    return values.filter(Boolean).map((value) => JSON.parse(value));
  }
  return memoryRuns.slice(0, limit);
}
