#!/usr/bin/env node
import { createPreviewRelay } from '../src/preview-relay.mjs';

const operatorKey = process.env.PREVIEW_RELAY_OPERATOR_KEY;
if (!operatorKey) throw new Error('PREVIEW_RELAY_OPERATOR_KEY is required');
const port = Number(process.env.PORT || process.env.PREVIEW_RELAY_PORT || 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be 0-65535');

const relay = createPreviewRelay({
  operatorKey,
  defaultTtlMs: Number(process.env.PREVIEW_RELAY_DEFAULT_TTL_MS || 15 * 60_000),
  maxTtlMs: Number(process.env.PREVIEW_RELAY_MAX_TTL_MS || 60 * 60_000)
});

const address = await relay.listen({ host: '0.0.0.0', port });
console.log(`safe-preview-relay: listening on 0.0.0.0:${address.port}`);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`safe-preview-relay: stopping on ${signal}`);
  await relay.close();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
