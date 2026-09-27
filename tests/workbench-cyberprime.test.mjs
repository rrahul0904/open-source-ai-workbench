import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkflow } from '../src/workflows.mjs';
import { handleApi } from '../src/http.mjs';

test('new demo workflows are callable through the existing workflow dispatcher', async () => {
  const triage=await executeWorkflow('defensive-triage', {kind:'email', text:'Urgent verify your password - PRIVATE-INPUT-CANARY'});
  assert.equal(triage.status,'succeeded');
  assert.equal(triage.output.actionTaken,false);
  assert.equal(triage.input.redacted,true);
  assert.ok(!JSON.stringify(triage).includes('PRIVATE-INPUT-CANARY'));
  const plan=await executeWorkflow('model-experiment-plan', {os:'linux',accelerator:'cuda',memoryGb:24,budgetHours:3});
  assert.equal(plan.status,'succeeded');
  assert.equal(plan.output.state,'plan-only');
  assert.equal(plan.output.trainingExecuted,false);
});

test('HTTP API exposes both capabilities without secrets and preserves privacy', async () => {
  const list=await handleApi({method:'GET',path:'/api/capabilities',clientKey:'cyberprime-test-capabilities'});
  assert.equal(list.status,200);
  assert.ok(list.body.capabilities.some(x=>x.id==='defensive-triage'));
  assert.ok(list.body.capabilities.some(x=>x.id==='model-experiment-plan'));
  const run=await handleApi({method:'POST',path:'/api/workflows/run',clientKey:'cyberprime-test-post',body:{workflowId:'defensive-triage',input:{kind:'http',text:'GET /status HTTP/1.1\nPRIVATE-INPUT-CANARY'}}});
  assert.equal(run.status,200);
  assert.equal(run.body.output.verdict,'no-heuristic-flags');
  assert.ok(!JSON.stringify(run.body).includes('PRIVATE-INPUT-CANARY'));
  const invalid=await handleApi({method:'POST',path:'/api/workflows/run',clientKey:'cyberprime-test-invalid',body:{workflowId:'defensive-triage',input:{kind:'email',text:5}}});
  assert.equal(invalid.status,400);
});
