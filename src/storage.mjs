const memoryRuns = globalThis.__WORKBENCH_RUNS__ || [];
globalThis.__WORKBENCH_RUNS__ = memoryRuns;

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
  memoryRuns.unshift(run);
  if (memoryRuns.length > 100) memoryRuns.length = 100;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    await redis(['SET', `workbench:run:${run.id}`, JSON.stringify(run), 'EX', 60 * 60 * 24 * 30]);
    await redis(['LPUSH', 'workbench:run_ids', run.id]);
    await redis(['LTRIM', 'workbench:run_ids', 0, 99]);
  }
  return run;
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
