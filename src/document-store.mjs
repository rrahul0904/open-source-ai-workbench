import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDocumentArtifact } from './document-intelligence.mjs';

const STORE_VERSION = 1;

async function readStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.records)) throw new Error('unsupported evidence document store format');
    return parsed.records;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function atomicWrite(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify({ version: STORE_VERSION, records }, null, 2);
  await writeFile(tempPath, body, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
}

export class FileEvidenceDocumentStore {
  constructor(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('filePath is required');
    this.filePath = path.resolve(filePath);
  }

  async put(input) {
    // Reuse the engine artifact validator so unsupported/oversized input is never persisted.
    const artifact = createDocumentArtifact(input);
    const records = await readStore(this.filePath);
    const existing = records.find((record) => record.tenantId === artifact.tenantId && record.sourceDigest === artifact.sourceDigest);
    if (existing) return { sourceDigest: existing.sourceDigest, idempotentReplay: true };

    const record = {
      tenantId: artifact.tenantId,
      documentId: artifact.documentId,
      sourceKind: artifact.sourceKind,
      mediaType: artifact.mediaType,
      content: artifact.content,
      sourceDigest: artifact.sourceDigest,
      parsingPolicy: artifact.parsingPolicy,
    };
    await atomicWrite(this.filePath, [...records, record]);
    return { sourceDigest: record.sourceDigest, idempotentReplay: false };
  }

  async hydrate(engine) {
    if (!engine?.ingestAndIndex || !engine?.snapshot) throw new Error('evidence document engine is required');
    const records = await readStore(this.filePath);
    for (const record of records) {
      const receipt = engine.ingestAndIndex(record);
      if (receipt.indexReceipt.sourceDigest !== record.sourceDigest) throw new Error('stored source digest failed replay verification');
    }
    return engine.snapshot();
  }

  async list() {
    return readStore(this.filePath);
  }
}
