# M1-02: Kernel schema + migrations
status: done
module: kernel
branch: task/M1-02

## Goal
The six kernel tables exist as Drizzle schemas with generated SQL migrations and pass tests against an in-memory Postgres — the foundation every module builds on.

## Context
- `docs/DESIGN.md` §5 (data model — kernel section) is the specification. Follow it exactly.
- `packages/db` is scaffolded (Drizzle + postgres-js, empty schema dir).
- No real Postgres server is available in dev/CI yet: tests must use **PGlite** (`@electric-sql/pglite` with drizzle's pglite driver) in-memory; runtime connection stays postgres-js via `DATABASE_URL`.

## Do
1. In `packages/db/src/schema/kernel.ts`, define Drizzle tables:
   - `scopes`: id (uuid pk), parent_id (self-FK, null for root), slug, path (unique, e.g. `airbuddy/marketing/meta-ads`), name, type (enum: root|client|project|area), status (enum: active|archived), settings (jsonb, default {}), created_at, updated_at.
   - `principals`: id, kind (enum: human|agent), name, email (nullable), status (enum: active|disabled), created_at.
   - `grants`: id, principal_id (FK), scope_id (FK), role (enum: owner|admin|editor|viewer|agent), created_at; unique(principal_id, scope_id).
   - `tokens`: id, principal_id (FK), name, token_hash (unique), expires_at (nullable), last_used_at (nullable), created_at, revoked_at (nullable).
   - `module_instances`: id, scope_id (FK), module_type (text), config (jsonb, default {}), position (int), created_at; unique(scope_id, module_type).
   - `events`: id (bigserial pk), type (text, e.g. `scope.created`), scope_id (FK, nullable), principal_id (FK, nullable), payload (jsonb), created_at. Index on (scope_id, created_at) and (type, created_at).
2. Generate SQL migrations with drizzle-kit into `packages/db/drizzle/`; commit them.
3. Seed script: creates the root scope (path `root`, type root), one human principal (env-configurable name/email), an owner grant on root. Idempotent (upsert by path/email).
4. Tests (vitest + PGlite): migrations apply cleanly; inserting a scope tree of depth 4 works; unique path constraint fires; grants unique constraint fires; events insert with jsonb payload; seed is idempotent (run twice, same row counts).
5. Export typed table objects + inferred types from `packages/db` index.

## Don't
- No service-layer logic (grant resolution, tree walking, auth) — that's M1-03 in `packages/api`.
- No module tables (records, documents, metrics, …) — later tasks.
- Don't touch apps/, packages/ui, packages/mcp, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from repo root
- [ ] Generated SQL migration files committed and apply cleanly to PGlite in tests
- [ ] All six tables match DESIGN.md §5 kernel spec (names, constraints, enums as listed above)
- [ ] Seed idempotency test passes
- [ ] `packages/db` exports typed schemas usable by `packages/api`
