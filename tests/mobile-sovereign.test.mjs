import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyContinuationEvent,
  canExecuteToolIntent,
  createConversationBinding,
  createMobileConnectionProfile,
  createMobileRunContinuation,
  createToolIntent,
  createTurnExecutionReceipt,
  isBackgroundCertified,
  resolveConversationBinding,
  reviseToolIntentArgs,
  stableDigest,
  transitionToolIntent,
} from '../src/mobile-sovereign.mjs';

function binding(overrides = {}) {
  return createConversationBinding({
    conversationId: 'conversation-a',
    profileId: 'local-mac',
    providerKind: 'ollama',
    modelId: 'qwen3:8b',
    ...overrides,
  });
}

test('existing conversation binding survives global default model changes', () => {
  const original = binding();
  const resolved = resolveConversationBinding(original, {
    conversationId: 'conversation-a',
    profileId: 'cloud',
    providerKind: 'anthropic',
    modelId: 'claude-new-default',
  });

  assert.equal(resolved, original);
  assert.equal(resolved.modelId, 'qwen3:8b');
  assert.equal(resolved.profileId, 'local-mac');
});

test('a new conversation can adopt changed defaults without mutating an old conversation', () => {
  const original = binding();
  const next = resolveConversationBinding(null, {
    conversationId: 'conversation-b',
    profileId: 'cloud',
    providerKind: 'anthropic',
    modelId: 'claude-new-default',
  });

  assert.equal(original.modelId, 'qwen3:8b');
  assert.equal(next.modelId, 'claude-new-default');
  assert.notEqual(next.bindingId, original.bindingId);
});

test('connection profile stores a credential reference but rejects raw secret fields', () => {
  const profile = createMobileConnectionProfile({
    id: 'ollama-lan',
    providerKind: 'ollama',
    baseUrl: 'http://192.168.1.2:11434/',
    credentialRef: 'keychain://ollama-lan',
    transportLocality: 'lan',
    capabilities: ['chat', 'vision', 'chat'],
  });

  assert.equal(profile.baseUrl, 'http://192.168.1.2:11434');
  assert.deepEqual(profile.capabilities, ['chat', 'vision']);
  assert.equal(profile.credentialRef, 'keychain://ollama-lan');

  assert.throws(
    () => createMobileConnectionProfile({
      id: 'bad',
      providerKind: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      apiKey: 'should-never-be-here',
    }),
    /raw secret field is forbidden/,
  );
});

test('on-device profiles cannot smuggle a network endpoint', () => {
  assert.throws(
    () => createMobileConnectionProfile({
      id: 'device',
      providerKind: 'on-device',
      baseUrl: 'https://example.test',
      transportLocality: 'device',
    }),
    /cannot declare a baseUrl/,
  );
});

test('every turn receipt fixes provider, model, profile and route identity', () => {
  const receipt = createTurnExecutionReceipt({
    binding: binding(),
    messageId: 'message-1',
    runId: 'run-1',
    route: 'local-lan',
    startedAt: '2026-10-06T16:00:00.000Z',
    completedAt: '2026-10-06T16:00:01.000Z',
    metrics: { latencyMs: 1000, inputTokens: 12, outputTokens: 20 },
  });

  assert.equal(receipt.providerKind, 'ollama');
  assert.equal(receipt.modelId, 'qwen3:8b');
  assert.equal(receipt.profileId, 'local-mac');
  assert.equal(receipt.route, 'local-lan');
  assert.match(receipt.receiptId, /^[a-f0-9]{64}$/);
});

test('local LAN and cloud BYOK remain distinct route receipts', () => {
  const local = createTurnExecutionReceipt({
    binding: binding(),
    messageId: 'm-local',
    runId: 'r-local',
    route: 'local-lan',
  });
  const cloud = createTurnExecutionReceipt({
    binding: binding({ profileId: 'cloud', providerKind: 'anthropic', modelId: 'claude' }),
    messageId: 'm-cloud',
    runId: 'r-cloud',
    route: 'cloud-byok',
  });

  assert.notEqual(local.route, cloud.route);
  assert.notEqual(local.receiptId, cloud.receiptId);
});

test('web search is off by default and external search egress is separate from model routing', () => {
  const defaultBinding = binding();
  assert.equal(defaultBinding.toolPolicy.webSearch, false);

  const receipt = createTurnExecutionReceipt({
    binding: createConversationBinding({
      conversationId: 'search-enabled',
      profileId: 'cloud',
      providerKind: 'openai-compatible',
      modelId: 'model-x',
      toolPolicy: { webSearch: true, appleActions: 'approval-required' },
    }),
    messageId: 'm-search',
    runId: 'r-search',
    route: 'cloud-byok',
    externalEgress: ['external-search'],
  });

  assert.equal(receipt.route, 'cloud-byok');
  assert.deepEqual(receipt.externalEgress, ['external-search']);
});

test('turn receipts reject raw secrets anywhere in serialized input', () => {
  assert.throws(
    () => createTurnExecutionReceipt({
      binding: binding(),
      messageId: 'm-secret',
      runId: 'r-secret',
      route: 'cloud-byok',
      metadata: { access_token: 'leak' },
    }),
    /raw secret field is forbidden/,
  );
});

test('tool intent cannot execute until exact intent is approved', () => {
  const proposed = createToolIntent({
    tool: 'calendar.create',
    args: { title: 'Design review', start: '2026-10-07T13:00:00-04:00' },
    conversationId: 'conversation-a',
    runId: 'run-tool-1',
  });

  assert.equal(canExecuteToolIntent(proposed), false);
  const previewed = transitionToolIntent(proposed, 'previewed');
  assert.equal(canExecuteToolIntent(previewed), false);
  assert.throws(() => transitionToolIntent(previewed, 'approved', {
    approvalFingerprint: 'wrong',
  }), /approval does not match/);

  const approved = transitionToolIntent(previewed, 'approved', {
    approvalFingerprint: previewed.approvalFingerprint,
  });
  assert.equal(canExecuteToolIntent(approved), true);
});

test('changing tool arguments invalidates prior approval fingerprint', () => {
  const original = createToolIntent({
    tool: 'reminder.create',
    args: { title: 'Call Sam', hour: 9 },
    conversationId: 'conversation-a',
    runId: 'run-tool-2',
  });
  const changed = reviseToolIntentArgs(original, { title: 'Call Sam', hour: 17 });

  assert.notEqual(original.approvalFingerprint, changed.approvalFingerprint);
  const changedPreview = transitionToolIntent(changed, 'previewed');
  assert.throws(() => transitionToolIntent(changedPreview, 'approved', {
    approvalFingerprint: original.approvalFingerprint,
  }), /approval does not match/);
});

test('mail compose is draft-only by default', () => {
  const intent = createToolIntent({
    tool: 'mail.compose',
    args: { recipient: 'person@example.test', subject: 'Hello', body: 'Draft only' },
    conversationId: 'conversation-a',
    runId: 'run-mail',
  });

  assert.equal(intent.effect, 'draft');
});

test('unknown background support is never certified as supported', () => {
  const run = createMobileRunContinuation({ runId: 'run-bg' });
  assert.equal(run.backgroundCapability, 'unknown');
  assert.equal(isBackgroundCertified(run), false);
});

test('continuation is monotonic and duplicate replay cannot duplicate completion', () => {
  let run = createMobileRunContinuation({ runId: 'run-replay', backgroundCapability: 'supported' });
  run = applyContinuationEvent(run, { seq: 1, nextState: 'streaming', cursor: 1 }).state;
  run = applyContinuationEvent(run, {
    seq: 2,
    nextState: 'completed',
    cursor: 8,
    completedReceiptId: 'receipt-final',
  }).state;

  const replay = applyContinuationEvent(run, {
    seq: 2,
    nextState: 'completed',
    cursor: 8,
    completedReceiptId: 'receipt-final',
  });

  assert.equal(run.state, 'completed');
  assert.equal(run.completedReceiptId, 'receipt-final');
  assert.equal(replay.applied, false);
  assert.equal(replay.reason, 'duplicate-or-stale-event');
  assert.equal(replay.state, run);
});

test('stable digest is deterministic regardless of object key insertion order', () => {
  assert.equal(
    stableDigest({ z: 1, nested: { b: 2, a: 1 } }),
    stableDigest({ nested: { a: 1, b: 2 }, z: 1 }),
  );
});
