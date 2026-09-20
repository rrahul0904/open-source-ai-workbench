# Dify reverse-engineering map

## Source behavior reviewed

This work is a clean-room implementation of product patterns visible in Dify's public documentation and repository README. No Dify source code, UI code, or assets are copied.

The donor capabilities worth extracting are:

1. graph-defined AI workflows rather than one hard-coded handler per use case;
2. model/provider abstraction;
3. knowledge ingestion and retrieval as first-class workflow primitives;
4. agent/tool/plugin extensibility;
5. prompt experimentation and versioning;
6. run-level and node-level observability;
7. API-first publishing and self-hosting.

## Existing workbench overlap

The workbench already has a provider abstraction, deterministic demo mode, executable workflows, approval-gated side effects, run history, API access, Docker packaging, Vercel adapters, CI smoke tests, and an optional persistence layer.

## Gap map

| Dify pattern | Workbench before this slice | Target |
| --- | --- | --- |
| Workflow graph | Hard-coded JavaScript handlers | Data-defined bounded DAG runtime |
| RAG | No reusable retrieval primitive | Deterministic knowledge node now; durable corpus later |
| Provider registry | One OpenAI-compatible adapter | Provider/plugin registry next |
| Prompt IDE | Raw JSON inputs | Versioned prompts + A/B run comparison later |
| Observability | Workflow run duration/history | Per-node trace now; cost/token trace later |
| Plugin ecosystem | Generic connector runtime | Typed tool/model/data-source registry later |
| Visual canvas | None | Build after graph contract stabilizes |

## First implementation slice

The first slice adds a small, bounded workflow engine with these node types:

- `input`
- `template`
- `knowledge`
- `llm`
- `output`

Safety and operability constraints:

- maximum 25 nodes and 100 edges;
- cycles and unknown node types fail closed;
- no arbitrary JavaScript execution;
- no arbitrary URL fetch nodes;
- model calls reuse the existing provider boundary;
- deterministic demo execution remains the zero-secret default;
- every node emits a structured trace record.

The default `workflow-studio` capability demonstrates question -> retrieval -> model -> structured output.

## Next slices

1. Persisted workflow definitions with versions and immutable published revisions.
2. Typed provider/plugin registry for model, tool, datasource and trigger classes.
3. Durable knowledge collections with chunking, embeddings, metadata filters and citations.
4. Visual graph editor that reads/writes the same graph contract.
5. Prompt playground with side-by-side evaluation datasets and token/cost telemetry.
6. Trigger/webhook nodes and scheduled execution, still preserving approval gates for external effects.
7. Hosted-runtime certification for any configured live providers.

## Acceptance boundary

This branch can certify the repository behavior of the graph runtime, deterministic retrieval, validation, traces and existing CI. It must not claim production-grade vector search, multi-tenant plugin isolation, or live provider readiness until those external/runtime capabilities are implemented and exercised.
