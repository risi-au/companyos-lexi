# packages/api/src/modules/records — AGENTS.md

Records module: the durable, scoped store for changelogs, decisions, reports, and notes. This is the first vertical module and the "structured exhaust" every agent session writes. Follows kernel patterns exactly.

## Purpose
Store markdown-bodied records per scope (with jsonb flexibility for data). All writes are audited via kernel events. Access is enforced via kernel grants (viewer for read, editor/agent for write).

## Tables (in packages/db)
- `records` (new in this module):
  - id (uuid pk)
  - scope_id (fk scopes, cascade)
  - kind (enum: changelog | decision | report | note)
  - title (text not null)
  - body_md (text not null, default '')
  - data (jsonb not null, default {})
  - author_id (fk principals, not null)
  - created_at, updated_at (timestamptz)
  - Indexes: records_scope_kind_created_idx (scope_id, kind, created_at), records_scope_created_idx (scope_id, created_at)

Exports from `@companyos/db`: records table, recordKindEnum, Record interface, NewRecord type.

## Contract / Functions
All functions take injected `db: DB` first (no globals). Re-exported from `@companyos/api`.

- `createRecord(db, {scopePath, kind, title, bodyMd?, data?}, actorPrincipalId)`: requires editor/agent on scope; inserts; emits `record.created` (payload has kind, title, recordId).
- `getRecord(db, id, actorPrincipalId)`: fetches by id; requires viewer on owning scope; returns Record | null.
- `listRecords(db, {scopePath, kind?, since?, limit? (50 default, clamped max 200)}, actorPrincipalId)`: requires viewer; newest-first by created_at; filters kind/since.
- `updateRecord(db, id, {title?, bodyMd?, data?}, actorPrincipalId)`: requires editor/agent; bumps updated_at; emits `record.updated`.
- No delete.

Uses `requireAccess`, `emitEvent`, `getScope` from kernel. Scope path → id resolution internal.

Events always emitted on mutations. No cross-module imports.

## Files
- `src/modules/records/service.ts` — the four functions above.
- `src/modules/records/AGENTS.md` — this file.
- `src/modules/records/records.test.ts` — PGlite tests (co-located for module).
- Updated: `packages/db/src/schema/records.ts`, `packages/db/src/schema/index.ts` (additive), new migration, `packages/api/src/errors.ts` (additive RecordNotFoundError), `packages/api/src/index.ts` (additive re-export).

## How to test
From repo root:
- `pnpm --filter @companyos/api test`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`

Tests use PGlite + migrationsFolder resolution (same as kernel.test.ts). Acceptance criteria become tests.

## Key behaviors
- Access: viewer read (incl get/list); editor + agent (rank eq) for create/update within granted scope/subtree.
- Agent grants work for subtree (inherited via ancestor walk).
- list newest first; limit enforced; since is inclusive gte on createdAt.
- update bumps updatedAt; partial updates allowed.
- Every write emits event with correct type + scope + principal.
- Unauthorized (no grant or insufficient role) throws AccessDeniedError.
- Nonexistent scope for create/list → appropriate error (ScopeNotFound or access).
- Nonexistent record for get/update → null or RecordNotFoundError.

## Do not
- Do not implement MCP tools (M1-05), UI, or other modules.
- Never modify kernel schema (packages/db/src/schema/kernel.ts) or existing migrations.
- No direct DB in clients; always through these services.
- Don't add delete.
- Update module AGENTS.md in same commit as behavior change.

## Usage
```ts
import { createRecord, listRecords, updateRecord, getRecord } from "@companyos/api";
const rec = await createRecord(db, { scopePath: "acme/project", kind: "note", title: "Kickoff", bodyMd: "## Notes\n..." }, principalId);
const list = await listRecords(db, { scopePath: "acme/project", kind: "note", limit: 20 }, principalId);
await updateRecord(db, rec.id, { bodyMd: "updated..." }, principalId);
```
