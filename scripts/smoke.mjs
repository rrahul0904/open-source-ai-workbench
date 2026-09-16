import { spawn } from 'node:child_process';
const port = 3187;
const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await sleep(400);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
  if (!health.ok) throw new Error('health failed');
  const runResponse = await fetch(`http://127.0.0.1:${port}/api/workflows/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflowId: 'launch-campaign', input: { topic: 'smoke test' } }) });
  if (!runResponse.ok) throw new Error(`workflow smoke returned ${runResponse.status}`);
  const run = await runResponse.json();
  if (run.status !== 'succeeded') throw new Error('workflow smoke did not succeed');
  const home = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  if (!home.includes('Open Source AI Workbench')) throw new Error('home page smoke failed');
  console.log('smoke: health, cross-capability workflow and UI passed');
} finally {
  child.kill('SIGTERM');
}
