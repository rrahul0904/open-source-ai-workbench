import crypto from 'node:crypto';

function stableScore(seed, min = 0, max = 100) {
  const hash = crypto.createHash('sha256').update(String(seed)).digest();
  const value = hash.readUInt32BE(0) / 0xffffffff;
  return Math.round((min + value * (max - min)) * 100) / 100;
}

export function providerStatus() {
  return {
    llm: process.env.LLM_API_KEY ? 'live-configured' : 'demo',
    connector: process.env.CONNECTOR_HTTP_BASE_URL ? 'live-configured' : 'demo',
    persistence: process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'redis-rest' : 'memory'
  };
}

export async function generateText({ prompt, system = '', provider = 'auto' }) {
  const live = provider === 'live' || (provider === 'auto' && process.env.LLM_API_KEY);
  if (live) {
    if (!process.env.LLM_API_KEY) throw new Error('Live LLM requested but LLM_API_KEY is not configured.');
    const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.LLM_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-5-mini',
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`LLM provider returned ${response.status}.`);
    const data = await response.json();
    return {
      provider: 'live',
      model: process.env.LLM_MODEL || 'gpt-5-mini',
      text: data.choices?.[0]?.message?.content || '',
      rawUsage: data.usage || null
    };
  }

  const short = String(prompt || '').trim().replace(/\s+/g, ' ');
  return {
    provider: 'demo',
    model: 'deterministic-workbench',
    text: `Workbench synthesis: ${short || 'No prompt supplied.'}\n\nRecommended next action: validate assumptions, capture evidence, and keep external actions behind approval gates.`,
    rawUsage: null
  };
}

export function demoMarketSnapshot(symbol = 'ACME') {
  const normalized = String(symbol).toUpperCase().slice(0, 12);
  const price = stableScore(`${normalized}:price`, 18, 420);
  const changePct = stableScore(`${normalized}:change`, -4.5, 4.5);
  const quality = stableScore(`${normalized}:quality`, 35, 95);
  const risk = stableScore(`${normalized}:risk`, 10, 90);
  const momentum = stableScore(`${normalized}:momentum`, 10, 90);
  return {
    symbol: normalized,
    price,
    changePct,
    metrics: {
      quality,
      risk,
      momentum,
      valuation: stableScore(`${normalized}:valuation`, 10, 90),
      liquidity: stableScore(`${normalized}:liquidity`, 25, 99)
    },
    source: 'deterministic-demo',
    asOf: new Date().toISOString()
  };
}

export async function executeConfiguredConnector({ operation, payload }) {
  if (!process.env.CONNECTOR_HTTP_BASE_URL) {
    return {
      provider: 'demo',
      operation,
      accepted: true,
      syncId: crypto.randomUUID(),
      echo: payload ?? {},
      note: 'No live connector endpoint configured; operation completed in auditable demo mode.'
    };
  }

  const base = process.env.CONNECTOR_HTTP_BASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/workbench/${encodeURIComponent(operation || 'sync')}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.CONNECTOR_HTTP_TOKEN ? { authorization: `Bearer ${process.env.CONNECTOR_HTTP_TOKEN}` } : {})
    },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Connector provider returned ${response.status}.`);
  let data;
  try { data = JSON.parse(text); } catch { data = { text }; }
  return { provider: 'live', operation, accepted: true, data };
}
