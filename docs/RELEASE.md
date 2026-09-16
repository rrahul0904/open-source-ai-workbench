# Release certification

A repository head is eligible for deployment when all of the following are green:

1. `npm test` — workflow/security/API tests.
2. `npm run check` — every catalog capability executes plus required deployment files exist.
3. `npm run smoke` — live Node server health, UI and cross-capability workflow acceptance.
4. GitHub Actions `container` job — Docker image build, boot and live HTTP acceptance.
5. Hosting preview/production deployment — provider-specific runtime evidence.

## What zero-config deployment includes

All eleven workflows, browser UI, APIs, in-memory run history, approval gates, deterministic market/demo inference, generated WAV audio and cross-capability orchestration.

## Optional production integrations

These are enhancements, not boot blockers:

- `LLM_API_KEY` (+ optional `LLM_BASE_URL`, `LLM_MODEL`) for live model inference.
- `CONNECTOR_HTTP_BASE_URL` (+ optional token) for a live action/sync provider.
- Upstash Redis REST variables for durable run history.
- `WORKBENCH_API_KEY` for API bearer protection.

A deployment must not claim that an optional integration is live until that provider has been configured and exercised in that environment.
