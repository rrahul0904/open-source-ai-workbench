import path from 'node:path';
import { createDemoPolicy, createPreviewRuntime } from './preview-runtime.mjs';
import { createTunnelAgent } from './preview-relay.mjs';
import { createDeploymentPlan, classifyDeploymentReceipt } from './deploy-runtime.mjs';

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'preview_policy_check',
    description: 'Evaluate whether one HTTP request would be forwarded by the safe-preview demo policy. No network side effects.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        method: { type: 'string', minLength: 1 },
        path: { type: 'string', pattern: '^/' },
        allowedMutations: {
          type: 'array',
          maxItems: 64,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['method', 'path'],
            properties: {
              method: { type: 'string', minLength: 1 },
              path: { type: 'string', pattern: '^/' }
            }
          }
        }
      },
      required: ['method', 'path']
    }
  },
  {
    name: 'deploy_plan',
    description: 'Create a deterministic, exact-SHA deployment plan from an explicitly allowed local source root. This never deploys.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sourceRoot: { type: 'string', minLength: 1 },
        sourceRevision: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
        builder: { type: 'string', enum: ['auto', 'dockerfile', 'railpack'] },
        startCommand: { type: ['string', 'null'] },
        healthcheckPath: { type: 'string', pattern: '^/' },
        environmentVariableNames: {
          type: 'array',
          maxItems: 128,
          items: { type: 'string', pattern: '^[A-Z_][A-Z0-9_]*$' }
        }
      },
      required: ['sourceRoot', 'sourceRevision']
    }
  },
  {
    name: 'deploy_receipt_classify',
    description: 'Classify an existing normalized deployment receipt without inferring unsupported production, isolation, or scale-to-zero claims.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['receipt'],
      properties: {
        receipt: { type: 'object' }
      }
    }
  },
  {
    name: 'share_start',
    description: 'Create an ephemeral public share through the configured relay. Requires server-side enablement and explicit per-call confirmation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['upstream', 'confirmExternalShare'],
      properties: {
        upstream: { type: 'string', minLength: 1 },
        ttlMs: { type: 'integer', minimum: 1000, maximum: 3600000 },
        confirmExternalShare: { const: true },
        freeze: { type: 'boolean' },
        injectWidget: { type: 'boolean' },
        allowedMutations: {
          type: 'array',
          maxItems: 64,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['method', 'path'],
            properties: {
              method: { type: 'string', minLength: 1 },
              path: { type: 'string', pattern: '^/' }
            }
          }
        }
      }
    }
  },
  {
    name: 'share_status',
    description: 'Read the current agent-owned ephemeral share state. No network mutation.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'share_requests',
    description: 'Read bounded redacted request receipts from the current agent-owned share.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'share_feedback',
    description: 'Read bounded feedback captured by the current agent-owned share.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'share_stop',
    description: 'Stop and revoke the current agent-owned ephemeral share. Requires explicit per-call confirmation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['confirmStop'],
      properties: { confirmStop: { const: true } }
    }
  }
]);

function assertPlainObject(value, label = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function assertKnownKeys(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`Unknown argument: ${key}`);
  }
}

function withinRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function sanitizePlan(plan) {
  return {
    version: plan.version,
    planDigest: plan.planDigest,
    source: plan.source,
    build: plan.build,
    resources: plan.resources,
    environmentVariableNames: plan.environmentVariableNames,
    approvalRequired: plan.approvalRequired
  };
}

export function createAgentToolRuntime({
  allowedSourceRoots = [],
  allowPublicShare = false,
  relayUrl = null,
  relayOperatorKey = null,
  defaultShareTtlMs = 15 * 60_000
} = {}) {
  const normalizedRoots = allowedSourceRoots.map((root) => path.resolve(root));
  let share = null;

  async function stopShare() {
    if (!share) return { stopped: false, reason: 'no-active-share' };
    const current = share;
    share = null;
    current.abort.abort();
    await current.agent.close().catch(() => {});
    await current.preview.close().catch(() => {});
    await current.loop.catch(() => {});
    return { stopped: true };
  }

  async function call(name, rawArguments = {}) {
    const args = assertPlainObject(rawArguments);
    switch (name) {
      case 'preview_policy_check': {
        assertKnownKeys(args, new Set(['method', 'path', 'allowedMutations']));
        const method = String(args.method || '').toUpperCase();
        const requestPath = String(args.path || '');
        if (!method || !requestPath.startsWith('/')) throw new TypeError('method and absolute path are required');
        const policy = createDemoPolicy({ allowedMutations: args.allowedMutations || [] });
        return { method, path: requestPath, ...policy.evaluate(method, requestPath) };
      }

      case 'deploy_plan': {
        assertKnownKeys(args, new Set(['sourceRoot', 'sourceRevision', 'builder', 'startCommand', 'healthcheckPath', 'environmentVariableNames']));
        if (!normalizedRoots.length) throw new Error('No deployment source roots are configured');
        const requestedRoot = path.resolve(String(args.sourceRoot || ''));
        if (!normalizedRoots.some((root) => withinRoot(requestedRoot, root))) throw new Error('Requested sourceRoot is outside the configured allowlist');
        const plan = await createDeploymentPlan({
          sourceRoot: requestedRoot,
          sourceRevision: args.sourceRevision,
          builder: args.builder || 'auto',
          startCommand: args.startCommand ?? null,
          healthcheckPath: args.healthcheckPath || '/healthz',
          environmentVariableNames: args.environmentVariableNames || []
        });
        return sanitizePlan(plan);
      }

      case 'deploy_receipt_classify': {
        assertKnownKeys(args, new Set(['receipt']));
        return classifyDeploymentReceipt(args.receipt);
      }

      case 'share_start': {
        assertKnownKeys(args, new Set(['upstream', 'ttlMs', 'confirmExternalShare', 'freeze', 'injectWidget', 'allowedMutations']));
        if (!allowPublicShare) throw new Error('Public share is disabled by server policy');
        if (args.confirmExternalShare !== true) throw new Error('confirmExternalShare=true is required');
        if (!relayUrl || !relayOperatorKey) throw new Error('Relay URL and operator key must be configured server-side');
        if (share) throw new Error('An agent-owned share is already active');

        const ttlMs = args.ttlMs ?? defaultShareTtlMs;
        if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600000) throw new TypeError('ttlMs must be 1000-3600000');

        const preview = createPreviewRuntime({
          upstream: String(args.upstream || ''),
          freeze: args.freeze !== false,
          injectWidget: args.injectWidget !== false,
          allowedMutations: args.allowedMutations || []
        });
        const address = await preview.listen({ host: '127.0.0.1', port: 0 });
        const previewUrl = `http://127.0.0.1:${address.port}`;
        const agent = createTunnelAgent({ relayUrl, operatorKey: relayOperatorKey, previewUrl, ttlMs });
        const session = await agent.register();
        const abort = new AbortController();
        const loop = agent.run({ signal: abort.signal });
        share = { preview, agent, abort, loop, session, upstream: String(args.upstream), startedAt: new Date().toISOString() };
        return {
          active: true,
          publicUrl: session.publicUrl,
          expiresAt: session.expiresAt,
          upstream: share.upstream,
          demoPolicy: 'default-deny-mutations'
        };
      }

      case 'share_status': {
        assertKnownKeys(args, new Set());
        if (!share) return { active: false };
        return {
          active: true,
          publicUrl: share.session.publicUrl,
          expiresAt: share.session.expiresAt,
          upstream: share.upstream,
          startedAt: share.startedAt,
          capturedRequests: share.preview.listRequests().length,
          feedbackCount: share.preview.listFeedback().length
        };
      }

      case 'share_requests': {
        assertKnownKeys(args, new Set());
        return { active: Boolean(share), requests: share ? share.preview.listRequests() : [] };
      }

      case 'share_feedback': {
        assertKnownKeys(args, new Set());
        return { active: Boolean(share), feedback: share ? share.preview.listFeedback() : [] };
      }

      case 'share_stop': {
        assertKnownKeys(args, new Set(['confirmStop']));
        if (args.confirmStop !== true) throw new Error('confirmStop=true is required');
        return stopShare();
      }

      default:
        throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'UNKNOWN_TOOL' });
    }
  }

  return {
    tools: () => TOOL_DEFINITIONS.map((tool) => structuredClone(tool)),
    call,
    close: stopShare
  };
}
