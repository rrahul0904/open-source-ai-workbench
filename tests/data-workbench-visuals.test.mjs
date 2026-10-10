import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileVisualQuery,
  planSchemaMaterialization,
  projectRows,
  runProjectedQuery,
  validateMaterializationPlan
} from '../src/data-workbench-visuals.mjs';

test('same safe query projects to table tree and json without losing int64 identity', () => {
  const modes = ['table', 'tree', 'json'].map((mode) => runProjectedQuery({
    sql: 'SELECT customer_id, name FROM customers ORDER BY customer_id ASC LIMIT 2',
    requestId: `re394-${mode}`,
    mode
  }));
  for (const run of modes) {
    assert.equal(run.execution.status, 'succeeded');
    assert.equal(run.projection.status, 'succeeded');
    assert.equal(run.projection.canonicalRows[0].fields.customer_id.type, 'int64');
    assert.equal(run.projection.canonicalRows[0].fields.customer_id.value, '844197938335842304');
    assert.equal(JSON.stringify(run.projection.receipt).includes('SELECT customer_id'), false);
  }
  assert.equal(modes[0].projection.receipt.canonicalHash, modes[1].projection.receipt.canonicalHash);
  assert.equal(modes[1].projection.receipt.canonicalHash, modes[2].projection.receipt.canonicalHash);
});

test('nested values remain typed and unsafe integers fail closed', () => {
  const nested = projectRows({
    mode: 'tree',
    rows: [{ id: 9223372036854775807n, profile: { tags: ['a', 'b'], flags: [true, null] } }]
  });
  assert.equal(nested.status, 'succeeded');
  assert.equal(nested.canonicalRows[0].fields.id.type, 'bigint');
  assert.equal(nested.canonicalRows[0].fields.id.value, '9223372036854775807');
  assert.equal(nested.canonicalRows[0].fields.profile.type, 'object');

  const unsafe = projectRows({ rows: [{ id: Number.MAX_SAFE_INTEGER + 10 }] });
  assert.equal(unsafe.status, 'failed');
  assert.equal(unsafe.error.code, 'UNSAFE_INTEGER_DENIED');
});

test('render budgets truncate rows and reject pathological nesting safely', () => {
  const truncated = projectRows({ rows: [{ a: 1 }, { a: 2 }, { a: 3 }], budget: { maxRows: 2 } });
  assert.equal(truncated.status, 'succeeded');
  assert.equal(truncated.receipt.truncated, true);
  assert.equal(truncated.receipt.renderedRows, 2);
  assert.equal(truncated.receipt.code, 'RENDER_TRUNCATED');

  const deep = projectRows({ rows: [{ a: { b: { c: { d: 1 } } } }], budget: { maxDepth: 2 } });
  assert.equal(deep.status, 'failed');
  assert.equal(deep.error.code, 'RENDER_DEPTH_LIMIT');

  const cyclic = {};
  cyclic.self = cyclic;
  const cycleResult = projectRows({ rows: [cyclic] });
  assert.equal(cycleResult.status, 'failed');
  assert.equal(cycleResult.error.code, 'CYCLIC_VALUE_DENIED');
});

test('visual query AST compiles only to the safe planner subset', () => {
  const compiled = compileVisualQuery({
    table: 'customers',
    select: ['customer_id', 'name'],
    filter: { column: 'segment', op: 'eq', value: { type: 'string', value: 'enterprise' } },
    orderBy: { column: 'customer_id', direction: 'asc' },
    limit: 2
  });
  assert.equal(compiled.plan.operation, 'select');
  assert.equal(compiled.plan.query.table, 'customers');

  assert.throws(() => compileVisualQuery({ table: 'customers; DELETE FROM customers', select: ['*'] }), /Unknown table/);
  assert.throws(() => compileVisualQuery({ table: 'customers', select: ['name; DROP TABLE orders'] }), /unknown column/i);
});

test('schema materialization remains a preview-only revision-bound plan', () => {
  const preview = planSchemaMaterialization({
    operations: [{ type: 'add-column', table: 'customers', column: 'region', dataType: 'text' }]
  });
  assert.equal(preview.mode, 'preview-only');
  assert.equal(preview.executable, false);
  assert.deepEqual(validateMaterializationPlan(preview), { valid: true, code: 'PREVIEW_VALID', executable: false });
  assert.deepEqual(validateMaterializationPlan(preview, { currentRevision: 'different' }), { valid: false, code: 'MATERIALIZATION_PLAN_STALE', executable: false });

  const tampered = structuredClone(preview);
  tampered.operations[0].column = 'secret';
  assert.deepEqual(validateMaterializationPlan(tampered), { valid: false, code: 'MATERIALIZATION_PLAN_TAMPERED', executable: false });

  assert.throws(() => planSchemaMaterialization({ operations: [{ type: 'add-column', table: 'customers', column: 'x', rawSql: 'ALTER TABLE customers' }] }), /Raw mutation text/);
});
