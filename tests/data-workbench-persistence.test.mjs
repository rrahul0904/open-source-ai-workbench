import test from 'node:test';
import assert from 'node:assert/strict';
import { listRuns } from '../src/storage.mjs';
import { executeWorkflow } from '../src/workflows.mjs';

test('Data Workbench workflow persistence redacts raw SQL and secret-shaped input fields', async () => {
  const rawSql = "SELECT customer_id, name FROM customers WHERE segment = 'enterprise'";
  const secret = 'should-never-be-persisted';
  const run = await executeWorkflow('data-workbench', {
    action: 'run-read-query',
    sql: rawSql,
    requestId: 're394-persistence-redaction',
    password: secret,
    nested: { apiKey: 'nested-secret' }
  });
  assert.equal(run.status, 'succeeded');

  const persisted = (await listRuns(100)).find((candidate) => candidate.id === run.id);
  assert.ok(persisted);
  assert.equal(persisted.input.password, '[REDACTED]');
  assert.equal(persisted.input.nested.apiKey, '[REDACTED]');
  assert.equal(persisted.input.sql.redacted, true);
  assert.equal(typeof persisted.input.sql.sha256, 'string');
  assert.ok(persisted.input.sql.sha256.length > 20);

  const serialized = JSON.stringify(persisted);
  assert.equal(serialized.includes(rawSql), false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('nested-secret'), false);
});

test('non-Data-Workbench run persistence is not rewritten by the database redaction policy', async () => {
  const run = await executeWorkflow('engineering-agent', { goal: 'Verify persistence boundary' });
  const persisted = (await listRuns(100)).find((candidate) => candidate.id === run.id);
  assert.ok(persisted);
  assert.equal(persisted.input.goal, 'Verify persistence boundary');
});
