# M4-01: Structure v2 — type merge, grant-filtered navigation, instance identity, members UI
status: todo
module: kernel + web
branch: task/M4-01

## Goal
The ratified structure (DESIGN.md "Structure ratification 2026-07-03") is real: scope types are project/subproject, users see only their assigned projects, the instance has a name, and owners can assign members to projects from the UI.

## Context
- DESIGN.md §Structure ratification. Kernel enum currently: root|client|project|area. Existing data: scopes with type `client` (airbuddy) and `area`.
- Tree rendering: sidebar uses `getSubtree(root)` unfiltered — fine for owners, wrong for assigned users.
- Grants/services already enforce access on every read/write; this task changes what's *shown* + adds assignment UX.

## Do
1. **Enum migration** (kernel — pre-approved): migrate pg enum `scope_type` to values `root|project|subproject`: `client`→`project`, `area`→`subproject` (data update + enum swap in one migration; verify PGlite applies it cleanly on top of existing migrations). Update all zod schemas/types/UI labels: UI shows "Project / Client" for `project`, "Sub-project" for `subproject`. `createScope` validation: top-level (parent=root) must be `project`; nested must be `subproject`.
2. **Grant-filtered tree**: new kernel service `getVisibleTree(db, principalId)` → the subtrees the principal can see: for each top-level project, include it iff resolveAccess(principal, project) != null; root visible only to those with a root grant; owners/admins on root see everything. Sidebar + home page use it. A user with a grant only on airbuddy sees ONLY airbuddy (+ its subprojects) — no root link, and `/s/root` redirects them to their first project.
3. **Instance identity**: `INSTANCE_NAME` env (default "CompanyOS", .env.example entry; set "Brissie Digital" in .env.example comment). Sidebar header + page titles show it. Seed script: root scope name = INSTANCE_NAME when creating.
4. **Members UI** (pulls a slice of M5 forward): on each top-level project page, a "Members" tab visible to root owners/admins and project admins: list current grants on that scope (name, email, role), add member by email (must be an existing auth user/principal — invite flow is M5; helpful error otherwise) with role picker defaulting **editor**, change role, revoke. Uses existing grantRole + a new `revokeGrant` kernel service (emits `grant.revoked`). All through services.
5. Tests: enum migration applies over existing data (client→project); getVisibleTree matrix (root owner sees all; project-only user sees exactly their project; no-grant user sees nothing); revokeGrant; createScope type validation. UI verified by architect.

## Don't
- No Plane changes (M4-02). No GitHub/provisioning (M4-03). No invite emails.
- Don't touch docs/, legacy/ (DESIGN.md already updated by architect).

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Migration converts existing client/area rows; fresh PGlite + live-DB both apply cleanly
- [ ] getVisibleTree matrix tests pass; sidebar filtered (architect verifies with a second user)
- [ ] Members tab: add (default editor) / change role / revoke work through services (architect verifies live)
- [ ] Instance name renders from env
