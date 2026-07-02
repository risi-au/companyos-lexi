# M1-04: Records module
status: done
module: records
branch: task/M1-04

## Goal
The record store — changelogs, decisions, reports, notes per scope — exists as the first true vertical module: its own schema, services, tests, and AGENTS.md. This is the "structured exhaust" every agent session writes.

## Context
- `docs/DESIGN.md` §5 (records table) and §2 items 5 (record store) — the durable memory of the system.
- Kernel services are merged (`packages/api/src/kernel/*`): use `requireAccess` (editor/agent for writes, viewer for reads), `emitEvent` for every mutation, scopes for path→id resolution.
- Module pattern: this is the template all later modules copy. Schema lives in `packages/db/src/schema/records.ts` (new migration), services in `packages/api/src/modules/records/`, and a module `AGENTS.md` in that folder.

## Do
1. Schema `packages/db/src/schema/records.ts`:
   - `records`: id (uuid pk), scope_id (FK, not null, cascade), kind (enum: changelog|decision|report|note), title (text, not null), body_md (text, not null, default ''), data (jsonb, default {}), author_id (FK principals, not null), created_at, updated_at.
   - Indexes: (scope_id, kind, created_at desc); (scope_id, created_at desc).
   - Generate + commit migration. Export table + types.
2. Services `packages/api/src/modules/records/service.ts` (db-handle injection, same pattern as kernel):
   - `createRecord(db, {scopePath, kind, title, bodyMd, data?}, actorPrincipalId)` — requireAccess editor-or-agent; emits `record.created` with kind in payload.
   - `getRecord(db, id, actorPrincipalId)` — requireAccess viewer on the record's scope.
   - `listRecords(db, {scopePath, kind?, since?, limit? (default 50, max 200)}, actorPrincipalId)` — viewer; newest first.
   - `updateRecord(db, id, {title?, bodyMd?, data?}, actorPrincipalId)` — editor-or-agent; bumps updated_at; emits `record.updated`.
   - No delete (records are the audit trail). 
3. Module `AGENTS.md` in `packages/api/src/modules/records/`: purpose, tables, functions, how to test.
4. Tests (PGlite): create/list/filter by kind/since/limit ordering; viewer can read but not write; agent principal with agent grant can create within subtree but not outside; unauthorized principal denied; events emitted per mutation; updateRecord bumps updated_at.

## Don't
- No MCP tools yet (M1-05). No UI. No other module tables.
- Don't modify kernel schema/services except additive exports if genuinely required (flag it in commit body if so).
- Don't touch apps/, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] New migration applies cleanly on top of 0000 in tests
- [ ] Access control enforced through kernel `requireAccess` (tested for viewer/editor/agent/none)
- [ ] Every mutation emits an event (tested)
- [ ] Module folder contains AGENTS.md following the pattern
