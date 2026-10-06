import { createHash } from 'node:crypto';

export const PROVIDER_KINDS = Object.freeze([
  'openai-compatible',
  'anthropic',
  'ollama',
  'on-device',
  'unknown',
]);

export const ROUTE_KINDS = Object.freeze([
  'on-device',
  'local-lan',
  'self-hosted-remote',
  'cloud-byok',
  'external-search',
  'apple-action',
  'unknown',
]);

export const TOOL_INTENT_STATES = Object.freeze([
  'proposed',
  'previewed',
  'approved',
  'executing',
  'succeeded',
  'failed',
  'cancelled',
]);

export const RUN_CONTINUATION_STATES = Object.freeze([
  'queued',
  'streaming',
  'suspended',
  'resumable',
  'completed',
  'failed',
  'cancelled',
]);

const RAW_SECRET_KEY = /(^|_)(api[-_]?key|access[-_]?token|refresh[-_]?token|password|authorization|raw[-_]?secret|secret)(_|$)/i;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new RangeError(`${label} must be one of: ${allowed.join(', ')}`);
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function stableDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function assertNoRawSecrets(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, nested] of Object.entries(value)) {
    if (RAW_SECRET_KEY.test(key)) {
      throw new Error(`raw secret field is forbidden at ${path}.${key}`);
    }
    assertNoRawSecrets(nested, `${path}.${key}`);
  }
}

function normalizeBaseUrl(baseUrl, providerKind) {
  if (providerKind === 'on-device') {
    if (baseUrl !== undefined && baseUrl !== null && baseUrl !== '') {
      throw new Error('on-device profiles cannot declare a baseUrl');
    }
    return null;
  }

  if (baseUrl === undefined || baseUrl === null || baseUrl === '') return null;
  assertString(baseUrl, 'baseUrl');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('baseUrl must use http or https');
  }
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function createMobileConnectionProfile(input) {
  assertObject(input, 'connection profile');
  const {
    id,
    providerKind,
    baseUrl,
    credentialRef = null,
    transportLocality = 'unknown',
    capabilities = [],
    assessedAt = null,
  } = input;

  assertString(id, 'id');
  assertEnum(providerKind, PROVIDER_KINDS, 'providerKind');
  assertEnum(transportLocality, ['device', 'lan', 'remote', 'unknown'], 'transportLocality');
  if (credentialRef !== null) assertString(credentialRef, 'credentialRef');
  if (!Array.isArray(capabilities)) throw new TypeError('capabilities must be an array');
  assertNoRawSecrets(input);

  const profile = {
    id,
    providerKind,
    baseUrl: normalizeBaseUrl(baseUrl, providerKind),
    credentialRef,
    transportLocality,
    capabilities: [...new Set(capabilities)].sort(),
    assessedAt,
  };

  return Object.freeze({ ...profile, fingerprint: stableDigest(profile) });
}

export function createConversationBinding(input) {
  assertObject(input, 'conversation binding');
  const {
    conversationId,
    profileId,
    providerKind,
    modelId,
    systemPromptId = null,
    toolPolicy = { webSearch: false, appleActions: 'approval-required' },
  } = input;

  assertString(conversationId, 'conversationId');
  assertString(profileId, 'profileId');
  assertEnum(providerKind, PROVIDER_KINDS, 'providerKind');
  assertString(modelId, 'modelId');
  assertObject(toolPolicy, 'toolPolicy');
  assertNoRawSecrets(input);

  const binding = {
    conversationId,
    profileId,
    providerKind,
    modelId,
    systemPromptId,
    toolPolicy: canonicalize(toolPolicy),
  };

  return Object.freeze({ ...binding, bindingId: stableDigest(binding) });
}

export function resolveConversationBinding(existingBinding, globalDefaults) {
  if (existingBinding) return existingBinding;
  return createConversationBinding(globalDefaults);
}

function normalizeMetrics(metrics = {}) {
  assertObject(metrics, 'metrics');
  const result = {};
  for (const key of ['latencyMs', 'inputTokens', 'outputTokens', 'costUsd']) {
    const value = metrics[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`${key} must be a non-negative finite number`);
    }
    result[key] = value;
  }
  return result;
}

export function createTurnExecutionReceipt(input) {
  assertObject(input, 'turn receipt');
  const {
    binding,
    messageId,
    runId,
    route = 'unknown',
    externalEgress = [],
    status = 'completed',
    startedAt = null,
    completedAt = null,
    metrics = {},
  } = input;

  assertObject(binding, 'binding');
  assertString(messageId, 'messageId');
  assertString(runId, 'runId');
  assertEnum(route, ROUTE_KINDS, 'route');
  if (!Array.isArray(externalEgress)) throw new TypeError('externalEgress must be an array');
  assertNoRawSecrets(input);

  const receipt = {
    conversationId: binding.conversationId,
    bindingId: binding.bindingId,
    profileId: binding.profileId,
    providerKind: binding.providerKind,
    modelId: binding.modelId,
    messageId,
    runId,
    route,
    externalEgress: [...new Set(externalEgress)].sort(),
    status,
    startedAt,
    completedAt,
    metrics: normalizeMetrics(metrics),
  };

  return Object.freeze({ ...receipt, receiptId: stableDigest(receipt) });
}

function toolApprovalPayload(intentLike) {
  return {
    tool: intentLike.tool,
    args: canonicalize(intentLike.args),
    conversationId: intentLike.conversationId,
    runId: intentLike.runId,
    effect: intentLike.effect,
  };
}

export function createToolIntent(input) {
  assertObject(input, 'tool intent');
  const { tool, args = {}, conversationId, runId, effect } = input;
  assertString(tool, 'tool');
  assertObject(args, 'args');
  assertString(conversationId, 'conversationId');
  assertString(runId, 'runId');
  assertNoRawSecrets(input);

  const normalizedEffect = effect ?? (tool === 'mail.compose' ? 'draft' : 'mutation');
  const base = {
    tool,
    args: canonicalize(args),
    conversationId,
    runId,
    effect: normalizedEffect,
  };

  return Object.freeze({
    ...base,
    state: 'proposed',
    approvalFingerprint: stableDigest(toolApprovalPayload(base)),
  });
}

export function reviseToolIntentArgs(intent, nextArgs) {
  assertObject(intent, 'tool intent');
  assertObject(nextArgs, 'nextArgs');
  return createToolIntent({
    tool: intent.tool,
    args: nextArgs,
    conversationId: intent.conversationId,
    runId: intent.runId,
    effect: intent.effect,
  });
}

const TOOL_TRANSITIONS = Object.freeze({
  proposed: ['previewed', 'cancelled'],
  previewed: ['approved', 'cancelled'],
  approved: ['executing', 'cancelled'],
  executing: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
});

export function transitionToolIntent(intent, nextState, options = {}) {
  assertObject(intent, 'tool intent');
  assertEnum(nextState, TOOL_INTENT_STATES, 'nextState');
  const allowed = TOOL_TRANSITIONS[intent.state] ?? [];
  if (!allowed.includes(nextState)) {
    throw new Error(`invalid tool transition: ${intent.state} -> ${nextState}`);
  }

  if (nextState === 'approved') {
    if (options.approvalFingerprint !== intent.approvalFingerprint) {
      throw new Error('approval does not match the exact tool intent');
    }
  }

  return Object.freeze({ ...intent, state: nextState });
}

export function canExecuteToolIntent(intent) {
  return intent?.state === 'approved';
}

export function createMobileRunContinuation({ runId, backgroundCapability = 'unknown' }) {
  assertString(runId, 'runId');
  assertEnum(backgroundCapability, ['supported', 'unsupported', 'unknown'], 'backgroundCapability');
  return Object.freeze({
    runId,
    state: 'queued',
    cursor: 0,
    lastEventSeq: 0,
    backgroundCapability,
    completedReceiptId: null,
  });
}

const RUN_TRANSITIONS = Object.freeze({
  queued: ['streaming', 'cancelled', 'failed'],
  streaming: ['suspended', 'completed', 'cancelled', 'failed'],
  suspended: ['resumable', 'cancelled', 'failed'],
  resumable: ['streaming', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
});

export function applyContinuationEvent(current, event) {
  assertObject(current, 'continuation');
  assertObject(event, 'event');
  const { seq, nextState, cursor = current.cursor, completedReceiptId = null } = event;
  if (!Number.isInteger(seq) || seq <= 0) throw new TypeError('event seq must be a positive integer');
  assertEnum(nextState, RUN_CONTINUATION_STATES, 'nextState');
  if (!Number.isInteger(cursor) || cursor < current.cursor) {
    throw new Error('continuation cursor must be monotonic');
  }

  if (seq <= current.lastEventSeq) {
    return Object.freeze({ state: current, applied: false, reason: 'duplicate-or-stale-event' });
  }

  const allowed = RUN_TRANSITIONS[current.state] ?? [];
  if (!allowed.includes(nextState)) {
    throw new Error(`invalid run transition: ${current.state} -> ${nextState}`);
  }

  if (nextState === 'completed') assertString(completedReceiptId, 'completedReceiptId');

  const next = Object.freeze({
    ...current,
    state: nextState,
    cursor,
    lastEventSeq: seq,
    completedReceiptId: nextState === 'completed' ? completedReceiptId : current.completedReceiptId,
  });

  return Object.freeze({ state: next, applied: true, reason: null });
}

export function isBackgroundCertified(continuation) {
  return continuation?.backgroundCapability === 'supported';
}
