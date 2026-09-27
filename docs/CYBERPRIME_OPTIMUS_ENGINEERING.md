# CyberPrime × Optimus-inspired engineering slice

## Boundaries and provenance

This is independently authored **workflow/orchestration code**, not a copy of CyberPrime model weights or Optimus Studio's Python/CUDA/MLX internals. The sources are the public Reddit discussion, upstream model card, license and Optimus Studio public documentation. CyberPrime is an upstream model, not our trained checkpoint. Optimus Studio is a separate donor, not a deployed training worker. We do not claim GPT-4 parity, CyberBench parity, full upstream Optimus parity, model improvement or live deployment until separately certified.

- Reddit: https://www.reddit.com/r/OpenSourceAI/comments/1wr278f/i_opensourced_a_small_and_powerful_cyber_ai_model/
- CyberPrime 1.1 model: https://huggingface.co/Akahsizrr/Cyber-Prime-1.1-2.6B
- Upstream license: https://www.liquid.ai/lfm-license
- Optimus Studio: https://github.com/Vaskrokodile/optimus-studio
- Optimus failure-driven TTC caveat: https://github.com/Vaskrokodile/optimus-studio/blob/main/docs/test-time-compute.md

The Reddit author states 2.6B parameters, synthetic and Hugging Face data with repeated selection of top-ranked rows, SFT/RL and an experimental five-day test-time training loop, with 3090-class consumer hardware discussed and A100 selected for speed. These are author reports, not our reproduced measurements. The model card admits cross-model benchmark shot-count differences. Optimus Studio's publicly documented adapter experiments include negative results and distinguish a passing trusted framework fallback from unaccepted local-model adaptation.

## Deployed workflows

1. `defensive-triage`: accept an email, HTTP request, or threat-report text. Validate bounds; emit a *heuristic* review indication and non-sensitive signal IDs. No URL fetching, scanning, blocking, IP reputation, active probes, exploitation, false probability or automatic incident resolution. An empty signal list is `no-heuristic-flags`, **never** a claim that an input is safe. Model text is optional, advisory, and requires explicit opt-in plus operator endpoint configuration and a protected workbench.
2. `model-experiment-plan`: produce a deterministic fingerprinted configuration plus license/provenance/holdout/measurement gates for a future local experiment. Distinguish MLX Apple Silicon, Linux CUDA and Windows CUDA. It neither probes hardware nor downloads weights nor performs SFT/QLoRA/GRPO. An unsupportable configuration is visible, not silently promoted.

For the two workflows, persisted run inputs are limited to a redacted descriptor, byte count and truncated SHA-256 fingerprint: raw email/log/report text and arbitrary request secrets are not saved by the application run store. Outputs intentionally exclude source text. Upstream endpoint/provider logging is separately governed by the operator; do not input real incidents into public demo.

## Start and deploy

The host repository uses Node.js 20+ built-ins and supports `npm test && npm run check && npm run smoke && npm start`. Browse `http://localhost:3000` and choose either new capability; no secret is necessary for deterministic demo. Docker: `docker compose up --build`. Vercel: connect this repo; static assets and `/api/*` functions already exist in the repository. Set `WORKBENCH_API_KEY` for access control before enabling a live model.

Optional operator-owned, OpenAI-compatible **CyberPrime-serving** inference service:

```
WORKBENCH_API_KEY=<server-side token>
CYBER_MODEL_BASE_URL=https://your-controlled-model-server.example/v1
CYBER_MODEL_ID=Akahsizrr/Cyber-Prime-1.1-2.6B
CYBER_MODEL_API_KEY=<server-side token, only if required>
```

Request `provider: "live"` *and* `optInRemoteInference: true` to send input to the configured service. Only HTTPS or local loopback HTTP endpoints are accepted. It is the operator's responsibility to actually host and verify the stated checkpoint; an arbitrary OpenAI-compatible response does not authenticate the weights used. Never put provider credentials or model service URLs in browser request JSON. External model service availability is NOT established by this repository.

### Security and compliance gates before public live operation

- Verify LFM Open License v1.0, including the commercial-use revenue threshold, attribution and redistribution clauses, with legal review as necessary.
- Use a private/approved model endpoint and access protection; confirm no real sensitive case data is logged by the model provider or access layer.
- Run matched, independent held-out evaluations and report per-task F1/accuracy/shot counts and failures; compare against current baselines only under the same protocol.
- Add input retention controls, administrator auth/RBAC, service-side durable quota/rate-limiting, metrics, structured privacy-safe audit, deploy/rollback evidence, incident-response handling and threat modeling.
- Install a real isolated local worker on hardware to execute SFT/GRPO; track GPU OOM, retries, cancellation, reproducibility, holdout contamination, adapter licensing and rollbacks. Do not expose arbitrary training or generated code execution in a hosted service.

### Focused acceptance

`npm test` exercises both workflows for invalid data, no-action boundaries, negative findings, input redaction, explicit live opt-in, deterministic plans and invalid backend combinations. Existing CI runs unit tests, release checks, HTTP smoke and a Docker-backed HTTP acceptance. A live GPU/model or provider certification is intentionally not included.
