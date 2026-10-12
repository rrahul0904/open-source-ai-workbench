import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReadQuery, createDataWorkbench, createSyntheticAdapter } from '../src/data-workbench.mjs';

const dev = { id: 'dev-fixture', environment: 'development', password: 'never-serialize-me' };
const prod = { id: 'prod-fixture', environment: 'production', apiKey: 'never-serialize-me' };

test('synthetic schema and bounded SELECT execute with a receipt', async () => {
  const workbench = createDataWorkbench();
  const schema = workbench.inspectSchema();
  assert.deepEqual(schema.tables.map((table) => table.name), ['customers', 'orders']);
  const receipt = await workbench.run({ profile: dev, sql: 'SELECT id, name FROM customers LIMIT 2' });
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.policy.allowed, true);
  assert.equal(receipt.result.rowCount, 2);
  assert.deepEqual(receipt.result.rows[0], { id: 1, name: 'Ada' });
  assert.equal(JSON.stringify(receipt).includes('never-serialize-me'), false);
});

test('mutations, stacked statements and side-effect functions fail closed', async () => {
  const workbench = createDataWorkbench();
  for (const sql of [
    'DELETE FROM customers',
    'SELECT * FROM customers; DELETE FROM customers',
    "SELECT pg_read_file('/etc/passwd') FROM customers"
  ]) {
    const receipt = await workbench.run({ profile: dev, sql });
    assert.notEqual(receipt.status, 'succeeded', sql);
    assert.equal(receipt.policy.allowed, false, sql);
  }
});

test('production requires adapter-enforced read-only proof', async () => {
  const workbench = createDataWorkbench({ adapter: createSyntheticAdapter({ enforcedReadOnly: false }) });
  const receipt = await workbench.run({ profile: prod, sql: 'SELECT * FROM customers' });
  assert.equal(receipt.status, 'denied');
  assert.equal(receipt.policy.reason, 'production-readonly-proof-required');
});

test('history is filterable by connection and status', async () => {
  const workbench = createDataWorkbench();
  await workbench.run({ profile: dev, sql: 'SELECT * FROM customers' });
  await workbench.run({ profile: { id: 'other', environment: 'development' }, sql: 'UPDATE customers SET tier = \'x\'' });
  assert.equal(workbench.listHistory({ profileId: 'dev-fixture' }).length, 1);
  assert.equal(workbench.listHistory({ status: 'denied' }).length, 1);
});

test('mutation planning exposes exact SQL but cannot execute', () => {
  const workbench = createDataWorkbench();
  const plan = workbench.planMutation({ profile: dev, sql: "UPDATE customers SET tier = 'silver' WHERE id = 1" });
  assert.equal(plan.executable, false);
  assert.equal(plan.requiresSeparateAuthority, true);
  assert.match(plan.sql, /^UPDATE customers/i);
  assert.equal(JSON.stringify(plan).includes('never-serialize-me'), false);
});

test('read classifier permits one read statement and rejects writes', () => {
  assert.equal(classifyReadQuery('SELECT * FROM customers;').allowed, true);
  assert.equal(classifyReadQuery('SELECT * FROM customers; SELECT * FROM orders').allowed, false);
  assert.equal(classifyReadQuery('WITH x AS (DELETE FROM customers RETURNING *) SELECT * FROM x').allowed, false);
});
