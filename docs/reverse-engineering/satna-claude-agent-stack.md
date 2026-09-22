# SATNA Claude Agent Stack — Clean-room reverse engineering

Source: https://www.reddit.com/r/SATNA_PROJECT/s/UDzD45UMfs

## Product interpretation

The Reddit post is best treated as a donor architecture rather than as one product to clone. Its useful idea is an end-to-end agent engineering loop:

`build -> memory -> orchestrate -> control -> ship`

The post groups 20 claimed Claude Code plugins under four capability layers. The source list itself is not authoritative: several links are dead, renamed, or misattributed. This workbench therefore uses only independently verified patterns and does not vendor third-party source code.

## Verified donor patterns

### Build
- `OLDyade/animated-sketch-diagram` — architecture/flow visualization as an agent skill.
- `archcore-ai/cli` — Git-native context/spec/ADR/project knowledge.
- `Wynelson94/shipwright` — goal-to-build/test/deploy workflow pattern.
- `davepoon/buildwithclaude` — plugin/skill discovery marketplace; the Reddit post incorrectly points several named plugins at this repository.

### Memory
- `7xuanlu/origin` redirects to `7xuanlu/wenlan` — durable source-cited agent knowledge.
- `xiehuan123/dsh-deepread` — evidence-first reading and traceable claims.
- `kepano/obsidian-skills` — reusable agent skills over durable Markdown/knowledge artifacts.
- `fablerlabs/claude-md-templates` — project-level agent instructions/templates.

### Orchestration
- `d7omdev/crosstalk` — repository exists; treat as an experimental donor until behavior is independently validated.
- `glitchwerks/claude-wayfinder` — deterministic routing/evaluation concepts.
- `wenqingyu/magic-cc-codex-worker` — parallel workers, role separation, resumable sessions, git-worktree isolation, review-before-merge.
- The Reddit path `nicolai-bernse/backlogd` was not found and is excluded from implementation.
- The Reddit path `explorium-ai/vibe-prospecting` was not found. Explorium currently publishes related `vibeprospecting-plugin` repositories; no code is copied into this workbench.

### Control
- `justi/claude-code-project-boundary` — project-boundary protection for destructive operations.
- `bharat7gupta/claude-pager` — repository exists; candidate notification/paging donor.
- `glitchwerks/claude-prospector` — repository exists; candidate discovery/prospecting donor.
- The Reddit paths `Lifecycle-Inno/claude-ops` and `TLS-Radar/tlsradar` were not found and are excluded.
- The post's `slopmop` link is misattributed; `ScienceIsNeato/slop-mop` exists separately.

## Clean-room implementation target

The workbench adds an `agentic-stack` workflow that turns a goal into five auditable layers:

1. **Build** — interface, architecture, implementation slice and acceptance criteria.
2. **Memory** — context ledger, source/evidence capture, durable decisions and reusable instructions.
3. **Orchestrate** — role packets for planner, implementer and reviewer; parallelizable work is isolated conceptually from the main branch.
4. **Control** — project-boundary, approval, verification and release gates.
5. **Ship** — a release decision that distinguishes repository evidence from runtime/hosted evidence.

The implementation is deliberately deterministic and zero-secret in demo mode. It records no claim that an external worker, deployment, PR merge, or provider action actually occurred.

## Commercial/license boundary

This repository reimplements behavioral patterns from public descriptions. Do not copy third-party source code, prompts, assets, or plugin manifests into this project without an explicit license review. In particular, some donor projects use licenses that are not blanket commercial licenses; keep this feature clean-room unless the relevant license is approved.

## Acceptance criteria

- `agentic-stack` appears in the capability catalog.
- It executes without secrets.
- Output includes exactly the build, memory, orchestrate, control and ship stages.
- Orchestration identifies planner/implementer/reviewer responsibilities without pretending workers ran.
- Control gates remain fail-closed for deployment/external evidence.
- Tests cover the stage contract and external-action boundary.
