import { createHash } from 'node:crypto';

const FORBIDDEN_SQL = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|execute|attach|detach|pragma|vacuum|load|install|export|import|set|reset|begin|commit|rollback|replace|upsert)\b/i;
const SIDE_EFFECT_SQL = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|http_get|http_post|read_csv|read_parquet|write_csv|write_parquet)\s*\(/i;
const READ_PREFIX = /^(select|with|show|explain)\b/i;
const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;

const FIXTURE = Object.freeze({
  customers: Object.freeze([
    Object.freeze({ id: 1, name: 'Ada', tier: 'gold' }),
    Object.freeze({ id: 2, name: 'Grace', tier: 'silver' }),
    Object.freeze({ id: 3, name: 'Linus', tier: 'gold' })
  ]),
  orders: Object.freeze([
    Object.freeze({ id: 101, customer_id: 1, total_cents: 12500 }),
    Object.freeze({ id: 102, customer_id: 2, total_cents: 4999 }),
    Object.freeze({ id: 103, customer_id: 1, total_cents: 2500 })
  ])
});

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redact(child)]));
}

function normalizeSql(sql) {
  if (typeof sql !== 'string') throw new Error('Query must be a string.');
  const text = sql.trim();
  if (!text) throw new Error('Query must not be empty.');
  if (text.length > 4000) throw new Error('Query exceeds the 4000 character Phase-A limit.');
  const withoutTrailing = text.endsWith(';') ? text.slice(0, -1).trim() : text;
  if (withoutTrailing.includes(';')) throw new Error('Only one SQL statement is allowed.');
  return withoutTrailing.replace(/\s+/g, ' ').trim();
}

export function classifyReadQuery(sql) {
  let normalized;
  try {
    normalized = normalizeSql(sql);
  } catch (error) {
    const message = String(error?.message || error);
    return { allowed: false, normalized: '', reason: message.includes('Only one SQL statement') ? 'multiple-statements' : 'invalid-query' };
  }
  if (!READ_PREFIX.test(normalized)) return { allowed: false, normalized, reason: 'statement-not-read-class' };
  if (FORBIDDEN_SQL.test(normalized)) return { allowed: false, normalized, reason: 'forbidden-keyword' };
  if (SIDE_EFFECT_SQL.test(normalized)) return { allowed: false, normalized, reason: 'side-effect-function' };
  return { allowed: true, normalized, reason: 'read-class' };
}

export function createSyntheticAdapter({ enforcedReadOnly = true } = {}) {
  const schema = Object.freeze({
    revision: digest(JSON.stringify(FIXTURE)),
    tables: Object.freeze(Object.entries(FIXTURE).map(([name, rows]) => Object.freeze({
      name,
      columns: Object.freeze(Object.keys(rows[0] || {})),
      rowCount: rows.length
    })))
  });

  return Object.freeze({
    id: 'synthetic-relational-v1',
    capabilities: Object.freeze({
      schemaIntrospection: true,
      readQuery: true,
      mutations: false,
      schemaChanges: false,
      transactions: false,
      crossSourceTransfer: false,
      enforcedReadOnly
    }),
    readOnlyProof: Object.freeze({
      enforced: enforcedReadOnly,
      layer: enforcedReadOnly ? 'fixture-adapter' : 'none',
      evidence: enforcedReadOnly ? 'adapter-has-no-mutation-path' : 'unproven'
    }),
    inspectSchema() { return schema; },
    executeRead(sql, { rowLimit = 100 } = {}) {
      const classification = classifyReadQuery(sql);
      if (!classification.allowed) throw new Error(`Query denied: ${classification.reason}.`);
      const match = /^select\s+(.+?)\s+from\s+(customers|orders)(?:\s+limit\s+(\d+))?$/i.exec(classification.normalized);
      if (!match) throw new Error('Phase-A synthetic adapter supports SELECT <columns> FROM customers|orders [LIMIT n] only.');
      const [, projection, tableName, queryLimit] = match;
      const table = FIXTURE[tableName.toLowerCase()];
      const available = Object.keys(table[0] || {});
      const requested = projection.trim() === '*' ? available : projection.split(',').map((part) => part.trim());
      if (!requested.length || requested.some((column) => !available.includes(column))) throw new Error('Unknown or unsupported projection column.');
      const hardLimit = Math.min(Math.max(Number(rowLimit) || 1, 1), 100);
      const effectiveLimit = queryLimit ? Math.min(Number(queryLimit), hardLimit) : hardLimit;
      const rows = table.slice(0, effectiveLimit).map((row) => Object.fromEntries(requested.map((column) => [column, row[column]])));
      return Object.freeze({ columns: Object.freeze(requested), rows: Object.freeze(rows.map(Object.freeze)), rowCount: rows.length, truncated: table.length > rows.length });
    }
  });
}

export function createDataWorkbench({ adapter = createSyntheticAdapter() } = {}) {
  const history = [];
  let sequence = 0;

  function record(receipt) {
    const frozen = Object.freeze(redact(receipt));
    history.unshift(frozen);
    return frozen;
  }

  async function run({ profile, sql, actor = 'human', rowLimit = 100 } = {}) {
    const startedAt = new Date().toISOString();
    sequence += 1;
    const profileId = profile?.id || 'unknown';
    const queryHash = digest(typeof sql === 'string' ? sql : '');
    const id = `qrcpt_${digest(`${profileId}:${queryHash}:${sequence}`).slice(0, 16)}`;
    const base = { id, profileId, actor, queryHash, startedAt, adapterId: adapter.id, schemaRevision: adapter.inspectSchema().revision };

    try {
      if (!profile?.id) throw new Error('Connection profile id is required.');
      if (!['development', 'test', 'production'].includes(profile.environment)) throw new Error('Connection environment must be development, test or production.');
      const classification = classifyReadQuery(sql);
      if (!classification.allowed) {
        return record({ ...base, status: 'denied', policy: { allowed: false, reason: classification.reason }, completedAt: new Date().toISOString() });
      }
      if (!adapter.capabilities.readQuery) {
        return record({ ...base, status: 'denied', policy: { allowed: false, reason: 'adapter-read-query-unsupported' }, completedAt: new Date().toISOString() });
      }
      if (profile.environment === 'production' && !adapter.readOnlyProof?.enforced) {
        return record({ ...base, status: 'denied', policy: { allowed: false, reason: 'production-readonly-proof-required' }, readOnlyProof: adapter.readOnlyProof, completedAt: new Date().toISOString() });
      }
      const result = adapter.executeRead(classification.normalized, { rowLimit });
      return record({
        ...base,
        status: 'succeeded',
        policy: { allowed: true, reason: 'read-only-approved' },
        readOnlyProof: adapter.readOnlyProof,
        bounds: { requestedRowLimit: rowLimit, appliedMaxRowLimit: 100 },
        result,
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      return record({ ...base, status: 'failed', policy: { allowed: false, reason: 'validation-or-adapter-error' }, error: String(error?.message || error), completedAt: new Date().toISOString() });
    }
  }

  function listHistory({ profileId, status, queryHash, limit = 25 } = {}) {
    return history
      .filter((receipt) => !profileId || receipt.profileId === profileId)
      .filter((receipt) => !status || receipt.status === status)
      .filter((receipt) => !queryHash || receipt.queryHash === queryHash)
      .slice(0, Math.min(Math.max(Number(limit) || 1, 1), 100));
  }

  function planMutation({ profile, sql } = {}) {
    if (!profile?.id) throw new Error('Connection profile id is required.');
    const normalized = normalizeSql(sql);
    if (!FORBIDDEN_SQL.test(normalized)) throw new Error('Mutation plan requires an explicit mutation/schema statement.');
    return Object.freeze(redact({
      id: `mplan_${digest(`${profile.id}:${normalized}`).slice(0, 16)}`,
      profileId: profile.id,
      schemaRevision: adapter.inspectSchema().revision,
      sql: normalized,
      executable: false,
      requiresSeparateAuthority: true
    }));
  }

  return Object.freeze({ adapter, run, listHistory, planMutation, inspectSchema: () => adapter.inspectSchema() });
}
