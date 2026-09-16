# Open Source AI Workbench

![CI](https://github.com/rrahul0904/open-source-ai-workbench/actions/workflows/ci.yml/badge.svg)

A clean-room, deployment-ready AI workspace that turns the SATNA_PROJECT open-source collection into one coherent product instead of ten disconnected clones.

## What is implemented

The repository ships **11 executable workflows** covering the ten source capability tracks plus a cross-capability orchestrator:

- TradingAgents-style multi-agent market research council
- LibreChat-style provider-abstracted chat
- HyperFrames-style deterministic video manifest composition
- Fincepter-style finance terminal snapshot
- MoneyPrinterTurbo-style topic → script → storyboard → voice content factory
- Agentic Inbox-style triage, drafting and approval gates
- VoxCPM-inspired voice studio with a built-in WAV demo renderer
- Flowsint-inspired OSINT entity/relationship graph workspace
- agent-skills-inspired spec → plan → test → review → ship engineering agent
- Nango-inspired normalized connector/action/sync runtime
- Cross-capability campaign orchestration

The product is intentionally **zero-secret runnable**. Demo mode is real executable software, not disabled UI: every workflow returns deterministic output and can be exercised through the browser or API. Optional live providers plug in through environment variables.

## Run locally

```bash
npm test
npm run check
npm run smoke
npm start
```

Open `http://localhost:3000`.

There is no dependency installation step; the runtime uses Node.js 20+ built-ins only.

## Deploy

### Vercel

Import this GitHub repository into Vercel. `public/` is the UI and `api/` contains the Node.js functions. No environment variables are required for demo mode.

Optional variables are documented in `.env.example`.

### Docker

```bash
docker build -t open-source-ai-workbench .
docker run --rm -p 3000:3000 open-source-ai-workbench
```

Or:

```bash
docker compose up --build
```

## API

```text
GET  /api/health
GET  /api/capabilities
GET  /api/runs
POST /api/workflows/run
```

Example:

```bash
curl -s http://localhost:3000/api/workflows/run \
  -H 'content-type: application/json' \
  -d '{"workflowId":"launch-campaign","input":{"topic":"AI agents for data engineering","audience":"architects"}}'
```

## Production boundaries

- External effects are fail-closed. Inbox/publishing workflows generate approved-ready artifacts but do not silently send or publish.
- Arbitrary user URLs are never fetched. Live connector traffic can only go to the operator-configured `CONNECTOR_HTTP_BASE_URL`.
- `WORKBENCH_API_KEY` can protect all APIs with bearer auth.
- Live LLM execution is optional through an OpenAI-compatible endpoint.
- Run history is in memory by default and can use Upstash Redis REST when configured.
- Synthetic finance values are clearly marked and are not investment advice.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/RELEASE.md`](docs/RELEASE.md).
