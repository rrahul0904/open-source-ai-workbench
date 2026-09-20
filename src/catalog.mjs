export const capabilities = [
  {
    id: 'trading-research',
    name: 'Trading Research Council',
    inspiredBy: 'TradingAgents',
    category: 'Research',
    status: 'ready',
    description: 'Multi-agent market research with fundamental, technical, bull, bear, risk and portfolio roles.',
    inputs: ['symbol', 'question']
  },
  {
    id: 'multi-model-chat',
    name: 'Multi-model Chat',
    inspiredBy: 'LibreChat',
    category: 'AI Workspace',
    status: 'ready',
    description: 'Provider-abstracted chat with deterministic demo mode and optional OpenAI-compatible live inference.',
    inputs: ['prompt', 'system']
  },
  {
    id: 'video-composer',
    name: 'Deterministic Video Composer',
    inspiredBy: 'HyperFrames',
    category: 'Media',
    status: 'ready',
    description: 'Turns a concept into a deterministic scene/frame rendering manifest.',
    inputs: ['topic', 'durationSeconds']
  },
  {
    id: 'finance-terminal',
    name: 'Finance Terminal',
    inspiredBy: 'Fincepter',
    category: 'Finance',
    status: 'ready',
    description: 'Portable market snapshot, ratios, watchlist and risk summary with provider-ready boundaries.',
    inputs: ['symbol']
  },
  {
    id: 'content-factory',
    name: 'Content Factory',
    inspiredBy: 'MoneyPrinterTurbo',
    category: 'Media',
    status: 'ready',
    description: 'Topic-to-script-to-storyboard-to-voice package orchestration.',
    inputs: ['topic', 'audience']
  },
  {
    id: 'agentic-inbox',
    name: 'Agentic Inbox',
    inspiredBy: 'Agentic Inbox',
    category: 'Communication',
    status: 'ready',
    description: 'Email triage, action extraction and draft generation with an explicit approval-before-send boundary.',
    inputs: ['subject', 'body']
  },
  {
    id: 'voice-studio',
    name: 'Voice Studio',
    inspiredBy: 'VoxCPM',
    category: 'Media',
    status: 'ready',
    description: 'Speech job generation with a built-in WAV demo renderer and provider-ready TTS contract.',
    inputs: ['text', 'voice']
  },
  {
    id: 'osint-graph',
    name: 'OSINT Graph Workspace',
    inspiredBy: 'Flowsint',
    category: 'Investigation',
    status: 'ready',
    description: 'Entity/relationship graph normalization, enrichment and investigation summaries.',
    inputs: ['entities', 'relationships']
  },
  {
    id: 'engineering-agent',
    name: 'Engineering Agent',
    inspiredBy: 'agent-skills',
    category: 'Engineering',
    status: 'ready',
    description: 'Spec-plan-build-test-review-ship workflow with release gates.',
    inputs: ['goal']
  },
  {
    id: 'connector-runtime',
    name: 'Connector Runtime',
    inspiredBy: 'Nango',
    category: 'Integrations',
    status: 'ready',
    description: 'Normalized connector/action/sync contracts with safe configured-endpoint execution.',
    inputs: ['connector', 'operation', 'payload']
  },
  {
    id: 'workflow-studio',
    name: 'Workflow Studio Runtime',
    inspiredBy: 'Dify',
    category: 'Orchestration',
    status: 'ready',
    description: 'Executes bounded data-defined DAG workflows with knowledge retrieval, model nodes, structured outputs and node-level traces.',
    inputs: ['question', 'documents', 'graph']
  },
  {
    id: 'launch-campaign',
    name: 'Cross-capability Campaign',
    inspiredBy: 'Unified Workbench',
    category: 'Orchestration',
    status: 'ready',
    description: 'Runs research, copy, video, voice and delivery preparation as one auditable workflow.',
    inputs: ['topic', 'audience']
  }
];

export function getCapability(id) {
  return capabilities.find((capability) => capability.id === id);
}
