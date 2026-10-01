# Safe Preview / Tunnel / Deploy Runtime — Reverse Engineering Dossier

Research snapshot: 2026-10-01  
Implementation issue: #20  
Implementation branch: `reverse/safe-preview-runtime`

## Source and clean-room boundary

This work studies public behavior of **tunr** from its public Reddit launch discussion and public GitHub documentation, then implements an independently designed capability inside Open Source AI Workbench.

Primary public sources:

- Reddit discussion: https://www.reddit.com/r/vibecoding/comments/1wuwcb2/i_teach_coding_through_vibecoded_projects_built_a/
- Public upstream repository/docs: https://github.com/tunr-dev/tunr
- Cloudflare Tunnel docs: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
- ngrok docs/site: https://ngrok.com/
- LocalTunnel: https://github.com/localtunnel/localtunnel
- Railway Railpack docs: https://docs.railway.com/reference/railpack
- Vercel agent/deployment documentation: https://vercel.com/

The implementation does **not** copy tunr source, private prompts, branding, UI assets, relay implementation, control-plane implementation, or infrastructure. This is especially important because the public tunr repository documents a split license in which the relay is source-available under PolyForm Shield rather than the same permissive license as all client components.

## What the public product does

The publicly documented system combines several related developer-preview capabilities:

1. expose a localhost HTTP/WebSocket app through a public URL;
2. optionally block write-like requests for client demos;
3. serve the last successful page when the local server crashes or begins returning 5xx;
4. inject a feedback control into HTML responses;
5. inspect and replay traffic;
6. protect links through authentication, allowlists and TTLs;
7. deploy applications to persistent URLs;
8. expose deploy/status/log lifecycle through MCP;
9. suspend idle hosted applications and wake them again;
10. self-host relay and runner infrastructure.

The public architecture describes a browser-to-relay-to-CLI-to-localhost path for tunnels and a control-plane/runner model for hosted applications.

## Reddit feedback captured

The supplied Reddit thread contains a small but useful feedback set.

- One commenter highlighted the value of allowing clients to explore a prototype without touching the real database.
- Another commenter focused on the difficulty beginners have deciding when a project is complete and asked about testing with real people.
- Most importantly, a commenter challenged the safety semantics of demo mode: applications can POST on every keystroke, so a simplistic method filter can still create surprising behavior.

That last point materially changes our implementation. The safe-preview layer must not merely advertise “read only.” Every forwarded or intercepted request needs a policy decision and receipt, mutations must be denied by default, and exceptions must be explicit method+route rules.

No commenter-linked product in the captured thread required a separate reverse-engineering project at this snapshot.

## Comparator findings

| Capability | Typical tunnel tools | Our target |
| --- | --- | --- |
| Temporary localhost URL | Common | Yes, later public-relay phase |
| Stable named tunnel | Available in mature providers | Yes, after identity/auth phase |
| Traffic inspection | Available in products such as ngrok | Yes, bounded/redacted |
| Safe client-demo mutation policy | Not generally the core tunnel primitive | Yes, first-class |
| Last-good HTML fallback | Uncommon as a tunnel primitive | Yes |
| In-page feedback capture | Usually separate tooling | Yes |
| Agent-native deploy lifecycle | Increasingly common | Yes, provider-neutral |
| Scale/suspend lifecycle | Hosting concern, not tunnel concern | Later phase |
| Self-hosted path | Available in some tools | Later phase |

Cloudflare Quick Tunnels are useful for ephemeral development, while named tunnels provide durable hostnames. LocalTunnel remains a simple self-hostable tunnel reference. ngrok demonstrates mature traffic inspection and policy controls. These comparators reinforce that our differentiator should be the combined **safe preview + evidence + agent workflow**, not merely another public URL generator.

## Build-system decision

The upstream project currently documents Nixpacks-style zero-config application builds, but current Railway documentation positions **Railpack** as the maintained successor. Our deploy layer therefore should not hardwire itself to an obsolete builder.

The target deploy abstraction will accept a provider-neutral build receipt and support at least:

- explicit Dockerfile;
- Railpack-compatible zero-config build where available;
- a deterministic static/demo fixture for acceptance tests.

Provider integrations are adapters; the application contract must not depend on one hosting vendor.

## Phase A implemented scope

Phase A is intentionally local and bounded. It proves the safety semantics before any public relay is introduced.

### Runtime invariants

- upstream is required and loopback-only by default;
- preview listener binds to loopback;
- GET/HEAD/OPTIONS are considered read-like for policy purposes;
- every other method is denied upstream in demo mode unless the exact method+path is allowlisted;
- intercepted writes receive a synthetic success response carrying an explicit interception header and receipt ID;
- authorization, cookies and API-key-like headers are redacted in captured receipts;
- request capture is bounded;
- response size is bounded;
- last-good cache is bounded;
- only successful uncompressed HTML GET responses enter the freeze cache;
- freeze can replace an unreachable/5xx HTML navigation only when a last-good page for that exact path exists;
- JSON/API failures are never masked by freeze;
- feedback is captured by the preview runtime and not forwarded to the application;
- feedback widget injection is idempotent and HTML-only;
- safe GET replay is explicit;
- mutation replay requires both runtime opt-in and call-site opt-in, and cannot work unless bodies were explicitly captured.

### Local control endpoints

- `GET /__preview/status`
- `GET /__preview/requests`
- `GET /__preview/widget.js`
- `POST /__preview/feedback`

These endpoints are local Phase A controls. They must not be exposed unchanged by a future public relay. Public exposure requires authentication, origin/session binding and abuse controls.

## Phase A acceptance tests

The focused test suite verifies:

1. demo policy denies non-read methods by default;
2. exact mutation allowlist behavior;
3. credential/cookie/API-key redaction;
4. idempotent widget injection;
5. real socket-level GET proxying;
6. blocked POST never reaching upstream;
7. allowlisted POST reaching upstream;
8. last-good HTML fallback on later 5xx;
9. JSON 5xx remaining visible;
10. local feedback capture without app mutation;
11. explicit safe GET replay;
12. mutation replay double gating;
13. remote upstream rejection.

The repository's normal CI still runs the entire workbench test/check/smoke suite and Docker acceptance.

## Phase B — public relay

Not implemented or claimed yet.

Required design work:

- authenticated tunnel session contract;
- HTTPS edge termination;
- WebSocket support;
- route ownership and collision handling;
- session TTL and revocation;
- optional password/bearer/IP access policy;
- bounded bandwidth/concurrency;
- abuse and rate controls;
- public-control-endpoint isolation;
- end-to-end receipts connecting edge request to local preview decision;
- explicit failure semantics when the local client disconnects.

Raw TCP/UDP/TLS forwarding is outside the initial public-relay scope and requires separate threat modeling.

## Phase C — durable deploy

Not implemented or claimed yet.

Required:

- versioned app/deployment contracts;
- immutable source/build/deploy receipts;
- Docker/Railpack adapter;
- safe build context rules and secret exclusion;
- resource budgets;
- logs;
- health state;
- persistent URL;
- lifecycle states such as running/idle/suspended/stopped based on measured provider behavior;
- rollback/version selection;
- real deployment acceptance.

“Scale to zero” must describe measured provider/runtime behavior, not a marketing label.

## Phase D — MCP / agent interface

Not implemented or claimed yet.

Target tools:

- preview start/status/stop;
- inspect requests;
- replay safe request;
- submit/list feedback;
- deploy;
- deployment status;
- logs;
- teardown.

Externally visible or mutating actions must preserve explicit policy/approval boundaries. An agent should be able to gather evidence without silently widening network or write privileges.

## Phase E — security and release gates

Before tracker registration as a completed build:

- SSRF/host-validation review;
- tunnel/session authentication review;
- secrets and token-storage review;
- replay and request-body privacy review;
- control endpoint authorization;
- WebSocket boundary tests;
- resource and abuse limits;
- deployment isolation evidence;
- exact-head CI;
- public tunnel runtime evidence;
- durable deploy runtime evidence;
- browser/client acceptance;
- restart/failure acceptance;
- documented non-claims.

## Tracker rule

This source is **not yet registered as a completed reverse-engineering project** in the canonical spreadsheet. Issue #20 and the implementation branch are the working evidence surface. The canonical tracker should be updated only after the full research/build/verification gate is satisfied and a fresh canonical-ID collision check is performed.


## Phase B implementation evidence — bounded relay transport

Phase B now has an independently authored executable transport slice. It deliberately does **not** reproduce the upstream WebSocket relay. Instead, the local share agent keeps an outbound authenticated long-poll connection to a relay service, which is enough to prove the public-request routing contract without requiring inbound access to a developer machine.

Implemented behavior:

- operator-key-gated session creation;
- cryptographically random public slugs and per-session agent tokens;
- bounded session TTL with explicit expiration;
- one outstanding long-poll per session;
- bounded queued/pending requests and request/response bodies;
- public request -> relay -> outbound agent -> local safe-preview -> localhost app -> response round trip;
- public relay denial for local inspector/status controls;
- public forwarding for only the feedback/widget controls needed by the injected client experience;
- explicit agent response timeout;
- per-session teardown;
- public `/healthz` that exposes no session inventory;
- one-command `npm run share` composition of the Phase A safe-preview policy plus relay agent;
- relay service entrypoint via `npm run relay`.

Focused Phase B tests cover relay health, end-to-end GET forwarding, end-to-end POST interception at the local safety boundary, selective control exposure, per-session agent authentication, and TTL expiry.

This is still **not public-runtime evidence**. A local socket-level relay test proves the protocol and safety boundary, but not internet routing, TLS termination, hosting-provider behavior, multi-instance durability, WebSocket support, abuse resistance, or production availability. Those remain deployment/security gates.
