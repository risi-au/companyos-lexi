# packages/api/src/modules/tasks - AGENTS.md

Tasks module (M1-07, updated M4-03): Plane CE adapter providing `create_task` / `complete_task` / `update_task` / `list_tasks`. Backed by injected Plane client; scope-to-workspace/project/label mapping is stored in `task_links`. All writes emit events. Uses kernel access + records for optional changelog notes.

## Purpose
Enable agents and UI to drive tasks in the system of record (Plane as backing engine). Lazy provisioning supports both mappings:
- Legacy fallback: top-level scope maps to one Plane project in the env-default workspace, deeper scopes map to `scope:<path>` labels inside it.
- V2 registered workspace: top-level project adopts a manually-created Plane workspace; top-level tasks use a "General" Plane project, second-level subprojects get their own Plane projects, and deeper scopes use `scope:<path>` labels inside the second-level ancestor's project.

MCP tools are thin wrappers over this service.

## Tables (in packages/db)
- `task_links`:
  - id (uuid pk)
  - scope_id (fk scopes, cascade, unique)
  - plane_project_id (text not null)
  - plane_label_id (text nullable)
  - plane_workspace_slug (text nullable; null = env-default workspace / legacy fallback)
  - created_at (timestamptz)
  - Unique index on scope_id

Exports from `@companyos/db`: taskLinks table, TaskLink interface, NewTaskLink type.

## Contract / Functions
All functions take injected `db: DB` first and `plane: PlaneClient` where Plane access is needed. Re-exported from `@companyos/api`.

- `setProjectWorkspace(db, plane, { scopePath, workspaceSlug }, actor)`: admin-only. Registers a manually-created Plane workspace on a top-level project after validating the workspace is reachable. Emits `tasks.workspace_registered`.
- `ensureTaskTarget(db, plane, scopePath)`: idempotent lazy create. Legacy fallback resolves top-level ancestor for project and ensures `scope:<path>` label. Registered-workspace mode resolves the workspace, the correct Plane project, and a deep-scope label only when needed. Stores/returns `{ projectId, labelId, workspaceSlug }`. Emits `tasks.target_provisioned`.
- `createTask(db, plane, {scopePath, title, description?, priority?, dueDate?}, actor)`: editor/agent; creates Plane work-item in the resolved workspace/project (with label when needed); returns `{ id, sequenceId, url }`; emits `task.created`.
- `completeTask(db, plane, {issueId, scopePath, note?}, actor)`: editor/agent; moves to a state with group="completed" in the resolved workspace/project; if note, writes changelog record via records service; emits `task.completed`.
- `updateTask(db, plane, {issueId, scopePath, title?, description?, state?, priority?, dueDate?}, actor)`: editor/agent; updates in the resolved workspace/project; emits `task.updated`.
- `listTasks(db, plane, {scopePath, state?("open"|"completed"|"all"), limit?}, actor)`: viewer; label-scoped list in the resolved workspace/project; returns compact TaskSummary[].
- `findScopeByPlaneProject(db, planeProjectId, planeLabelId?)`: webhook support; returns link result or null. Plane project IDs are treated as globally unique, so workspace slug is not part of the lookup key.
- `getPlaneUrl(db, scopePath)`: returns a workspace-correct Plane project URL from the scope's own `task_links` row, then the top project's row, else base URL fallback.

PlaneClient (in same dir): getProjects, createProject, getStates, createIssue, updateIssue, getIssue, listIssues, createLabel, listLabels. Constructor takes config + optional fetch. Use `plane.forWorkspace(slug)` for all non-default workspace calls; do not string-build workspace API paths outside the client.

Uses `requireAccess`, `emitEvent`, `getScope`, `createRecord` (records for note side-effect only).

## Files
- `src/modules/tasks/plane-client.ts` - typed injectable client.
- `src/modules/tasks/service.ts` - the functions above + ensure.
- `src/modules/tasks/AGENTS.md` - this file.
- `src/modules/tasks/tasks.test.ts` - PGlite + mocked PlaneClient tests.
- Updated: `packages/db/src/schema/tasks.ts`, latest task_links migration + journal, `packages/api/src/index.ts`.

## How to test
From repo root:
- `pnpm --filter @companyos/api test`
- `pnpm --filter @companyos/mcp test`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

Tests always use mocked PlaneClient (never live, never read .env). Acceptance criteria are covered by tests.

## Key Behaviors
- Access: viewer for list; editor/agent for create/complete/update; admin for workspace registration.
- Legacy fallback mapping verified: multiple subs under same top share project id, different labels, null workspace slug.
- Registered workspace mapping verified: top-level uses "General", second-level subprojects use their own Plane project, deeper scopes use labels.
- completeTask finds completed group state (fallback heuristic) and transitions.
- Note in complete writes changelog record.
- Events always emitted on mutations + provisioning/registration.
- Unconfigured (missing plane in MCP) yields clear "tasks engine not configured".
- Idempotent provisioning (no duplicate projects/labels on repeat calls; verified by mock recording).
- Webhook registration is per Plane workspace and manual for now. When a project workspace is adopted, configure Plane webhooks in that workspace manually; M4-04 provisioning will make this an onboarding step.

## Do Not
- No direct live Plane calls in tests.
- No webhook auto-registration or ingestion in this module task.
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
