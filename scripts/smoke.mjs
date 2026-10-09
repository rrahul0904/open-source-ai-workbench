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

  const evidenceResponse = await fetch(`http://127.0.0.1:${port}/api/documents/flow`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      tenantId: 'smoke-tenant', documentId: 'smoke-doc', mediaType: 'text/markdown',
      content: '# Smoke fixture\nNorth generated 42 units.\n--- page:2 ---\n| Region | Units |\n| --- | --- |\n| South | 17 |', query: 'North 42 units',
    })
  });
  if (!evidenceResponse.ok) throw new Error(`evidence flow smoke returned ${evidenceResponse.status}`);
  const evidence = await evidenceResponse.json();
  if (!evidence.evidence?.verified || !evidence.retrieval?.hits?.length) throw new Error('evidence flow did not verify');
  if (evidence.evidence.sourceDigest !== evidence.retrieval.hits[0].sourceDigest) throw new Error('evidence source digest mismatch');

  const acceptanceResponse = await fetch(`http://127.0.0.1:${port}/api/documents/acceptance`);
  if (!acceptanceResponse.ok) throw new Error(`document acceptance returned ${acceptanceResponse.status}`);
  const acceptance = await acceptanceResponse.json();
  if (!acceptance.ok || !acceptance.verified || acceptance.roadmap !== 'RE-389') throw new Error('document acceptance receipt failed');

  const home = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  if (!home.includes('Open Source AI Workbench')) throw new Error('home page smoke failed');
  if (!home.includes('RE-389') || !home.includes('evidence-lab')) throw new Error('RE-389 evidence lab UI smoke failed');
  console.log('smoke: health, workflow, evidence flow, acceptance receipt and RE-389 UI passed');
} finally {
  child.kill('SIGTERM');
}
