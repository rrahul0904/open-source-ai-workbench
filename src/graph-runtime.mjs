import { generateText } from './providers.mjs';

const MAX_NODES = 25;
const MAX_EDGES = 100;
const ALLOWED_NODE_TYPES = new Set(['input', 'template', 'knowledge', 'llm', 'output']);

function pathValue(root, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], root);
}

function renderTemplate(value, scope) {
  return String(value ?? '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
    const resolved = pathValue(scope, expression.trim());
    if (resolved == null) return '';
    return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
  });
}

function renderValue(value, scope) {
  if (Array.isArray(value)) return value.map((item) => renderValue(item, scope));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderValue(item, scope)]));
  return typeof value === 'string' ? renderTemplate(value, scope) : value;
}

function tokens(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []);
}

function normalizeDocuments(documents) {
  if (!Array.isArray(documents)) return [];
  return documents.slice(0, 100).map((document, index) => {
    if (typeof document === 'string') return { id: `doc-${index + 1}`, title: `Document ${index + 1}`, text: document };
    return {
      id: String(document?.id || `doc-${index + 1}`),
      title: String(document?.title || document?.name || `Document ${index + 1}`),
      text: String(document?.text || document?.content || '')
    };
  }).filter((document) => document.text);
}

function retrieve(query, documents, topK = 3) {
  const queryTokens = tokens(query);
  if (!queryTokens.size) return [];
  return normalizeDocuments(documents)
    .map((document) => {
      const documentTokens = tokens(`${document.title} ${document.text}`);
      let overlap = 0;
      for (const token of queryTokens) if (documentTokens.has(token)) overlap += 1;
      const score = overlap / queryTokens.size;
      return { ...document, score: Math.round(score * 1000) / 1000 };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(10, Number(topK) || 3)));
}

export function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error('Workflow graph requires a nodes array.');
  if (graph.nodes.length < 1 || graph.nodes.length > MAX_NODES) throw new Error(`Workflow graph must contain 1-${MAX_NODES} nodes.`);
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || typeof node.id !== 'string') throw new Error('Every workflow node requires a string id.');
    if (ids.has(node.id)) throw new Error(`Duplicate workflow node id: ${node.id}`);
    if (!ALLOWED_NODE_TYPES.has(node.type)) throw new Error(`Unsupported workflow node type: ${node.type}`);
    ids.add(node.id);
  }

  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (edges.length > MAX_EDGES) throw new Error(`Workflow graph supports at most ${MAX_EDGES} edges.`);
  const outgoing = new Map([...ids].map((id) => [id, []]));
  const indegree = new Map([...ids].map((id) => [id, 0]));
  for (const edge of edges) {
    const from = Array.isArray(edge) ? edge[0] : edge?.from;
    const to = Array.isArray(edge) ? edge[1] : edge?.to;
    if (!ids.has(from) || !ids.has(to)) throw new Error(`Workflow edge references an unknown node: ${from} -> ${to}`);
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }

  const ready = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (order.length !== graph.nodes.length) throw new Error('Workflow graph contains a cycle.');
  return { order, edges };
}

async function executeNode(node, scope) {
  const config = node.config || {};
  if (node.type === 'input') return { ...scope.input };

  if (node.type === 'template') {
    return { text: renderTemplate(config.template || '', scope) };
  }

  if (node.type === 'knowledge') {
    const documents = config.documentsPath ? pathValue(scope, config.documentsPath) : scope.input.documents;
    const query = renderTemplate(config.query || '{{input.query}}', scope);
    const matches = retrieve(query, documents, config.topK);
    return {
      query,
      matches,
      text: matches.map((match) => `[${match.id}] ${match.title}\n${match.text}`).join('\n\n')
    };
  }

  if (node.type === 'llm') {
    return generateText({
      prompt: renderTemplate(config.prompt || '', scope),
      system: renderTemplate(config.system || '', scope),
      provider: config.provider || scope.input.provider || 'demo'
    });
  }

  if (node.type === 'output') {
    return renderValue(config.fields || {}, scope);
  }

  throw new Error(`Unsupported workflow node type: ${node.type}`);
}

export async function executeGraph({ graph, input = {} }) {
  const { order, edges } = validateGraph(graph);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeResults = {};
  const trace = [];

  for (const id of order) {
    const node = nodesById.get(id);
    const startedAt = new Date().toISOString();
    const start = performance.now();
    try {
      const output = await executeNode(node, { input, nodes: nodeResults });
      nodeResults[id] = output;
      trace.push({
        nodeId: id,
        type: node.type,
        status: 'succeeded',
        startedAt,
        durationMs: Math.round(performance.now() - start)
      });
    } catch (error) {
      trace.push({
        nodeId: id,
        type: node.type,
        status: 'failed',
        startedAt,
        durationMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error)
      });
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { trace });
    }
  }

  const outputNodes = graph.nodes.filter((node) => node.type === 'output');
  const selected = outputNodes.length ? outputNodes.at(-1).id : order.at(-1);
  return {
    graph: { version: graph.version || 1, nodeCount: graph.nodes.length, edgeCount: edges.length },
    output: nodeResults[selected],
    trace,
    nodeResults
  };
}

export function defaultWorkflowGraph() {
  return {
    version: 1,
    nodes: [
      { id: 'input', type: 'input' },
      {
        id: 'retrieve',
        type: 'knowledge',
        config: { query: '{{input.question}}', documentsPath: 'input.documents', topK: 3 }
      },
      {
        id: 'answer',
        type: 'llm',
        config: {
          system: 'Answer only from the supplied context when context is available. Keep claims auditable.',
          prompt: 'Question: {{input.question}}\n\nRetrieved context:\n{{nodes.retrieve.text}}',
          provider: 'demo'
        }
      },
      {
        id: 'output',
        type: 'output',
        config: {
          fields: {
            answer: '{{nodes.answer.text}}',
            retrieval: '{{nodes.retrieve.matches}}',
            provider: '{{nodes.answer.provider}}',
            model: '{{nodes.answer.model}}'
          }
        }
      }
    ],
    edges: [
      ['input', 'retrieve'],
      ['retrieve', 'answer'],
      ['answer', 'output']
    ]
  };
}
