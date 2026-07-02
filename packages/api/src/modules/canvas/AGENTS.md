# packages/api/src/modules/canvas — AGENTS.md

Canvas module (M3-03): per-scope Excalidraw scenes stored as jsonb. Slug unique per scope, soft archive, 2MB scene size cap. No revisions in v1. Agents + HTTP + UI use same service. Every write emits event.

## Purpose
Excalidraw canvas per scope for process maps etc. Scene = { elements, appState, files? } JSON. save (upsert), get, list (excl archived), archive. Access via kernel grants. 2MB cap with typed error.

## Tables (in packages/db)
- `canvases` (new):
  - id (uuid pk)
  - scope_id (fk scopes, cascade)
  - slug (text not null; [a-z0-9-]+ ; unique per scope_id)
  - name (text not null)
  - scene (jsonb not null default {})
  - updated_by (fk principals)
  - created_at, updated_at (timestamptz)
  - archived_at (timestamptz nullable) — soft delete; list excludes by default
  - unique: canvases_scope_slug_unique on (scope_id, slug)
  - idx: canvases_scope_updated_idx
Exports from `@companyos/db`: canvases, Canvas, NewCanvas.

## Contract / Functions
All take `db: DB` first. Re-exported from `@companyos/api`.

- `saveCanvas(db, {scopePath, slug?, name, scene?}, actor)`: editor/agent. Size checked <=2MB (CanvasSizeError). Slug auto from name + collision suffix -2 etc if omitted. Upsert by (scope,slug). Emits `canvas.saved`.
- `getCanvas(db, {scopePath, slug}, actor)`: viewer. Returns full or null. (archived fetchable)
- `listCanvases(db, {scopePath, includeArchived?}, actor)`: viewer. Returns {id,slug,name,updatedAt}[]. Excludes archived unless flag.
- `archiveCanvas(db, {scopePath, slug}, actor)`: editor/agent. Sets archived_at. Emits `canvas.archived`.

Uses kernel: getScope, requireAccess (viewer read, editor+agent write), emitEvent.

## Files
- `src/modules/canvas/service.ts`
- `src/modules/canvas/AGENTS.md`
- `src/modules/canvas/canvas.test.ts` (PGlite)
- Updated: `packages/db/src/schema/canvases.ts`, `packages/db/src/schema/index.ts`, new migration 0007, `packages/api/src/errors.ts` (CanvasNotFoundError, CanvasSizeError), `packages/api/src/index.ts`, `packages/mcp/src/server.ts`, `packages/mcp/AGENTS.md`, `apps/os/src/app/api/v1/canvas/route.ts`, UI in `apps/os/src/modules/canvas/`, lib/api + scope tab.

## How to test
- `pnpm --filter @companyos/api test`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

Tests cover: access matrix, save/get/list roundtrip (scene jsonb intact), slug collision suffix, size cap (2MB), archive hides, events, MCP tools, HTTP.

## Key behaviors
- Scene jsonb roundtrips exactly.
- Every mutation emits event (canvas.saved / canvas.archived).
- Slug unique + auto suffix on default.
- Archive soft.
- 2MB cap: throw CanvasSizeError before write.
- Access: viewer read/list/get; editor write/archive.

## Do not
- No realtime, no revisions, no image uploads into scenes (elements JSON only).
- Never touch other module schemas.
- No direct DB outside services.
- Update this AGENTS.md with changes.

## Usage
```ts
import { saveCanvas, getCanvas, listCanvases, archiveCanvas } from "@companyos/api";
const c = await saveCanvas(db, { scopePath: "acme", name: "Process", scene: {elements: [], appState: {}} }, principal);
const got = await getCanvas(db, { scopePath: "acme", slug: c.slug }, principal);
await archiveCanvas(db, { scopePath: "acme", slug: c.slug }, principal);
```
