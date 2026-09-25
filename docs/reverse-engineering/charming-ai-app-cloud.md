# RE-240 — Charming-inspired AI app cloud capability study

Status: research/specification only  
Canonical destination: `rrahul0904/open-source-ai-workbench`  
Tracking issue: #9  
Research branch: `reverse/charming-ai-app-cloud`  
Verified: 2026-09-24

## 1. Objective

Study Charming's publicly documented product behavior and extract the reusable architecture into an independently implemented, provider-neutral AI app cloud capability inside Open Source AI Workbench.

This is a clean-room reconstruction. Do not copy or disassemble proprietary Charming platform code, private prompts, branding, visual assets, or non-public implementation details. Charming's Terms restrict reverse engineering of Charming IP, so this work uses public product behavior, published documentation, the public HTTP/OpenAPI contract, and the public MCP integration repository only.

Sources:
- Reddit launch: https://www.reddit.com/r/SideProject/s/6fbDoneX6q
- Product: https://usecharming.com/
- How it works: https://usecharming.com/how-it-works
- Public authoring/runtime guide: https://charm.ing/docs/llms-full.txt
- Public OpenAPI: https://charm.ing/.well-known/openapi.json
- Public MCP integration repo: https://github.com/tambo-labs/charming-mcp
- Security/work controls: https://usecharming.com/security

## 2. Product thesis

The transferable idea is not another AI code generator. The user's existing agent writes the software; the platform supplies a durable execution and collaboration substrate for small AI-authored apps.

The product therefore separates two responsibilities:

1. **Authoring agent** — decides what the app should do and produces source/UI.
2. **App cloud** — validates, stores, versions, runs, secures, shares and exposes the app over browser, HTTP and MCP.

That separation is the core capability to bring into the Workbench.

## 3. Observable user flow

1. A user connects an existing AI/agent or uses an HTTP-capable coding agent.
2. The agent creates an app from a compact source contract.
3. The platform validates the source and declared operations.
4. A persistent app identity and hosted URL are created.
5. App state survives code updates.
6. The app is private by default and can be shared with explicit roles.
7. The agent can later read source, update it, call declared operations and manage sharing.
8. Apps can become public, templates/copies, or team-managed assets.
9. Optional routines run selected operations on a schedule.
10. Runtime failures and contract mismatches are observable so an agent can repair them.

## 3A. Reddit launch feedback — incorporated

The launch thread was reviewed directly, including the currently indexed comments and the founder's replies.

### Feedback 1 — immediate comparison with Claude Artifacts

A commenter asked how Charming differs from Claude Artifacts. The founder's answer was that Charming apps are full apps with a database, API and authentication provider; they can call APIs, persist data and be shared with different access levels.

**Reverse-engineering implication:** the reconstruction must not be framed as an artifact/HTML hosting service. Persistent backend state, callable operations/APIs, identity and server-enforced access levels are core product requirements and must exist before parity claims.

### Feedback 2 — migration of apps already built with Claude

A commenter asked whether a company that already built apps through Claude can convert them to Charming apps. The founder said this is expected to be possible, often by asking Claude to deploy the existing app to Charming, while noting compatibility depends on the source app.

**Reverse-engineering implication:** add an explicit import/migration path for existing AI-built apps. The platform should accept an existing app/source package, inspect unsupported assumptions, produce a migration/compatibility report, and convert supported storage/auth/API behavior into the hosted-app contract without silently losing data or functionality.

### Migration capability track

- source/app import intake;
- compatibility scanner for browser-only state, unsupported libraries, backend assumptions and external services;
- migration plan with blocking vs auto-convertible findings;
- source transformation into the canonical HostedApp contract;
- data migration adapters where a source data export exists;
- post-import validation and smoke tests;
- rollback/no-cutover behavior when required capabilities are unsupported.

### Product positioning constraint learned from the thread

The primary value proposition is **durable full-stack personal/team apps built by the AI the user already has**, not a replacement AI builder. Comparisons should therefore be tested against artifact-style chat outputs on persistence, API/backend capability, auth/access control, shareability and cross-agent reuse.


## 4. Core architecture

```text
AI / Coding Agent
      |
      | HTTP or MCP
      v
Authoring Gateway
      |
      +--> Auth / pairing / scoped tokens
      +--> Create / update / source export
      +--> Operation invocation
      +--> Sharing / template / routine management
      |
      v
App Registry + Revision Store
      |
      +--> immutable source revisions
      +--> app metadata / ownership
      +--> declared operation schemas
      +--> grants / visibility / template state
      |
      v
Validation + Build Layer
      |
      +--> manifest/schema validation
      +--> operation discovery
      +--> UI/backend contract checks
      +--> capability / dependency checks
      |
      v
Isolated Runtime
      |
      +--> per-app state
      +--> assets
      +--> logs/activity
      +--> capability-gated egress / secrets
      |
      +--> Browser/embed viewer
      +--> HTTP operation API
      +--> MCP app interface
```

## 5. App authoring contract

The public contract centers on a server module with a literal manifest plus a literal array of declared operations/routes, with optional UI and styles. The useful independent pattern is:

- stable app identifier and display metadata;
- a dated or explicitly versioned app contract;
- capability imports declared up front;
- operation name, HTTP semantics and schemas declared as metadata;
- read-only intent declared explicitly instead of inferred;
- source validation before publication;
- machine-readable API discovery generated from the same operation definitions.

### Clean-room domain model

```ts
HostedApp {
  appId
  ownerId
  slug
  displayName
  visibility
  activeRevision
  contractVersion
  createdAt
  updatedAt
}

AppRevision {
  appId
  revision
  manifest
  operations[]
  uiSource?
  styles?
  sourceHash
  createdAt
}

Operation {
  name
  method
  inputSchema
  outputSchema
  readOnly
  idempotent
  requiredCapabilities[]
}
```

## 6. Lifecycle and versioning

Required lifecycle:

- create app;
- list apps visible to caller;
- read current descriptor;
- export current source;
- guarded update;
- rename;
- delete with explicit confirmation;
- retain revision history;
- optionally restore an earlier validated revision.

Guarded writes should use optimistic concurrency. A write that targets stale source must fail with a revision conflict and return enough information for the agent to re-read before retrying. App state must not be erased merely because source changes.

## 7. Runtime execution model

The public behavior implies an isolated, resource-bounded runtime with a limited web-standard API surface rather than arbitrary host access. The independent implementation should preserve the same principle:

- no host filesystem/process access by default;
- per-invocation capability bindings only;
- backend operation dispatch through declared metadata;
- input and output validation around every invocation;
- request/runtime budgets;
- an explicit result envelope;
- no silent retry when execution may have occurred.

Phase A should use a deterministic local evaluator/fake runtime. A hardened remote sandbox is a separate certification gate.

## 8. State and assets

Each app needs a durable state namespace independent of source revisions.

Phase A:
- JSON key/value state;
- namespaced by app;
- deterministic size accounting;
- list/get/put/delete primitives;
- state survives source update;
- read-only callers receive a write-disabled storage facade.

Later:
- blob/file assets;
- quotas;
- export/delete;
- optional region/retention policy.

## 9. Auth and identity

Transferable patterns:

- anonymous bootstrap may create a temporary app credential;
- a user-scoped credential can act across the user's apps;
- app-scoped tokens are limited to one app;
- render/view credentials are short-lived and app-bound;
- claim/pairing upgrades an anonymous app into an owned app without exposing long-lived credentials to the generated UI;
- browser identity is a convenience signal, not the authorization boundary.

The clean-room implementation should keep credentials out of generated app code and apply authorization server-side before operation dispatch.

## 10. Sharing and authorization

Model explicit role capabilities rather than ad-hoc checks inside app handlers.

Suggested roles:

| Role | Read data | Mutate data | Edit source | Manage access |
| --- | --- | --- | --- | --- |
| owner | yes | yes | yes | yes |
| editor | yes | yes | yes | no/limited |
| user | yes | yes | no | no |
| viewer | yes | no | no | no |

Authorization invariants:

- server gate decides whether an operation can run;
- read-only metadata must be explicit;
- a viewer cannot gain write access because the handler was mislabeled;
- a write-disabled runtime binding must backstop read-only execution;
- generated UI hints can improve UX but are never trusted for enforcement.

## 11. Public, template and copy semantics

These states should remain distinct:

- **private** — only explicit grants;
- **public/viewable** — live app accessible by link under a defined data-access policy;
- **template/copyable** — visitor receives a separate new app rather than shared live state;
- **listed/discoverable** — optional directory metadata layered on top of template state.

Do not collapse public sharing and templating into one flag; they have different data and authorization consequences.

## 12. Agent interface: HTTP + MCP

The app cloud should expose the same canonical domain through multiple adapters:

- HTTP API for create/update/source/list/call;
- MCP tools for agents that support remote MCP;
- browser/embed viewer for humans;
- machine-readable app descriptor/OpenAPI generated from declared operations.

Provider adapters must not fork core behavior. HTTP and MCP should call the same application service.

## 13. Secrets and outbound network

Secrets must never be embedded in generated source.

Independent design:

- app owner stores named secrets outside app source;
- runtime exposes a sealed fetch abstraction;
- generated code can reference a secret name/placeholder but cannot read plaintext;
- outbound destinations are explicit HTTPS origins;
- private/loopback/metadata destinations fail closed;
- request logs redact or never materialize secret plaintext.

This is not part of Phase A. Until a sandbox and SSRF defenses are certified, network and secret capabilities remain disabled.

## 14. Scheduled routines

A useful follow-on capability is a small scheduler that invokes one declared operation hourly/daily/weekly without a chat session.

Required controls:

- only declared operations;
- deterministic empty/default input contract;
- per-app and per-owner limits;
- persisted next/last run state;
- consecutive-failure counter;
- auto-disable after repeated failures;
- owner-visible error history.

## 15. Observability and agent-recoverable errors

The platform should treat errors as machine contracts, not prose only.

Recommended stable classes:

- validation_error;
- forbidden;
- forbidden_write;
- revision_conflict;
- rate_limited;
- payload_too_large;
- runtime_failed;
- execution_uncertain;
- not_found;
- quota_exceeded;
- capability_denied.

Recoverable errors may include a structured recovery action such as:

- retry after a delay;
- refetch source and retry with fresh revision;
- shrink a named field;
- correct a route's read/write label;
- open an existing copy instead of duplicating it.

Runtime activity should be durable enough for an agent to answer 'what broke after deployment?' without requiring a user to paste console output.

## 16. Team / enterprise layer

Publicly described work controls suggest a separate management plane:

- workspace membership;
- SSO/SAML/OIDC and SCIM adapters;
- app-level roles;
- global app inventory;
- audit events;
- retention/delete/export policies;
- regional placement policy;
- custom domain/white-label controls;
- administrator revoke/offboarding flows.

These are later phases and require separate live-provider certification.

## 17. Security model

Security principles for the independent implementation:

- deny by default;
- isolated app execution;
- least-privilege capability injection;
- server-side authorization on every operation;
- source and state tenant isolation;
- secrets outside generated code;
- exact-origin outbound allowlists;
- SSRF protection;
- CSP/iframe sandboxing for generated UI;
- explicit destructive confirmation;
- idempotency for retryable writes;
- execution-uncertain errors never trigger blind replay;
- append-only security/audit events.

## 18. Phase A — smallest repository-certifiable slice

Implement inside Open Source AI Workbench with zero secrets and no external effects:

1. HostedApp/AppRevision/Operation/AppGrant/StoredValue/RuntimeEvent schemas.
2. Deterministic app registry and in-memory persistence adapter.
3. Create/list/get-source/update lifecycle.
4. Immutable revision history and guarded expected-revision updates.
5. Operation registration with JSON-schema-like deterministic validation.
6. Query vs mutation dispatch.
7. Owner/editor/user/viewer gate.
8. Write-disabled state facade for read-only execution.
9. Public descriptor derived from operation metadata.
10. Structured errors for validation, stale revision, forbidden and forbidden-write.
11. Unit tests for domain invariants.
12. Integration test covering create → write state → source update → verify state survives → viewer read → viewer write denied.

### Phase A acceptance criteria

- no live LLM, OAuth provider, network egress, secrets or remote shell required;
- every persisted write creates a deterministic audit event;
- stale source updates fail closed;
- viewer writes fail before app logic receives a writable state binding;
- state survives source revision changes;
- exported descriptor matches registered operations;
- test suite runs in CI with no external credentials.

## 19. Phase B

- asset storage;
- revision restore;
- template/copy model;
- public viewer shell;
- local sandbox process/container boundary;
- runtime activity stream;
- idempotency keys;
- quotas/rate limits;
- MCP adapter over the same application service.

## 20. Phase C

- hardened multi-tenant sandbox;
- sealed secrets + egress proxy;
- remote hosting/deployment;
- OAuth/device pairing;
- scheduled routines;
- custom domains;
- billing/usage plans;
- team workspaces, audit export, SSO/SCIM, retention and regional policy;
- browser/MCP embedding certification.

## 21. Test strategy

### Unit
- schema/manifest validation;
- role matrix;
- state quota accounting;
- revision conflict handling;
- idempotency;
- recovery-envelope generation.

### Integration
- app lifecycle;
- state persistence across revisions;
- view-only enforcement;
- template copy isolation;
- routine failure disablement;
- activity persistence.

### Security
- cross-app state isolation;
- token/app binding;
- read-only write backstop;
- SSRF allow/deny table;
- secret redaction;
- destructive confirmation.

### Browser/acceptance
- create app and open viewer;
- mutate then refresh;
- share role behavior;
- source update without data loss;
- public/template semantics;
- operator activity/error display.

## 22. Non-claims

This branch does **not** claim Charming source-code parity, proprietary implementation knowledge, hosted production parity, live OAuth/SSO, hardened sandboxing, secret-safe egress, custom domains, billing, or enterprise certification.

The first honest milestone is a deterministic local app-runtime contract with exact-head tests.