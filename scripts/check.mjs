import { promises as fs } from 'node:fs';
import path from 'node:path';
import { capabilities } from '../src/catalog.mjs';
import { executeWorkflow } from '../src/workflows.mjs';

const required = ['package.json','server.mjs','public/index.html','public/app.js','public/styles.css','api/health.js','api/capabilities.js','api/runs.js','api/acceptance.js','api/workflows/run.js','vercel.json','Dockerfile','.github/workflows/ci.yml'];
for (const file of required) await fs.access(path.resolve(file));
if (capabilities.length < 11) throw new Error(`Expected at least 11 executable capabilities, found ${capabilities.length}`);
for (const capability of capabilities) {
  const sample = capability.id === 'agentic-inbox' ? { subject: 'Hello', body: 'Please reply' } : capability.id === 'osint-graph' ? {} : { topic: 'check', prompt: 'check', text: 'check', goal: 'check', symbol: 'CHK' };
  const run = await executeWorkflow(capability.id, sample);
  if (run.status !== 'succeeded') throw new Error(`${capability.id} did not succeed`);
}
console.log(`check: ${capabilities.length} capabilities executable; required deployment files present`);
