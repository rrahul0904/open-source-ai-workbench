import crypto from 'node:crypto';

const DEFAULT_MODEL = 'Akahsizrr/Cyber-Prime-1.1-2.6B';
const BENCHMARKS = ['cyner', 'aptner', 'phishing-email', 'http-anomaly', 'cyber-mcq', 'cynews'];
function fail(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input must be a JSON object');
  const os = input.os ?? 'linux';
  const accelerator = input.accelerator ?? 'none';
  const memoryGb = Number(input.memoryGb ?? 0);
  const budgetHours = Number(input.budgetHours ?? 2);
  if (!['linux', 'windows', 'macos'].includes(os)) fail('os must be linux, windows, or macos');
  if (!['cuda', 'apple-silicon', 'none'].includes(accelerator)) fail('accelerator must be cuda, apple-silicon, or none');
  if (!Number.isFinite(memoryGb) || memoryGb < 0 || memoryGb > 2048) fail('memoryGb must be between 0 and 2048');
  if (!Number.isFinite(budgetHours) || budgetHours <= 0 || budgetHours > 168) fail('budgetHours must be greater than 0 and at most 168');
  if (input.modelId !== undefined && (typeof input.modelId !== 'string' || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(input.modelId))) fail('modelId must be a valid publisher/name model identifier');
  if (input.benchmarks !== undefined && (!Array.isArray(input.benchmarks) || input.benchmarks.length === 0 || input.benchmarks.some((b) => !BENCHMARKS.includes(b)))) fail('benchmarks must be a nonempty selection from the supported task IDs');
  if (os === 'macos' && accelerator === 'cuda') fail('Unsupported OS/accelerator combination');
  if (os !== 'macos' && accelerator === 'apple-silicon') fail('Apple Silicon backend requires macos');
  return { os, accelerator, memoryGb, budgetHours, modelId: input.modelId || DEFAULT_MODEL, benchmarks: [...new Set(input.benchmarks || BENCHMARKS)].sort() };
}

function backend(config) {
  if (config.accelerator === 'apple-silicon') return { name: 'mlx-lm', status: config.memoryGb >= 8 ? 'candidate-needs-real-hardware-check' : 'insufficient-reported-memory', note: 'MLX on Apple Silicon; paging and throughput not verified by this hosted planner.' };
  if (config.accelerator === 'cuda') return { name: config.os === 'windows' ? 'transformers-peft' : 'transformers-peft-with-optional-vllm', status: config.memoryGb >= 8 ? 'candidate-needs-real-hardware-check' : 'insufficient-reported-memory', note: config.os === 'windows' ? 'vLLM is not assumed on Windows; use Transformers/PEFT for a local worker.' : 'vLLM is optional for inference; PEFT trains adapters.' };
  return { name: 'unavailable', status: 'accelerator-required', note: 'This plan cannot claim local fine-tuning without a supported GPU; inspect hardware before training.' };
}

export function modelExperimentPlan(input = {}) {
  const config = normalize(input);
  const selected = backend(config);
  const planVersion = 'cyber-security-posttraining-plan/v1';
  const planId = crypto.createHash('sha256').update(JSON.stringify({ planVersion, config })).digest('hex').slice(0, 16);
  return {
    id: `plan-${planId}`,
    planVersion,
    state: 'plan-only',
    trainingExecuted: false,
    modelDownloaded: false,
    hardwareDetected: false,
    config,
    backend: selected,
    experimentProtocol: {
      tasks: config.benchmarks,
      split: 'Source-grouped train/validation/test; freeze and hash test prompts before curation; never use test examples in post-training or demonstrations.',
      comparability: 'Use identical prompt templates, shot counts, decoding, grader versions and source licenses when comparing models; report confidence intervals and per-task support.',
      curation: 'Record per-row source, rights, transformation and provenance; remove duplicates, near-duplicates, leaks, sensitive information and malicious training instructions.',
      stages: ['inventory-license-and-source-data', 'freeze-holdout', 'record-baseline-with-actual-worker', 'prepare-licensed-sft-examples', 'train-bounded-adapter-with-telemetry', 'run-same-holdout', 'separate-human-review', 'publish-model-and-data-lineage-only-if-rights-allow'],
      acceptanceGates: ['verified licenses', 'data lineage', 'holdout isolation', 'real baseline and retry', 'matched evaluation protocol', 'resource budget', 'no model-improvement claim unless holdout gates pass'],
      outputArtifactContracts: ['run-config.json', 'data-provenance.jsonl', 'holdout-manifest.json', 'baseline-metrics.json', 'training-events.jsonl', 'retry-metrics.json', 'acceptance-decision.json']
    },
    externalActionsTaken: false,
    warnings: [
      'CyberPrime inherits Liquid AI LFM Open License v1.0; its commercial threshold and attribution obligations require review.',
      'The model-card baseline comparison used different shot counts; do not claim performance parity without matched independent evaluation.',
      'This hosted planner neither downloads weights nor executes SFT, GRPO, QLoRA or test-time self-improvement.'
    ],
    sourceReferences: [
      'https://www.reddit.com/r/OpenSourceAI/comments/1wr278f/i_opensourced_a_small_and_powerful_cyber_ai_model/',
      'https://huggingface.co/Akahsizrr/Cyber-Prime-1.1-2.6B',
      'https://github.com/Vaskrokodile/optimus-studio',
      'https://www.liquid.ai/lfm-license'
    ]
  };
}
