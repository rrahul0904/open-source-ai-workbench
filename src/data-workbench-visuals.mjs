import crypto from 'node:crypto';
import { inspectSchema, planQuery, runReadQuery } from './data-workbench.mjs';

const DEFAULT_RENDER_BUDGET = Object.freeze({
  maxRows: 50,
  maxNodes: 5000,
  maxDepth: 8,
  maxBytes: 64 * 1024
});

const projectionReceipts = new Map();
const materializationPlans = new Map();

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function boundedRenderBudget(input = {}) {
  const cap = (name, floor) => {
    const requested = Number(input[name]);
    if (!Number.isFinite(requested)) return DEFAULT_RENDER_BUDGET[name];
    return Math.max(floor, Math.min(DEFAULT_RENDER_BUDGET[name], Math.floor(requested)));
  };
  return {
    maxRows: cap('maxRows', 1),
    maxNodes: cap('maxNodes', 8),
    maxDepth: cap('maxDepth', 1),
    maxBytes: cap('maxBytes', 256)
  };
}

function normalizeScalar(value, typeHint = null) {
  if (value === null) return { type: 'null', value: null };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NON_FINITE_NUMBER_DENIED', 'Non-finite numeric values are not supported');
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) fail('UNSAFE_INTEGER_DENIED', 'Unsafe JavaScript integers must be supplied as exact strings or bigint values');
      return { type: 'integer', value };
    }
    return { type: 'number', value };
  }
  if (typeof value === 'string') {
    if (typeHint === 'bigint-string') {
      if (!/^-?\d+$/.test(value)) fail('INVALID_INT64_STRING', 'bigint-string values must contain an exact integer literal');
      return { type: 'int64', value };
    }
    return { type: 'string', value };
  }
  if (value instanceof Date) return { type: 'datetime', value: value.toISOString() };
  if (value instanceof Uint8Array) return { type: 'binary', value: Buffer.from(value).toString('base64') };
  return null;
}

function envelopeValue(value, { typeHint = null, depth = 0, budget, state, seen }) {
  if (depth > budget.maxDepth) fail('RENDER_DEPTH_LIMIT', `Nested value exceeds maxDepth=${budget.maxDepth}`);
  state.nodes += 1;
  if (state.nodes > budget.maxNodes) fail('RENDER_NODE_LIMIT', `Nested value exceeds maxNodes=${budget.maxNodes}`);

  const scalar = normalizeScalar(value, typeHint);
  if (scalar) return scalar;

  if (Array.isArray(value)) {
    if (seen.has(value)) fail('CYCLIC_VALUE_DENIED', 'Cyclic values cannot be projected');
    seen.add(value);
    const items = value.map((item) => envelopeValue(item, { depth: depth + 1, budget, state, seen }));
    seen.delete(value);
    return { type: 'array', items };
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) fail('CYCLIC_VALUE_DENIED', 'Cyclic values cannot be projected');
    seen.add(value);
    const fields = {};
    for (const key of Object.keys(value).sort()) {
      fields[key] = envelopeValue(value[key], { depth: depth + 1, budget, state, seen });
    }
    seen.delete(value);
    return { type: 'object', fields };
  }

  fail('UNSUPPORTED_VALUE_TYPE', `Unsupported value type: ${typeof value}`);
}

function columnHintsForPlan(plan) {
  const schema = inspectSchema(plan.sourceId);
  const table = schema.tables.find((candidate) => candidate.name === plan.query.table);
  if (!table) fail('TABLE_NOT_FOUND', `Unknown table in plan: ${plan.query.table}`);
  return {
    schema,
    hints: Object.fromEntries(table.columns.map((column) => [column.name, column.type]))
  };
}

function envelopeRow(row, hints, budget, state) {
  const fields = {};
  const seen = new WeakSet();
  for (const key of Object.keys(row).sort()) {
    fields[key] = envelopeValue(row[key], { typeHint: hints[key] || null, budget, state, seen });
  }
  return { type: 'object', fields };
}

function envelopeToTree(envelope, key = 'root') {
  if (envelope.type === 'object') {
    return {
      key,
      type: 'object',
      children: Object.entries(envelope.fields).map(([childKey, child]) => envelopeToTree(child, childKey))
    };
  }
  if (envelope.type === 'array') {
    return {
      key,
      type: 'array',
      children: envelope.items.map((child, index) => envelopeToTree(child, String(index)))
    };
  }
  return { key, type: envelope.type, value: envelope.value };
}

function makeProjectionReceipt({ executionReceiptId, sourceId, schemaRevision, mode, budget, sourceRows, renderedRows, truncated, status, code, canonicalHash = null, viewHash = null }) {
  const core = {
    executionReceiptId,
    sourceId,
    schemaRevision,
    mode,
    budget,
    sourceRows,
    renderedRows,
    truncated,
    status,
    code,
    canonicalHash,
    viewHash
  };
  const receipt = {
    id: `render_${sha256(stableStringify(core)).slice(0, 24)}`,
    ...core,
    recordedAt: new Date().toISOString()
  };
  if (!projectionReceipts.has(receipt.id)) projectionReceipts.set(receipt.id, Object.freeze(clone(receipt)));
  return clone(projectionReceipts.get(receipt.id));
}

export function getProjectionReceipt(id) {
  return clone(projectionReceipts.get(id) || null);
}

export function projectRows({ rows, mode = 'table', budget: requestedBudget = {}, typeHints = {}, executionReceiptId = null, sourceId = null, schemaRevision = null } = {}) {
  if (!Array.isArray(rows)) fail('ROWS_REQUIRED', 'rows must be an array');
  if (!['table', 'tree', 'json'].includes(mode)) fail('VIEW_MODE_UNSUPPORTED', `Unsupported view mode: ${mode}`);
  const budget = boundedRenderBudget(requestedBudget);
  const sourceRows = rows.length;
  const limitedRows = rows.slice(0, budget.maxRows);
  let canonicalRows = [];

  try {
    const state = { nodes: 0 };
    canonicalRows = limitedRows.map((row) => envelopeRow(row, typeHints, budget, state));

    let serialized = stableStringify(canonicalRows);
    while (canonicalRows.length && Buffer.byteLength(serialized) > budget.maxBytes) {
      canonicalRows.pop();
      serialized = stableStringify(canonicalRows);
    }
    const truncated = canonicalRows.length < sourceRows;
    const canonicalHash = sha256(serialized);

    let view;
    if (mode === 'table') {
      const columns = [...new Set(canonicalRows.flatMap((row) => Object.keys(row.fields)))].sort();
      view = { mode, columns, rows: canonicalRows };
    } else if (mode === 'tree') {
      view = { mode, rows: canonicalRows.map((row, index) => envelopeToTree(row, String(index))) };
    } else {
      view = { mode, rows: canonicalRows, canonicalJson: serialized };
    }

    const viewHash = sha256(stableStringify(view));
    const receipt = makeProjectionReceipt({
      executionReceiptId,
      sourceId,
      schemaRevision,
      mode,
      budget,
      sourceRows,
      renderedRows: canonicalRows.length,
      truncated,
      status: 'succeeded',
      code: truncated ? 'RENDER_TRUNCATED' : 'RENDER_COMPLETE',
      canonicalHash,
      viewHash
    });
    return { status: 'succeeded', canonicalRows, view, receipt };
  } catch (error) {
    const receipt = makeProjectionReceipt({
      executionReceiptId,
      sourceId,
      schemaRevision,
      mode,
      budget,
      sourceRows,
      renderedRows: canonicalRows.length,
      truncated: true,
      status: 'failed',
      code: error.code || 'RENDER_FAILED'
    });
    return { status: 'failed', error: { code: error.code || 'RENDER_FAILED', message: error.message }, canonicalRows: [], view: null, receipt };
  }
}

export function projectQueryExecution({ plan, execution, mode = 'table', budget = {} } = {}) {
  if (!plan || !execution) fail('QUERY_EXECUTION_REQUIRED', 'plan and execution are required');
  if (execution.status !== 'succeeded' || !execution.result) {
    fail('QUERY_NOT_PROJECTABLE', 'Only a newly succeeded query result can be projected');
  }
  const { schema, hints } = columnHintsForPlan(plan);
  return projectRows({
    rows: execution.result.rows,
    mode,
    budget,
    typeHints: hints,
    executionReceiptId: execution.receipt.id,
    sourceId: plan.sourceId,
    schemaRevision: schema.revision
  });
}

export function runProjectedQuery({ sourceId = 'demo-analytics', sql, limits = {}, requestId = null, mode = 'table', renderBudget = {} } = {}) {
  const plan = planQuery({ sourceId, sql, limits });
  const execution = runReadQuery({ plan, requestId });
  if (execution.status !== 'succeeded' || !execution.result) return { plan, execution, projection: null };
  const projection = projectQueryExecution({ plan, execution, mode, budget: renderBudget });
  return { plan, execution, projection };
}

function quoteVisualLiteral(literal) {
  if (!literal || typeof literal !== 'object') fail('VISUAL_LITERAL_REQUIRED', 'Visual filter literal must be typed');
  if (literal.type === 'string') return `'${String(literal.value).replace(/'/g, "''")}'`;
  if (literal.type === 'boolean' && typeof literal.value === 'boolean') return literal.value ? 'true' : 'false';
  if (literal.type === 'integer' && /^-?\d+$/.test(String(literal.value))) return String(literal.value);
  fail('VISUAL_LITERAL_UNSUPPORTED', `Unsupported visual filter literal: ${literal.type}`);
}

export function compileVisualQuery({ sourceId = 'demo-analytics', table, select = ['*'], filter = null, orderBy = null, limit = null, limits = {} } = {}) {
  const schema = inspectSchema(sourceId);
  const tableSchema = schema.tables.find((candidate) => candidate.name === table);
  if (!tableSchema) fail('TABLE_NOT_FOUND', `Unknown table: ${table}`);
  const knownColumns = new Set(tableSchema.columns.map((column) => column.name));

  const requestedColumns = Array.isArray(select) && select.length ? select : ['*'];
  if (requestedColumns.some((column) => column !== '*' && !knownColumns.has(column))) fail('COLUMN_NOT_FOUND', 'Visual query contains an unknown column');
  if (requestedColumns.includes('*') && requestedColumns.length > 1) fail('VISUAL_SELECT_INVALID', 'Wildcard cannot be combined with named columns');

  let sql = `SELECT ${requestedColumns.join(', ')} FROM ${table}`;
  if (filter) {
    if (filter.op !== 'eq' || !knownColumns.has(filter.column)) fail('VISUAL_FILTER_UNSUPPORTED', 'Only equality filters on known columns are supported');
    sql += ` WHERE ${filter.column} = ${quoteVisualLiteral(filter.value)}`;
  }
  if (orderBy) {
    if (!knownColumns.has(orderBy.column) || !['asc', 'desc'].includes(String(orderBy.direction || 'asc').toLowerCase())) {
      fail('VISUAL_ORDER_UNSUPPORTED', 'ORDER BY must reference a known column with asc/desc direction');
    }
    sql += ` ORDER BY ${orderBy.column} ${String(orderBy.direction || 'asc').toUpperCase()}`;
  }
  if (limit !== null) {
    const numericLimit = Number(limit);
    if (!Number.isSafeInteger(numericLimit) || numericLimit < 1) fail('VISUAL_LIMIT_INVALID', 'Visual query limit must be a positive safe integer');
    sql += ` LIMIT ${numericLimit}`;
  }
  const plan = planQuery({ sourceId, sql, limits });
  return { ast: { sourceId, table, select: requestedColumns, filter, orderBy, limit }, plan };
}

const MATERIALIZATION_OPERATION_TYPES = new Set(['create-table', 'add-column', 'add-index']);

function validateIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))) fail('MATERIALIZATION_IDENTIFIER_INVALID', `${label} must be a simple identifier`);
  return String(value);
}

function normalizeMaterializationOperation(operation) {
  if (!operation || !MATERIALIZATION_OPERATION_TYPES.has(operation.type)) fail('MATERIALIZATION_OPERATION_UNSUPPORTED', 'Unsupported materialization operation');
  if ('sql' in operation || 'rawSql' in operation || 'statement' in operation) fail('RAW_MUTATION_TEXT_DENIED', 'Raw mutation text is not accepted in a materialization preview');
  if (operation.type === 'create-table') {
    return { type: operation.type, table: validateIdentifier(operation.table, 'table') };
  }
  if (operation.type === 'add-column') {
    return {
      type: operation.type,
      table: validateIdentifier(operation.table, 'table'),
      column: validateIdentifier(operation.column, 'column'),
      dataType: String(operation.dataType || 'text')
    };
  }
  return {
    type: operation.type,
    table: validateIdentifier(operation.table, 'table'),
    index: validateIdentifier(operation.index, 'index'),
    columns: (operation.columns || []).map((column) => validateIdentifier(column, 'index column'))
  };
}

export function planSchemaMaterialization({ sourceId = 'demo-analytics', operations = [] } = {}) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 20) fail('MATERIALIZATION_OPERATIONS_REQUIRED', 'Provide 1-20 typed materialization operations');
  const schema = inspectSchema(sourceId);
  const normalized = operations.map(normalizeMaterializationOperation);
  const core = {
    sourceId,
    schemaRevision: schema.revision,
    operations: normalized,
    mode: 'preview-only',
    executable: false
  };
  const plan = { id: `mutation_plan_${sha256(stableStringify(core)).slice(0, 24)}`, ...core };
  materializationPlans.set(plan.id, Object.freeze(clone(plan)));
  return clone(plan);
}

export function validateMaterializationPlan(plan, { currentRevision = null } = {}) {
  const stored = plan?.id ? materializationPlans.get(plan.id) : null;
  if (!stored || stableStringify(stored) !== stableStringify(plan)) {
    return { valid: false, code: 'MATERIALIZATION_PLAN_TAMPERED', executable: false };
  }
  const revision = currentRevision || inspectSchema(plan.sourceId).revision;
  if (revision !== plan.schemaRevision) return { valid: false, code: 'MATERIALIZATION_PLAN_STALE', executable: false };
  return { valid: true, code: 'PREVIEW_VALID', executable: false };
}
