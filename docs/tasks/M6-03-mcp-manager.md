# M6-03: MCP Manager (admin connections console)

status: done — implemented 2026-07-06 by codex (one type bug in revokePrincipalAccess's
scope-path fallback ternary was caught and fixed mid-run). Extends connect module with
listConnections (subtree or root-admin fleet-wide), revokeScopeAccess (bulk subtree,
one event), revokePrincipalAccess (offboard, gates on every scope the principal holds
a grant on). New root-admin-gated /admin/mcp console (apps/os/src/modules/mcp-manager/).
module: packages/api (`connect` module extension) + apps/os
branch: task/M6-03

## Goal

One admin surface showing every connection into the OS, with revocation at any
granularity — single token, whole person, or whole scope subtree — taking effect on the
next MCP request (guaranteed by M6-01 per-request auth). Complements the per-scope Connect
panel; this is the fleet view.

## Context

- M6-02 `connect` module: mint/list/revoke single tokens + events. Extend it — do NOT
  create a parallel module.
- M6-00 decisions 4 (active = last_used_at baseline), 5 (subtree revoke semantics),
  6 (grant editing OUT — that's M5-04 Tenant Admin; read-only grant display allowed).
- M5-04 is `status: draft` with open owner decisions. If Tenant Admin has not shipped when
  this task starts: create the minimal `/admin` shell (root-scope admin gated, per M5-04's
  proposed location) with MCP Manager as its first section; M5-04 extends the shell later.
  Coordinate copy: "edit team access" is a link/placeholder pointing at Tenant Admin.
- Kernel: `revokeToken`, `listGrants`, scopes tree walk utilities in `kernel/scopes.ts`.

## Do — API (extend `packages/api/src/modules/connect/`)

1. `listConnections(db, { scopePath?, principalId?, activeSince?, expiringWithin? }, actor)`
   - Roll up tokens + principals + grants + scope paths + `connections.minted_by`.
     Include createdAt, expiresAt, lastUsedAt, revoked status, minted-by name.
   - Visibility: root admin sees all; scope admin sees only their branch (filter by
     actor's granted subtrees). Tested for no cross-client leakage.
2. `revokeScopeAccess(db, { scopePath }, actor)` — admin on `scopePath` required. Revoke
   ALL non-revoked tokens for principals holding a grant on `scopePath` or any descendant.
   Join rule: grant's scope is within the subtree (branch semantics, same as skills scope
   matching / kernel ancestor walk — descendants included, siblings and ancestors NOT).
   Return `{ revokedCount, scopePaths: string[] }`. Emit `connection.bulk_revoked`.
3. `revokePrincipalAccess(db, { principalId }, actor)` — offboard: revoke all tokens for
   that principal. Gate: actor must be admin on every scope the principal holds grants on
   (root admin trivially passes). Emit event per M6-02 convention.
4. Optional (only if M6-01 implemented live session tracking): surface active session ids.
   `last_used_at` is the required baseline; do not build session tracking here.

## Do — UI (apps/os, `/admin/mcp`)

1. Connections table: filter by scope subtree / principal / "active in last N days"
   (last_used_at) / "expiring within N days" / revoked toggle.
2. Bulk subtree revoke with explicit confirmation naming the blast radius:
   "Revoke 14 tokens across airbuddy/digital-marketing and 3 sub-scopes?"
3. Per-person view: their grants (READ-ONLY) + all their tokens → one-click offboard.
4. "Edit team access" placeholder/link → M5-04 Tenant Admin (copy only if not shipped).

## Don't

- No grant creation/editing/deletion anywhere in this task (M5-04 owns that).
- No kernel schema changes; no new tables (M6-02's `connections` table already exists —
  read it for minted_by rollups).
- No parallel admin module if M5-04 shipped — mount inside its `/admin`.
- Don't revoke grants when revoking tokens — tokens only (the principal's grant record
  stays; a revoked-token principal with a live grant is inert until re-minted).
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] Subtree revoke hits target scope + descendants only; sibling client tokens untouched
      (tested with a two-client tree)
- [x] Scope-admin's listConnections returns only their branch (tested)
- [x] Offboard-person revokes every token of that principal across scopes (tested)
- [x] Any revoked token 401s on its next MCP request (integration with M6-01) — verified
      via authenticateToken returning null post-revoke; the authenticateToken→401 HTTP
      mapping itself was already proven in M6-01/M6-02's transport tests, unchanged here
- [x] Events emitted for single, bulk-subtree, and per-person revocations
- [x] No grant-edit affordance anywhere in the UI
- [x] Module AGENTS.md updated; additive exports only
- [ ] Architect live-verifies bulk revoke on staging kills a live agent session mid-work
