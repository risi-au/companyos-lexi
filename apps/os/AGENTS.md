# apps/os — AGENTS.md

Next.js (app router) tenant UI + thin HTTP API surface for agents/engines (n8n, etc).

## Purpose
- Human UI (React + design tokens from packages/ui)
- Thin HTTP API v1 for token-authenticated agent access (M2-05): metrics write, records log, context bundle, capability run reporting (stub), Plane webhooks.
- All logic delegated to @companyos/api services; routes only parse + authz + forward + error shape.
- Agent tokens (cos_*) use kernel authenticateToken + requireAccess inside services.

## API surface (bearer cos_ token)
- POST /api/v1/metrics/write { scope, points: [...] } → writeMetrics (editor)
- POST /api/v1/records/log { scope, kind, title, body_md?, data? } → createRecord (editor)
- GET /api/v1/context?scope=... → getContextBundle markdown (viewer)
- POST /api/v1/capabilities/report-run { capability, scope?, ... } → emits capability.run_reported (token validated)
- POST /api/v1/webhooks/plane (Plane signed, X-Plane-Signature HMAC raw-body) → emits task.completed_external / task.updated_external or webhook.unhandled

Auth helper: src/lib/agent-auth.ts (bearer → principal, consistent {error, requires?} JSON)

## Files
- src/app/api/v1/.../route.ts — thin handlers only
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

Update this file when API surface or auth wiring changes.
