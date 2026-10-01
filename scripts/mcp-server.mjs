#!/usr/bin/env node
import readline from 'node:readline';
import path from 'node:path';
import { createAgentToolRuntime } from '../src/agent-runtime.mjs';

const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSION = '2025-11-25';
const SERVER_INFO = Object.freeze({ name: 'open-source-ai-workbench-preview', version: '0.1.0' });
const SERVER_META = Object.freeze({ 'io.modelcontextprotocol/serverInfo': SERVER_INFO });

function parseRoots() {
  const raw = process.env.AGENT_RUNTIME_SOURCE_ROOTS || process.cwd();
  return raw.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

const runtime = createAgentToolRuntime({
  allowedSourceRoots: parseRoots(),
  allowPublicShare: process.env.AGENT_RUNTIME_ALLOW_PUBLIC_SHARE === '1',
  relayUrl: process.env.PREVIEW_RELAY_URL || null,
  relayOperatorKey: process.env.PREVIEW_RELAY_OPERATOR_KEY || null
});

function modernRequest(message) {
  return message?.params?._meta?.['io.modelcontextprotocol/protocolVersion'] === MODERN_VERSION;
}

function modernResult(result) {
  return { resultType: 'complete', ...result, _meta: { ...(result?._meta || {}), ...SERVER_META } };
}

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function toolResult(data, modern, isError = false) {
  const structuredContent = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : { value: data };
  const result = {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent,
    isError
  };
  return modern ? modernResult(result) : result;
}

export async function dispatchMcpMessage(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id, -32600, 'Invalid Request');
  }

  const isModern = modernRequest(message);
  if (message.method === 'server/discover') {
    if (!isModern) return rpcError(message.id, -32601, 'Method not found');
    return response(message.id, modernResult({
      supportedVersions: [MODERN_VERSION],
      capabilities: { tools: { listChanged: false } },
      instructions: 'Use deploy_plan for read-only exact-SHA planning. Public share creation is disabled unless the host explicitly enables it, and share_start still requires confirmExternalShare=true.',
      ttlMs: 0,
      cacheScope: 'private'
    }));
  }

  if (message.method === 'initialize') {
    const requested = message.params?.protocolVersion;
    const supported = [LEGACY_VERSION, '2025-06-18'];
    const protocolVersion = supported.includes(requested) ? requested : LEGACY_VERSION;
    return response(message.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: 'Mutating public-share operations are policy gated; deployment execution is not exposed.'
    });
  }

  if (message.method === 'notifications/initialized') return null;

  if (isModern === false && message.params?._meta?.['io.modelcontextprotocol/protocolVersion']) {
    return rpcError(message.id, -32022, 'Unsupported protocol version', {
      requested: message.params._meta['io.modelcontextprotocol/protocolVersion'],
      supported: [MODERN_VERSION]
    });
  }

  if (message.method === 'tools/list') {
    const result = { tools: runtime.tools() };
    if (isModern) {
      result.ttlMs = 0;
      result.cacheScope = 'private';
    }
    return response(message.id, isModern ? modernResult(result) : result);
  }

  if (message.method === 'tools/call') {
    const name = message.params?.name;
    if (typeof name !== 'string' || !name) return rpcError(message.id, -32602, 'Tool name is required');
    try {
      const data = await runtime.call(name, message.params?.arguments || {});
      return response(message.id, toolResult(data, isModern, false));
    } catch (error) {
      if (error?.code === 'UNKNOWN_TOOL') return rpcError(message.id, -32601, error.message);
      return response(message.id, toolResult({ error: error?.message || 'Tool call failed' }, isModern, true));
    }
  }

  if (message.method === 'ping') {
    if (isModern) return rpcError(message.id, -32601, 'Method not supported by protocol version');
    return response(message.id, {});
  }

  return rpcError(message.id, -32601, 'Method not found');
}

export async function closeMcpRuntime() {
  await runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let closed = false;

  async function shutdown() {
    if (closed) return;
    closed = true;
    await closeMcpRuntime();
  }

  process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify(rpcError(null, -32700, 'Parse error')) + '\n');
      continue;
    }
    const result = await dispatchMcpMessage(message);
    if (result) process.stdout.write(JSON.stringify(result) + '\n');
  }
  await shutdown();
}
