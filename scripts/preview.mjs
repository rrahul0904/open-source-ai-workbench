#!/usr/bin/env node
import { createPreviewRuntime } from '../src/preview-runtime.mjs';

function values(flag) {
  return process.argv.slice(2).filter((arg) => arg.startsWith(`${flag}=`)).map((arg) => arg.slice(flag.length + 1));
}

function value(flag, fallback) {
  return values(flag).at(-1) ?? fallback;
}

function has(flag) {
  return process.argv.slice(2).includes(flag);
}

function usage() {
  console.log(`Safe preview runtime

Usage:
  npm run preview -- --upstream=http://127.0.0.1:3000 [options]

Options:
  --listen-port=4040              Local preview port (default 4040)
  --allow-mutation=POST:/path     Explicitly forward one mutation route; repeatable
  --no-freeze                     Disable last-good HTML fallback
  --no-widget                     Disable feedback widget injection
  --unsafe-forward-writes         Disable demo interception entirely
  --help                          Show this help

Phase A binds only to 127.0.0.1 and accepts only loopback upstreams.
Public tunneling is deliberately not part of this slice.
`);
}

function parseMutation(value) {
  const separator = value.indexOf(':');
  if (separator < 1) throw new Error(`Invalid --allow-mutation value: ${value}`);
  const method = value.slice(0, separator).toUpperCase();
  const path = value.slice(separator + 1);
  if (!path.startsWith('/')) throw new Error(`Mutation path must start with /: ${value}`);
  return { method, path };
}

if (has('--help')) {
  usage();
  process.exit(0);
}

const upstream = value('--upstream', 'http://127.0.0.1:3000');
const listenPort = Number(value('--listen-port', '4040'));
if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) throw new Error('--listen-port must be 0-65535');

const runtime = createPreviewRuntime({
  upstream,
  demo: !has('--unsafe-forward-writes'),
  freeze: !has('--no-freeze'),
  injectWidget: !has('--no-widget'),
  allowedMutations: values('--allow-mutation').map(parseMutation)
});

const address = await runtime.listen({ host: '127.0.0.1', port: listenPort });
const origin = `http://127.0.0.1:${address.port}`;
console.log(`safe-preview: ${origin} -> ${runtime.config.upstream}`);
console.log(`policy: demo=${runtime.config.demo} freeze=${runtime.config.freeze} widget=${runtime.config.injectWidget}`);
console.log(`inspect: ${origin}/__preview/status and ${origin}/__preview/requests`);

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`safe-preview: stopping on ${signal}`);
  await runtime.close();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
