# packages/api/src/modules/search - AGENTS.md

Read-only cross-module search over records and docs.

## Purpose
Provides `search(db, { scopePath, query, kinds?, limit? }, actorPrincipalId)` for agents and clients that need to find older scoped knowledge without trawling recent context. v1 uses Postgres full-text search only.

## Contract
- Requires viewer-or-better on the requested `scopePath`.
- Searches the requested scope subtree. `root` means all scopes.
- Returns typed hits from records and active docs: `type`, `id`, `title`, `scopePath`, `date`, `snippet`, plus `kind` for records and `slug` for docs.
- Default limit is 10, clamped to 50.
- After a successful search, logs a redacted usage event with result count, requested limit, kind filters, snippet budget, bytes, and estimated returned tokens. It never stores the query text or snippets in usage metadata.

## Isolation Exception
This module deliberately imports schemas from multiple modules (`records`, `documents`, `scopes`) because search is a cross-cutting read model. The only service import exception is `usage/service.ts` for redacted observability logging. It must not import other module services or emit business events.

## Files
- `service.ts` - read-only Postgres FTS implementation.
- `search.test.ts` - PGlite coverage for subtree search, docs+records, kind filters, snippets, access, cross-client leakage, and usage metadata redaction.

## Do Not
- No embeddings, pgvector, or external search infrastructure.
- No inserts, updates, deletes, or `emitEvent` except redacted `usage_events` via the usage module.
- Do not move business logic from records or docs into this module.
