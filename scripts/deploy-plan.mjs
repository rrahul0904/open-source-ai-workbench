#!/usr/bin/env node
import { createDeploymentPlan } from '../src/deploy-runtime.mjs';

function value(flag, fallback = null) {
  const prefix = `${flag}=`;
  const found = process.argv.slice(2).filter((arg) => arg.startsWith(prefix)).at(-1);
  return found ? found.slice(prefix.length) : fallback;
}
function values(flag) {
  const prefix = `${flag}=`;
  return process.argv.slice(2).filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
}
if (process.argv.includes('--help')) {
  console.log(`Usage:
  npm run deploy:plan -- --source=. --revision=<40-char-git-sha> [options]

Options:
  --builder=auto|dockerfile|railpack
  --start-command=<command>
  --healthcheck=/healthz
  --env-name=PORT              Repeatable; names only, never values
`);
  process.exit(0);
}

const sourceRoot = value('--source', '.');
const sourceRevision = value('--revision');
if (!sourceRevision) throw new Error('--revision is required');

const plan = await createDeploymentPlan({
  sourceRoot,
  sourceRevision,
  builder: value('--builder', 'auto'),
  startCommand: value('--start-command'),
  healthcheckPath: value('--healthcheck', '/healthz'),
  environmentVariableNames: values('--env-name')
});

const output = {
  version: plan.version,
  planDigest: plan.planDigest,
  source: plan.source,
  build: plan.build,
  resources: plan.resources,
  environmentVariableNames: plan.environmentVariableNames,
  approvalRequired: plan.approvalRequired
};
console.log(JSON.stringify(output, null, 2));
