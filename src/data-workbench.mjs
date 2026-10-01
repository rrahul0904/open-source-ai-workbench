import crypto from 'node:crypto';

const SECRET_KEY = /(password|passwd|token|secret|private.?key|api.?key|credential)/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const MAX_QUERY_BYTES = 10_000;
const MAX_ROWS = 100;

const fixtureRows = Object.freeze([
  Object.freeze({ id: 1, name: 'Avery Chen', department: 'Engineering', salary: 142000 }),
  Object.freeze({ id: 2, name: 'Jordan Reyes', department: 'Finance', salary: 118000 }),
  Object.freeze({ id: 3, name: 'Morgan Patel', department: 'Engineering', salary: 136000 }),
  Object.freeze({ id: 4, name: 'Riley Okafor', department: 'Operations', salary: 109000 }),
  Object.freeze({ id: 5, name: 'Casey Novak', department: 'Finance', salary: 124000 }),
  Object.freeze({ id: 6, name: 'Taylor Kim', department: 'Operations', salary: 115000 })
]);

export const fixtureSchema = Object.freeze({
  database: 'workbench_demo',
  tables: Object.freeze([
    Object.freeze({
      name: 'employees',
      rowCount: fixtureRows.length,
      columns: Object.freeze([
        Object.freeze({ name: 'id', type: 'integer', nullable: false, primaryKey: true }),
        Object.freeze({ name: 'name', type: 'text', nullable: false, primaryKey: false }),
        Object.freeze({ name: 'department', type: 'text', nullable: false, primaryKey: false }),
        Object.freeze({ name: 'salary', type: 'integer', nullable: false, primaryKey: false })
      ])
    })
  ])
});

const adapterCatalog = Object.freeze({
  'synthetic-relational': Object.freeze({
    adapterId: 'synthetic-relational',
    queryLanguage: 'sql',
    schemaIntrospection: true,
    query: true,
    mutations: false,
    explain: false,
    cancellation: false,
    readOnly: true,
    readOnlyProof: Object.freeze({
      enforced: true,
      mechanism: 'fixture-engine-select-only',
      scope: 'all-statements'
    })
  }),
  'synthetic-unproven': Object.freeze({
    adapterId: 'synthetic-unproven',
    queryLanguage: 'sql',
    schemaIntrospection: true,
    query: true,
    mutations: false,
    explain: false,
    cancellation: false,
    readOnly: true,
    readOnlyProof: Object.freeze({
      enforced: false,
      mechanism: 'declared-read-only-without-native-proof',
      scope: 'none'
    })
  })
});

const history = globalThis.__DATA_WORKBENCH_RECEIPTS__ || [];
globalThis.__DATA_WORKBENCH_RECEIPTS__ = history;

function stableClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeQuery(query) {
  return String(query || '').trim().replace(/\s+/g, ' ');
}

function hasSecretField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSecretField);
  return Object.entries(value).some(([key, child]) => SECRET_KEY.test(key) || hasSecretField(child));
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(child)
  ]));
}

export function redactDataWorkbenchRunInput(input = {}) {
  const redacted = redactSecrets(stableClone(input));
  if (typeof redacted.query === 'string') {
    const normalized = normalizeQuery(redacted.query);
    redacted.query = {
      redacted: true,
      sha256: sha256(normalized),
      length: Buffer.byteLength(normalized, 'utf8')
    };
  }
  return redacted;
}

function safeId(value, fallback) {
  const id = String(value || fallback);
  if (!ID_PATTERN.test(id)) return fallback;
  return id;
}

function connectionProfile(input = {}) {
  const environment = ['development', 'staging', 'production'].includes(input.environment)
    ? input.environment
    : 'development';
  const adapterId = safeId(input.adapterId, 'synthetic-relational');
  return Object.freeze({
    id: safeId(input.connectionId, 'demo-connection'),
    label: String(input.connectionLabel || 'Synthetic Workbench Demo').slice(0, 120),
    environment,
    adapterId
  });
}

function classify(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return { ok: false, code: 'DENY_EMPTY_QUERY', normalized, statementType: 'unknown' };
  if (Buffer.byteLength(normalized, 'utf8') > MAX_QUERY_BYTES) {
    return { ok: false, code: 'DENY_QUERY_TOO_LARGE', normalized, statementType: 'unknown' };
  }
  if (/\0|--|\/\*|\*\//.test(normalized)) {
    return { ok: false, code: 'DENY_COMMENT_OR_CONTROL_TOKEN', normalized, statementType: 'unknown' };
  }
  const withoutTrailing = normalized.replace(/;$/, '').trim();
  if (withoutTrailing.includes(';')) {
    return { ok: false, code: 'DENY_MULTI_STATEMENT', normalized, statementType: 'unknown' };
  }
  const upper = withoutTrailing.toUpperCase();
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|UPSERT|REPLACE|COPY|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|GRANT|REVOKE|CALL|EXEC|EXECUTE|LOAD|INSTALL|EXPORT|IMPORT|READ_CSV|READ_PARQUET|READ_JSON|SQLITE_SCAN|POSTGRES_SCAN|GLOB)\b/;
  if (forbidden.test(upper)) {
    return { ok: false, code: 'DENY_MUTATION_OR_EXTERNAL_OPERATION', normalized, statementType: 'write-or-admin' };
  }
  if (!upper.startsWith('SELECT ')) {
    return { ok: false, code: 'DENY_STATEMENT_TYPE', normalized, statementType: 'unknown' };
  }
  return { ok: true, code: 'READ_ONLY_SELECT', normalized: withoutTrailing, statementType: 'select' };
}

export function decideQueryPolicy({ input = {}, profile, capabilities, query }) {
  if (hasSecretField(input)) {
    return Object.freeze({ allowed: false, code: 'DENY_SECRET_FIELD_IN_REQUEST', reason: 'Database secret fields are not accepted by the demo workflow.' });
  }
  if (!capabilities || capabilities.query !== true || capabilities.readOnly !== true) {
    return Object.freeze({ allowed: false, code: 'DENY_UNSUPPORTED_ADAPTER_CAPABILITY', reason: 'Adapter cannot prove a read-only query capability.' });
  }
  if (profile.environment === 'production' && capabilities.readOnlyProof?.enforced !== true) {
    return Object.freeze({ allowed: false, code: 'DENY_PRODUCTION_READ_ONLY_UNPROVEN', reason: 'Production requires an adapter-enforced read-only proof.' });
  }
  const classification = classify(query);
  if (!classification.ok) {
    return Object.freeze({ allowed: false, code: classification.code, reason: 'Statement is outside the Phase A read-only grammar.', statementType: classification.statementType });
  }
  return Object.freeze({ allowed: true, code: 'ALLOW_READ_ONLY_SELECT', reason: 'Adapter capability and query policy both permit bounded read-only execution.', statementType: classification.statementType });
}

function compareRows(rows, field, direction = 'ASC') {
  const sign = direction.toUpperCase() === 'DESC' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a[field] === b[field]) return 0;
    return a[field] > b[field] ? sign : -sign;
  });
}

function executeFixtureQuery(query) {
  const normalized = normalizeQuery(query).replace(/;$/, '').trim();

  const grouped = /^SELECT department, COUNT\(\*\) AS employee_count FROM employees GROUP BY department(?: ORDER BY employee_count (ASC|DESC))?(?: LIMIT (\d+))?$/i.exec(normalized);
  if (grouped) {
    const counts = new Map();
    for (const row of fixtureRows) counts.set(row.department, (counts.get(row.department) || 0) + 1);
    let rows = [...counts.entries()].map(([department, employee_count]) => ({ department, employee_count }));
    rows = compareRows(rows, 'employee_count', grouped[1] || 'DESC');
    const limit = Math.min(MAX_ROWS, Number(grouped[2] || MAX_ROWS));
    rows = rows.slice(0, limit);
    return {
      columns: [
        { name: 'department', type: 'text' },
        { name: 'employee_count', type: 'integer' }
      ],
      rows,
      rowCount: rows.length,
      truncated: false,
      source: 'synthetic-fixture'
    };
  }

  const simple = /^SELECT (\*|(?:id|name|department|salary)(?:\s*,\s*(?:id|name|department|salary))*) FROM employees(?: WHERE department = '([^']{1,80})')?(?: ORDER BY (id|name|department|salary)(?: (ASC|DESC))?)?(?: LIMIT (\d+))?$/i.exec(normalized);
  if (!simple) throw new Error('Query is read-only but outside the certified synthetic fixture grammar.');

  const selected = simple[1] === '*'
    ? ['id', 'name', 'department', 'salary']
    : simple[1].split(',').map((part) => part.trim().toLowerCase());
  let rows = fixtureRows.map((row) => ({ ...row }));
  if (simple[2]) rows = rows.filter((row) => row.department === simple[2]);
  if (simple[3]) rows = compareRows(rows, simple[3].toLowerCase(), simple[4] || 'ASC');
  const limit = Math.min(MAX_ROWS, Number(simple[5] || 50));
  rows = rows.slice(0, limit).map((row) => Object.fromEntries(selected.map((column) => [column, row[column]])));
  const tableColumns = fixtureSchema.tables[0].columns;
  return {
    columns: selected.map((name) => ({ name, type: tableColumns.find((column) => column.name === name)?.type || 'unknown' })),
    rows,
    rowCount: rows.length,
    truncated: false,
    source: 'synthetic-fixture'
  };
}

function makeReceipt({ profile, source, query, policy, status, result = null, error = null, durationMs = 0 }) {
  const normalized = normalizeQuery(query);
  const sequence = history.length + 1;
  const receipt = Object.freeze({
    id: `dwr-${String(sequence).padStart(5, '0')}-${sha256(`${profile.id}|${normalized}|${status}|${sequence}`).slice(0, 12)}`,
    connectionId: profile.id,
    adapterId: profile.adapterId,
    environment: profile.environment,
    source: source === 'agent' ? 'agent' : 'human',
    queryHash: sha256(normalized),
    statementType: policy.statementType || 'unknown',
    policyCode: policy.code,
    policyAllowed: policy.allowed === true,
    status,
    rowCount: Number(result?.rowCount || 0),
    durationMs,
    errorCode: error ? 'FIXTURE_EXECUTION_FAILED' : null,
    errorMessage: error ? String(error.message || error).slice(0, 240) : null,
    createdAt: new Date().toISOString()
  });
  history.unshift(receipt);
  if (history.length > 500) history.length = 500;
  return receipt;
}

export function listDataWorkbenchReceipts({ connectionId, status, queryHash, limit = 50 } = {}) {
  const bounded = Math.max(1, Math.min(100, Number(limit) || 50));
  return history
    .filter((receipt) => !connectionId || receipt.connectionId === connectionId)
    .filter((receipt) => !status || receipt.status === status)
    .filter((receipt) => !queryHash || receipt.queryHash === queryHash)
    .slice(0, bounded)
    .map(stableClone);
}

export function resetDataWorkbenchHistoryForTests() {
  history.length = 0;
}

export function runDataWorkbench(input = {}) {
  const started = performance.now();
  const profile = connectionProfile(input);
  const capabilities = adapterCatalog[profile.adapterId] || null;
  const query = typeof input.query === 'string'
    ? input.query
    : "SELECT department, COUNT(*) AS employee_count FROM employees GROUP BY department ORDER BY employee_count DESC";
  const source = input.source === 'agent' ? 'agent' : 'human';
  const policy = decideQueryPolicy({ input, profile, capabilities, query });

  if (!policy.allowed) {
    const receipt = makeReceipt({
      profile,
      source,
      query,
      policy,
      status: 'denied',
      durationMs: Math.round(performance.now() - started)
    });
    return {
      mode: 'synthetic-read-only',
      connection: stableClone(profile),
      capabilities: stableClone(capabilities),
      schema: stableClone(fixtureSchema),
      execution: { status: 'denied', policy: stableClone(policy), receipt, result: null },
      history: listDataWorkbenchReceipts({ connectionId: profile.id, limit: 10 }),
      boundaries: ['synthetic fixture only', 'no live database credentials', 'no network/filesystem query execution', 'no production-readiness claim']
    };
  }

  try {
    const result = executeFixtureQuery(query);
    const receipt = makeReceipt({
      profile,
      source,
      query,
      policy,
      status: 'succeeded',
      result,
      durationMs: Math.round(performance.now() - started)
    });
    return {
      mode: 'synthetic-read-only',
      connection: stableClone(profile),
      capabilities: stableClone(capabilities),
      schema: stableClone(fixtureSchema),
      execution: { status: 'succeeded', policy: stableClone(policy), receipt, result },
      history: listDataWorkbenchReceipts({ connectionId: profile.id, limit: 10 }),
      boundaries: ['synthetic fixture only', 'no live database credentials', 'no network/filesystem query execution', 'no production-readiness claim']
    };
  } catch (error) {
    const receipt = makeReceipt({
      profile,
      source,
      query,
      policy,
      status: 'failed',
      error,
      durationMs: Math.round(performance.now() - started)
    });
    return {
      mode: 'synthetic-read-only',
      connection: stableClone(profile),
      capabilities: stableClone(capabilities),
      schema: stableClone(fixtureSchema),
      execution: { status: 'failed', policy: stableClone(policy), receipt, result: null },
      history: listDataWorkbenchReceipts({ connectionId: profile.id, limit: 10 }),
      boundaries: ['synthetic fixture only', 'no live database credentials', 'no network/filesystem query execution', 'no production-readiness claim']
    };
  }
}
