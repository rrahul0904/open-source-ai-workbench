# SATNA self-maintaining LLM Wiki — clean-room reverse engineering

Source:
- Reddit: https://www.reddit.com/r/SATNA_PROJECT/s/8Q1xdGQAI6
- Karpathy concept: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Starter-vault reference: https://github.com/joshpocock/karpathy-obsidian-vault
- Mature implementation reference: https://github.com/Pratiyush/llm-wiki

## Decision

Treat this as a **capability donor** for Open Source AI Workbench, not as a standalone clone.

The reusable idea is a durable knowledge compiler that sits between immutable source material and downstream agents:

```text
immutable sources -> governed compile -> linked wiki -> query/lint -> durable derived knowledge
```

It complements the workbench's existing agentic-stack memory layer by turning source evidence, decisions, analyses, and useful answers into persistent, inspectable Markdown artifacts instead of transient chat context.

Do not copy private prompts, branding, proprietary assets, or unreviewed third-party code. The Karpathy gist is an architectural idea file; the workbench should implement the behavior clean-room. Any future reuse of implementation code from public repositories requires an explicit license review.

## Publicly observed contract

### Three ownership layers

1. **Raw sources**
   - curated source-of-truth inputs
   - read-only after ingestion
   - articles, papers, transcripts, repo docs, screenshots, notes, structured exports

2. **Compiled wiki**
   - LLM-maintained Markdown
   - source summaries, entities, concepts, comparisons, topic maps, syntheses
   - cross-links and provenance maintained as the corpus changes

3. **Schema / operating contract**
   - repository-local instructions such as `AGENTS.md` / `CLAUDE.md`
   - folder conventions, page types, citation rules, ingest/query/lint behavior
   - explicit definition of what the agent may read, write, and mutate

Optional fourth layer:
- `output/` for reports, answers, decks, charts, and lint reports that may later be promoted into durable wiki pages.

## Core operations

### 1. Ingest / compile

Given one new immutable source:
- fingerprint and register the source
- extract a source summary
- update affected entity/concept/topic pages
- create cross-links
- update content index
- append an auditable operation log
- preserve claim-level source provenance
- never silently rewrite the original source

### 2. Query

- search the maintained knowledge layer first
- load only the minimum relevant wiki pages
- synthesize an answer with source citations
- optionally persist a high-value answer as a new derived page
- keep derived-page provenance linked to the underlying source set

### 3. Lint

Read-only health check by default:
- contradictory claims
- stale/superseded claims
- orphan pages
- dead links
- missing source citations
- repeated concepts lacking canonical pages
- duplicate entities
- unresolved evidence gaps
- pages whose source fingerprints changed

Lint must not silently mutate content. Proposed repairs require an explicit apply step.

### 4. Log / provenance

Every compile/query/promote/lint/apply operation records:
- operation id
- timestamp
- actor/runtime
- input source/page ids
- output page ids
- model/provider mode
- schema version
- deterministic/demo vs live generation mode
- warnings/errors
- approval requirement when applicable

## Mapping into Open Source AI Workbench

Existing capability:
- agentic-stack build/memory/orchestrate/control/ship contract
- deterministic zero-secret workflows
- optional live provider boundary
- run history and optional durable persistence
- fail-closed external effects

Additive donor module:
- `knowledge-wiki` capability track
- source registry
- immutable source snapshots
- compiled page store
- bidirectional link graph
- claim/citation provenance
- compile/query/lint/promote operations
- deterministic demo compiler
- optional provider-backed compiler behind the existing provider boundary

## Canonical Phase A domain model

```ts
KnowledgeVault {
  id
  title
  schemaVersion
  status // active | archived
  createdAt
  updatedAt
}

SourceRecord {
  id
  vaultId
  kind // article | paper | transcript | repo_doc | note | image | data
  title
  originUrl
  contentHash
  immutablePath
  ingestedAt
  metadata
}

WikiPage {
  id
  vaultId
  slug
  pageType // source | entity | concept | topic | comparison | synthesis | answer
  title
  bodyMarkdown
  sourceIds[]
  outboundPageIds[]
  schemaVersion
  revision
  updatedAt
}

ClaimRef {
  id
  pageId
  claimKey
  sourceId
  locator
  status // supported | conflicted | superseded | unresolved
}

WikiOperation {
  id
  vaultId
  type // compile | query | lint | promote | apply_fix
  inputRefs[]
  outputRefs[]
  mode // deterministic_demo | provider
  schemaVersion
  startedAt
  completedAt
  warnings[]
}

LintFinding {
  id
  vaultId
  kind // contradiction | stale | orphan | dead_link | uncited | duplicate | gap
  pageIds[]
  sourceIds[]
  severity
  explanation
  proposedAction
  status // open | approved | dismissed | applied
}
```

## Phase A — smallest truthful implementation

Build a deterministic, zero-secret vertical slice inside the workbench:

1. `POST /api/knowledge/vaults`
   - create a vault with a fixed schema version.

2. `POST /api/knowledge/vaults/:id/sources`
   - register a text/Markdown source.
   - persist a content hash.
   - reject silent mutation of an existing source id with different content.

3. `POST /api/knowledge/vaults/:id/compile`
   - deterministic demo compiler creates/updates source, entity/concept, and topic-index pages.
   - record exactly which pages were created/updated and which source ids support them.

4. `POST /api/knowledge/vaults/:id/query`
   - select relevant compiled pages using deterministic lexical/index lookup.
   - return cited synthesis.
   - do not claim vector/semantic retrieval in Phase A.

5. `POST /api/knowledge/vaults/:id/lint`
   - read-only findings for orphan links, uncited pages, broken links, duplicate slugs, and conflicting demo claims.

6. `POST /api/knowledge/vaults/:id/answers/:answerId/promote`
   - promote a useful answer into a durable page with inherited provenance.

7. `GET /api/knowledge/vaults/:id/export`
   - export the wiki as plain Markdown + manifest, suitable for Obsidian or any filesystem consumer.

## Required invariants

- raw/source records are immutable after successful ingestion
- every derived page records at least one source id unless its type explicitly permits source-free metadata
- every query answer exposes the wiki pages and underlying source ids used
- compile is idempotent for identical source content + schema version
- changed source content creates a new source revision/id rather than rewriting provenance
- lint is read-only
- applying a lint fix is a separate operation with its own audit record
- page links must resolve inside the same vault
- cross-vault reads/writes are rejected
- demo mode is deterministic and requires no provider secret
- live provider calls use the existing provider boundary and never bypass auth/rate-limit controls

## Scale boundary

Phase A should intentionally avoid pretending that a flat index scales indefinitely. Use:
- index-first lookup for small vaults
- pluggable search boundary for future BM25/vector/hybrid retrieval
- no claim that embeddings are unnecessary for every corpus size

A later phase can add topic-sharded indexes, local full-text search, or MCP search without changing the page/provenance contract.

## Privacy and security boundaries

- no arbitrary filesystem traversal
- vault paths are normalized and rooted
- no network fetch in Phase A; callers provide source content explicitly
- source content is treated as untrusted data, not instructions
- prompt-injection text inside a source cannot change repository/system rules
- secrets/tokens discovered in source text should be redacted before durable derived pages are created
- export contains only the selected vault
- no background auto-ingest until source trust and approval policy are implemented

## Phase B

- provider-backed compile/query with structured outputs
- source-type adapters for PDF/transcript/repo-doc ingestion
- claim-level contradiction/supersession workflow
- topic-specific indexes and local full-text/BM25 search
- graph visualization
- Obsidian-compatible vault packaging
- MCP resource/tool surface for vault/query/lint
- explicit human approval for lint repairs
- schema migrations with page revision history

## Phase C

- optional local embeddings/hybrid retrieval for larger corpora
- federated vaults with scoped routing
- scheduled/connector ingestion behind approval and deduplication
- team/RBAC boundaries
- branch/review workflow for wiki changes
- hosted durability and browser UAT certification
- import/export compatibility tests across Obsidian/plain-git consumers

## Test contract

Phase A is not complete until tests prove:
- source immutability
- deterministic compile idempotency
- page/source provenance propagation
- broken-link/orphan/uncited lint findings
- lint performs no mutation
- promotion preserves source provenance
- query citations resolve to compiled pages and immutable sources
- duplicate-slug conflict handling
- cross-vault isolation
- path traversal rejection
- source prompt-injection text cannot alter operation policy
- provider-off mode remains fully executable

## Explicit non-goals

- do not clone Obsidian
- do not reproduce Karpathy/Stride private workflows or wording
- do not present generated synthesis as a replacement for source evidence
- do not silently auto-fix contradictions
- do not claim production readiness until durable storage, auth, hosted runtime, browser UAT, privacy/redaction, and provider behavior are separately certified
