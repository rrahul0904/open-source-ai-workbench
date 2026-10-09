import crypto from 'node:crypto';

const DEFAULT_LIMITS = Object.freeze({
  maxRows: 50,
  maxPageSize: 50,
  maxBytes: 64 * 1024,
  timeoutMs: 100
});

const SOURCE_ID = 'demo-analytics';

const FIXTURES = Object.freeze({
  customers: Object.freeze([
    Object.freeze({ customer_id: '844197938335842304', name: 'Ada Labs', segment: 'enterprise', active: true }),
    Object.freeze({ customer_id: '844197938335842305', name: 'Beacon Retail', segment: 'mid-market', active: true }),
    Object.freeze({ customer_id: '844197938335842306', name: 'Cedar Health', segment: 'enterprise', active: false })
  ]),
  orders: Object.freeze([
    Object.freeze({ order_id: '9223372036854775701', customer_id: '844197938335842304', amount_cents: 125000, status: 'paid' }),
    Object.freeze({ order_id: '9223372036854775702', customer_id: '844197938335842304', amount_cents: 48250, status: 'paid' }),
    Object.freeze({ order_id: '9223372036854775703', customer_id: '844197938335842305', amount_cents: 9950, status: 'pending' })
  ])
});

const TABLE_DEFINITIONS = Object.freeze({
  customers: Object.freeze([
    Object.freeze({ name: 'customer_id', type: 'bigint-string', nullable: false, primaryKey: true }),
    Object.freeze({ name: 'name', type: 'text', nullable: false }),
    Object.freeze({ name: 'segment', type: 'text', nullable: false }),
    Object.freeze({ name: 'active', type: 'boolean', nullable: false })
  ]),
  orders: Object.freeze([
    Object.freeze({ name: 'order_id', type: 'bigint-string', nullable: false, primaryKey: true }),
    Object.freeze({ name: 'customer_id', type: 'bigint-string', nullable: false }),
    Object.freeze({ name: 'amount_cents', type: 'integer', nullable: false }),
    Object.freeze({ name: 'status', type: 'text', nullable: false })
  ])
});

const receiptStore = new Map();

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentSource() {
  return Object.freeze({
    id: SOURCE_ID,
    name: 'Synthetic Analytics Fixture',
    engine: 'synthetic-sql',
    environment: 'development',
    capabilities: Object.freeze(['schema.read', 'query.select', 'receipt.read']),
    readOnlyProof: Object.freeze({ enforced: true, mechanism: 'adapter-contract', scope: 'all-statements' })
  });
}

export function listSources() {
  return [deepClone(currentSource())];
}

export function inspectSchema(sourceId = SOURCE_ID) {
  if (sourceId !== SOURCE_ID) throw Object.assign(new Error(`Unknown data source: ${sourceId}`), { code: 'SOURCE_NOT_FOUND' });
  const tables = Object.keys(TABLE_DEFINITIONS).sort().map((name) => ({
    name,
    columns: TABLE_DEFINITIONS[name].map((column) => ({ ...column })),
    rowCount: FIXTURES[name].length
  }));
  const identity = { sourceId, engine: currentSource().engine, tables };
  return {
    ...identity,
    revision: sha256(stableStringify(identity))
  };
}

function rejectUnsafeStatement(sql) {
  const original = String(sql || '').trim();
  if (!original) throw Object.assign(new Error('SQL is required'), { code: 'SQL_REQUIRED' });
  const withoutTrailingSemicolon = original.endsWith(';') ? original.slice(0, -1).trim() : original;
  if (withoutTrailingSemicolon.includes(';')) {
    throw Object.assign(new Error('Multiple SQL statements are not allowed'), { code: 'MULTI_STATEMENT_DENIED' });
  }
  if (/--|\/\*|\*\//.test(withoutTrailingSemicolon)) {
    throw Object.assign(new Error('SQL comments are not allowed in Phase A'), { code: 'SQL_COMMENT_DENIED' });
  }
  if (!/^select\b/i.test(withoutTrailingSemicolon)) {
    throw Object.assign(new Error('Phase A permits SELECT statements only'), { code: 'MUTATION_DENIED' });
  }
  return withoutTrailingSemicolon;
}

function splitColumns(value) {
  const trimmed = value.trim();
  if (trimmed === '*') return ['*'];
  const columns = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (!columns.length || columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
    throw Object.assign(new Error('Only simple column selections are supported in Phase A'), { code: 'UNSUPPORTED_SELECT_LIST' });
  }
  return columns;
}

function parseLiteral(token) {
  const trimmed = token.trim();
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'");
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+$/.test(trimmed)) return trimmed;
  throw Object.assign(new Error('WHERE values must be quoted strings, booleans, or integer literals'), { code: 'UNSUPPORTED_LITERAL' });
}

function parseSelect(sql) {
  const safeSql = rejectUnsafeStatement(sql);
  const match = safeSql.match(/^select\s+(.+?)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+where\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?))?(?:\s+order\s+by\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/i);
  if (!match) {
    throw Object.assign(new Error('Unsupported SELECT shape; Phase A supports SELECT columns FROM table [WHERE column = literal] [ORDER BY column] [LIMIT n]'), { code: 'UNSUPPORTED_QUERY' });
  }
  const [, selection, table, whereColumn, whereValue, orderColumn, orderDirection, limitValue] = match;
  if (!TABLE_DEFINITIONS[table]) throw Object.assign(new Error(`Unknown table: ${table}`), { code: 'TABLE_NOT_FOUND' });
  const knownColumns = new Set(TABLE_DEFINITIONS[table].map((column) => column.name));
  const columns = splitColumns(selection);
  for (const column of columns === ['*'] ? [] : columns) {
    if (!knownColumns.has(column)) throw Object.assign(new Error(`Unknown column: ${column}`), { code: 'COLUMN_NOT_FOUND' });
  }
  if (whereColumn && !knownColumns.has(whereColumn)) throw Object.assign(new Error(`Unknown WHERE column: ${whereColumn}`), { code: 'COLUMN_NOT_FOUND' });
  if (orderColumn && !knownColumns.has(orderColumn)) throw Object.assign(new Error(`Unknown ORDER BY column: ${orderColumn}`), { code: 'COLUMN_NOT_FOUND' });
  return {
    sql: safeSql,
    table,
    columns,
    where: whereColumn ? { column: whereColumn, value: parseLiteral(whereValue) } : null,
    orderBy: orderColumn ? { column: orderColumn, direction: (orderDirection || 'asc').toLowerCase() } : null,
    requestedLimit: limitValue ? Number(limitValue) : null
  };
}

function canonicalPlanPayload({ sourceId, schemaRevision, parsed, limits }) {
  return {
    sourceId,
    schemaRevision,
    operation: 'select',
    query: {
      table: parsed.table,
      columns: parsed.columns,
      where: parsed.where,
      orderBy: parsed.orderBy,
      requestedLimit: parsed.requestedLimit
    },
    limits
  };
}

export function planQuery({ sourceId = SOURCE_ID, sql, limits = {} } = {}) {
  const schema = inspectSchema(sourceId);
  const parsed = parseSelect(sql);
  const boundedLimits = {
    maxRows: Math.max(1, Math.min(DEFAULT_LIMITS.maxRows, Number(limits.maxRows) || DEFAULT_LIMITS.maxRows)),
    maxPageSize: Math.max(1, Math.min(DEFAULT_LIMITS.maxPageSize, Number(limits.maxPageSize) || DEFAULT_LIMITS.maxPageSize)),
    maxBytes: Math.max(1024, Math.min(DEFAULT_LIMITS.maxBytes, Number(limits.maxBytes) || DEFAULT_LIMITS.maxBytes)),
    timeoutMs: Math.max(10, Math.min(DEFAULT_LIMITS.timeoutMs, Number(limits.timeoutMs) || DEFAULT_LIMITS.timeoutMs))
  };
  const payload = canonicalPlanPayload({ sourceId, schemaRevision: schema.revision, parsed, limits: boundedLimits });
  return {
    id: `plan_${sha256(stableStringify(payload)).slice(0, 24)}`,
    ...payload,
    sqlHash: sha256(parsed.sql),
    policy: { mode: 'read-only', requiresApproval: false }
  };
}

function compareForFilter(actual, expected) {
  if (typeof actual === 'boolean') return actual === expected;
  return String(actual) === String(expected);
}

function executePlan(plan) {
  const tableRows = FIXTURES[plan.query.table];
  let rows = tableRows.map((row) => ({ ...row }));
  if (plan.query.where) rows = rows.filter((row) => compareForFilter(row[plan.query.where.column], plan.query.where.value));
  if (plan.query.orderBy) {
    const { column, direction } = plan.query.orderBy;
    const factor = direction === 'desc' ? -1 : 1;
    rows.sort((left, right) => String(left[column]).localeCompare(String(right[column]), 'en', { numeric: true }) * factor);
  }
  const limit = Math.min(plan.limits.maxRows, plan.query.requestedLimit || plan.limits.maxRows);
  rows = rows.slice(0, limit);
  if (!(plan.query.columns.length === 1 && plan.query.columns[0] === '*')) {
    rows = rows.map((row) => Object.fromEntries(plan.query.columns.map((column) => [column, row[column]])));
  }
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  if (bytes > plan.limits.maxBytes) throw Object.assign(new Error('Result exceeds the configured byte ceiling'), { code: 'RESULT_TOO_LARGE' });
  return { rows, rowCount: rows.length, bytes };
}

function policyDecision(plan) {
  const source = currentSource();
  if (!plan || typeof plan !== 'object') return { allowed: false, code: 'PLAN_REQUIRED', reason: 'A validated query plan is required' };
  if (plan.operation !== 'select') return { allowed: false, code: 'MUTATION_DENIED', reason: 'Phase A permits SELECT plans only' };
  if (plan.sourceId !== source.id) return { allowed: false, code: 'SOURCE_MISMATCH', reason: 'The plan is bound to a different data source' };
  const currentSchema = inspectSchema(source.id);
  if (plan.schemaRevision !== currentSchema.revision) return { allowed: false, code: 'STALE_SCHEMA', reason: 'The plan schema revision is stale' };
  if (!source.readOnlyProof?.enforced) return { allowed: false, code: 'READ_ONLY_PROOF_REQUIRED', reason: 'Read-only enforcement is not proven by the adapter' };
  return { allowed: true, code: 'ALLOW_READ', reason: 'Read-only plan is bound to the current source and schema revision' };
}

function receiptIdentity({ requestId, plan, status, code }) {
  return `receipt_${sha256(stableStringify({ requestId, planId: plan?.id || null, status, code })).slice(0, 24)}`;
}

function persistReceipt(receipt) {
  if (receiptStore.has(receipt.id)) return deepClone(receiptStore.get(receipt.id));
  const frozen = Object.freeze(deepClone(receipt));
  receiptStore.set(receipt.id, frozen);
  return deepClone(frozen);
}

function makeReceipt({ requestId, plan, decision, status, code, result = null, error = null }) {
  const receipt = {
    id: receiptIdentity({ requestId, plan, status, code }),
    requestId,
    planId: plan?.id || null,
    sourceId: plan?.sourceId || null,
    schemaRevision: plan?.schemaRevision || null,
    sqlHash: plan?.sqlHash || null,
    status,
    code,
    policyDecision: decision,
    limits: plan?.limits || null,
    resultMetadata: result ? { rowCount: result.rowCount, bytes: result.bytes } : null,
    error: error ? String(error) : null,
    recordedAt: new Date().toISOString()
  };
  return persistReceipt(receipt);
}

export function getExecutionReceipt(receiptId) {
  const receipt = receiptStore.get(receiptId);
  return receipt ? deepClone(receipt) : null;
}

export function searchExecutionReceipts({ sourceId = null, status = null, sqlHash = null } = {}) {
  return [...receiptStore.values()]
    .filter((receipt) => !sourceId || receipt.sourceId === sourceId)
    .filter((receipt) => !status || receipt.status === status)
    .filter((receipt) => !sqlHash || receipt.sqlHash === sqlHash)
    .map(deepClone);
}

export function runReadQuery({ plan = null, sourceId = SOURCE_ID, sql = null, limits = {}, requestId = null } = {}) {
  let validatedPlan = plan;
  let planningError = null;
  if (!validatedPlan) {
    try {
      validatedPlan = planQuery({ sourceId, sql, limits });
    } catch (error) {
      planningError = error;
    }
  }
  const effectiveRequestId = String(requestId || `auto_${sha256(stableStringify({ sourceId, sqlHash: validatedPlan?.sqlHash || sha256(String(sql || '')), planId: validatedPlan?.id || null })).slice(0, 24)}`);
  if (planningError) {
    const decision = { allowed: false, code: planningError.code || 'PLAN_INVALID', reason: planningError.message };
    const receipt = makeReceipt({ requestId: effectiveRequestId, plan: null, decision, status: 'denied', code: decision.code, error: decision.reason });
    return { status: 'denied', decision, receipt, result: null };
  }
  const decision = policyDecision(validatedPlan);
  if (!decision.allowed) {
    const receipt = makeReceipt({ requestId: effectiveRequestId, plan: validatedPlan, decision, status: 'denied', code: decision.code, error: decision.reason });
    return { status: 'denied', decision, receipt, result: null };
  }
  const expectedReceiptId = receiptIdentity({ requestId: effectiveRequestId, plan: validatedPlan, status: 'succeeded', code: 'QUERY_EXECUTED' });
  const replay = receiptStore.get(expectedReceiptId);
  if (replay) return { status: 'succeeded', decision, receipt: deepClone(replay), result: null, replayed: true };
  try {
    const started = performance.now();
    const result = executePlan(validatedPlan);
    if (performance.now() - started > validatedPlan.limits.timeoutMs) {
      throw Object.assign(new Error('Query exceeded the configured timeout ceiling'), { code: 'QUERY_TIMEOUT' });
    }
    const receipt = makeReceipt({ requestId: effectiveRequestId, plan: validatedPlan, decision, status: 'succeeded', code: 'QUERY_EXECUTED', result });
    return {
      status: 'succeeded',
      decision,
      receipt,
      result: {
        rows: result.rows,
        rowCount: result.rowCount,
        bytes: result.bytes,
        page: 1,
        pageSize: Math.min(validatedPlan.limits.maxPageSize, result.rowCount || validatedPlan.limits.maxPageSize)
      },
      replayed: false
    };
  } catch (error) {
    const receipt = makeReceipt({ requestId: effectiveRequestId, plan: validatedPlan, decision, status: 'failed', code: error.code || 'QUERY_FAILED', error: error.message });
    return { status: 'failed', decision, receipt, result: null };
  }
}

export async function runDataWorkbench(input = {}) {
  const action = input.action || 'list-sources';
  if (action === 'list-sources') return { action, sources: listSources() };
  if (action === 'inspect-schema') return { action, schema: inspectSchema(input.sourceId || SOURCE_ID) };
  if (action === 'plan-query') return { action, plan: planQuery(input) };
  if (action === 'run-read-query') return { action, ...runReadQuery(input) };
  if (action === 'get-execution-receipt') return { action, receipt: getExecutionReceipt(input.receiptId) };
  if (action === 'search-execution-receipts') return { action, receipts: searchExecutionReceipts(input) };
  throw Object.assign(new Error(`Unknown Data Workbench action: ${action}`), { statusCode: 400 });
}
