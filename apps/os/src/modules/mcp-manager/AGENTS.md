# apps/os/src/modules/mcp-manager - AGENTS.md

Tenant admin UI for fleet-level MCP connection oversight. This module is UI-only: all business logic and permission checks live in `packages/api/src/modules/connect/service.ts`.

## Purpose
- Render the `/admin/mcp` root-admin console for MCP connections.
- Filter connection rows by scope subtree, principal, activity, expiry, and revoked status.
- Trigger service-backed bulk revocation for a scope subtree or an entire principal.
- Show read-only per-person access details; no grant editing is allowed here.

## Files
- `McpManagerView.tsx` client component
- `actions.ts` server actions wrapping bound `api.listConnections`, `api.revokeScopeAccess`, and `api.revokePrincipalAccess`
- `index.ts`
- Route mount: `apps/os/src/app/(app)/admin/mcp/page.tsx`

## Contract
- The route page gates visibility with `api.resolveAccess(actor, "root")` and only renders for root `admin` or `owner`.
- Server actions still rely on the API service for authoritative access checks.
- Bulk actions revoke tokens only. Grants remain read-only and unchanged.

## How to test
- API coverage lives in `packages/api/src/modules/connect/connect.test.ts`.
- App compile coverage: `pnpm typecheck` and `pnpm lint`.
