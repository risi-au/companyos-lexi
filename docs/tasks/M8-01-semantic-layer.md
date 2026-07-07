# M8-01: Semantic layer (pgvector embeddings + wikilinks/backlinks)

status: todo (unblocks all of M8 — see docs/tasks/M8-second-brain-overview.md)
module: packages/db (migration) + packages/api (search upgrade, new embeddings lib, docs
link extraction) + infra (LiteLLM alias, Postgres image check)
branch: task/M8-01

## Goal

Give the OS a semantic substrate: pgvector embeddings over docs and records with a hybrid
FTS+vector search mode, and a real link graph extracted from wiki pages. The brain engine
(M8-02), scoped memory recall (M8-03), wizard similarity detection (M8-04), and the graph
app (M8-05) all build on this.

## Context

- `packages/api/src/modules/search/` is deliberately Postgres FTS-only today; its
  AGENTS.md forbids embeddings. **That restriction is superseded by this brief** — update
  the AGENTS.md accordingly.
- docs/patterns/WIKI.md describes Sources sections as "the backlink graph in plain
  markdown" — this brief makes links first-class data.
- LiteLLM is the only model gateway; role aliases only, never vendor names
  (docs/CONSTITUTION.md).
- Docs and records mutations already emit kernel events (`doc.saved`, record creation) —
  use them to keep embeddings and links current.

## Pre-implementation analysis gate

Write a short analysis note to docs/tasks/M8-01-semantic-layer.analysis.md covering:

1. One embedding per entity vs chunking for long docs — pick and justify.
2. Where embedding generation runs (synchronous on save vs deferred/backfill) and how a
   LiteLLM outage degrades (search must fall back to FTS, saves must never fail).
3. Rank-fusion approach for hybrid search (e.g. RRF) and how existing FTS-only consumers
   keep their current behavior.
4. PGlite test strategy for the vector extension.

## Do

1. **Migration**: `CREATE EXTENSION IF NOT EXISTS vector`. New `embeddings` table:
   `id`, `entity_type` (`doc | record`), `entity_id`, `scope_id`, `content_hash`,
   `model` (alias string), `embedding vector(N)` (dimension via env, default 1536),
   `updated_at`. Unique on (entity_type, entity_id). Verify the compose Postgres image
   ships pgvector; switch to a pgvector-enabled image if not (note it in infra README).
2. **Embeddings lib** (`packages/api/src/lib/embeddings.ts`): calls LiteLLM's
   OpenAI-compatible `/embeddings` endpoint with a new role alias `embed` (add to the
   LiteLLM config in infra with a budget-capped key). Content-hash skip: identical
   content is never re-embedded. Fail-open: embedding failures log (usage/alert
   patterns) but never fail the triggering write.
3. **Pipeline**: embed on doc save and record creation (deferred from the event, not in
   the write path), plus an idempotent backfill function for existing rows, exposed as an
   admin-gated service function.
4. **Hybrid search**: extend the search service with `mode?: "keyword" | "semantic" |
   "hybrid"` (default `hybrid`). Hybrid = FTS + cosine-similarity candidates fused by
   RRF. If no embeddings exist for the subtree or the alias is unconfigured, behave
   exactly like `keyword`. Existing contract (typed hits, viewer gating, limits, redacted
   usage logging) unchanged.
5. **Wikilinks + backlinks**: adopt `[[slug]]` (same-wiki) and `[[scope-path:slug]]`
   (cross-wiki) as the link convention — document it in docs/patterns/WIKI.md. New
   `doc_links` table: `from_document_id`, `to_scope_id`, `to_slug`,
   `to_document_id` nullable (resolved when the target exists), `created_at`. Extract
   links on every doc save (replace that doc's rows). Service functions:
   `getBacklinks(db, {scopePath, slug}, actor)` and `getLinkGraph(db, {scopePath},
   actor)` (nodes + edges for a subtree; root = whole instance, viewer-gated per scope).
6. **AGENTS.md updates**: search module (restriction lifted, new modes), docs module
   (link extraction), new lib documented. Update packages/mcp AGENTS.md if search tool
   schema changes.
7. **Tests**: PGlite with the vector extension enabled — embedding upsert + hash skip,
   fail-open on embed errors, hybrid vs keyword parity when no vectors, link extraction
   round-trip (create/update/remove), backlink + graph queries, access control, and the
   existing search suite still green.

## Don't

- No external vector DB or search service.
- No vendor-named models anywhere — the `embed` alias only.
- Don't put embedding calls in the synchronous write path of saveDoc/createRecord.
- Don't store raw query text in usage metadata (existing search redaction rule holds).
- Don't break the existing search contract or its tests.
- Don't render or interpret wikilinks in UI beyond extraction (graph UI is M8-05).

## Acceptance criteria

- [ ] Migration applies; embeddings + doc_links tables exist; pgvector confirmed in the
      compose image
- [ ] Saving a doc / creating a record produces an embedding row (deferred), identical
      content re-save does not re-embed
- [ ] LiteLLM down → writes still succeed, search falls back to keyword, a warning is
      surfaced per ALERTS.md patterns
- [ ] `search(mode: "hybrid")` returns semantically relevant hits ("paid social" finds
      "meta ads" content) in tests via a fake embedding client
- [ ] `[[slug]]` and `[[scope:slug]]` links extracted to doc_links on save; backlinks and
      subtree graph queries return correct nodes/edges; unresolved targets allowed
- [ ] Backfill function embeds and link-extracts existing content idempotently
- [ ] WIKI.md documents the wikilink convention; search AGENTS.md restriction replaced
- [ ] All existing tests green; new coverage as listed above
