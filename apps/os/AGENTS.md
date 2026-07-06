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

## API surface (bearer cos_ token)
- GET/POST/DELETE /api/mcp: remote streamable MCP HTTP transport. Requires `Authorization: Bearer cos_...` on every request; route delegates to `@companyos/mcp` `createHttpHandler` and `src/lib/agent-auth.ts`.
- POST /api/v1/metrics/write { scope, points: [...] } → writeMetrics (editor)
- POST /api/v1/records/log { scope, kind, title, body_md?, data? } → createRecord (editor)
- GET /api/v1/context?scope=... → getContextBundle markdown (viewer)
- POST /api/v1/capabilities/report-run { capability, scope?, ... } → emits capability.run_reported (token validated)
- POST /api/v1/webhooks/plane (Plane signed, X-Plane-Signature HMAC raw-body) → emits task.completed_external / task.updated_external or webhook.unhandled
- POST /api/webhooks/github (GitHub signed, X-Hub-Signature-256 HMAC raw-body; `GITHUB_WEBHOOK_SECRET`) → delegates to workbench-events for push/PR ingestion and changelog stubs
- GET/POST /api/v1/canvas ?scope= [&slug=] ; POST {scope, name, slug?, scene?} → canvas ops (viewer/editor)

Auth helper: src/lib/agent-auth.ts (bearer → principal, consistent {error, requires?} JSON)

## Files
- src/app/api/v1/.../route.ts — thin handlers only
- src/app/api/mcp/route.ts - thin mount for `@companyos/mcp` HTTP handler
- src/lib/agent-auth.ts — shared auth + error helpers for agent routes
- src/lib/api.ts — bindings + current actor for human UI paths
- src/modules/* — local UI components only (no direct db)
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

## Navigation (M4-02)
- Sidebar replaced with project switcher (cookie-persisted via setSelectedProject action) + per-project module sidebar.
- Switcher lists visible top-level projects (via getVisibleTree) + "⌂ overview" first for root-grant users.
- Selected project section shows header + Dashboard/Overview/Activity/Docs/Canvas (+ Members for project) + Task Manager ↗ (uses api.getPlaneUrl).
- All links use /s/<path>?tab=... matching scope page tabs. Active states based on path+tab.
- getPlaneUrl added to @companyos/api (packages/api) for isolated URL (current /companyos/projects/${id}/issues ; fallback to PLANE_BASE_URL).
- No module cross-imports; all nav logic client thin + server layout + api service.
- "+" button beside the Project label opens NewScopeDialog (in Sidebar.tsx) → createNewScope action; parent select decides placement, type derived server-side (top level = project, nested = subproject).
