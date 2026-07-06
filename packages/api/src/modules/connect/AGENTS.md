# packages/api/src/modules/connect - AGENTS.md

Connect module (M6-02, extended by M6-03): module-owned records for per-scope remote MCP connection tokens. The kernel still owns principals, grants, tokens, and token authentication; this module records which actor minted each scoped token so revoke permissions can be enforced and root/scope admins can audit or bulk-revoke MCP access.

## Purpose
Expose scoped MCP token mint/list/revoke services for the OS UI and future MCP/API clients. Each mint creates a dedicated `agent` principal, grants it only on the target scope, issues one token, and writes a `connections` row in the same transaction. Plaintext is returned once from `mintConnectionToken` and is never persisted.

## Tables
- `connections` in `packages/db/src/schema/connect.ts`
  - `id` uuid primary key
  - `token_id` unique fk `tokens.id` cascade
  - `scope_id` fk `scopes.id` cascade
  - `minted_by` fk `principals.id` cascade
  - `created_at` timestamptz

## Contract / Functions
All functions take `db: DB` first and are re-exported from `@companyos/api`.

- `mintConnectionToken(db, { scopePath, name, role, expiresAt? }, actor)`: actor must resolve to editor-or-better and rank at least the requested role. Requested role is limited to `agent | viewer`. Creates a dedicated agent principal, grants only the target scope, issues a token, inserts `connections`, emits `connection.minted`, returns `{ token, storeNow: true, tokenId, principalId, expiresAt }`.
- `listConnectionTokens(db, { scopePath }, actor)`: viewer-or-better. Lists connection tokens for exactly that scope with name, principal name, minted-by name, role, created/expiry/last-used, revoked, and `canRevoke`.
- `revokeConnectionToken(db, { tokenId }, actor)`: editor can revoke only own mints; admin/owner can revoke any connection on the token scope. Emits `connection.revoked`.
- `listConnections(db, { scopePath?, principalId?, activeSince?, expiringWithin? }, actor)`: admin/owner on the requested scope subtree, or root admin/owner for fleet-wide listing. Returns admin rows with `scopePath` and no UI-specific `canRevoke`.
- `revokeScopeAccess(db, { scopePath }, actor)`: admin/owner on `scopePath`. Revokes all non-revoked connection tokens minted for that scope or descendants in one transaction and emits one `connection.bulk_revoked` event.
- `revokePrincipalAccess(db, { principalId }, actor)`: offboards one principal by revoking every non-revoked token for that principal. The actor must be admin/owner on every scope where that principal has a grant. Emits one `connection.bulk_revoked` event.

## Files
- `service.ts`
- `connect.test.ts`
- `AGENTS.md`
- DB schema: `packages/db/src/schema/connect.ts`
- Migration: `packages/db/drizzle/0014_connect_connections.sql`

## Events
- `connection.minted` payload: `scopePath`, `role`, `tokenId`, `name`, `expiresAt`
- `connection.revoked` payload: `tokenId`, `scopePath`
- `connection.bulk_revoked` payload for subtree revoke: `scopePath`, `revokedCount`, `scopePaths`
- `connection.bulk_revoked` payload for principal offboard: `principalId`, `revokedCount`, `scopePaths`

Payloads must never contain plaintext tokens.

## How to test
- `pnpm --filter @companyos/api test -- connect`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

Tests cover mint escalation denial, subtree boundaries, admin listing filters, revoke matrix, bulk subtree revoke, principal offboarding, connection row writes, events, token authentication after revoke, and plaintext redaction from DB/events/logs.

## Do / Don't
- Do use kernel `grantRole`, `issueToken`, `revokeToken`, `resolveAccess`, and `emitEvent`.
- Do not change kernel schema or token helper signatures.
- Do not store plaintext tokens in any table, event, log, or module state.
- Do not revoke grants when revoking tokens.
- Do not add grant creation/editing/deletion UI in this module.
