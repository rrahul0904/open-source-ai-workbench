/** RE-334: public-safe model registry; never disclose provider credentials. */
export const DEMO = Object.freeze([
  { id: 'demo-analysis', name: 'Analysis Lens', provider: 'Synthetic A', model: 'analysis-v1', mode: 'demo', description: 'Assumptions and evaluation' },
  { id: 'demo-creative', name: 'Creative Lens', provider: 'Synthetic B', model: 'creative-v1', mode: 'demo', description: 'Alternatives and trade-offs' },
  { id: 'demo-structured', name: 'Structured Lens', provider: 'Synthetic C', model: 'structured-v1', mode: 'demo', description: 'Implementation and milestones' },
  { id: 'demo-cautious', name: 'Cautious Lens', provider: 'Synthetic D', model: 'cautious-v1', mode: 'demo', description: 'Uncertainty and validation' }
]);

// Model identifiers are operator supplied to avoid stale/hallucinated defaults.
const LIVE_SPEC = Object.freeze([
  { id: 'openai', name: 'OpenAI', key: 'OPENAI_COMPARE_API_KEY', model: 'OPENAI_COMPARE_MODEL' },
  { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_COMPARE_API_KEY', model: 'ANTHROPIC_COMPARE_MODEL' },
  { id: 'gemini', name: 'Gemini', key: 'GEMINI_COMPARE_API_KEY', model: 'GEMINI_COMPARE_MODEL' },
  { id: 'deepseek', name: 'DeepSeek', key: 'DEEPSEEK_COMPARE_API_KEY', model: 'DEEPSEEK_COMPARE_MODEL' }
]);
export const LIVE_IDS = Object.freeze(LIVE_SPEC.map(({ id }) => id));

export function liveEnabled(env = process.env) {
  // Live billing is operator-gated; public / unrestricted live comparison is intentionally impossible.
  return env.COMPARE_LIVE_ENABLED === 'true' && Boolean(env.WORKBENCH_API_KEY);
}

export function getLiveSpec(id, env = process.env) {
  const spec = LIVE_SPEC.find(item => item.id === id);
  if (!spec) return null;
  const apiKey = env[spec.key];
  const model = env[spec.model];
  if (!apiKey || !model) return null;
  if (!/^[a-zA-Z0-9_.:/-]{2,100}$/.test(model)) return null;
  return { id, apiKey, model };
}

export function catalog(env = process.env) {
  return {
    product: 'Multi-Model Evidence Lab',
    version: '0.2.0-preview',
    liveEnabled: liveEnabled(env),
    storage: 'session-only',
    modes: {
      demo: DEMO,
      live: liveEnabled(env) ? LIVE_IDS.map(id => {
        const spec = getLiveSpec(id, env);
        return { id, name: id === 'gemini' ? 'Google Gemini' : id[0].toUpperCase() + id.slice(1), model: spec?.model || null, ready: Boolean(spec), mode: 'live' };
      }) : []
    },
    notice: 'Demo responses are entirely synthetic; live mode sends the prompt to each selected external provider.'
  };
}

export function validateRequest(value, env = process.env) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('A JSON request is required'), { statusCode: 400 });
  const { prompt, mode = 'demo', models, consent } = value;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw Object.assign(new Error('Prompt must contain 1–4000 characters'), { statusCode: 400 });
  if (!['demo', 'live'].includes(mode)) throw Object.assign(new Error('Invalid mode'), { statusCode: 400 });
  const allowed = mode === 'demo' ? DEMO.map(x => x.id) : LIVE_IDS;
  const selected = models === undefined ? (mode === 'demo' ? allowed : []) : models;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 4 || new Set(selected).size !== selected.length || selected.some(x => typeof x !== 'string' || !allowed.includes(x))) throw Object.assign(new Error('Select 1–4 distinct available models'), { statusCode: 400 });
  if (mode === 'live') {
    if (!liveEnabled(env)) throw Object.assign(new Error('Live mode is disabled by the operator'), { statusCode: 403 });
    if (consent !== true) throw Object.assign(new Error('Explicit third-party provider consent is required'), { statusCode: 400 });
    if (selected.some(id => !getLiveSpec(id, env))) throw Object.assign(new Error('A selected live provider is not configured'), { statusCode: 400 });
  }
  return { prompt: prompt.trim(), mode, models: [...selected] };
}
