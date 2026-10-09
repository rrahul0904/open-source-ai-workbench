import { createHash } from 'node:crypto';

const MAX_DOCUMENT_BYTES = 1_000_000;
const ALLOWED_MEDIA_TYPES = new Set(['text/plain', 'text/markdown']);

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function requireNonEmpty(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function stableLocator(locator) {
  return JSON.stringify(locator, Object.keys(locator).sort());
}

function normalizeText(content) {
  if (typeof content !== 'string') throw new Error('content must be UTF-8 text');
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function tokenize(text) {
  return [...new Set(String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) ?? [])];
}

export function createDocumentArtifact({ tenantId, documentId, sourceKind = 'fixture', mediaType = 'text/plain', content }) {
  const tenant = requireNonEmpty('tenantId', tenantId);
  const normalized = normalizeText(content);
  const sizeBytes = Buffer.byteLength(normalized, 'utf8');
  if (sizeBytes === 0) throw new Error('document is empty');
  if (sizeBytes > MAX_DOCUMENT_BYTES) throw new Error('document exceeds bounded fixture size');
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) throw new Error(`unsupported media type: ${mediaType}`);

  const sourceDigest = sha256(normalized);
  return Object.freeze({
    tenantId: tenant,
    documentId: documentId ? requireNonEmpty('documentId', documentId) : `doc_${sourceDigest.slice(0, 16)}`,
    sourceKind,
    sourceDigest,
    mediaType,
    sizeBytes,
    content: normalized,
    parsingPolicy: 'fixture-structured-text-v1',
  });
}

export function parseDocument(artifact) {
  if (!artifact?.sourceDigest || typeof artifact.content !== 'string') throw new Error('invalid document artifact');
  const lines = artifact.content.split('\n');
  const units = [];
  let page = 1;
  let section = 'root';
  let sectionIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const pageMarker = trimmed.match(/^---\s*page\s*:\s*(\d+)\s*---$/i);
    if (pageMarker) {
      page = Number(pageMarker[1]);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      sectionIndex += 1;
      section = heading[2].trim();
      units.push({
        kind: 'heading',
        text: section,
        locator: { page, sectionIndex, section, lineStart: i + 1, lineEnd: i + 1 },
      });
      continue;
    }

    const tableCells = trimmed.startsWith('|') && trimmed.endsWith('|')
      ? trimmed.slice(1, -1).split('|').map((cell) => cell.trim())
      : null;
    if (tableCells && tableCells.length >= 2 && !tableCells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      units.push({
        kind: 'table-row',
        text: tableCells.join(' | '),
        cells: tableCells,
        locator: { page, sectionIndex, section, lineStart: i + 1, lineEnd: i + 1, tableRow: i + 1 },
      });
      continue;
    }

    units.push({
      kind: 'paragraph',
      text: trimmed,
      locator: { page, sectionIndex, section, lineStart: i + 1, lineEnd: i + 1 },
    });
  }

  if (!units.length) throw new Error('parser produced no structural units');
  const unitsDigest = sha256(units.map((unit) => `${unit.kind}:${stableLocator(unit.locator)}:${unit.text}`).join('\n'));
  return Object.freeze({
    parserId: 'fixture-structured-text',
    parserVersion: '1',
    sourceDigest: artifact.sourceDigest,
    status: 'complete',
    units,
    unitsDigest,
    warnings: [],
    unsupportedRegions: [],
  });
}

export function createChunkPlan(parseReceipt) {
  if (parseReceipt?.status !== 'complete') throw new Error('cannot chunk incomplete parse');
  const chunks = parseReceipt.units.map((unit, index) => {
    const locator = Object.freeze({ ...unit.locator });
    const textDigest = sha256(unit.text);
    return Object.freeze({
      chunkId: `chk_${sha256(`${parseReceipt.sourceDigest}:${index}:${stableLocator(locator)}:${textDigest}`).slice(0, 20)}`,
      sourceDigest: parseReceipt.sourceDigest,
      structuralLocator: locator,
      kind: unit.kind,
      text: unit.text,
      textDigest,
      tokens: tokenize(unit.text),
    });
  });
  return Object.freeze({
    strategy: 'structural-unit-v1',
    sourceDigest: parseReceipt.sourceDigest,
    chunkSetDigest: sha256(chunks.map((chunk) => chunk.chunkId).join(':')),
    chunks,
  });
}

function scoreChunk(queryTokens, chunk) {
  if (!queryTokens.length) return 0;
  const haystack = new Set(chunk.tokens);
  const matches = queryTokens.filter((token) => haystack.has(token)).length;
  return matches / queryTokens.length;
}

export class EvidenceDocumentEngine {
  #documents = new Map();
  #indexes = new Map();

  #tenantMap(root, tenantId) {
    const tenant = requireNonEmpty('tenantId', tenantId);
    if (!root.has(tenant)) root.set(tenant, new Map());
    return root.get(tenant);
  }

  ingestAndIndex(input) {
    const artifact = createDocumentArtifact(input);
    const existing = this.#documents.get(artifact.tenantId)?.get(artifact.sourceDigest);
    if (existing) return { ...existing.receipt, idempotentReplay: true };

    // Build every derived artifact before publishing any tenant/index state.
    const parseReceipt = parseDocument(artifact);
    const chunkPlan = createChunkPlan(parseReceipt);
    const indexId = `idx_${sha256(`${artifact.tenantId}:${chunkPlan.chunkSetDigest}`).slice(0, 20)}`;
    const indexReceipt = Object.freeze({
      indexId,
      indexVersion: 'fixture-local-v1',
      sourceDigest: artifact.sourceDigest,
      chunkSetDigest: chunkPlan.chunkSetDigest,
      tenantId: artifact.tenantId,
      status: 'complete',
      chunkCount: chunkPlan.chunks.length,
    });
    const receipt = Object.freeze({ artifact: { ...artifact, content: undefined }, parseReceipt, chunkPlan: { ...chunkPlan, chunks: undefined }, indexReceipt, idempotentReplay: false });

    const documents = this.#tenantMap(this.#documents, artifact.tenantId);
    const indexes = this.#tenantMap(this.#indexes, artifact.tenantId);
    documents.set(artifact.sourceDigest, { artifact, receipt });
    indexes.set(indexId, { artifact, parseReceipt, chunkPlan, indexReceipt });
    return receipt;
  }

  retrieve({ tenantId, query, limit = 5 }) {
    const tenant = requireNonEmpty('tenantId', tenantId);
    const q = requireNonEmpty('query', query);
    const queryTokens = tokenize(q);
    const indexes = this.#indexes.get(tenant);
    if (!indexes) return Object.freeze({ queryDigest: sha256(q), tenantId: tenant, hits: [] });

    const hits = [];
    for (const entry of indexes.values()) {
      for (const chunk of entry.chunkPlan.chunks) {
        const lexicalScore = scoreChunk(queryTokens, chunk);
        if (lexicalScore <= 0) continue;
        hits.push({
          chunkId: chunk.chunkId,
          lexicalScore,
          sourceDigest: chunk.sourceDigest,
          structuralLocator: chunk.structuralLocator,
          text: chunk.text,
          evidenceCitation: {
            documentId: entry.artifact.documentId,
            sourceDigest: chunk.sourceDigest,
            structuralLocator: chunk.structuralLocator,
            evidenceTextDigest: chunk.textDigest,
          },
        });
      }
    }

    hits.sort((a, b) => b.lexicalScore - a.lexicalScore || a.chunkId.localeCompare(b.chunkId));
    return Object.freeze({
      tenantId: tenant,
      queryDigest: sha256(q),
      retrievalPolicy: 'fixture-lexical-v1',
      hits: hits.slice(0, Math.max(1, Math.min(Number(limit) || 5, 20))),
    });
  }

  resolveCitation({ tenantId, citation }) {
    const tenant = requireNonEmpty('tenantId', tenantId);
    if (!citation?.sourceDigest || !citation?.evidenceTextDigest) throw new Error('invalid citation');
    const documents = this.#documents.get(tenant);
    const indexes = this.#indexes.get(tenant);
    if (!documents || !indexes || !documents.has(citation.sourceDigest)) throw new Error('citation source not found in tenant scope');

    for (const entry of indexes.values()) {
      if (entry.artifact.sourceDigest !== citation.sourceDigest) continue;
      const chunk = entry.chunkPlan.chunks.find((candidate) =>
        candidate.textDigest === citation.evidenceTextDigest &&
        stableLocator(candidate.structuralLocator) === stableLocator(citation.structuralLocator)
      );
      if (chunk) return Object.freeze({
        documentId: entry.artifact.documentId,
        sourceDigest: entry.artifact.sourceDigest,
        locator: chunk.structuralLocator,
        text: chunk.text,
        verified: true,
      });
    }
    throw new Error('citation does not resolve to indexed evidence');
  }

  snapshot() {
    const tenants = [...this.#documents.keys()].sort().map((tenantId) => ({
      tenantId,
      sourceDigests: [...this.#documents.get(tenantId).keys()].sort(),
      indexIds: [...(this.#indexes.get(tenantId)?.keys() ?? [])].sort(),
    }));
    return Object.freeze({ version: 'evidence-document-engine-v1', tenants, digest: sha256(JSON.stringify(tenants)) });
  }
}
