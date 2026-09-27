import test from 'node:test';
import assert from 'node:assert/strict';
import { defensiveTriage, privacySafeWorkflowInput } from '../src/defensive-triage.mjs';
import { modelExperimentPlan } from '../src/model-experiment-plan.mjs';

const secret = 'test-person@example.org SECRET-CANARY-407';
test('defensive triage returns bounded advisory, takes no action and never reflects full input', async () => {
  const out = await defensiveTriage({ kind:'email', text:`URGENT: verify your account password. ${secret}`, provider:'demo' });
  assert.equal(out.verdict, 'review-indicated');
  assert.deepEqual(out.signals, ['credential-request','urgency-pressure']);
  assert.equal(out.reviewRequired, true);
  assert.equal(out.modelInvoked, false);
  assert.equal(out.actionTaken, false);
  assert.ok(!JSON.stringify(out).includes(secret));
});
test('absence of heuristic evidence is not a benign or safe verdict', async () => {
  const out = await defensiveTriage({ kind:'http', text:'GET /status HTTP/1.1' });
  assert.equal(out.verdict, 'no-heuristic-flags');
  assert.equal(out.reviewRequired, true);
});
test('threat report counts unique references without echoing report', async () => {
  const out = await defensiveTriage({ kind:'threat-report', text:`Malware CVE-2025-1234 CVE-2025-1234 T1059 ${secret}` });
  assert.deepEqual(out.referenceCounts,{distinctCves:1,distinctAttackTechniques:1});
  assert.ok(!JSON.stringify(out).includes(secret));
});
test('invalid types, kind and payload sizes fail closed', async () => {
  await assert.rejects(defensiveTriage({ kind:'email',text:42 }),/text must be/);
  await assert.rejects(defensiveTriage({ kind:'host',text:'x' }),/kind must/);
  await assert.rejects(defensiveTriage({ kind:'email',text:'x'.repeat(12001) }),/at most/);
  await assert.rejects(defensiveTriage({ kind:'email',text:'x',provider:'other' }),/provider must/);
});
test('live inference is opt-in and requires owner protection, not request-supplied URL', async () => {
  await assert.rejects(defensiveTriage({kind:'email',text:'hello',provider:'live'}),/Explicit optInRemoteInference/);
  const prior=process.env.WORKBENCH_API_KEY; delete process.env.WORKBENCH_API_KEY;
  try { await assert.rejects(defensiveTriage({kind:'email',text:'hello',provider:'live',optInRemoteInference:true}),/Protect the workbench/); }
  finally { if (prior===undefined) delete process.env.WORKBENCH_API_KEY; else process.env.WORKBENCH_API_KEY=prior; }
});
test('run records for security and training do not persist source text or secrets',()=>{
  for (const id of ['defensive-triage','model-experiment-plan']) {
    const saved=privacySafeWorkflowInput(id,{kind:'email',text:secret,provider:'demo'});
    assert.equal(saved.redacted,true);
    assert.ok(!JSON.stringify(saved).includes(secret));
  }
});
test('planner is deterministic and explicitly does not train or download a model',()=>{
  const a=modelExperimentPlan({os:'linux',accelerator:'cuda',memoryGb:24,budgetHours:4});
  const b=modelExperimentPlan({os:'linux',accelerator:'cuda',memoryGb:24,budgetHours:4});
  assert.deepEqual(a,b);
  assert.equal(a.trainingExecuted,false); assert.equal(a.modelDownloaded,false); assert.equal(a.state,'plan-only');
  assert.equal(a.backend.name,'transformers-peft-with-optional-vllm');
});
test('unsupported hardware and invalid parameters are explicit',()=>{
  assert.equal(modelExperimentPlan({}).backend.status,'accelerator-required');
  assert.equal(modelExperimentPlan({os:'windows',accelerator:'cuda',memoryGb:6}).backend.status,'insufficient-reported-memory');
  assert.equal(modelExperimentPlan({os:'windows',accelerator:'cuda',memoryGb:24}).backend.name,'transformers-peft');
  assert.throws(()=>modelExperimentPlan({os:'macos',accelerator:'cuda'}),/Unsupported/);
  assert.throws(()=>modelExperimentPlan({budgetHours:-1}),/budgetHours/);
  assert.throws(()=>modelExperimentPlan({benchmarks:['imaginary']}),/benchmarks/);
  assert.throws(()=>modelExperimentPlan({memoryGb:Infinity}),/memoryGb/);
});
