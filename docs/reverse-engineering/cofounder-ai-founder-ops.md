# RE-231 — Co-Founder AI / Founder Ops capability study

Status: research/specification only  
Canonical destination: `rrahul0904/open-source-ai-workbench`  
Tracking issue: #7  
Research branch: `reverse/cofounder-founder-ops`  
Verified: 2026-09-24

## 1. Objective

Study the observable behavior and public architecture of Co-Founder AI and extract the useful product capabilities into an independently implemented Founder Ops workflow inside Open Source AI Workbench.

This is not a request to duplicate the upstream user interface, prompts, source code, datasets, branding, thresholds or internal implementation. The desired outcome is a clean-room, provider-neutral business-agent workflow that fits the Workbench's existing governance model.

Sources:
- Reddit launch post: https://www.reddit.com/r/SideProject/s/kaDc66xlYK
- Product: https://get-cofounder.tech/
- Public upstream repository: https://github.com/karthik132007/Co_Founder

## 2. Product problem

A solo founder repeatedly changes operating modes: research, strategy, writing, marketing, analysis, design, execution and review. A normal chatbot preserves one conversational persona, so the user must manually decompose the work, rewrite context for each discipline and reconcile contradictory outputs.

The important product idea is therefore not "many chatbots." It is a governed business workflow:

1. capture one founder/company objective;
2. let one coordinator own decomposition;
3. delegate bounded assignments to role-specialized workers;
4. share durable company evidence and memory;
5. expose progress while work is running;
6. preserve evidence/artifacts from each worker;
7. synthesize one coherent decision package;
8. execute external actions only through explicit governed connectors.

## 3. Observable product flow

### 3.1 Entry and company context
The user starts with a business brief or question. Company-specific context, prior conversations, uploaded material and retrieved evidence can become reusable memory.

### 3.2 CEO/orchestrator
A central coordinator decides which specialist capabilities are needed and what each specialist should receive. The coordinator remains responsible for the final synthesis instead of returning unrelated agent transcripts.

### 3.3 Specialist execution
Public product/source material exposes roles covering at least:
- research;
- writing/content;
- marketing;
- data/analysis;
- design;
- judge/quality reflection.

The public launch description also presents the CEO as the coordinating role.

### 3.4 Shared knowledge and memory
The system exposes persistent conversation/company memory and hybrid retrieval. The useful transferable requirement is a common evidence interface shared by every specialist, with tenant/company isolation and source provenance.

### 3.5 Progress visibility
The user can observe agents working instead of seeing only a long synchronous spinner. The independent rebuild should model run events as first-class durable data rather than coupling progress to UI strings.

### 3.6 Synthesis
Specialist results are reconciled into a founder-facing artifact: a strategy, campaign, analysis, content package or other deliverable.

### 3.7 Action layer
The public product describes business integrations. For the Workbench, all outbound side effects must remain behind explicit provider adapters and approval gates.

## 4. Public architecture study

The current upstream repository describes a Python/FastAPI backend, Next.js/React frontend, Redis caching, Kafka/KRaft asynchronous processing, Supabase/Postgres with pgvector, hybrid retrieval, model routing through OpenRouter, search providers, an e2b execution boundary, file extraction/OCR and WebSocket/token streaming.

The earlier Reddit launch post described RabbitMQ for background work. Treat this as evidence of architecture evolution, not as a contradiction we need to reproduce. Our implementation should depend on a queue/event interface rather than Kafka or RabbitMQ semantics.

### 4.1 Transferable architecture pattern

```text
Founder UI / API
      |
      v
FounderBrief + CompanyContext
      |
      v
CEO Planner / Orchestrator
      |
      +------> Research assignment
      +------> Writer assignment
      +------> Marketing assignment
      +------> Analyst assignment
      |
      v
Shared Evidence + Memory interface
      |
      v
Run/Event Ledger -----> live operator view
      |
      v
Artifact Synthesis
      |
      v
Approval-gated Connectors / Actions
```

### 4.2 Interfaces, not vendor lock-in

The clean-room Workbench slice should define:
- `ModelGateway`
- `EvidenceRetriever`
- `MemoryStore`
- `RunEventStore`
- `ArtifactStore`
- `ConnectorAction`
- `ApprovalGate`
- `UsageMeter`

Concrete Redis, Postgres, queue, LLM or browser providers can be added later without changing the orchestration domain model.

## 5. Proposed domain model

### FounderBrief
- brief_id
- tenant_id
- company_id
- objective
- audience
- constraints
- requested_outputs
- max_actions
- max_cost
- created_at

### CompanyContext
- company_id
- description
- products
- audience
- positioning
- brand_constraints
- approved_sources
- memory_refs

### Assignment
- assignment_id
- run_id
- role
- objective
- inputs
- required_evidence
- artifact_contract
- budget
- status

### EvidenceRef
- evidence_id
- source_type
- locator
- observed_at
- excerpt_hash
- confidence
- license/provenance metadata

### AgentArtifact
- artifact_id
- assignment_id
- artifact_type
- content_ref
- evidence_refs
- version

### RunEvent
- event_id
- run_id
- sequence
- assignment_id
- type
- timestamp
- payload

### FounderRun
- run_id
- brief_id
- plan_version
- status
- action_budget
- cost_budget
- consumed_actions
- consumed_cost
- artifacts
- final_artifact_ref

## 6. Phase A — repository-certifiable vertical slice

Phase A deliberately avoids live external models and side effects.

### 6.1 Scope
Implement:
1. original FounderBrief and CompanyContext schemas;
2. deterministic CEO planner;
3. Research, Writer, Marketing and Analyst worker contracts;
4. deterministic fake worker provider;
5. shared read-only EvidenceRetriever and MemoryStore interfaces;
6. append-only RunEvent ledger;
7. budget/cancellation state machine;
8. deterministic synthesis of a final Founder Ops bundle;
9. API/workflow registration in the Workbench;
10. tests and acceptance fixture.

### 6.2 Example acceptance scenario

Input:
- Company: fictional B2B data-quality startup.
- Objective: prepare a launch brief for a new agentic testing feature.
- Outputs: market summary, positioning, launch copy, KPI plan.
- Action budget: 8.
- External effects: disabled.

Expected plan:
- Research → independent market/evidence artifact.
- Marketing → positioning artifact using supplied context/evidence.
- Writer → launch copy draft.
- Analyst → KPI/measurement artifact.
- CEO synthesis → final launch brief with references to the four artifacts.

The same input and fixture set must produce deterministic plan structure, event ordering and artifact identifiers.

## 7. Phase A acceptance gates

Repository evidence must demonstrate:
- planner routing is deterministic for fixtures;
- role inputs are bounded and do not receive another tenant/company's memory;
- the action budget fails closed;
- cancellation stops undispatched work and records terminal events;
- event sequence is stable and replayable;
- final synthesis references its component artifacts;
- research evidence provenance survives into downstream outputs;
- connectors cannot perform a real side effect;
- existing `npm test`, `npm run check` and `npm run smoke` continue to pass;
- exact-head CI succeeds.

No browser, hosted, queue, Redis, Supabase, Kafka or live-model claims are implied by a passing Phase A.

## 8. Phase B — durable company memory and RAG

After Phase A:
- persist CompanyContext;
- add document/file ingestion;
- chunk and index evidence;
- combine semantic and lexical retrieval;
- add cache abstraction;
- enforce tenant/company namespaces;
- record source provenance and ingestion version;
- test deletion/revocation and stale-memory behavior.

The target is useful organizational memory, not simply "vector search."

## 9. Phase C — live intelligence and streaming

Add:
- OpenAI-compatible/provider-neutral model adapter;
- effort/cost policy;
- live agent events;
- token/partial output streaming;
- bounded retry/reflection;
- judge/reviewer adapter;
- timeouts and cancellation;
- cost/usage receipts.

Model choice is an operator policy, not business logic.

## 10. Phase D — governed business actions

Potential adapters:
- email;
- ad platforms;
- spreadsheets;
- commerce;
- CRM;
- social publishing.

Every mutation must have:
- tenant-scoped credential handling;
- preview;
- explicit approval when policy requires it;
- idempotency key;
- audit event;
- bounded retry;
- provider response receipt;
- revocation path.

Read-only discovery can be certified independently from mutations.

## 11. Phase E — evaluation, economics and quality

Add:
- scenario/eval corpus written specifically for this project;
- plan-quality checks;
- evidence-grounding checks;
- cross-agent contradiction detection;
- artifact completeness checks;
- latency/cost telemetry;
- per-run usage ledger;
- regression thresholds.

Do not use an unverified single "AI quality score" as the release gate. Keep inspectable component metrics.

## 12. Phase F — hosted production boundary

Only after repository certification:
- durable worker/queue;
- persistent run/event state;
- production auth and tenant isolation;
- secret storage;
- rate limits;
- connector authorization;
- disaster/retry semantics;
- hosted readiness endpoint;
- browser evidence for the exact deployed commit;
- production usage/credit reconciliation.

## 13. What to reuse from Open Source AI Workbench

Prefer extending existing Workbench capabilities instead of creating duplicate infrastructure:
- provider abstraction;
- deterministic workflow execution;
- multi-agent/campaign orchestration patterns;
- connector/action boundary;
- run history abstraction;
- API auth boundary;
- current test/check/smoke gates.

The Founder Ops donor should become a coherent additional workflow/capability, not a second platform hidden inside the repository.

## 14. Differentiation we should intentionally add

A clean-room implementation can improve on the observable concept through:
- explicit artifact and evidence contracts between roles;
- deterministic fake providers for CI;
- replayable event ledger;
- first-class cost/action budgets;
- provenance propagation from research through synthesis;
- connector approvals and idempotency;
- provider-neutral storage/queue/model interfaces;
- tenant isolation tests;
- exact-head release evidence.

## 15. Risks

### Orchestration quality
More agents can increase contradiction, latency and cost. Only delegate when the plan requires a role.

### Memory contamination
Shared memory is valuable only when company/tenant boundaries and evidence freshness are enforced.

### Cost explosion
Retries, reflection and parallel workers require hard budgets.

### Unsafe side effects
A founder agent can reach email, ads, commerce and social systems. Mutations must remain approval-gated and auditable.

### False grounding
A research artifact must retain its evidence references through downstream synthesis.

### Operational complexity
Redis/queues/vector stores are implementation choices, not prerequisites for the first repository-certified slice.

## 16. License and clean-room boundary

The upstream Co_Founder repository is published under AGPL-3.0. A modified network-served derivative can carry source-availability obligations. The Workbench donor therefore starts as a clean-room behavior/architecture study.

For this branch:
- do not copy upstream source;
- do not port prompts;
- do not reproduce proprietary UI or brand assets;
- do not import upstream eval data or thresholds;
- do not copy word-for-word documentation beyond unavoidable names/facts;
- write independent schemas, tests, fixtures and implementation;
- preserve source URLs and license notes as provenance.

If a future decision intentionally adopts upstream AGPL code, that must be treated as a separate licensing/product decision, not silently mixed into this clean-room donor.

## 17. Smallest truthful next action

Implement only the Phase A domain contracts plus deterministic planner/run ledger/fake-worker acceptance path. Do not add live models, queues, vector databases, external connectors or hosted claims until the repository can first certify the orchestration semantics at an exact commit.
