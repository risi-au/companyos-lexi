# M4-03: Plane adapter v2 — workspace per project
status: todo
module: tasks (packages/api)
branch: task/M4-03

## Goal
Implement Plane mapping v2 (DESIGN.md "Structure ratification" §3): one Plane **workspace** per OS project, one Plane **project** per subproject (plus "General" for the OS project's own tasks). Keep everything working when a project has no dedicated workspace yet.

## Hard constraint (verified live 2026-07-03)
Plane CE's public API (`/api/v1`) has **no workspace endpoints** — `GET/POST /api/v1/workspaces/` return 404. Workspaces are created manually in the Plane UI. The OS therefore **adopts** a workspace by recording its slug, it never creates one. The API token is user-scoped and works across all workspaces its user belongs to.

## Do

1. **Schema (packages/db):** add nullable `plane_workspace_slug` to `task_links`. New drizzle migration; backfill existing rows with the current env default slug (`companyos`). Null slug on a row = "use env default".
2. **PlaneClient:** make the workspace slug per-call instead of fixed config: keep `PlaneConfig.workspaceSlug` as the *default*, add `forWorkspace(slug: string): PlaneClient` returning a client bound to that slug (same token/baseUrl/fetch). No callsite may string-build workspace URLs outside the client.
3. **Workspace registration:** new service fn `setProjectWorkspace(db, scopePath, workspaceSlug, actorPrincipalId)` — requires admin on the project, only valid on top-level projects, validates the workspace is reachable (a cheap authenticated GET, e.g. list projects in that workspace; clear error if 404/403), stores the slug on the project's `task_links` row (create row if missing, planeProjectId may stay empty until first use), emits `tasks.workspace_registered`. Export from packages/api index.
4. **ensureTaskTarget v2:** resolve the top-level project's registered workspace slug.
   - **Registered workspace:** target Plane project = the *second-level subproject's* own Plane project in that workspace, created lazily by name (adopt on name conflict, same trick as v1); for the top project itself use a lazily-created "General" Plane project. Scopes deeper than two levels use their second-level ancestor's Plane project + a `scope:<path>` label (labels stay for deep nesting only).
   - **No registered workspace:** legacy v1 behavior unchanged (one Plane project per OS project in the default workspace, labels per sub-scope). Existing tests must keep passing.
   - Store each scope's resolved link (workspace slug + plane project id + label) in its `task_links` row; keep it idempotent.
5. **getPlaneUrl v2:** `${base}/${slug}/projects/${projectId}/issues` where slug/projectId come from the scope's own task_links row, else the top project's row, else env-default slug + bare base URL fallback. (Sidebar Task Manager link keeps working through this one function — no UI changes needed.)
6. **createTask/completeTask/updateTask/listTasks:** route through the scope's resolved workspace (use `plane.forWorkspace(...)` from the task_links slug). Issue URL construction in createTask must use the resolved slug, not the config default.
7. **Webhooks:** `findScopeByPlaneProject` keys on plane project id (globally unique UUID) — verify it still resolves across workspaces and add a test. Document in the module AGENTS.md that webhook registration is per-workspace and manual for now (M4-04 provisioning will list it as an onboarding step).
8. **Tests (tasks.test.ts + mock plane):** extend the mock to be workspace-aware. Cover: setProjectWorkspace happy path + non-project rejection + unreachable workspace rejection; ensureTaskTarget in registered-workspace mode (subproject → own project, top → General, 3-deep → label); legacy fallback unchanged; getPlaneUrl with registered slug, legacy row, and no row.

## Don't
- No UI changes (sidebar already isolated behind getPlaneUrl). No provisioning automation (M4-04). No webhook auto-registration.
- Don't touch kernel schema other than the task_links migration. Don't rename existing task_links columns.
- Never call Plane's internal session-auth APIs.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] All pre-existing tasks tests pass unmodified in legacy-fallback mode
- [ ] setProjectWorkspace validates reachability and rejects non-top-level scopes
- [ ] With a registered workspace: subproject tasks land in their own Plane project, top-level tasks in "General", deep scopes get labels
- [ ] getPlaneUrl returns workspace-correct URLs for all three states (registered / legacy / none)
- [ ] Architect live check: register a manually-created workspace and create a task through it end-to-end
