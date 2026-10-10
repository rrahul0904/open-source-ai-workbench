import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectSchema,
  listSources,
  planQuery,
  runDataWorkbench,
  runReadQuery,
  searchExecutionReceipts
} from '../src/data-workbench.mjs';

test('sources and schema are deterministic and read-only proven', () => {
  const [source] = listSources();
  assert.equal(source.id, 'demo-analytics');
  assert.equal(source.readOnlyProof.enforced, true);
  const first = inspectSchema(source.id);
  const second = inspectSchema(source.id);
  assert.equal(first.revision, second.revision);
  assert.deepEqual(first.tables.map((table) => table.name), ['customers', 'orders']);
});

test('preserves 64-bit identifiers as strings at the API boundary', () => {
  const result = runReadQuery({
    sql: 'SELECT customer_id, name FROM customers WHERE customer_id = 844197938335842304',
    requestId: 'req-bigint'
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.result.rows[0].customer_id, '844197938335842304');
  assert.equal(typeof result.result.rows[0].customer_id, 'string');
});

test('supports star, ordering and bounded limits', () => {
  const result = runReadQuery({
    sql: 'SELECT * FROM customers ORDER BY customer_id DESC LIMIT 2',
    requestId: 'req-star-order'
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.result.rowCount, 2);
  assert.equal(result.result.rows[0].customer_id, '844197938335842306');
});

test('mutation and stacked statements fail closed with receipts', () => {
  const mutation = runReadQuery({ sql: "UPDATE customers SET name='x'", requestId: 'req-write' });
  assert.equal(mutation.status, 'denied');
  assert.equal(mutation.receipt.code, 'MUTATION_DENIED');

  const stacked = runReadQuery({
    sql: 'SELECT name FROM customers; DELETE FROM customers',
    requestId: 'req-stack'
  });
  assert.equal(stacked.status, 'denied');
  assert.equal(stacked.receipt.code, 'MULTI_STATEMENT_DENIED');
});

test('issued plans fail when tampered', () => {
  const base = planQuery({ sql: 'SELECT name FROM customers' });

  const sourceMismatch = structuredClone(base);
  sourceMismatch.sourceId = 'prod';
  assert.equal(runReadQuery({ plan: sourceMismatch, requestId: 'req-source' }).receipt.code, 'PLAN_TAMPERED');

  const stale = structuredClone(base);
  stale.schemaRevision = 'stale';
  assert.equal(runReadQuery({ plan: stale, requestId: 'req-stale' }).receipt.code, 'PLAN_TAMPERED');

  const queryTamper = structuredClone(base);
  queryTamper.query.table = 'orders';
  assert.equal(runReadQuery({ plan: queryTamper, requestId: 'req-tamper' }).receipt.code, 'PLAN_TAMPERED');
});

test('limits are bounded and repeated request ids are replay-safe', () => {
  const plan = planQuery({
    sql: 'SELECT customer_id FROM customers',
    limits: { maxRows: 2, maxPageSize: 1, maxBytes: 999999999 }
  });
  const first = runReadQuery({ plan, requestId: 'req-replay' });
  const second = runReadQuery({ plan, requestId: 'req-replay' });
  assert.equal(first.result.rowCount, 2);
  assert.equal(first.result.pageSize, 1);
  assert.ok(first.receipt.limits.maxBytes <= 64 * 1024);
  assert.equal(second.replayed, true);
  assert.equal(second.receipt.id, first.receipt.id);
});

test('receipts are searchable and do not persist secrets or raw SQL', () => {
  const result = runReadQuery({
    sql: "SELECT name FROM customers WHERE segment = 'enterprise'",
    requestId: 'req-search',
    password: 'dont-store-me'
  });
  const matches = searchExecutionReceipts({
    sourceId: 'demo-analytics',
    status: 'succeeded',
    sqlHash: result.receipt.sqlHash
  });
  assert.ok(matches.some((receipt) => receipt.id === result.receipt.id));
  const serialized = JSON.stringify(result.receipt);
  assert.equal(serialized.includes('dont-store-me'), false);
  assert.equal(serialized.includes('SELECT name'), false);
});

test('workflow facade exposes bounded agent-style actions', async () => {
  const planned = await runDataWorkbench({
    action: 'plan-query',
    sql: 'SELECT name FROM customers LIMIT 1'
  });
  assert.equal(planned.plan.operation, 'select');

  const executed = await runDataWorkbench({
    action: 'run-read-query',
    plan: planned.plan,
    requestId: 'req-facade'
  });
  assert.equal(executed.status, 'succeeded');
});
