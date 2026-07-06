# M6-09: search tool + wiki surfacing in context

status: done — implemented 2026-07-07, codex for the backend (search module,
migration, MCP tool, agent.ts Knowledge section) plus architect completion of
the DocsView.tsx UI half (wiki-pin + inherited-wiki banner — codex's own
dispatch got interrupted mid-file after a runaway non-writing loop; plumbing
existed, render/fetch logic didn't) and three test gaps the same interruption
left (Knowledge-section tests in agent.test.ts, search MCP roundtrip + tool-
list entry in ping.test.ts) plus one real type bug (implicit-any in
findNearestWiki). This is the final M6 task — full milestone now merged
locally, pending the batched staging push/deploy/live-verify pass.
module: packages/api (new module `search` + context bundle) + packages/mcp + apps/os
branch: task/M6-09

## Goal

Agents connect today's work to anything done months ago without trawling records: a
`search(scope, query)` tool over records + docs in the scope subtree (promised in
DESIGN.md's MCP contract v1, never built — verified absent from the MCP server), and
`get_context` surfaces the scope's wiki (docs index via ancestor walk) so every session
starts knowing the distilled knowledge exists. Together with docs/patterns/WIKI.md this
closes the "agent overwrites six-month-old work it didn't know about" failure mode.

## Context

- DESIGN.md §MCP contract v1: "Context: get_context(scope), search(scope, query),
  get_tree(scope)". DESIGN §engines: "+pgvector later"; gbrain dropped with the door open
  ("KB is markdown, which gbrain ingests").
- docs/patterns/WIKI.md — placement rules, `wiki` index slug, ancestor-walk resolution,
  inherited-wiki UI. This task implements its surfacing + retrieval mechanics.
- M6-04 added workbench ancestor-walk to `getContextBundle`
  (packages/api/src/agent.ts) — same idiom, same file.
- M6-08 added subtree matching for records — reuse the helper.
- Docs module: `docs` table (scope_id, slug, title, body_md, archived), revisions,
  `save_doc`/`get_doc`/`list_docs` MCP tools already exist.

## Architect decisions (do not relitigate)

1. **v1 is Postgres FTS, not embeddings.** `to_tsvector('english', title || body)` over
   records + docs, GIN expression indexes. pgvector/semantic is a later task — note it,
   don't build it.
2. **Search is a new read-only module** (`packages/api/src/modules/search/`). It queries
   records + docs tables read-only for ranking. This is a deliberate, documented
   exception to module isolation for a cross-cutting query layer — it imports SCHEMAS
   (from @companyos/db) only, never other modules' services, and writes nothing.
   Expression indexes are added in a migration owned by this task.
3. **Wiki = docs convention** (WIKI.md): no new tables, no new tab. UI changes live
   inside the existing Docs tab.

## Do

1. Search service: `search(db, { scopePath, query, kinds?: ("record"|"doc")[], limit? },
   actor)` — viewer on requested scope; subtree matching (M6-08 helper); FTS with
   `websearch_to_tsquery`; returns typed hits:
   `{ type: "record"|"doc", id, slug?, kind?, title, scopePath, date, snippet }`
   (snippet via `ts_headline`, capped). Limit default 10, clamp 50. Newest-first as
   tiebreak on equal rank.
2. Migration: GIN expression indexes on records(title, body_md) and docs(title, body_md).
3. MCP tool `search({scope, query, kinds?, limit?})` (additive) — compact tab-delimited
   results like list_records, snippet included.
4. `getContextBundle` + MCP `get_context` gain a "Knowledge" section:
   - Ancestor-walk to the nearest scope owning a `wiki` doc (WIKI.md graduation rule
     falls out naturally — nearest wins).
   - List that wiki's doc index: slugs + titles ONLY (token-light), starting with the
     `wiki` index page, plus the owning scope path.
   - One line pointing agents at `search` for anything older than the recent records
     shown.
5. UI (Docs tab, per WIKI.md):
   - Pin the `wiki` slug doc first, visually distinct (front door).
   - Sub-scopes without own docs/wiki: "Inherited wiki — from <ancestor path>" section
     linking the ancestor's wiki index + topic pages (read/open in ancestor scope).
6. Update AGENTS.md files: new search module, packages/mcp tool list, apps/os docs module.

## Don't

- No embeddings, pgvector, or external search infra (explicitly later).
- No new tables; no docs schema changes — wiki is convention.
- No write path in the search module — read-only, no events (constitution: events on
  writes only).
- Don't modify records/docs services beyond what M6-08 already did.
- Don't build the gardener capability (post-M6: n8n workflow + wiki-maintenance skill
  per WIKI.md).
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] search finds a 6-month-old record by topic words from a descendant scope, queried
      at the client scope (tested with backdated fixture)
- [x] search spans records AND docs; kinds filter works; snippets returned (tested)
- [x] Access: viewer required on requested scope; no cross-client leakage in results
      (tested with two-client tree)
- [x] get_context on a deep sub-scope shows the ancestor wiki's index (slugs/titles) and
      the owning scope path (tested); scope with no wiki anywhere omits the section
- [x] Graduated wiki (descendant owns its own `wiki` doc) wins over the top-level one in
      the ancestor walk (tested)
- [ ] Docs tab pins wiki first; sub-scope shows inherited-wiki section (architect
      verifies in browser) — UI built, not yet live-verified in a real browser
- [x] MCP roundtrip tests for search; existing get_context assertions extended
- [x] Migration adds only indexes (no table/column changes)
