# M4-02: Navigation v2 — project switcher + module sidebar + Task Manager link
status: todo
module: web (apps/os)
branch: task/M4-02

## Goal
Plane-style navigation: a project switcher at the top of the sidebar selects the working project; the sidebar then shows that project and its subprojects, each with direct module links. One click to any module of any subproject; one click out to the project's Plane.

## Context
- Builds on M4-01 (merged): getVisibleTree (grant-filtered), types project/subproject, INSTANCE_NAME.
- Current sidebar lists the whole tree — replace it.
- Scope pages already render tabs (Dashboard/Overview/Activity/Docs/Canvas [+Members on projects]) via `?tab=`.

## Do
1. **Project switcher** (top of sidebar, under instance name): dropdown listing the principal's visible top-level projects (from getVisibleTree). Selecting stores the choice (cookie, so SSR renders correctly) and navigates to that project's scope page. For principals with a root grant, the dropdown also contains "⌂ <INSTANCE_NAME> overview" (the root scope) as the first entry. Default selection: last used (cookie) else first visible project.
2. **Sidebar for the selected project**: a section per node, project first then each subproject (nested subprojects indented under their parent, arbitrary depth):
   - Section header = node name → links to the scope page (its default tab), active-state when current.
   - Under it, module links: Dashboard, Overview, Activity, Docs, Canvas → `/s/<path>?tab=<x>` (only render Members for the project section, per M4-01 visibility rules). Highlight the active path+tab.
3. **Task Manager link**: in the project section (below module links, with an external-link icon): "Task Manager ↗" → opens in a new tab the project's Plane URL derived from `task_links` (current mapping: `${PLANE_BASE_URL}/companyos/projects/${plane_project_id}/issues` — read mapping via a small service accessor; if no task_links row yet, fall back to `${PLANE_BASE_URL}`). Server-rendered href (PLANE_BASE_URL is server env). NOTE: M4-03 will change the mapping to workspace-per-project — isolate URL construction in ONE function (`getPlaneUrl(db, scopePath)`) in packages/api so only that changes.
4. **Root scope page** (instance overview) keeps working as a normal scope page for root-grant holders.
5. Mobile: sidebar collapses (existing pattern); switcher remains accessible.
6. Tests: getPlaneUrl fallback logic; switcher visibility rules reuse getVisibleTree tests (no new kernel logic). UI verified by architect in browser (Playwright available).

## Don't
- No Plane adapter changes (M4-03). No new modules/tabs. No breadcrumb redesign beyond what the switcher requires.
- Don't touch docs/, legacy/, kernel schema.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Switcher lists exactly the visible projects (+ overview entry for root grants); selection persists across reloads
- [ ] Sidebar shows selected project + nested subprojects with working module links and active states
- [ ] Task Manager opens the mapped Plane project in a new tab
- [ ] Clicking a project/subproject name loads its scope page with the normal tab bar
