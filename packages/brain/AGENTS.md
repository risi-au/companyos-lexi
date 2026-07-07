# packages/brain - AGENTS.md

Second brain maintenance engine. Product-grade package boundary: production code imports `@companyos/api` services only. It has no UI and no direct schema imports from module tables.

## Purpose

Runs the wiki maintenance loops for M8:
- per top-level scope ingest from records, workbench events, and session wrap-ups
- update-in-place wiki page merges through `saveDoc`
- root distillation for `critical-facts`, `scope-map`, and `pattern-*` pages
- lint pass with safe auto-fixes and warning alerts
- event-triggered targeted ingest using the same code path as scheduled/manual runs

## Contract

- Exports from `@companyos/brain`.
- Callers inject DB handle, actor principal, and LLM client/config.
- LLM model names are role aliases only: `cheap` and `analysis`.
- Tests use fixture LLM clients only. No live calls and no `.env` reads in tests.
- All OS reads/writes go through `@companyos/api` services: docs, records, events, search, skills, capabilities, usage, and scopes.
- The engine loads `wiki-maintenance` via the skills module at run time.

## Public functions

- `registerBrainCapability(db, actorPrincipalId, opts?)`: idempotently registers `brain-engine` on root.
- `runBrainEngine(db, input, actorPrincipalId, deps)`: manual/scheduled ingest, lint, or backfill.
- `handleBrainEvent(db, input, actorPrincipalId, deps)`: targeted ingest for `scope.created`, `intake.provisioned`, `intake.rejected`, and `workbench.*`.
- `createLiteLlmBrainClient(config)`: production HTTP client for LiteLLM-compatible chat completion endpoints.

## Reporting

Every run reports `brain-engine` through the capabilities module with pages touched, records distilled, token counts, and partial/budget state. Lint findings emit a warning alert on the same report.

## Tests

Run from repo root:
- `node_modules/.bin/vitest run --config packages/brain/vitest.config.ts`
- `node_modules/.bin/tsc -p packages/brain/tsconfig.json --noEmit`
- `node_modules/.bin/eslint packages/brain/src/`

PGlite tests seed the database directly, but package source code must not import `@companyos/db`.
