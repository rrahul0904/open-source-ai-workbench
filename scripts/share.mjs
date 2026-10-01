#!/usr/bin/env node
import { createPreviewRuntime } from '../src/preview-runtime.mjs';
import { createTunnelAgent } from '../src/preview-relay.mjs';

function values(flag) {
  return process.argv.slice(2).filter((arg) => arg.startsWith(`${flag}=`)).map((arg) => arg.slice(flag.length + 1));
}
function value(flag, fallback) { return values(flag).at(-1) ?? fallback; }
function has(flag) { return process.argv.slice(2).includes(flag); }
function mutation(raw) {
  const i = raw.indexOf(':');
  if (i < 1 || !raw.slice(i + 1).startsWith('/')) throw new Error(`Invalid --allow-mutation value: ${raw}`);
  return { method: raw.slice(0, i).toUpperCase(), path: raw.slice(i + 1) };
}
if (has('--help')) {
  console.log(`Usage:
  npm run share -- --relay-url=https://relay.example --upstream=http://127.0.0.1:3000

Environment:
  PREVIEW_RELAY_OPERATOR_KEY   Required relay registration secret

Options:
  --ttl-ms=900000
  --allow-mutation=POST:/safe-route
  --no-freeze
  --no-widget
  --unsafe-forward-writes
`);
  process.exit(0);
}

const operatorKey = process.env.PREVIEW_RELAY_OPERATOR_KEY;
if (!operatorKey) throw new Error('PREVIEW_RELAY_OPERATOR_KEY is required');
const relayUrl = value('--relay-url');
if (!relayUrl) throw new Error('--relay-url is required');
const upstream = value('--upstream', 'http://127.0.0.1:3000');
const ttlMs = Number(value('--ttl-ms', String(15 * 60_000)));

const preview = createPreviewRuntime({
  upstream,
  demo: !has('--unsafe-forward-writes'),
  freeze: !has('--no-freeze'),
  injectWidget: !has('--no-widget'),
  allowedMutations: values('--allow-mutation').map(mutation)
});
const previewAddress = await preview.listen({ host: '127.0.0.1', port: 0 });
const previewUrl = `http://127.0.0.1:${previewAddress.port}`;
const agent = createTunnelAgent({ relayUrl, operatorKey, previewUrl, ttlMs });
const session = await agent.register();

console.log(`share: ${session.publicUrl}`);
console.log(`upstream: ${upstream}`);
console.log(`expires: ${session.expiresAt}`);
console.log(`policy: demo=${preview.config.demo} freeze=${preview.config.freeze} widget=${preview.config.injectWidget}`);

const abort = new AbortController();
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  abort.abort();
  console.log(`share: stopping on ${signal}`);
  await agent.close().catch(() => {});
  await preview.close();
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

await agent.run({ signal: abort.signal });
