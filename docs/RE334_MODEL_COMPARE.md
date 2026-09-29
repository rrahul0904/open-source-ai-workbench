# RE-334 — Original Multi-Model Evidence Lab: phase-by-phase implementation

Source of inspiration: public product descriptions in [Indes.AI's SideProject announcement](https://www.reddit.com/r/SideProject/comments/1wspjha/i_got_tired_of_copypasting_the_same_question_into/). This repo implements original functionality; it must not fetch, reuse, extract, brand-match, automate, or copy source-service private code and behavior. Existing `multi-model-chat` remains unchanged. Source research and claim-level caveats are kept in the project research dossier.

## Phase gates

| Phase | Deliverables | Acceptance gate | Current state |
| --- | --- | --- | --- |
| P0 — Research/architecture | Dated source evidence and empty-comment snapshot, comparators, vendor Terms/privacy discrepancy, repo overlap check | Provenance and clean-room boundary | Public-desk research complete; vendor runtime unverified |
| P1 — Mock-only execution engine | Stable registry, four original mock text adapters, unique run/event IDs, injectable contracts, concurrent fan-out, status/error isolation, cancellation, deadline, eligibility gate | Node tests; no external provider dispatch | Implemented; exact-head verify/container passed at 73bd9b (run 36497018721) |
| P2 — Original browser UI and streaming transport | SSE/fetch-stream endpoint with reconnect/cancel, responsive four-lane panel, focus/error accessibility, mobile acceptance | Browser E2E and verified network event ordering | Not started |
| P3 — Grounded synthesis | Per-answer source provenance, contradiction map, evidence lookup and abstention rules | Attributed disagreements; no agreement-as-fact assumption | Not started |
| P4 — Routing & evaluations | Deterministic smart routing baseline, fallback, holdout cases, latency/usage/cost instrumentation | Reproducible comparisons with no unsupported best-model claims | Not started |
| P5 — SaaS/security | Tenant-scoped auth/storage, explicit provider transfer consent, secrets, upload scanning/limits, delete/export and TEST-only billing | Isolation/privacy/abuse tests and verified webhook idempotency | Not started |
| P6 — Preview/release | Protected preview, exact-head CI, real-browser checks, observability and operational runbooks | Independent security and deployment proof | Not started |
| P7 — Commercialization | Unit-economics measurement, pilot feedback, legal/IP clearance and support model | Release decision based on external evidence | Not started |

## P1 technical contract

`src/model-compare.mjs` has no network calls, provider API keys, browser state or persistence. `DEMO_MODELS` are explicitly synthetic original adapters, **not** OpenAI/Anthropic/Gemini/DeepSeek model executions. `compareDemo(input, options)` validates a prompt up to 4,000 characters and a nonempty unique model subset. One invocation yields `run.started`, independent provider started/delta/completion/terminal events and `run.completed`; `eventId` is run-local monotonic. Callback `onEvent` receives each event in event order, while the return value includes a complete snapshot for deterministic testing. Deadline and parent abort are guarded even if an injected adapter never resolves `.next()`. Errors are generic and retain partial data from another provider. A complete count of at least two marks only **eligibility**, never successful synthesis or independently verified facts.

Run it locally on Node >=20 using `node --test tests/model-compare.test.mjs` and `node scripts/model-compare-demo.mjs "Describe four approaches to ETL testing"`. The existing `npm test` will also pick the new test file on CI.

P1 limitations: no network SSE, no UI, no actual LLM adapters, no cost ledger, no real syntheses, no secure user persistence, no deployment or production certification. Add real provider integrations only after consent/credentials/budget/evaluation gates are implemented and separately approved by operators.

## Feedback provenance

Reddit structured post JSON on 2026-09-28 reported `num_comments=0` and empty comment children. There are no observed commenter projects, criticisms or suggestions to implement. Refresh thread metadata and record any new comment IDs and linked projects with attribution before expanding scope. Pricing is internally inconsistent between source FAQ/App Store Premium and Sep 9 Terms; commercial modeling requires reconciliation.

Repo-local branch name retains the provisional `re332` prefix from before the canonical tracker ID collision was discovered. Canonical portfolio ID is **RE-334**; existing RE-332 belongs to MLDrills.\n\nTracking issue: https://github.com/rrahul0904/open-source-ai-workbench/issues/12

## P2 bounded mock-only slice (isolated from the later PR #13 head)

This branch starts at `73bd9b908dff4625cc622f84fe7af12c29c0edaa` instead of rewriting the since-advanced draft PR. Open `/compare.html` on the Node HTTP server. `multi-model-chat` and `/api/workflows/run` are not modified.

- `POST /api/compare/runs` validates the P1 demo registry and starts at most eight simultaneous, 32 retained process-local runs; response contains opaque run ID, events path and cancellation path.
- `GET /api/compare/runs/:id/events` streams real `text/event-stream` events with P1 IDs, ordered replay from `Last-Event-ID`, no duplicate text append in the browser and disconnect without server-side cancellation. Invalid replay cursor is rejected.
- `DELETE /api/compare/runs/:id` sends the existing P1 cancellation signal and allows individual terminal statuses before `run.completed`. Incomplete/failed provider output is retained but exception details are not emitted.
- `GET /api/compare/catalog` identifies the only available labels as synthetic. The UI is original semantic HTML with explicit labels, keyboard focus, a status live region, four responsive cards and reduced-motion support. Output uses `textContent` rather than injected HTML.
- Server memory is neither durable nor multi-instance; completed sessions expire after five minutes and restarting the process loses replay. SSE relies on a single running Node process. There are no third-party AI requests, provider credentials, real vendor names, synthesis, source citations, pricing, tenancy, billing, upload support or deployment guarantees.
- Existing `WORKBENCH_API_KEY` protects comparison endpoints if enabled; native EventSource has no bearer-header input in this pilot, so the standalone browser page is intended for the default local public synthetic mode. The authenticated HTTP API can be exercised separately. Do not put private information in prompts.

Verification: `npm test` includes live HTTP SSE event-order, partial-failure, cancellation, replay/cursor and authorization tests; the separate `npm run browser:compare` uses pinned CI-only Playwright and axe dependencies for a real Chromium keyboard/mobile/accessibility and reconnect check. Neither CI completion nor browser/device certification is implied by writing this documentation. No Vercel SSE function was added; this P2 transport is for the Node server only.

Clean-room rule: all markup, client behavior and HTTP coordination are original, built around repository P1 synthetic contracts. No outside service code, private APIs, branding, assets or hidden behavior are copied.
