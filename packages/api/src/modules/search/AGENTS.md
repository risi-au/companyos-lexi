# packages/api/src/modules/search - AGENTS.md

Read-only cross-module search over records and docs.

## Purpose
Provides `search(db, { scopePath, query, kinds?, limit?, mode? }, actorPrincipalId)` for agents and clients that need to find older scoped knowledge without trawling recent context. Search supports `keyword`, `semantic`, and `hybrid` modes; default is `hybrid`.
The intake creation wizard uses hybrid search for related-history candidates, then
stores only selected references on the intake row.

## Contract
- Requires viewer-or-better on the requested `scopePath`.
- Searches the requested scope subtree. `root` means all scopes.
- Returns typed hits from records and active docs: `type`, `id`, `title`, `scopePath`, `date`, `snippet`, plus `kind` for records and `slug` for docs.
- Default limit is 10, clamped to 50.
- `keyword` is Postgres full-text search. `semantic` uses pgvector embeddings when available. `hybrid` fuses keyword and vector candidates with reciprocal rank fusion.
- If embeddings do not exist for the subtree or LiteLLM alias `embed` is unconfigured/unavailable, semantic and hybrid calls fall back to keyword behavior without storing raw query text.
- After a successful search, logs a redacted usage event with result count, requested limit, kind filters, snippet budget, bytes, and estimated returned tokens. It never stores the query text or snippets in usage metadata.

## Isolation Exception
This module deliberately imports schemas from multiple modules (`records`, `documents`, `scopes`, `embeddings`) because search is a cross-cutting read model. Service import exceptions are `usage/service.ts` for redacted observability logging and `lib/embeddings.ts` for query embedding/fallback checks. It must not emit business events.

## Files
- `service.ts` - read-only keyword/vector/hybrid implementation.
- `search.test.ts` - PGlite coverage for subtree search, docs+records, kind filters, snippets, access, cross-client leakage, usage metadata redaction, vector fallback, and hybrid ranking.
- `packages/api/src/lib/embeddings.ts` - LiteLLM `embed` alias client, hash-skip upsert, fail-open logging, and backfill service.

## Do Not
- No external search infrastructure or vector DB; pgvector in Postgres only.
- No inserts, updates, deletes, or `emitEvent` from the search service. Embedding writes live in `lib/embeddings.ts`.
- Do not move business logic from records or docs into this module.
