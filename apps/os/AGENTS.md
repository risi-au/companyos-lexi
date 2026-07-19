# apps/os — AGENTS.md

## Production image (M5-01)
- `next.config.ts` sets `output: "standalone"` so the prod OS image can run the traced Next server; `next dev` behavior is unchanged.
- `Dockerfile` has two final targets: `os` for the non-root Next standalone runtime on port 3000, and `migrate` for the delegated `@companyos/db` Drizzle migration runner.
- Keep the Dockerfile as deployment packaging only. Do not move business logic or direct DB access into `apps/os`.

Next.js (app router) tenant UI + thin HTTP API surface for agents/engines (n8n, etc).

## Purpose
- Human UI (React + design tokens from packages/ui)
- Thin HTTP API for token-authenticated agent access: API v1 routes (M2-05) plus remote MCP at `/api/mcp` (M6-01).
- All logic delegated to @companyos/api services; routes only parse + authz + forward + error shape.
- Agent tokens (cos_*) use kernel authenticateToken + requireAccess inside services.

## Auth + home routing
- Better Auth (email/password): `/sign-in`, `/sign-up`, `/change-password` (forced temp-password), sign-out in `UserMenu`. Session cookie gate in `src/middleware.ts`; real session check in `(app)/layout.tsx`.
- **Home `/`:** middleware sends anonymous users to `/sign-in` and signed-in users to **`/s/root`**. Do not reintroduce `app/(app)/page.tsx` as a pure server `redirect("/s/root")` — Next.js 15.5.x can 500 those pages (`clientReferenceManifest` missing). Fallback only: `app/page.tsx` also redirects to `/s/root`.
- Post-auth navigations must land on `/s/root` (or a safe same-origin `?redirect=` path from sign-in), not `/`.

## API surface (bearer cos_ token)
- GET/POST/DELETE /api/mcp: remote streamable MCP HTTP transport. Requires `Authorization: Bearer cos_...` on every request; route delegates to `@companyos/mcp` `createHttpHandler` and `src/lib/agent-auth.ts`.
- `/admin/mcp`: root-admin MCP connection console plus usage observability dashboard for estimated CompanyOS MCP/context overhead and context profile presets.
- POST /api/v1/metrics/write { scope, points: [...] } → writeMetrics (editor)
- POST /api/v1/records/log { scope, kind, title, body_md?, data? } → createRecord (editor)
- GET /api/v1/context?scope=... → getContextBundle markdown (viewer)
- POST /api/v1/capabilities/report-run { capability, scope?, ... } → emits capability.run_reported (token validated)
- POST /api/v1/brain/run { mode: "ingest"|"lint"|"backfill", scope?, tokenCeiling? } → root-admin/manual trigger for `@companyos/brain`; cron should call the same route
- GET /api/v1/brain/graph → root-admin session route for bounded global graph data used by `/brain`
- GET /api/v1/brain/engine → root-admin session route for brain-engine runs, lint findings, and spend used by `/brain/engine`
- `/admin/intake` → root-admin intake queue and wizard template editor; commits template markdown through `GitHubClient` and triggers skills resync.
- POST /api/v1/webhooks/plane (Plane signed, X-Plane-Signature HMAC raw-body) → emits task.completed_external / task.updated_external or webhook.unhandled
- POST /api/webhooks/github (GitHub signed, X-Hub-Signature-256 HMAC raw-body; `GITHUB_WEBHOOK_SECRET`) → delegates to workbench-events for push/PR ingestion, changelog stubs, and default-branch skills repo auto-sync when `GITHUB_ORG`, `GITHUB_TOKEN`, and `SKILLS_REPO` are configured
- GET/POST /api/v1/canvas ?scope= [&slug=] ; POST {scope, name, slug?, scene?} → canvas ops (viewer/editor)

Auth helper: src/lib/agent-auth.ts (bearer → principal, consistent {error, requires?} JSON)

Startup hook: `src/instrumentation.ts` runs on server start, skips when `DATABASE_URL` is unset, and fail-open seeds missing root `cos-*` self-doc wiki pages through `@companyos/api`.

## Files
- src/app/api/v1/.../route.ts — thin handlers only
- src/app/api/mcp/route.ts - thin mount for `@companyos/mcp` HTTP handler
- src/lib/agent-auth.ts — shared auth + error helpers for agent routes
- src/lib/api.ts — bindings + current actor for human UI paths
- src/modules/* — local UI components only (no direct db)
- src/modules/brain — root-admin brain graph client + engine trigger action
- src/modules/intake — creation wizard UI, resume card, scope Intake tab, and admin queue actions. Server actions call `@companyos/api` only.
- src/modules/credentials — scope Credential vault tab and intake setup panel. Values are write-only; server actions call `@companyos/api` only.
- Does not contain business services (see packages/api)

## How to test (routes + auth)
- Unit: auth paths + service roundtrips via packages/api tests (PGlite)
- Integration: direct Request() invocation in vitest where possible, or manual curl with valid cos_ token
- See M2-05 brief acceptance: 401/403, writes, Plane sig + event emission

## Contract
- Never raw db access here.
- Routes: validate minimally, call api services with actor from token.
- Every write path ends in service which emits event.
- Consistent error shape for agent clients: { error, requires? }

Update this file when API surface or auth wiring changes. (canvas added M3-03)

## Ops Health (M9-01)
- `/admin/health` is a root-admin-only panel for credential expiry, capability liveness, webhook/skills recency, recent run logs, and deduplicated alert email surfacing.
- It calls `@companyos/api` health services through `src/lib/api.ts`; SMTP and LiteLLM probe config stays in `src/lib/ops-health.ts`.

## Navigation (UX-08 sidebar tree + fluid shell)
- `Sidebar.tsx` is a scope-tree-only sidebar: top-level projects render as folder rows, chevron buttons toggle expansion without navigation, name clicks navigate, and `sidebar-state.ts` keeps strict one-branch accordion expansion for deep links and manual toggles. Every scope row has a stable chevron column plus a persisted plus/minus module shortcut toggle; `SIDEBAR_MODULES_STORAGE_KEY` now stores a JSON set of open scope paths while still migrating legacy `open`/`closed` values. Shortcut targets remain `/s/<path>?tab=<tab>`. The flat `system` group (Brain/Ops Health/Admin) remains gated on `rootRole` owner/admin.
- Personal scopes returned by `getVisibleTree` render as normal top-level sidebar
  entries, but the new-scope dialog parent filter only allows project/subproject
  parents (`isNewScopeParentOption`), so personal scopes cannot be selected as parents.
- Scope pages use the client `ScopeTabs` wrapper to pass Next `Link` into the shared `Tabs` primitive for soft tab navigation, wrap server-rendered tab content in the client `ScopeTabPanel` GSAP transition island, and render grant-aware linked breadcrumbs using display names rather than raw path segments.
- Archived scopes are absent from the sidebar. Direct `/s/<path>` access renders an archived notice with an admin-only Restore action; active non-root scope headers expose the admin-only Archive action. Admin Settings lists top-level archived roots with Restore controls.
- The shell (`layout.tsx`) stays an async server component and passes the rendered `<Sidebar>`/`<UserMenu>` into `AppShellChrome.tsx`, a `"use client"` wrapper that owns the mobile-drawer state and desktop sidebar resize state. Desktop content is fluid with 22px padding, the sidebar width persists in `localStorage` and clamps to 220-420px with double-click reset to 264px; below `@media (max-width: 820px)` the drawer remains the fixed 264px slide-in branch behind an `--overlay` scrim with header burger toggle, scrim/nav-link/Esc close behavior, and no resize handle.

## Navigation (UX-04, superseded by UX-08 above - kept for history)
- `Sidebar.tsx` is a real expand/collapse tree: a mono-labelled `work` group (project forest built from `Scope.path`, per-node collapse with `aria-expanded`, GSAP chevron-rotate + child stagger via `@companyos/ui` `anim()/df()/rm()`) and a flat `system` group (Brain/Ops Health/Admin, gated on `rootRole` owner/admin). The `<select>` switcher is gone; top-level project rows submit `setSelectedProject` (keeps the `nav.selectedProject` cookie), subprojects are `/s/{path}` links, and the real module set (Dashboard…Intake + conditional Members/Task Manager) renders inline under the active scope with unchanged `?tab=` targets.
- The shell (`layout.tsx`) stays an async server component and passes the rendered `<Sidebar>`/`<UserMenu>` into `AppShellChrome.tsx`, a `"use client"` wrapper that owns the mobile-drawer state: below `@media (max-width: 820px)` the aside slides in (CSS transform, 280ms) behind an `--overlay` scrim with a header burger toggle; scrim, nav-item, and Esc close it; ≥820px it is the normal fixed column.

## Navigation (M4-02, superseded by UX-04 above — kept for history)
- Sidebar replaced with project switcher (cookie-persisted via setSelectedProject action) + per-project module sidebar.
- Root owner/admin users also see a Brain nav entry for `/brain`; non-root and root-viewer users do not.
- Switcher lists visible top-level projects (via getVisibleTree) + "⌂ overview" first for root-grant users.
- Selected project section shows header + Dashboard/Overview/Activity/Docs/Canvas (+ Members for project) + Task Manager ↗ (uses api.getPlaneUrl).
- All links use /s/<path>?tab=... matching scope page tabs. Active states based on path+tab.
- Scope pages include a Credentials tab for vault metadata/add/update/delete. The Intake tab also renders the same credential setup panel with required credential names from the intake packet.
- getPlaneUrl added to @companyos/api (packages/api) for isolated URL (current /companyos/projects/${id}/issues ; fallback to PLANE_BASE_URL).
- No module cross-imports; all nav logic client thin + server layout + api service.
- "+" button beside the Project label opens NewScopeDialog (in Sidebar.tsx) → createNewScope action; parent select decides placement, type derived server-side (top level = project, nested = subproject).

## Creation Wizard Navigation
- NewScopeDialog requires a free-text reason; createNewScope stores it on the
  draft intake as answers.reason through ensureDraftIntakeForScope.
- The scope Intake tab now renders the setup flow as a 6-step shared `Stepper`
  rail: Basics, Framing, History, Interview, Review, Provision. Keep server
  action semantics in `src/modules/intake/actions.ts`; the rail is UI
  organization plus local motion/checklist/provisioning state only.
- Admin tabs/tables/cards/empty states now compose `@companyos/ui` primitives.
  Destructive admin server-action forms use the small client
  `ConfirmSubmitButton` wrapper rather than converting pages to client
  components.

## UX-01 Theme Foundations
- Root layout self-hosts Gantari plus JetBrains Mono via `next/font/local`; `--font-sans` now resolves to Gantari and `--font-mono` remains JetBrains Mono.
- Theme choice is `localStorage.theme` with `auto | light | green | charcoal`. The pre-hydration script resolves it before paint, stamps `body[data-theme]`, and toggles `.dark` on `<html>` for the dark concrete themes so unmigrated V1 token consumers still render in dark mode.
- Default with no stored preference is `auto`; this intentionally reverses the earlier dark-default decision per the locked V2 design brief.
- Shell-level new surfaces should use V2 tokens (`--bg`, `--fg`, `--raised`, `--mutedfg`, etc.) and the additive radius scale (`--radius-2`, `--radius-3`, `--radius-4`). Existing module surfaces remain on V1 tokens until their UX migration package.
- GSAP motion plumbing is exposed from `@companyos/ui/motion`; feature modules should use the shared `df()` / `rm()` / `anim()` helpers instead of creating local reduced-motion logic.


## OAuth MCP auth (FEAT-connect-oauth-pr1)
- /api/mcp accepts either a legacy cos_ bearer token or an OAuth access JWT. OAuth JWTs are verified in-process through Better Auth, must have the exact MCP endpoint audience, and map sub to principals.auth_user_id.
- Missing or invalid MCP auth returns 401 with RFC 9728 WWW-Authenticate resource metadata. Protected-resource metadata is available at both /.well-known/oauth-protected-resource paths.
- OAuth discovery is served at both `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`; both keep `authorization_response_iss_parameter_supported` false by default for Codex/rmcp compatibility.
- Better Auth uses BETTER_AUTH_URL as the preferred public origin, falling back to COMPANYOS_URL, then the origin of MCP_PUBLIC_URL. MCP_PUBLIC_URL remains the canonical explicit MCP endpoint override.
- OAuth provider endpoints, JWKS, DCR, and consent are mounted under Better Auth. The consent page is /oauth/consent and approval emits connection.authorized.


## OAuth MCP auth (FEAT-connect-oauth-pr2)
- Successful OAuth MCP calls record first/last use in the connect-owned `oauth_connections` table. The first call emits `connection.first_used`; tracking failures log and never block authentication.
