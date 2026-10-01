# RE-267 — Moonshoot clean-room rebuild

Status: research refreshed 2026-10-01; Phase A implementation started. This records public behavior/community feedback and does **not** claim access to Moonshoot's private source or runtime internals.

## Current public product observed

Moonshoot evolved rapidly during September 2026. Its current public surface combines: a 384,400 km One Push challenge; permanent km claims with project or dedication; a Flag registry; weekly Manifest/project updates; daily Fuel curation with next-day featured cargo; country standings/referrals; a paid Company Crew page that explicitly does not buy kilometres; and a separate older paid live-flight/pricing surface. That coexistence makes the product transitional rather than one proven model.

Primary evidence:
- https://moonshoot.lol/
- https://moonshoot.lol/rules
- https://moonshoot.lol/manifest
- https://moonshoot.lol/flag
- https://moonshoot.lol/crew/new
- https://moonshoot.lol/pricing
- https://moonshoot.lol/privacy
- https://moonshoot.lol/terms

## Feedback that changes the rebuild

Public build-in-public threads repeatedly expose four risks:

1. **Meaning is unclear.** Commenters repeatedly ask what the point is. The creator says the point is still being earned and is testing whether discovery, attention and connections emerge.
2. **Retention is not value.** Fuel can create a reason to act after returning, but feedback correctly distinguishes reactivation from useful outcomes. The creator began tracking profile visits and outbound clicks.
3. **Moderation cannot be report-only.** A thread surfaced slurs already visible on the product; the creator acknowledged submission filtering must be stronger.
4. **Scheduled attention is expensive.** Earlier live-launch feedback warns that synchronized 5/10/20-minute participation is high-friction, and warm-community tests do not prove cold-start demand.

Selected discussion evidence:
- https://www.reddit.com/r/SideProject/comments/1wpzahd/i_rebuilt_moonshoot_into_one_stupidly_simple_idea/
- https://www.reddit.com/r/buildinpublic/comments/1wpz87i/day_5_building_moonshoot_i_completely_changed_the/
- https://www.reddit.com/r/indie_startups/comments/1wuhru8/i_thought_acquisition_was_the_hard_part_turns_out/
- https://www.reddit.com/r/SaaS/comments/1wujx4c/i_added_a_daily_mechanic_to_my_project_but_i_dont/
- https://www.reddit.com/r/sideprojects/comments/1wug1oh/68_users_31_countries_and_i_still_dont_know_what/

## Clean-room product decision

Keep the permanent-kilometre communal registry, but make the primary value proposition a **builder discovery + progress network**:

- one verified identity claims one durable kilometre;
- one short project update per UTC day plus weekly progress history;
- Fuel curates someone else and never moves the rocket;
- profile views/outbound clicks remain distinct from Fuel so engagement is not mislabeled as value;
- content constraints/filtering happen before publication, with participant reports as a secondary review signal;
- paid company/community pages can fund operations but cannot buy kilometres, Fuel or ranking;
- defer the old synchronous launch marketplace until the free network demonstrates repeat discovery value.

## Phase A implemented

- `src/moonshoot.mjs`: dependency-free domain engine.
- `src/moonshoot-http.mjs`: bounded HTTP adapter.
- `src/http.mjs`: routes the Moonshoot API through the existing workbench server.
- `public/moonshoot.html`: independent demo UI centered on discovery value.
- `tests/moonshoot.test.mjs`: focused deterministic tests.

Implemented invariants: 384,400 km cap; serialized process-local concurrent allocation; one claim per supplied verified identity; project-or-dedication validation; bounded fields/pre-publication blocking; referral same-day Fuel bonus; one base Fuel/day plus bonus and no self-Fuel; deterministic previous-day top-three cargo; one project update/day; deduplicated profile-view/outbound-click events separate from Fuel; three unique participant reports flag content for review.

## Truthful boundary

This slice does **not** prove “one human, one kilometre.” It enforces one claim per caller-supplied verified identity key. The demo uses a random local browser token. Production must replace it with signed authentication and stronger anti-abuse controls.

Claim allocation is atomic only inside one process. Production needs durable transactional uniqueness or an equivalent distributed atomic primitive. No deployment, production availability, privacy compliance, physical balloon/reward fulfillment or vendor parity is claimed.

## Next phases

1. Signed email/OAuth identity adapter, account recovery/deletion and anti-abuse controls.
2. Durable transactional ledger, unique identity/km constraints, idempotency and restart/replay tests.
3. Configurable moderation, review queue, audit receipts and appeals.
4. Builder pages/history, referral attribution, feature-vs-normal discovery experiments and privacy-safe analytics.
5. Original share cards/certificates and accessible Flag/search surfaces.
6. Company/community crew pages with strict no-distance/no-ranking entitlement boundaries.
7. Load/concurrency/browser/accessibility certification, deployment receipts and recovery runbooks.
8. Only after value evidence, separately evaluate synchronous live-launch mechanics.
