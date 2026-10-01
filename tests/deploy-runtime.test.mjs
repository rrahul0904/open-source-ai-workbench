import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  inspectDeploymentSource,
  createDeploymentPlan,
  approveDeploymentPlan,
  executeDeploymentPlan,
  classifyDeploymentReceipt
} from '../src/deploy-runtime.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const SECRET = 'approval-secret-for-tests';

async function fixture(files = { 'package.json': '{"name":"demo"}', 'server.mjs': 'console.log("ok")' }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deploy-runtime-'));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

test('source inspection is deterministic and sorted', async () => {
  const root = await fixture({ 'z.txt': 'z', 'package.json': '{}', 'a.txt': 'a' });
  try {
    const one = await inspectDeploymentSource(root);
    const two = await inspectDeploymentSource(root);
    assert.equal(one.manifestDigest, two.manifestDigest);
    assert.deepEqual(one.manifest.map((item) => item.path), ['a.txt', 'package.json', 'z.txt']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('secret-like files are rejected instead of silently shipped', async () => {
  const root = await fixture({ 'package.json': '{}', '.env': 'TOKEN=secret' });
  try {
    await assert.rejects(() => inspectDeploymentSource(root), /Secret-like source path/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('root .ssh material is rejected', async () => {
  const root = await fixture({ 'package.json': '{}', '.ssh/config': 'Host *' });
  try {
    await assert.rejects(() => inspectDeploymentSource(root), /Secret-like source path/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('symlinks are rejected', async () => {
  const root = await fixture();
  try {
    await symlink(path.join(root, 'server.mjs'), path.join(root, 'linked.mjs'));
    await assert.rejects(() => inspectDeploymentSource(root), /Symlinks are not allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source traversal is bounded', async () => {
  const root = await fixture({ 'package.json': '{}', 'one.txt': '1', 'two.txt': '2' });
  try {
    await assert.rejects(() => inspectDeploymentSource(root, { maxFiles: 2 }), /exceeds maxFiles/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('plan requires an exact Git SHA and selects Railpack for package.json', async () => {
  const root = await fixture();
  try {
    await assert.rejects(() => createDeploymentPlan({ sourceRoot: root, sourceRevision: 'main' }), /exact 40-character Git SHA/);
    const plan = await createDeploymentPlan({ sourceRoot: root, sourceRevision: SHA, environmentVariableNames: ['PORT', 'NODE_ENV', 'PORT'] });
    assert.equal(plan.build.builder, 'railpack');
    assert.deepEqual(plan.environmentVariableNames, ['NODE_ENV', 'PORT']);
    assert.equal(plan.approvalRequired, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Dockerfile wins auto builder detection', async () => {
  const root = await fixture({ Dockerfile: 'FROM node:22-alpine', 'package.json': '{}' });
  try {
    const plan = await createDeploymentPlan({ sourceRoot: root, sourceRevision: SHA });
    assert.equal(plan.build.builder, 'dockerfile');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('deployment cannot execute without exact-plan approval', async () => {
  const root = await fixture();
  try {
    const plan = await createDeploymentPlan({ sourceRoot: root, sourceRevision: SHA });
    const provider = { name: 'fake', async deploy() { return { deploymentId: 'd1', state: 'ready', url: 'https://example.invalid' }; } };
    await assert.rejects(() => executeDeploymentPlan(plan, { provider, approvalSecret: SECRET }), /Exact-plan deployment approval/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source mutation after approval invalidates deployment', async () => {
  const root = await fixture();
  try {
    const plan = await createDeploymentPlan({ sourceRoot: root, sourceRevision: SHA });
    const approval = approveDeploymentPlan(plan, { approvalSecret: SECRET });
    await writeFile(path.join(root, 'server.mjs'), 'console.log("changed")');
    const provider = { name: 'fake', async deploy() { throw new Error('must not run'); } };
    await assert.rejects(() => executeDeploymentPlan(plan, { approval, approvalSecret: SECRET, provider }), /source changed after approval/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ready provider receipt is exact-plan-bound but makes no unsupported readiness claims', async () => {
  const root = await fixture();
  try {
    const plan = await createDeploymentPlan({ sourceRoot: root, sourceRevision: SHA });
    const approval = approveDeploymentPlan(plan, { approvalSecret: SECRET, approvedBy: 'test-human' });
    const provider = {
      name: 'synthetic-provider',
      async deploy(received) {
        assert.equal(received.planDigest, plan.planDigest);
        return { deploymentId: 'deploy-123', state: 'ready', url: 'https://preview.example.invalid', providerReceipt: { synthetic: true } };
      }
    };
    const receipt = await executeDeploymentPlan(plan, { approval, approvalSecret: SECRET, provider });
    assert.equal(receipt.planDigest, plan.planDigest);
    assert.equal(receipt.sourceRevision, SHA);
    assert.equal(receipt.state, 'ready');
    const classification = classifyDeploymentReceipt(receipt);
    assert.deepEqual(classification, {
      deployed: true,
      publicHttpsVerified: true,
      productionReady: false,
      isolationVerified: false,
      scaleToZeroVerified: false
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('provider cannot claim an insecure public URL', async () => {
  const root = await fixture();
  try {
    const plan = await createDeploymentPlan({ sourceRoot: root, sourceRevision: SHA });
    const approval = approveDeploymentPlan(plan, { approvalSecret: SECRET });
    const provider = { name: 'bad-provider', async deploy() { return { deploymentId: 'd1', state: 'ready', url: 'http://plain.example.invalid' }; } };
    await assert.rejects(() => executeDeploymentPlan(plan, { approval, approvalSecret: SECRET, provider }), /must use HTTPS/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
