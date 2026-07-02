# packages/api/src/modules/tasks — AGENTS.md

Tasks module (M1-07): Plane CE adapter providing `create_task` / `complete_task` / `update_task` / `list_tasks`. Backed by injected Plane client; scope↔project/label mapping stored in `task_links`. All writes emit events. Uses kernel access + records for optional changelog notes.

## Purpose
Enable agents and UI to drive tasks in the system of record (Plane as backing engine). Lazy provisioning: top-level scope maps to Plane project, deeper scope maps to label `scope:<path>` within that project. MCP tools are thin wrappers.

## Tables (in packages/db)
- `task_links` (new in this module):
  - id (uuid pk)
  - scope_id (fk scopes, cascade, unique)
  - plane_project_id (text not null)
  - plane_label_id (text nullable)
  - created_at (timestamptz)
  - Unique index on scope_id

Exports from `@companyos/db`: taskLinks table, TaskLink interface, NewTaskLink type.

## Contract / Functions
All functions take injected `db: DB` first and `plane: PlaneClient` (fetch injectable for tests). Re-exported from `@companyos/api`.

- `ensureTaskTarget(db, plane, scopePath)`: idempotent lazy create. Resolves top-level ancestor for project; ensures `scope:<path>` label. Stores/returns {projectId, labelId}. Emits `tasks.target_provisioned`.
- `createTask(db, plane, {scopePath, title, description?, priority?, dueDate?}, actor)`: editor/agent; creates Plane work-item (with label); returns {id, sequenceId, url}; emits `task.created`.
- `completeTask(db, plane, {issueId, scopePath, note?}, actor)`: editor/agent; moves to a state with group="completed"; if note, writes changelog record via records service; emits `task.completed`.
- `updateTask(db, plane, {issueId, scopePath, title?, description?, state?, priority?, dueDate?}, actor)`: editor/agent; emits `task.updated`.
- `listTasks(db, plane, {scopePath, state?("open"|"completed"|"all"), limit?}, actor)`: viewer; label-scoped list; returns compact TaskSummary[].
- `findScopeByPlaneProject(db, planeProjectId, planeLabelId?)`: M2-05 webhook support; returns link result or null.

PlaneClient (in same dir): getProjects, createProject, getStates, createIssue, updateIssue, getIssue, listIssues, createLabel, listLabels. Constructor takes config + optional fetch.

Uses `requireAccess`, `emitEvent`, `getScope`, `createRecord` (records for note side-effect only).

## Files
- `src/modules/tasks/plane-client.ts` — typed injectable client.
- `src/modules/tasks/service.ts` — the functions above + ensure.
- `src/modules/tasks/AGENTS.md` — this file.
- `src/modules/tasks/tasks.test.ts` — PGlite + mocked PlaneClient tests.
- Updated: `packages/db/src/schema/tasks.ts` (additive), `packages/db/src/schema/index.ts`, new migration `0002_clever_squirrel.sql` + journal, `packages/api/src/index.ts`, `packages/api/src/errors.ts` (if needed), `packages/mcp/src/server.ts` + stdio, `packages/mcp/AGENTS.md`.

## How to test
From repo root:
- `pnpm --filter @companyos/api test`
- `pnpm --filter @companyos/mcp test`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

Tests **always** use mocked PlaneClient (never live, never read .env). Acceptance criteria are covered by tests.

## Key behaviors
- Access: viewer for list; editor/agent for create/complete/update (within grant scope or subtree for agents).
- Mapping verified: multiple subs under same top share project id, different labels.
- completeTask finds completed group state (fallback heuristic) and transitions.
- Note in complete writes changelog record.
- Events always emitted on mutations + provisioning.
- Unconfigured (missing plane in MCP) yields clear "tasks engine not configured".
- Idempotent provisioning (no duplicate projects/labels on repeat calls; verified by mock recording).

## Do not
- No direct live Plane calls in tests.
- No webhooks, no ingestion, no UI.
- Never log API tokens.
- Never modify kernel/records schema files or prior migrations.
- No cross-module imports except via records side-effect as specified (public reexports).

## Usage
```ts
import { createTask, completeTask, listTasks, PlaneClient } from "@companyos/api";
const plane = new PlaneClient({ baseUrl: "...", apiToken: "...", workspaceSlug: "..." });
const t = await createTask(db, plane, { scopePath: "airbuddy/website", title: "Fix header" }, pid);
await completeTask(db, plane, { issueId: t.id, scopePath: "airbuddy/website", note: "done" }, pid);
const open = await listTasks(db, plane, { scopePath: "airbuddy", state: "open" }, pid);
```
