# RE-353 — LibreDB Studio donor → Data Workbench

Status: **research complete; Phase A implementation started**  
Issue: #16  
Branch: `reverse/libredb-data-workbench`

## Research conclusion

LibreDB Studio is useful primarily as evidence for a **deploy-next-to-data, browser-accessible database workbench** with engine-specific capabilities, schema/query/history/monitoring surfaces and optional AI.

The supplied Reddit discussion makes one requirement especially important for our synthesis: a production safety boundary must not depend on a red badge or a confirmation modal. The creator explicitly distinguishes the editor's UI guard from the stronger database-enforced read-only path used by supported agent adapters and recommends using a read-only database role for a hard boundary.

That becomes an architectural requirement here: **production access must fail closed unless the adapter proves enforced read-only semantics.**

## Dedupe decision

This is not a new standalone clone in the tracker.

- RE-341 Tusk already contributes native database-client ergonomics/performance ideas.
- RE-342 DBFlux already contributes keyboard-first/extensible database-platform ideas.
- RE-353 contributes self-hosted browser deployment, capability-truth, audit/history, secret-boundary and governed-agent requirements.

All three map to the canonical **Data Workbench** concept.

## Public donor facts used as requirements evidence

Reviewed on 2026-09-30:

- supplied r/buildinpublic launch and comment thread;
- LibreDB public repository and MIT license;
- README, FEATURES, SECURITY and deployment files;
- provider documentation and compatibility/support distinctions;
- first-party site/security material;
- exact upstream head `dfa05ee64e969849196f236fe05f5caebe5f82e8`.

Important nuance: the public “46 databases” positioning is a connection-target total assembled from canonical integrations plus wire-compatible targets. Public provider material also documents partial/query-only/unsupported capabilities. We therefore do **not** translate the headline into “46 equally supported engines.”

## Clean-room boundary

This branch does not copy LibreDB source, UI structure, screenshots, assets, test fixtures or prompts.

The Phase A code is independently authored around generic database-workbench contracts:

- connection profile;
- adapter capability declaration;
- query request/policy decision;
- result envelope;
- immutable query receipt;
- searchable receipt history.

If upstream code is intentionally reused in a later phase, that must be a separate decision with explicit MIT attribution and dependency/asset review.

## Phase A scope

Phase A intentionally has **no live database connector**. It uses original synthetic relational data so policy, receipt and history semantics can be certified without credentials.

The slice must prove:

1. one execution policy path for human and future-agent sources;
2. SELECT-only deterministic fixture execution;
3. mutation/stacked/external-file requests denied;
4. production access denied when read-only proof is not enforced;
5. every success, denial and execution failure emits a receipt;
6. receipts contain query hashes/metadata, not raw credentials;
7. Data Workbench run inputs redact secret-like fields and raw query text before generic run persistence;
8. history can be filtered by connection, status and query hash.

## Explicit non-claims

This Phase A does not claim:

- LibreDB parity;
- support for any live database;
- support for 46 databases;
- production readiness;
- SSO/RBAC availability;
- benchmark equivalence;
- safe write support;
- a certified database agent.

Those require later engine-specific and deployment evidence.
