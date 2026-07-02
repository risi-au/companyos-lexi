# M1-07: Tasks module (Plane adapter + MCP tools)
status: todo
module: tasks
branch: task/M1-07

## Goal
Tasks work through the OS: `create_task` / `complete_task` / `update_task` / `list_tasks` MCP tools backed by a live Plane CE instance, with scope↔Plane mapping owned by the OS. This closes the M1 proof: a terminal agent finishes work and the task closes in the system of record.

## Context
- `docs/DESIGN.md` §2 item 4, §3 (Plane row), §5 (`task_links`), §6 (task tool group).
- Plane CE runs locally: base URL, API token, workspace slug come from env (`PLANE_BASE_URL`, `PLANE_API_TOKEN`, `PLANE_WORKSPACE_SLUG` — already in `.env`). Auth header: `x-api-key`. Verify current REST endpoints via web (developers.plane.so) — projects, issues, states, labels.
- Mapping strategy (DESIGN §3): **top-level scope ↔ Plane project; deeper scopes ↔ Plane label** `scope:<path>`. The adapter ensures these lazily: first task for any scope under `airbuddy` creates (once) the Plane project for `airbuddy` and the label for the exact scope path, storing ids in `task_links`.
- Module pattern: copy `modules/records/` (schema in packages/db + migration, service in packages/api/src/modules/tasks/, AGENTS.md, PGlite tests). Kernel: `requireAccess` (editor/agent write, viewer read), `emitEvent` every mutation.
- The Plane HTTP client must be injectable (constructor/param takes a `fetch`-like or client object) so unit tests mock it; PGlite covers our tables as usual.

## Do
1. Schema: extend `task_links` design — table `task_links`: id, scope_id (FK, unique), plane_project_id (text), plane_label_id (text, nullable), created_at. Generate migration.
2. `packages/api/src/modules/tasks/plane-client.ts`: minimal typed client (injectable fetch): getProjects, createProject, getStates(projectId), createIssue, updateIssue, getIssue, listIssues(projectId, filters), createLabel, listLabels. Reads config from params, not globals.
3. `packages/api/src/modules/tasks/service.ts`:
   - `ensureTaskTarget(db, plane, scopePath)` → {projectId, labelId} — lazy create per mapping strategy; idempotent; stores in task_links; emits `tasks.target_provisioned`.
   - `createTask(db, plane, {scopePath, title, description?, priority?, dueDate?}, actor)` — editor/agent; creates Plane issue (project from top-level ancestor, label for scope); emits `task.created` with plane ids in payload; returns {id, sequenceId, url}.
   - `completeTask(db, plane, {issueId, scopePath, note?}, actor)` — editor/agent; transitions issue to the project's completed-group state; if note provided, also writes a changelog record via records service ("Task X completed: note"); emits `task.completed`.
   - `updateTask(db, plane, {issueId, scopePath, title?, description?, state?, priority?, dueDate?}, actor)` — editor/agent; emits `task.updated`.
   - `listTasks(db, plane, {scopePath, state? (open|completed|all), limit?}, actor)` — viewer; project+label filtered; compact shape {id, sequenceId, title, state, assignee?, dueDate?}.
4. MCP tools in `packages/mcp` (thin, same pattern): `create_task`, `complete_task`, `update_task`, `list_tasks`. Plane client built from env at server start; if PLANE_* env missing, tools return a clear "tasks engine not configured" error (server still works for other tools).
5. Tests: PGlite + mocked Plane client covering: lazy target provisioning (once per scope, idempotent); create/complete/update/list flows; access control (viewer denied write, agent subtree rules); events emitted; completeTask with note writes changelog record. MCP round-trip tests for the 4 tools with mock client injected.
6. `packages/api/src/modules/tasks/AGENTS.md` + update `packages/mcp/AGENTS.md` tool list.

## Don't
- No webhooks/ingestion from Plane yet (separate task — needs an HTTP listener).
- No UI. Don't modify kernel/records beyond additive exports. Don't touch docs/, legacy/.
- Never log or commit the API token.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Mapping: two tasks on `airbuddy/website` and `airbuddy/meta-ads` share one Plane project (airbuddy) with two labels; verified in tests via mock call recording
- [ ] completeTask transitions to the completed state group and optionally writes the changelog record
- [ ] All 4 MCP tools round-trip in tests; unconfigured-env returns clear error instead of crash
- [ ] Every mutation emits an event; access control tested
