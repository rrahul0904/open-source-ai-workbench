# Zalcro clean-room reverse-engineering contract

Source references:
- Reddit: https://www.reddit.com/r/SideProject/s/DZjFW9sUpC
- Product: https://zalcro.ai/
- Workflow: https://zalcro.ai/how-it-works
- Public sample: https://zalcro.ai/samples/rentify-airbnb-clone

## Decision

Treat Zalcro as a **capability donor** for the existing engineering-agent track in Open Source AI Workbench, not as a standalone clone.

The reusable product idea is a pre-build planning and persistent project-context layer that sits before execution agents. It should turn an idea into an approved architecture contract, then derive dependency-ordered phases and agent-ready work units from that frozen contract.

Do not copy proprietary code, private prompts, visual assets, or wording. Reproduce only publicly observable workflows and standard architecture/planning patterns.

## Publicly observed product contract

1. User describes a software idea in plain language.
2. The planner asks focused questions about users, integrations, constraints, budget, hosting, compliance/security/performance needs, and preferred build workflow.
3. The planner produces an Architecture Design Document (ADD) and architecture diagram first.
4. The user can review/change the architecture before implementation artifacts are generated.
5. Agentic workflow outputs a phased implementation plan and granular dependency-aware tickets with acceptance criteria and architectural directives.
6. Vibe-coding workflow outputs sequenced platform-targeted prompt packs.
7. Outputs are intended for Cursor, Claude Code, Codex, Lovable, Bolt, Replit/v0 and project-management systems such as Linear/Jira/ClickUp.
8. Project decisions persist so later generated artifacts remain aligned to the same architecture.
9. Public samples show explicit dependencies, scope boundaries, technical directives, acceptance criteria, and verification expectations.

## Capability map into Open Source AI Workbench

Existing donor/runtime capability:
- engineering agent: spec -> plan -> test -> review -> ship
- workflow execution API
- run history / optional durable persistence
- optional live LLM provider
- fail-closed external effects

Additive Zalcro-inspired capabilities:

### A. Guided requirements elicitation
- `PlanningSession`
- `Requirement`
- `Decision`
- `Constraint`
- `OpenQuestion`
- bounded questions per turn
- explicit defaults and unresolved-decision flags

### B. Architecture contract
- versioned `ArchitectureBlueprint`
- system components and responsibilities
- data stores / schemas
- integrations and trust boundaries
- non-functional requirements
- ADR-style decisions and rejected alternatives
- risk register
- build-first checklist
- Mermaid representation generated from the same canonical graph

### C. Dependency-aware implementation graph
- `BuildPhase`
- `WorkItem`
- `dependsOn[]`
- scope boundaries
- acceptance criteria
- verification steps
- allowed/forbidden architectural changes
- deterministic topological ordering
- cycle detection and fail-closed validation

### D. Execution-target adapters
- Agentic ticket adapter: Cursor / Claude Code / Codex
- Vibe prompt-pack adapter: Lovable / Bolt / Replit / v0
- PM export adapter: generic structured text first; Linear/Jira/ClickUp integrations remain provider-gated

### E. Persistent context / drift control
- immutable approved blueprint version per execution batch
- tickets reference `blueprintVersion`
- later changes create a new blueprint version rather than silently mutating prior work
- execution result can raise `ArchitectureDriftFinding`
- planner never claims context loss is solved; it reduces ambiguity by giving executors a stable reference

## Canonical domain schema (Phase A)

```ts
PlanningProject {
  id
  title
  summary
  workflowMode // agentic | vibe
  targetEnvironment
  status // eliciting | architecture_review | approved | planned
  activeBlueprintVersion
}

PlanningSession {
  id
  projectId
  turns[]
  unresolvedQuestionIds[]
}

Requirement {
  id
  projectId
  kind // functional | non_functional | integration | constraint
  statement
  priority
  sourceTurnId
}

Decision {
  id
  projectId
  topic
  selectedOption
  rationale
  alternatives[]
  status // proposed | approved | superseded
}

ArchitectureBlueprint {
  id
  projectId
  version
  requirementsHash
  components[]
  dataStores[]
  integrations[]
  trustBoundaries[]
  decisions[]
  risks[]
  mermaid
  approvalStatus
  approvedAt
}

BuildPhase {
  id
  blueprintId
  ordinal
  objective
  entryCriteria[]
  exitCriteria[]
}

WorkItem {
  id
  phaseId
  objective
  context
  directives[]
  scopeBoundaries[]
  acceptanceCriteria[]
  verificationSteps[]
  dependsOn[]
}
```

## Phase A — smallest truthful implementation

Implement a zero-secret, deterministic planning vertical slice inside the existing workbench:

1. `POST /api/planning/projects`
   - create planning project from plain-language idea + workflow mode.
2. `POST /api/planning/projects/:id/requirements`
   - persist normalized requirements/constraints.
3. `POST /api/planning/projects/:id/blueprints/generate`
   - generate a deterministic demo blueprint from stored requirements.
   - live LLM generation remains optional/provider-gated.
4. `POST /api/planning/projects/:id/blueprints/:version/approve`
   - freeze an approved blueprint version.
5. `POST /api/planning/projects/:id/plan`
   - produce dependency-ordered phases/work items only from an approved blueprint.
6. `GET /api/planning/projects/:id/export?target=agentic|vibe`
   - render agent-ready tickets or a prompt-pack representation from the same underlying work graph.

## Required invariants

- No implementation plan can be generated from an unapproved blueprint.
- Every work item carries the blueprint version it was derived from.
- Dependencies must be acyclic; cycles fail closed.
- Acceptance criteria and verification steps are required fields, not optional prose.
- Target-specific prompt/ticket exports may change formatting, never architecture facts.
- Updating requirements after approval creates a new draft blueprint version.
- Demo mode must be executable with no provider secret and must clearly label deterministic/synthetic planning output.
- Live provider calls must use the workbench's existing provider boundary and never bypass auth/rate-limit controls.

## Phase B

- guided multi-turn elicitation with bounded questions per turn
- ADR generation and explicit trade-off tracking
- architecture graph editor / review UI
- drift detector comparing executor changes/results against blueprint constraints
- resume planning sessions from persisted history
- import an existing PRD/spec as requirements

## Phase C

- PM-tool adapters (Linear/Jira/ClickUp) behind explicit credentials and approval
- repository-aware planning context
- MCP resource/tool surface for blueprint, phase and ticket retrieval
- per-work-item execution provenance and verification evidence
- team workspaces / RBAC only after the core planning contract is stable

## Test contract

Phase A is not complete until automated tests prove:

- project/requirement persistence
- blueprint versioning and approval gate
- plan generation rejected for unapproved blueprint
- stable deterministic output for identical demo inputs
- dependency cycle rejection
- topological ordering
- blueprint-version propagation into every work item/export
- agentic and vibe exports preserve identical architecture facts
- cross-project isolation
- provider-off demo mode still works

## Explicit non-goals

- Do not build another coding agent.
- Do not claim that blueprinting prevents model context loss.
- Do not reproduce Zalcro branding, private prompts, proprietary generation logic, or site copy.
- Do not add live Jira/Linear/ClickUp mutations in Phase A.
- Do not claim production readiness until hosted persistence, auth, browser UAT and live-provider paths are separately certified.
