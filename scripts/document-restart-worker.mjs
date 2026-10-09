import { EvidenceDocumentEngine } from '../src/document-intelligence.mjs';
import { FileEvidenceDocumentStore } from '../src/document-store.mjs';

const [mode, storePath] = process.argv.slice(2);
if (!mode || !storePath) throw new Error('usage: document-restart-worker.mjs <write|read> <store-path>');

const fixture = {
  tenantId: 'restart-tenant',
  documentId: 'restart-doc',
  mediaType: 'text/markdown',
  sourceKind: 'restart-fixture',
  content: '# Restart proof\nNorth generated 42 units.\n--- page:2 ---\n| Region | Units |\n| --- | --- |\n| South | 17 |',
};
const store = new FileEvidenceDocumentStore(storePath);

if (mode === 'write') {
  const engine = new EvidenceDocumentEngine();
  const persisted = await store.put(fixture);
  const receipt = engine.ingestAndIndex(fixture);
  process.stdout.write(JSON.stringify({ persisted, snapshot: engine.snapshot(), indexReceipt: receipt.indexReceipt }));
} else if (mode === 'read') {
  const engine = new EvidenceDocumentEngine();
  const snapshot = await store.hydrate(engine);
  const retrieval = engine.retrieve({ tenantId: fixture.tenantId, query: 'North 42 units' });
  const top = retrieval.hits[0];
  if (!top) throw new Error('restart replay returned no evidence');
  const evidence = engine.resolveCitation({ tenantId: fixture.tenantId, citation: top.evidenceCitation });
  process.stdout.write(JSON.stringify({ snapshot, retrieval, evidence }));
} else {
  throw new Error(`unknown mode: ${mode}`);
}
