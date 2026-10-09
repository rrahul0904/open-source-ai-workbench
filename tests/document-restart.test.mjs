import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

function runWorker(mode, storePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/document-restart-worker.mjs', mode, storePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`restart worker ${mode} failed (${code}): ${stderr}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(new Error(`restart worker ${mode} returned invalid JSON: ${error.message}`)); }
    });
  });
}

test('file store replays the same source and verified citation in a fresh process', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 're389-restart-'));
  const storePath = path.join(directory, 'documents.json');
  try {
    const written = await runWorker('write', storePath);
    assert.equal(written.persisted.idempotentReplay, false);
    assert.equal(written.indexReceipt.status, 'complete');
    assert.equal(written.snapshot.tenants.length, 1);

    const replayed = await runWorker('read', storePath);
    assert.equal(replayed.snapshot.digest, written.snapshot.digest);
    assert.equal(replayed.retrieval.hits.length > 0, true);
    assert.equal(replayed.evidence.verified, true);
    assert.equal(replayed.evidence.sourceDigest, written.indexReceipt.sourceDigest);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
