# apps/os/src/modules/mcp-manager - AGENTS.md

Tenant admin UI for fleet-level MCP connection oversight and usage observability. This module is UI-only: all business logic and permission checks live in `packages/api/src/modules/connect/service.ts` and `packages/api/src/modules/usage/service.ts`.

## Purpose
- Render the `/admin/mcp` root-admin console for MCP connections.
- Filter connection rows by scope subtree, principal, activity, expiry, and revoked status.
- Trigger service-backed bulk revocation for a scope subtree or an entire principal.
- Show read-only per-person access details; no grant editing is allowed here.
- Render usage filters, grouped summaries, session drill-down rows, deterministic trim recommendations, and context profile preset controls.

## Files
- `McpManagerView.tsx` client component
- `UsageDashboardView.tsx` client component
- `actions.ts` server actions wrapping bound connection and usage APIs
- `index.ts`
- Route mount: `apps/os/src/app/(app)/admin/mcp/page.tsx`

## Contract
- The route page gates visibility with `api.resolveAccess(actor, "root")` and only renders for root `admin` or `owner`.
- Server actions still rely on the API service for authoritative access checks.
- Bulk actions revoke tokens only. Grants remain read-only and unchanged.
- Usage rows are displayed as estimated overhead unless actual token/cost fields exist in the service result. The UI must not show raw prompts, responses, bearer tokens, or document bodies.
- Context profile preset changes call the usage service and emit `usage.profile_updated`.

## How to test
- API coverage lives in `packages/api/src/modules/connect/connect.test.ts`.
- Usage coverage lives in `packages/api/src/modules/usage/usage.test.ts` and MCP HTTP tests.
- App compile coverage: `pnpm typecheck` and `pnpm lint`.
