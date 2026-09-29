# RE-334 · Multi-Model Evidence Lab

Independent clean-room product implementation inside the existing Open Source AI Workbench. This product does **not** use Indes.AI code, source assets, private network calls or design assets. Original UI, server behavior and provider adapters. Reddit comments were not present in the collected snapshot; later feedback requires a new dated audit.

## Customer experience

- `/compare` — mobile-friendly, keyboard-addressable comparison workspace.
- Four zero-secret synthetic lenses, clearly marked as simulations; no misleading branded vendor demo panels.
- `GET /api/compare/catalog` — public-safe capability list; keys never returned.
- `POST /api/compare/stream` — concurrent POST response streamed as incremental SSE, independent model status and partial failures. Cancelling the browser fetch aborts server provider jobs.
- Live adapters for OpenAI Chat Completions, Anthropic Messages, Gemini streamGenerateContent and DeepSeek Chat Completions. Live mode defaults **off**, is operator-gated, requires explicit third-party consent, operator-configured model IDs and four provider-specific credentials. All endpoints are pinned in source; arbitrary prompt URLs are not fetched.
- Response comparison preserves attribution, raw text per provider, timestamps, terminal status and provider-reported usage. No factual-consensus claim or fabricated estimated USD cost. Exports use local in-tab state; no server-side comparison/history retention.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/model-compare.mjs` | Existing P1 synthetic testable engine, preserved. |
| `src/compare/registry.mjs` | Public-safe model catalog, explicit live gating and payload validation. |
| `src/compare/adapters.mjs` | Pinned vendor streaming protocols, SSE framing, usage parsing, sanitized failures. |
| `src/compare/service.mjs` | Concurrent orchestration, bounded outputs, isolated cancellation and neutral comparison note. |
| `src/compare/http.mjs` | Shared Node/Vercel SSE transport, bearer access, request/rate guards. |
| `api/compare/catalog.js`, `api/compare/stream.js` | Thin Vercel handlers. |
| `server.mjs`, `src/http.mjs` | Docker/local routes use the same handlers. |
| `public/compare.html`, `.css`, `.js` | Original responsive, accessible comparison workspace. |
| `tests/compare.test.mjs` | Input, provider, transport, security and failure tests. |
| `scripts/smoke-compare.mjs` | Live HTTP synthetic smoke against a running deployment. |

## Run

Node 20+ (Node 22 recommended); repository remains zero-dependency.

```bash
npm test
npm run check
npm start
# open http://localhost:3000/compare
node scripts/smoke-compare.mjs
```

Docker: `docker compose up --build`; same `/compare` page. Vercel: existing project root, `public/` assets and `api/` functions; demo mode requires zero secrets.

## Controlled operator-only live verification

Set `WORKBENCH_API_KEY` to a strong value and `COMPARE_LIVE_ENABLED=true`. For each provider you wish to enable, configure its pair of `*_COMPARE_API_KEY` and `*_COMPARE_MODEL` variables (full names in `.env.example`). Do not put secrets in the browser, source, PR or logs. The operator enters the workbench access key into the session-only password field and explicitly checks third-party provider consent. Complete an approved low-budget test before further claims. Disable `COMPARE_LIVE_ENABLED` to immediately fail closed.

**Limitations:** In-memory per-instance rate limits are demo/protected-operator protection only, not distributed quotas. The access key is a single operator secret, not a customer authentication or tenant authorization system. Raw provider usage may differ by provider; it is not unified monetary billing. There is no database, cloud storage, document ingestion, paid checkout, subscription entitlement, human-reviewed real provider parity, deploy certification or public launch in this slice.

## Commercial architecture / release work (unimplemented gates)

1. Auth with isolated organization/user identities and session lifecycle; role scopes and invitation flows.
2. Durable Postgres tenant data: `users`, `organizations`, `memberships`, `comparisons`, `comparison_messages`, `usage_events`, `quota_reservations`, `subscriptions`, `audit_events`, retention/deletion tasks. Every query scoped by tenant; isolation tests for reads and writes.
3. Atomic distributed quota reserve/commit/refund, per-user and per-org daily spend ceilings, per-provider concurrency and alerting, correct handling of interrupted streams. Current `rateLimit()` cannot provide these guarantees across Vercel replicas.
4. Stripe TEST product/price, signed webhook verification, idempotent subscription lifecycle, entitlement reconciliation, customer portal, refunds/tax terms and billing support; then independently reviewed live mode.
5. Provider rate-card versioning and reconciled observed usage/cost per run before any stated savings/margin figures. Terms/privacy/copyright and third-party provider resale policy review.
6. E2E browser accessibility, load, threat model, abuse/redaction testing, deployment preview, rollback and monitoring. Separate legal/IP and commercial release approval.

Suggested differentiated offer: compare and track source-backed decisions for engineering and research teams, not a clone of any existing product's branding or interface. No subscription price or profit margin is certified by this implementation.

## Reference provider contracts

- OpenAI streaming Chat Completions: https://developers.openai.com/api/docs/guides/streaming-responses
- Anthropic Messages SSE: https://platform.claude.com/docs/en/build-with-claude/streaming
- Gemini streaming: https://ai.google.dev/api/generate-content
- DeepSeek Chat Completions: https://api-docs.deepseek.com/api/create-chat-completion/
