import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkflow } from '../src/workflows.mjs';
import {
  listDataWorkbenchReceipts,
  resetDataWorkbenchHistoryForTests,
  runDataWorkbench
} from '../src/data-workbench.mjs';

test.beforeEach(() => resetDataWorkbenchHistoryForTests());

test('synthetic read-only query returns schema, bounded rows and receipt', () => {
  const output = runDataWorkbench({
    connectionId: 'demo-a',
    query: "SELECT id, name, department FROM employees WHERE department = 'Engineering' ORDER BY id ASC LIMIT 10"
  });
  assert.equal(output.execution.status, 'succeeded');
  assert.equal(output.execution.policy.code, 'ALLOW_READ_ONLY_SELECT');
  assert.equal(output.execution.result.rowCount, 2);
  assert.deepEqual(output.execution.result.rows.map((row) => row.id), [1, 3]);
  assert.equal(output.schema.tables[0].name, 'employees');
  assert.equal(output.execution.receipt.connectionId, 'demo-a');
  assert.equal(output.execution.receipt.rowCount, 2);
});

test('mutations, stacked statements and external/file operations fail closed with receipts', () => {
  const samples = [
    'UPDATE employees SET salary = 0',
    'SELECT * FROM employees; DELETE FROM employees',
    "COPY employees TO '/tmp/out.csv'",
    "SELECT * FROM read_csv('/tmp/a.csv')",
    "ATTACH DATABASE '/tmp/x.db' AS other"
  ];
  for (const query of samples) {
    const output = runDataWorkbench({ connectionId: 'deny-a', query });
    assert.equal(output.execution.status, 'denied', query);
    assert.equal(output.execution.receipt.status, 'denied');
    assert.equal(output.execution.receipt.policyAllowed, false);
  }
  assert.equal(listDataWorkbenchReceipts({ connectionId: 'deny-a' }).length, samples.length);
});

test('production denies an adapter that cannot prove enforced read-only semantics', () => {
  const output = runDataWorkbench({
    environment: 'production',
    adapterId: 'synthetic-unproven',
    query: 'SELECT * FROM employees LIMIT 1'
  });
  assert.equal(output.execution.status, 'denied');
  assert.equal(output.execution.policy.code, 'DENY_PRODUCTION_READ_ONLY_UNPROVEN');
});

test('unknown adapter capability is denied instead of guessed', () => {
  const output = runDataWorkbench({
    adapterId: 'not-certified',
    query: 'SELECT * FROM employees LIMIT 1'
  });
  assert.equal(output.execution.status, 'denied');
  assert.equal(output.execution.policy.code, 'DENY_UNSUPPORTED_ADAPTER_CAPABILITY');
  assert.equal(output.capabilities, null);
});

test('read-only statement outside the certified fixture grammar fails but still emits a receipt', () => {
  const output = runDataWorkbench({ query: 'SELECT * FROM payroll_secrets' });
  assert.equal(output.execution.status, 'failed');
  assert.equal(output.execution.receipt.status, 'failed');
  assert.equal(output.execution.receipt.errorCode, 'FIXTURE_EXECUTION_FAILED');
});

test('human and agent sources use the same policy pipeline', () => {
  const human = runDataWorkbench({ source: 'human', query: 'SELECT * FROM employees LIMIT 2' });
  const agent = runDataWorkbench({ source: 'agent', query: 'SELECT * FROM employees LIMIT 2' });
  assert.equal(human.execution.policy.code, agent.execution.policy.code);
  assert.equal(human.execution.receipt.policyAllowed, true);
  assert.equal(agent.execution.receipt.policyAllowed, true);
  assert.equal(human.execution.receipt.source, 'human');
  assert.equal(agent.execution.receipt.source, 'agent');
});

test('history isolates connections and supports status and query-hash filters', () => {
  const first = runDataWorkbench({ connectionId: 'one', query: 'SELECT * FROM employees LIMIT 1' });
  runDataWorkbench({ connectionId: 'two', query: 'DELETE FROM employees' });
  runDataWorkbench({ connectionId: 'one', query: 'SELECT * FROM payroll_secrets' });

  assert.equal(listDataWorkbenchReceipts({ connectionId: 'one' }).length, 2);
  assert.equal(listDataWorkbenchReceipts({ connectionId: 'two' }).length, 1);
  assert.equal(listDataWorkbenchReceipts({ connectionId: 'one', status: 'failed' }).length, 1);
  assert.equal(listDataWorkbenchReceipts({ queryHash: first.execution.receipt.queryHash }).length, 1);
});

test('secret-like input fields are denied and redacted from persisted Workbench run input', async () => {
  const run = await executeWorkflow('data-workbench', {
    connectionId: 'secret-test',
    query: 'SELECT * FROM employees LIMIT 1',
    connection: { password: 'never-store-me', privateKey: 'also-never-store-me' }
  });
  assert.equal(run.status, 'succeeded');
  assert.equal(run.output.execution.status, 'denied');
  assert.equal(run.output.execution.policy.code, 'DENY_SECRET_FIELD_IN_REQUEST');
  assert.equal(run.input.connection.password, '[REDACTED]');
  assert.equal(run.input.connection.privateKey, '[REDACTED]');
  assert.equal(run.input.query.redacted, true);
  assert.equal(JSON.stringify(run).includes('never-store-me'), false);
  assert.equal(JSON.stringify(run).includes('also-never-store-me'), false);
});

test('receipts contain hashes and metadata, not raw SQL or credential fields', () => {
  const query = 'SELECT name FROM employees LIMIT 2';
  const output = runDataWorkbench({ connectionId: 'receipt-test', query });
  const serialized = JSON.stringify(output.execution.receipt);
  assert.equal(serialized.includes(query), false);
  assert.match(output.execution.receipt.queryHash, /^[a-f0-9]{64}$/);
  assert.equal(/password|privateKey|token/i.test(serialized), false);
});
