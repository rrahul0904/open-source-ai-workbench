# Architecture

## Design goals

The workbench is a clean-room modular monolith: one browser workspace, one HTTP contract, and capability-specific workflow modules behind a shared security/storage/provider layer. The core has no third-party runtime dependencies, which keeps Docker, local development and serverless deployment aligned.

## Layers

1. `public/` — operator UI and workflow runner.
2. `api/` — thin Vercel adapters.
3. `server.mjs` — portable Node HTTP host for local/Docker execution.
4. `src/http.mjs` — shared API routing and policy enforcement.
5. `src/workflows.mjs` — executable capability workflows and cross-capability orchestration.
6. `src/graph-runtime.mjs` — bounded data-defined DAG execution, retrieval nodes and node-level traces.
7. `src/providers.mjs` — deterministic providers plus optional live provider adapters.
8. `src/security.mjs` — bearer auth, request-size guard, rate limiting and approval checks.
9. `src/storage.mjs` — memory storage plus optional Redis REST durability.

## Side-effect policy

The repository is usable with no secrets, but demo operation must never be confused with a real external action. Email send, public publishing, payments and similar effects stay behind explicit approval/provider boundaries. Connector live traffic is restricted to one operator-configured base URL, preventing arbitrary SSRF.

## Source-project relationship

This is a clean-room implementation of capability patterns. It does not vendor source code from TradingAgents, LibreChat, HyperFrames, MoneyPrinterTurbo, Agentic Inbox, VoxCPM, Flowsint, agent-skills, Nango, or the unavailable Fincepter repository.
