# RE-394 — VisuaLeaf donor for Data Workbench

## Purpose

RE-394 is a clean-room capability intake from publicly observable VisuaLeaf behavior into the existing Data Workbench implementation line in `open-source-ai-workbench`.

Primary public source:
- Reddit launch: https://www.reddit.com/r/Database/comments/1wz6q6v/i_spent_2_years_building_a_database_client_that/
- Product: https://visualeaf.com/
- Public repository/docs: https://github.com/sozocode/VisuaLeaf
- Related Apache-2.0 project: https://github.com/sozocode/mini-leaf

This is not a VisuaLeaf clone and does not copy proprietary source, private prompts, product assets, screenshots, branding or UI trade dress.

## Canonical product mapping

VisuaLeaf is an additional donor to the existing **Data Workbench** product line rather than a new repository or application. Existing donors include Tusk, DBFlux, LibreDB Studio and Tabularis.

The useful RE-394 delta is:
- nested-data-first value handling;
- one canonical result projected into table/tree/JSON views;
- bounded rendering/virtualization contracts;
- typed visual-query planning;
- schema-change planning separated from execution authority;
- explicit render/performance evidence rather than unverified speed claims.

## Current implementation slice

The branch extends the existing synthetic read-only Data Workbench Phase A with `src/data-workbench-visuals.mjs`.

### Typed canonical values

`ValueEnvelope` preserves or rejects values deliberately:
- null, boolean, string, finite number and safe integer;
- schema-declared `bigint-string` as exact `int64` text;
- JavaScript `bigint` as exact text;
- Date and binary values when supplied by an adapter;
- nested arrays and objects;
- unsafe JavaScript integers fail closed instead of silently losing precision.

### Table / tree / JSON projection

`projectRows` and `projectQueryExecution` keep one typed canonical representation and derive view-specific projections from it. Every projection has a receipt containing:
- source/query receipt identity where applicable;
- source and schema revision;
- requested view mode;
- render budget;
- source vs rendered row counts;
- truncation state;
- canonical and view hashes.

Raw SQL and credentials are not stored in render receipts.

### Bounded rendering

The initial contract caps rows, nested nodes, nesting depth and serialized bytes. Oversized row sets are explicitly truncated; cyclic/pathological nested values fail with typed errors rather than attempting unbounded rendering.

This is a contract-level foundation for later UI virtualization. It is not a claim that the current browser UI matches VisuaLeaf performance.

### Typed visual-query AST

`compileVisualQuery` accepts a narrow original AST and compiles only into the already validated read-only planner subset:
- known table;
- wildcard or known columns;
- typed equality filter;
- known-column sort;
- positive safe integer limit.

The result still passes through the existing Data Workbench `planQuery` policy boundary. The visual surface therefore cannot create a second execution authority.

### Schema materialization preview

`planSchemaMaterialization` currently accepts a small typed operation set (`create-table`, `add-column`, `add-index`) and produces a revision-bound **preview-only** plan.

Important invariants:
- raw mutation SQL is rejected;
- preview is never executable;
- changed plan content fails tamper validation;
- changed schema revision makes the preview stale;
- no DDL is executed in RE-394 Phase A.

## Acceptance coverage added

`tests/data-workbench-visuals.test.mjs` covers:
1. same query projected to table/tree/JSON while retaining exact int64 identity;
2. nested value typing plus fail-closed unsafe integer handling;
3. row truncation, nesting-depth denial and cycle denial;
4. visual-query AST compilation through the safe planner and injection-shaped identifier rejection;
5. materialization preview-only semantics, stale-revision detection, tamper detection and raw mutation-text rejection.

Existing Data Workbench tests remain responsible for read-only execution, plan tamper detection, result ceilings, replay-safe receipts, secret/raw-SQL redaction and agent-style facade behavior.

## Explicit non-claims

This implementation does not establish:
- VisuaLeaf parity;
- VisuaLeaf benchmark parity or superiority;
- support for VisuaLeaf's advertised database count;
- a production MongoDB/PostgreSQL/MySQL/SQLite connector;
- safe write or DDL execution;
- desktop/Tauri/Electron packaging;
- MCP parity;
- AI query generation parity;
- production deployment or browser UAT.

Vendor performance and broad capability claims remain `SOURCE_CLAIM_UNVERIFIED` until reproduced with an owned fixture, exact build and machine/runtime receipt.

## Next gates

1. Exact-head repository CI for the combined Data Workbench + RE-394 slice.
2. Integrate the projection actions into the existing browser/API facade and run browser UAT against synthetic data.
3. Add disposable engine adapters one at a time with engine-level read-only escape tests (SQLite first; PostgreSQL/MongoDB after that).
4. Add measured performance fixtures and immutable performance receipts before making performance claims.
5. Add mutation execution only as a separate, approval-bound capability with exact revision binding, transaction/rollback capability checks and negative tests.
6. Consider desktop packaging only after the browser/runtime contracts are certified.

## Identifier hygiene

The implementation branch is named `re391-data-workbench-phase-a` because an earlier Tabularis intake used RE-391 locally. The canonical portfolio tracker already assigns RE-391 elsewhere. Do not treat the branch name as canonical project identity.

For this donor, the canonical tracker identity is **RE-394**. The shared product line remains **Data Workbench**, coordinated through issue #16.