import crypto from 'node:crypto';

const DEFAULT_LIMITS = Object.freeze({ maxRows: 50, maxPageSize: 50, maxBytes: 64 * 1024, timeoutMs: 100 });
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

const planStore = new Map();
const receiptStore = new Map();

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sourceDefinition() {
  return {
    id: SOURCE_ID,
    name: 'Synthetic Analytics Fixture',
    engine: 'synthetic-sql',
    environment: 'development',
    capabilities: ['schema.read', 'query.select', 'receipt.read'],
    readOnlyProof: { enforced: true, mechanism: 'adapter-contract', scope: 'all-statements' }
  };
}

export function listSources() {
  return [sourceDefinition()];
}

export function inspectSchema(sourceId = SOURCE_ID) {
  if (sourceId !== SOURCE_ID) throw Object.assign(new Error(`Unknown data source: ${sourceId}`), { code: 'SOURCE_NOT_FOUND' });
  const tables = Object.keys(TABLE_DEFINITIONS).sort().map((name) => ({
    name,
    columns: TABLE_DEFINITIONS[name].map((column) => ({ ...column })),
    rowCount: FIXTURES[name].length
  }));
  const identity = { sourceId, engine: sourceDefinition().engine, tables };
  return { ...identity, revision: sha256(stableStringify(identity)) };
}

function rejectUnsafeStatement(sql) {
  const original = String(sql || '').trim();
  if (!original) throw Object.assign(new Error('SQL is required'), { code: 'SQL_REQUIRED' });
  const statement = original.endsWith(';') ? original.slice(0, -1).trim() : original;
  if (statement.includes(';')) throw Object.assign(new Error('Multiple SQL statements are not allowed'), { code: 'MULTI_STATEMENT_DENIED' });
  if (/--|\/\*|\*\//.test(statement)) throw Object.assign(new Error('SQL comments are not allowed in Phase A'), { code: 'SQL_COMMENT_DENIED' });
  if (!/^select\b/i.test(statement)) throw Object.assign(new Error('Phase A permits SELECT statements only'), { code: 'MUTATION_DENIED' });
  return statement;
}

function parseLiteral(token) {
  const value = token.trim();
  if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+$/.test(value)) return value;
  throw Object.assign(new Error('WHERE values must be quoted strings, booleans, or integer literals'), { code: 'UNSUPPORTED_LITERAL' });
}

function parseSelect(sql) {
  const safeSql = rejectUnsafeStatement(sql);
  const base = safeSql.match(/^select\s+(.+?)\s+from\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/i);
  if (!base) throw Object.assign(new Error('Unsupported SELECT shape'), { code: 'UNSUPPORTED_QUERY' });

  const [, selection, table] = base;
  let rest = base[3].trim();
  let requestedLimit = null;
  let orderBy = null;
  let where = null;

  const limitMatch = rest.match(/(?:^|\s)limit\s+(\d+)\s*$/i);
  if (limitMatch) {
    requestedLimit = Number(limitMatch[1]);
    rest = rest.slice(0, limitMatch.index).trim();
  }

  const orderMatch = rest.match(/(?:^|\s)order\s+by\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(asc|desc))?\s*$/i);
  if (orderMatch) {
    orderBy = { column: orderMatch[1], direction: (orderMatch[2] || 'asc').toLowerCase() };
    rest = rest.slice(0, orderMatch.index).trim();
  }

  if (rest) {
    const whereMatch = rest.match(/^where\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i);
    if (!whereMatch) throw Object.assign(new Error('Unsupported SELECT suffix'), { code: 'UNSUPPORTED_QUERY' });
    where = { column: whereMatch[1], value: parseLiteral(whereMatch[2]) };
  }

  if (!TABLE_DEFINITIONS[table]) throw Object.assign(new Error(`Unknown table: ${table}`), { code: 'TABLE_NOT_FOUND' });
  const knownColumns = new Set(TABLE_DEFINITIONS[table].map((column) => column.name));
  const trimmedSelection = selection.trim();
  const columns = trimmedSelection === '*' ? ['*'] : trimmedSelection.split(',').map((part) => part.trim()).filter(Boolean);
  if (!columns.length || columns.some((column) => column !== '*' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
    throw Object.assign(new Error('Only simple column selections are supported'), { code: 'UNSUPPORTED_SELECT_LIST' });
  }
  for (const column of columns) {
    if (column !== '*' && !knownColumns.has(column)) throw Object.assign(new Error(`Unknown column: ${column}`), { code: 'COLUMN_NOT_FOUND' });
  }
  if (where && !knownColumns.has(where.column)) throw Object.assign(new Error(`Unknown WHERE column: ${where.column}`), { code: 'COLUMN_NOT_FOUND' });
  if (orderBy && !knownColumns.has(orderBy.column)) throw Object.assign(new Error(`Unknown ORDER BY column: ${orderBy.column}`), { code: 'COLUMN_NOT_FOUND' });
  if (requestedLimit !== null && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)) {
    throw Object.assign(new Error('LIMIT must be a positive safe integer'), { code: 'INVALID_LIMIT' });
  }
  return { sql: safeSql, table, columns, where, orderBy, requestedLimit };
}

function boundedLimits(limits = {}) {
  return {
    maxRows: Math.max(1, Math.min(DEFAULT_LIMITS.maxRows, Number(limits.maxRows) || DEFAULT_LIMITS.maxRows)),
    maxPageSize: Math.max(1, Math.min(DEFAULT_LIMITS.maxPageSize, Number(limits.maxPageSize) || DEFAULT_LIMITS.maxPageSize)),
    maxBytes: Math.max(1024, Math.min(DEFAULT_LIMITS.maxBytes, Number(limits.maxBytes) || DEFAULT_LIMITS.maxBytes)),
    timeoutMs: Math.max(10, Math.min(DEFAULT_LIMITS.timeoutMs, Number(limits.timeoutMs) || DEFAULT_LIMITS.timeoutMs))
  };
}

function planCore(plan) {
  return { sourceId: plan.sourceId, schemaRevision: plan.schemaRevision, operation: plan.operation, query: plan.query, limits: plan.limits, sqlHash: plan.sqlHash };
}

export function planQuery({ sourceId = SOURCE_ID, sql, limits = {} } = {}) {
  const schema = inspectSchema(sourceId);
  const parsed = parseSelect(sql);
  const plan = {
    sourceId,
    schemaRevision: schema.revision,
    operation: 'select',
    query: { table: parsed.table, columns: parsed.columns, where: parsed.where, orderBy: parsed.orderBy, requestedLimit: parsed.requestedLimit },
    limits: boundedLimits(limits),
    sqlHash: sha256(parsed.sql),
    policy: { mode: 'read-only', requiresApproval: false }
  };
  plan.id = `plan_${sha256(stableStringify(planCore(plan))).slice(0, 24)}`;
  planStore.set(plan.id, Object.freeze(clone(plan)));
  return clone(plan);
}

function compareValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  const a = String(left);
  const b = String(right);
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return a.length === b.length ? a.localeCompare(b) : a.length - b.length;
  return a.localeCompare(b);
}

function executePlan(plan) {
  let rows = FIXTURES[plan.query.table].map((row) => ({ ...row }));
  if (plan.query.where) rows = rows.filter((row) => String(row[plan.query.where.column]) === String(plan.query.where.value));
  if (plan.query.orderBy) {
    const factor = plan.query.orderBy.direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => compareValues(a[plan.query.orderBy.column], b[plan.query.orderBy.column]) * factor);
  }
  rows = rows.slice(0, Math.min(plan.limits.maxRows, plan.query.requestedLimit || plan.limits.maxRows));
  if (!(plan.query.columns.length === 1 && plan.query.columns[0] === '*')) {
    rows = rows.map((row) => Object.fromEntries(plan.query.columns.map((column) => [column, row[column]])));
  }
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  if (bytes > plan.limits.maxBytes) throw Object.assign(new Error('Result exceeds the configured byte ceiling'), { code: 'RESULT_TOO_LARGE' });
  return { rows, rowCount: rows.length, bytes };
}

function policyDecision(plan) {
  if (!plan || typeof plan !== 'object') return { allowed: false, code: 'PLAN_REQUIRED', reason: 'A validated query plan is required' };
  const stored = planStore.get(plan.id);
  if (!stored || stableStringify(stored) !== stableStringify(plan)) return { allowed: false, code: 'PLAN_TAMPERED', reason: 'The plan was not issued by the planner or has been modified' };
  if (plan.operation !== 'select') return { allowed: false, code: 'MUTATION_DENIED', reason: 'Phase A permits SELECT plans only' };
  if (plan.sourceId !== SOURCE_ID) return { allowed: false, code: 'SOURCE_MISMATCH', reason: 'The plan is bound to a different data source' };
  if (plan.schemaRevision !== inspectSchema(SOURCE_ID).revision) return { allowed: false, code: 'STALE_SCHEMA', reason: 'The plan schema revision is stale' };
  if (!sourceDefinition().readOnlyProof.enforced) return { allowed: false, code: 'READ_ONLY_PROOF_REQUIRED', reason: 'Read-only enforcement is not proven by the adapter' };
  return { allowed: true, code: 'ALLOW_READ', reason: 'Read-only plan is bound to the current source and schema revision' };
}

function receiptId({ requestId, plan, status, code }) {
  return `receipt_${sha256(stableStringify({ requestId, planId: plan?.id || null, status, code })).slice(0, 24)}`;
}

function saveReceipt(receipt) {
  if (!receiptStore.has(receipt.id)) receiptStore.set(receipt.id, Object.freeze(clone(receipt)));
  return clone(receiptStore.get(receipt.id));
}

function recordReceipt({ requestId, plan, decision, status, code, result = null, error = null }) {
  return saveReceipt({
    id: receiptId({ requestId, plan, status, code }),
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
  });
}

export function getExecutionReceipt(id) {
  return clone(receiptStore.get(id) || null);
}

export function searchExecutionReceipts({ sourceId = null, status = null, sqlHash = null } = {}) {
  return [...receiptStore.values()].filter((receipt) => !sourceId || receipt.sourceId === sourceId)
    .filter((receipt) => !status || receipt.status === status)
    .filter((receipt) => !sqlHash || receipt.sqlHash === sqlHash)
    .map(clone);
}

export function runReadQuery({ plan = null, sourceId = SOURCE_ID, sql = null, limits = {}, requestId = null } = {}) {
  let effectivePlan = plan;
  let planningError = null;
  if (!effectivePlan) {
    try { effectivePlan = planQuery({ sourceId, sql, limits }); } catch (error) { planningError = error; }
  }
  const effectiveRequestId = String(requestId || `auto_${sha256(stableStringify({ sourceId, planId: effectivePlan?.id || null, sql: String(sql || '') })).slice(0, 24)}`);

  if (planningError) {
    const decision = { allowed: false, code: planningError.code || 'PLAN_INVALID', reason: planningError.message };
    const receipt = recordReceipt({ requestId: effectiveRequestId, plan: null, decision, status: 'denied', code: decision.code, error: decision.reason });
    return { status: 'denied', decision, receipt, result: null, replayed: false };
  }

  const decision = policyDecision(effectivePlan);
  if (!decision.allowed) {
    const receipt = recordReceipt({ requestId: effectiveRequestId, plan: effectivePlan, decision, status: 'denied', code: decision.code, error: decision.reason });
    return { status: 'denied', decision, receipt, result: null, replayed: false };
  }

  const successId = receiptId({ requestId: effectiveRequestId, plan: effectivePlan, status: 'succeeded', code: 'QUERY_EXECUTED' });
  if (receiptStore.has(successId)) return { status: 'succeeded', decision, receipt: getExecutionReceipt(successId), result: null, replayed: true };

  try {
    const startedAt = performance.now();
    const result = executePlan(effectivePlan);
    if (performance.now() - startedAt > effectivePlan.limits.timeoutMs) throw Object.assign(new Error('Query exceeded the configured timeout ceiling'), { code: 'QUERY_TIMEOUT' });
    const receipt = recordReceipt({ requestId: effectiveRequestId, plan: effectivePlan, decision, status: 'succeeded', code: 'QUERY_EXECUTED', result });
    return {
      status: 'succeeded', decision, receipt, replayed: false,
      result: { ...result, page: 1, pageSize: Math.min(effectivePlan.limits.maxPageSize, result.rowCount || effectivePlan.limits.maxPageSize) }
    };
  } catch (error) {
    const receipt = recordReceipt({ requestId: effectiveRequestId, plan: effectivePlan, decision, status: 'failed', code: error.code || 'QUERY_FAILED', error: error.message });
    return { status: 'failed', decision, receipt, result: null, replayed: false };
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
