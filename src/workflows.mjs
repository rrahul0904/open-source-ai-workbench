import crypto from 'node:crypto';
import { getCapability } from './catalog.mjs';
import { synthesizeDemoWav } from './audio.mjs';
import { demoMarketSnapshot, executeConfiguredConnector, generateText } from './providers.mjs';
import { requireApproval } from './security.mjs';
import { saveRun } from './storage.mjs';

function words(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

function scenePlan(topic, durationSeconds = 30) {
  const duration = Math.max(6, Math.min(180, Number(durationSeconds) || 30));
  const sceneCount = Math.max(3, Math.min(8, Math.ceil(duration / 8)));
  return Array.from({ length: sceneCount }, (_, index) => {
    const start = Math.round((duration / sceneCount) * index * 10) / 10;
    const end = Math.round((duration / sceneCount) * (index + 1) * 10) / 10;
    return {
      id: `scene-${index + 1}`,
      start,
      end,
      headline: index === 0 ? `Hook: ${topic}` : index === sceneCount - 1 ? 'Call to action' : `${topic} — insight ${index}`,
      motion: index % 2 === 0 ? 'push-in' : 'slide-up',
      layers: ['background', 'headline', 'caption']
    };
  });
}

async function tradingResearch(input) {
  const snapshot = demoMarketSnapshot(input.symbol || 'ACME');
  const metrics = snapshot.metrics;
  const bull = `Quality ${metrics.quality}/100 and momentum ${metrics.momentum}/100 support the constructive case.`;
  const bear = `Risk ${metrics.risk}/100 and valuation ${metrics.valuation}/100 are the main constraints.`;
  const composite = Math.round((metrics.quality + metrics.momentum + (100 - metrics.risk) + (100 - metrics.valuation)) / 4);
  return {
    snapshot,
    agents: {
      fundamental: { thesis: metrics.quality >= 60 ? 'Fundamentals screen constructive.' : 'Fundamentals require caution.', confidence: metrics.quality },
      technical: { thesis: metrics.momentum >= 60 ? 'Momentum screen positive.' : 'Momentum screen weak.', confidence: metrics.momentum },
      bull: { thesis: bull },
      bear: { thesis: bear },
      risk: { thesis: `Risk budget score ${100 - metrics.risk}/100.` },
      portfolio: { decision: composite >= 65 ? 'research-further' : 'watchlist', conviction: composite }
    },
    question: input.question || 'Evaluate the setup',
    disclaimer: 'Demo research only; not investment advice.'
  };
}

async function multiModelChat(input) {
  return generateText({ prompt: input.prompt || '', system: input.system || 'You are an AI workbench assistant.', provider: input.provider || 'auto' });
}

async function videoComposer(input) {
  const topic = input.topic || 'AI workbench';
  const scenes = scenePlan(topic, input.durationSeconds);
  return {
    fps: 30,
    width: 1080,
    height: 1920,
    durationSeconds: scenes.at(-1).end,
    scenes,
    renderer: 'deterministic-manifest',
    renderCommand: 'Use the manifest with a browser/FFmpeg renderer in a media worker.'
  };
}

async function financeTerminal(input) {
  const snapshot = demoMarketSnapshot(input.symbol || 'ACME');
  return {
    quote: snapshot,
    watchlist: [snapshot, demoMarketSnapshot('DATA'), demoMarketSnapshot('CLOUD')],
    signal: snapshot.metrics.momentum > 65 ? 'positive-momentum' : snapshot.metrics.risk > 70 ? 'elevated-risk' : 'neutral',
    notes: ['Market data adapter is isolated behind provider boundaries.', 'Demo mode uses deterministic synthetic values.']
  };
}

async function agenticInbox(input) {
  const body = `${input.subject || ''} ${input.body || ''}`.toLowerCase();
  const urgent = /(urgent|asap|today|deadline|production down|incident)/.test(body);
  const action = /(approve|send|pay|sign|confirm|schedule|reply)/.test(body);
  const category = /(invoice|payment|budget)/.test(body) ? 'finance' : /(meeting|calendar|schedule)/.test(body) ? 'scheduling' : 'general';
  const draft = await generateText({
    prompt: `Draft a concise email reply to: Subject: ${input.subject || '(none)'} Body: ${input.body || '(empty)'}`,
    system: 'Write a safe draft only. Do not claim the email has been sent.',
    provider: input.provider || 'demo'
  });
  return {
    triage: { priority: urgent ? 'high' : 'normal', category, actionRequired: action },
    extractedActions: action ? ['Review and approve a response/action'] : [],
    draft: draft.text,
    sendState: requireApproval(input) ? 'approved-for-provider-send' : 'approval-required',
    requiresApproval: !requireApproval(input)
  };
}

async function voiceStudio(input) {
  const text = String(input.text || 'Hello from AI Workbench');
  return {
    voice: input.voice || 'workbench-demo',
    format: 'wav',
    durationEstimateSeconds: Math.round((Math.max(1, words(text).length) / 2.4) * 10) / 10,
    audioDataUrl: synthesizeDemoWav(text),
    provider: 'built-in-demo-synth',
    note: 'The built-in waveform makes the flow deployable with zero model credentials; a production TTS adapter can replace it.'
  };
}

async function osintGraph(input) {
  const entities = Array.isArray(input.entities) && input.entities.length ? input.entities : [
    { id: 'org-1', type: 'organization', label: 'Example Corp' },
    { id: 'domain-1', type: 'domain', label: 'example.org' }
  ];
  const relationships = Array.isArray(input.relationships) ? input.relationships : [];
  const normalized = entities.map((entity, index) => ({ id: entity.id || `entity-${index + 1}`, type: entity.type || 'unknown', label: entity.label || entity.value || 'Unnamed' }));
  const inferred = normalized.length >= 2 && relationships.length === 0 ? [{ from: normalized[0].id, to: normalized[1].id, type: 'associated-with', confidence: 0.5, source: 'demo-inference' }] : [];
  return {
    nodes: normalized,
    edges: [...relationships, ...inferred],
    summary: `Graph contains ${normalized.length} entities and ${relationships.length + inferred.length} relationships.`,
    enrichmentPolicy: 'Only user-provided or configured-provider data is processed; no arbitrary scraping is performed.'
  };
}

async function engineeringAgent(input) {
  const goal = input.goal || 'Ship the requested feature';
  return {
    goal,
    specification: [`Define user-visible acceptance criteria for: ${goal}`, 'Identify data/security boundaries', 'Separate repository-certifiable evidence from external evidence'],
    plan: ['Implement smallest complete vertical slice', 'Add deterministic tests', 'Add smoke acceptance', 'Document rollback and configuration'],
    gates: [
      { name: 'spec', status: 'pass' },
      { name: 'implementation', status: 'pass' },
      { name: 'unit-tests', status: 'pass' },
      { name: 'security-boundaries', status: 'pass' },
      { name: 'deployment-evidence', status: 'runtime-dependent' }
    ]
  };
}

async function agenticStack(input) {
  const goal = input.goal || 'Ship the requested capability safely';
  const constraints = Array.isArray(input.constraints)
    ? input.constraints.map((value) => String(value)).filter(Boolean)
    : words(input.constraints || '');

  return {
    goal,
    constraints,
    stages: [
      {
        id: 'build',
        purpose: 'Turn the goal into a bounded vertical slice before implementation begins.',
        artifacts: ['acceptance-criteria', 'interface-contract', 'architecture-notes', 'implementation-slice'],
        donorPatterns: ['animated-sketch-diagram', 'archcore', 'shipwright'],
        state: 'planned'
      },
      {
        id: 'memory',
        purpose: 'Keep evidence, decisions and reusable project context durable and source-aware.',
        artifacts: ['context-ledger', 'decision-log', 'evidence-index', 'project-instructions'],
        donorPatterns: ['wenlan', 'dsh-deepread', 'obsidian-skills', 'claude-md-templates'],
        state: 'planned'
      },
      {
        id: 'orchestrate',
        purpose: 'Split independent work into explicit role packets without claiming that external workers executed.',
        roles: [
          { role: 'planner', access: 'read-only', responsibility: 'decompose scope and identify risks' },
          { role: 'implementer', access: 'isolated-write', responsibility: 'build one bounded slice in an isolated branch/worktree' },
          { role: 'reviewer', access: 'read-only', responsibility: 'verify diff, tests, security boundaries and evidence' }
        ],
        donorPatterns: ['claude-wayfinder', 'magic-cc-codex-worker', 'crosstalk'],
        state: 'planned'
      },
      {
        id: 'control',
        purpose: 'Keep destructive, external and release-affecting operations behind explicit boundaries.',
        gates: [
          { name: 'project-boundary', status: 'pass', evidence: 'workflow contract only' },
          { name: 'unit-tests', status: 'planned', evidence: 'must be produced by repository execution' },
          { name: 'security-review', status: 'planned', evidence: 'must be produced by repository execution' },
          { name: 'external-actions', status: 'blocked', evidence: 'human/provider approval required' },
          { name: 'hosted-runtime', status: 'runtime-dependent', evidence: 'requires deployed environment proof' }
        ],
        donorPatterns: ['claude-code-project-boundary', 'claude-pager', 'claude-prospector'],
        state: 'fail-closed'
      },
      {
        id: 'ship',
        purpose: 'Make the release state truthful by separating repository evidence from hosted evidence.',
        decision: 'not-certified',
        repositoryEvidenceRequired: ['implementation', 'tests', 'security checks', 'reviewed diff'],
        hostedEvidenceRequired: ['deployment health', 'real provider/runtime checks where applicable'],
        externalActionTaken: false
      }
    ],
    sourceAudit: {
      mode: 'verified-subset-clean-room',
      excludedAsPosted: ['Lifecycle-Inno/claude-ops', 'nicolai-bernse/backlogd', 'TLS-Radar/tlsradar', 'explorium-ai/vibe-prospecting'],
      note: 'No third-party source code is vendored or executed by this demo workflow.'
    },
    externalActionTaken: false
  };
}

async function connectorRuntime(input) {
  const operation = input.operation || 'sync';
  const result = await executeConfiguredConnector({ operation, payload: input.payload || {} });
  return {
    connector: input.connector || 'demo-connector',
    operation,
    schema: { input: 'json', output: 'json', auth: process.env.CONNECTOR_HTTP_BASE_URL ? 'configured-token' : 'none-demo' },
    result
  };
}

async function contentFactory(input) {
  const topic = input.topic || 'AI workbench';
  const audience = input.audience || 'builders';
  const script = await generateText({ prompt: `Create a short video script about ${topic} for ${audience}.`, provider: input.provider || 'demo' });
  const video = await videoComposer({ topic, durationSeconds: input.durationSeconds || 30 });
  const voice = await voiceStudio({ text: script.text, voice: input.voice });
  return {
    topic,
    audience,
    script: script.text,
    storyboard: video,
    voice: { ...voice, audioDataUrl: voice.audioDataUrl },
    publishing: { state: 'package-ready', requiresApproval: true }
  };
}

async function launchCampaign(input) {
  const topic = input.topic || 'AI workbench';
  const audience = input.audience || 'technical teams';
  const research = await generateText({ prompt: `Summarize the key claims, caveats, and audience needs for ${topic}.`, provider: input.provider || 'demo' });
  const content = await contentFactory({ topic, audience, provider: input.provider || 'demo', durationSeconds: input.durationSeconds || 30 });
  const delivery = await connectorRuntime({ connector: input.connector || 'demo-connector', operation: 'prepare-publish', payload: { topic, audience } });
  return {
    research,
    content,
    delivery,
    state: 'ready-for-human-approval',
    externalActionTaken: false
  };
}

const handlers = {
  'trading-research': tradingResearch,
  'multi-model-chat': multiModelChat,
  'video-composer': videoComposer,
  'finance-terminal': financeTerminal,
  'content-factory': contentFactory,
  'agentic-inbox': agenticInbox,
  'voice-studio': voiceStudio,
  'osint-graph': osintGraph,
  'engineering-agent': engineeringAgent,
  'agentic-stack': agenticStack,
  'connector-runtime': connectorRuntime,
  'launch-campaign': launchCampaign
};

export async function executeWorkflow(id, input = {}) {
  const capability = getCapability(id);
  if (!capability || !handlers[id]) throw Object.assign(new Error(`Unknown workflow: ${id}`), { statusCode: 404 });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  try {
    const output = await handlers[id](input);
    const run = {
      id: crypto.randomUUID(),
      workflowId: id,
      capability: capability.name,
      status: 'succeeded',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
      input,
      output
    };
    await saveRun(run);
    return run;
  } catch (error) {
    const run = {
      id: crypto.randomUUID(),
      workflowId: id,
      capability: capability.name,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
      input,
      error: error instanceof Error ? error.message : String(error)
    };
    await saveRun(run);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { run });
  }
}
