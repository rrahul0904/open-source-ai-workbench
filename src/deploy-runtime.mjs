import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PLAN_VERSION = 'deploy-plan/v1';
const RECEIPT_VERSION = 'deploy-receipt/v1';
const DEFAULT_PRUNE = new Set(['.git', '.hg', '.svn', 'node_modules', '.cache', '.turbo']);
const SECRET_BASENAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.development', '.npmrc', '.pypirc',
  'id_rsa', 'id_ed25519', 'credentials', 'credentials.json', 'service-account.json'
]);
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);
const BUILDERS = new Set(['dockerfile', 'railpack']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function assertPositiveInteger(name, value, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TypeError(`${name} must be an integer between 1 and ${max}`);
}

function isSecretPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const basename = path.posix.basename(normalized).toLowerCase();
  if (SECRET_BASENAMES.has(basename)) return true;
  if (basename.startsWith('.env.')) return true;
  if (SECRET_EXTENSIONS.has(path.posix.extname(basename))) return true;
  return normalized.toLowerCase().includes('/.ssh/');
}

function normalizeRevision(revision) {
  const value = String(revision || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new TypeError('sourceRevision must be an exact 40-character Git SHA');
  return value.toLowerCase();
}

function normalizeResources(resources = {}) {
  const cpuMilli = resources.cpuMilli ?? 500;
  const memoryMb = resources.memoryMb ?? 512;
  const timeoutSeconds = resources.timeoutSeconds ?? 300;
  assertPositiveInteger('resources.cpuMilli', cpuMilli, 8000);
  assertPositiveInteger('resources.memoryMb', memoryMb, 32768);
  assertPositiveInteger('resources.timeoutSeconds', timeoutSeconds, 3600);
  return Object.freeze({ cpuMilli, memoryMb, timeoutSeconds });
}

async function walk(root, current, state, options) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    const relative = path.relative(root, full).replaceAll('\\', '/');
    if (!relative || relative.startsWith('../')) throw new Error('Source traversal escaped the explicit root');
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in deployment source: ${relative}`);
    if (entry.isDirectory()) {
      if (options.prune.has(entry.name)) continue;
      await walk(root, full, state, options);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSecretPath(relative)) throw new Error(`Secret-like source path is not deployable: ${relative}`);
    state.files += 1;
    if (state.files > options.maxFiles) throw new Error(`Deployment source exceeds maxFiles=${options.maxFiles}`);
    const stat = await fs.stat(full);
    if (stat.size > options.maxFileBytes) throw new Error(`Deployment source file exceeds maxFileBytes: ${relative}`);
    state.bytes += stat.size;
    if (state.bytes > options.maxTotalBytes) throw new Error(`Deployment source exceeds maxTotalBytes=${options.maxTotalBytes}`);
    const body = await fs.readFile(full);
    state.manifest.push(Object.freeze({ path: relative, bytes: body.length, sha256: sha256(body) }));
  }
}

export async function inspectDeploymentSource(sourceRoot, {
  maxFiles = 2000,
  maxFileBytes = 2_000_000,
  maxTotalBytes = 20_000_000,
  prune = DEFAULT_PRUNE
} = {}) {
  assertPositiveInteger('maxFiles', maxFiles, 100_000);
  assertPositiveInteger('maxFileBytes', maxFileBytes, 100_000_000);
  assertPositiveInteger('maxTotalBytes', maxTotalBytes, 2_000_000_000);

  const root = await fs.realpath(sourceRoot);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new TypeError('sourceRoot must be a directory');
  const state = { files: 0, bytes: 0, manifest: [] };
  await walk(root, root, state, { maxFiles, maxFileBytes, maxTotalBytes, prune: new Set(prune) });
  if (!state.files) throw new Error('Deployment source contains no eligible files');

  const manifestDigest = sha256(stableJson(state.manifest));
  return Object.freeze({
    root,
    fileCount: state.files,
    totalBytes: state.bytes,
    manifestDigest,
    manifest: Object.freeze(state.manifest.slice())
  });
}

async function detectBuilder(sourceRoot, requested) {
  if (requested && requested !== 'auto') {
    if (!BUILDERS.has(requested)) throw new TypeError('builder must be auto, dockerfile, or railpack');
    return requested;
  }
  try {
    const stat = await fs.stat(path.join(sourceRoot, 'Dockerfile'));
    if (stat.isFile()) return 'dockerfile';
  } catch {}
  try {
    const stat = await fs.stat(path.join(sourceRoot, 'package.json'));
    if (stat.isFile()) return 'railpack';
  } catch {}
  throw new Error('Could not safely detect a supported builder; add a Dockerfile or package.json');
}

export async function createDeploymentPlan({
  sourceRoot,
  sourceRevision,
  builder = 'auto',
  startCommand = null,
  healthcheckPath = '/healthz',
  resources,
  environmentVariableNames = []
} = {}) {
  if (!sourceRoot) throw new TypeError('sourceRoot is required');
  const revision = normalizeRevision(sourceRevision);
  if (startCommand !== null && (typeof startCommand !== 'string' || !startCommand.trim())) throw new TypeError('startCommand must be a non-empty string or null');
  if (typeof healthcheckPath !== 'string' || !healthcheckPath.startsWith('/') || healthcheckPath.includes('://')) throw new TypeError('healthcheckPath must be an absolute URL path');
  const envNames = [...new Set(environmentVariableNames.map((name) => String(name).trim()))].sort();
  for (const name of envNames) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new TypeError(`Invalid environment variable name: ${name}`);
  }

  const source = await inspectDeploymentSource(sourceRoot);
  const selectedBuilder = await detectBuilder(source.root, builder);
  const normalized = {
    version: PLAN_VERSION,
    source: {
      revision,
      manifestDigest: source.manifestDigest,
      fileCount: source.fileCount,
      totalBytes: source.totalBytes
    },
    build: {
      builder: selectedBuilder,
      startCommand: startCommand?.trim() || null,
      healthcheckPath
    },
    resources: normalizeResources(resources),
    environmentVariableNames: envNames
  };
  const planDigest = sha256(stableJson(normalized));
  return Object.freeze({
    ...normalized,
    planDigest,
    sourceRoot: source.root,
    approvalRequired: true
  });
}

export function approveDeploymentPlan(plan, { approvalSecret, approvedBy = 'human' } = {}) {
  if (!plan?.planDigest || plan.version !== PLAN_VERSION) throw new TypeError('A valid deployment plan is required');
  if (!approvalSecret || String(approvalSecret).length < 16) throw new TypeError('approvalSecret must be at least 16 characters');
  const approval = {
    version: 'deploy-approval/v1',
    planDigest: plan.planDigest,
    approvedBy: String(approvedBy),
    scope: 'deploy-exact-plan'
  };
  const signature = createHmac('sha256', String(approvalSecret)).update(stableJson(approval)).digest('hex');
  return Object.freeze({ ...approval, signature });
}

function verifyApproval(plan, approval, approvalSecret) {
  if (!approval || approval.planDigest !== plan.planDigest || approval.scope !== 'deploy-exact-plan') return false;
  const unsigned = {
    version: approval.version,
    planDigest: approval.planDigest,
    approvedBy: approval.approvedBy,
    scope: approval.scope
  };
  const expected = createHmac('sha256', String(approvalSecret)).update(stableJson(unsigned)).digest();
  const supplied = Buffer.from(String(approval.signature || ''), 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function validateProviderReceipt(plan, providerName, result) {
  if (!result || typeof result !== 'object') throw new Error('Deployment provider returned no receipt');
  const deploymentId = String(result.deploymentId || '');
  if (!deploymentId) throw new Error('Deployment provider receipt requires deploymentId');
  const state = String(result.state || '');
  if (!['queued', 'building', 'deploying', 'ready', 'failed'].includes(state)) throw new Error(`Unsupported deployment state: ${state}`);
  const url = result.url == null ? null : String(result.url);
  if (url !== null) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Deployment URL must use HTTPS');
  }
  return Object.freeze({
    version: RECEIPT_VERSION,
    planDigest: plan.planDigest,
    sourceRevision: plan.source.revision,
    sourceManifestDigest: plan.source.manifestDigest,
    provider: providerName,
    deploymentId,
    state,
    url,
    providerReceipt: result.providerReceipt ?? null
  });
}

export async function executeDeploymentPlan(plan, {
  approval,
  approvalSecret,
  provider
} = {}) {
  if (!plan?.planDigest || plan.version !== PLAN_VERSION) throw new TypeError('A valid deployment plan is required');
  if (!approvalSecret || !verifyApproval(plan, approval, approvalSecret)) throw new Error('Exact-plan deployment approval is required');
  if (!provider || typeof provider.deploy !== 'function') throw new TypeError('provider.deploy(plan) is required');
  const providerName = String(provider.name || '').trim();
  if (!providerName) throw new TypeError('provider.name is required');

  const fresh = await inspectDeploymentSource(plan.sourceRoot);
  if (fresh.manifestDigest !== plan.source.manifestDigest) throw new Error('Deployment source changed after approval; create and approve a new plan');

  const result = await provider.deploy(plan);
  return validateProviderReceipt(plan, providerName, result);
}

export function classifyDeploymentReceipt(receipt) {
  if (!receipt || receipt.version !== RECEIPT_VERSION) throw new TypeError('A valid deployment receipt is required');
  return Object.freeze({
    deployed: receipt.state === 'ready',
    publicHttpsVerified: receipt.state === 'ready' && Boolean(receipt.url?.startsWith('https://')),
    productionReady: false,
    isolationVerified: false,
    scaleToZeroVerified: false
  });
}
