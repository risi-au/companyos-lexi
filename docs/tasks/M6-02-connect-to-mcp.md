# M6-02: "Connect to MCP" (per-scope connect panel)

status: done — implemented 2026-07-06 (codex for schema/service/tests, grok for
service completion + HTTP integration test, architect for the UI panel + scope-page
mount after repeated implementer dispatches stalled on the UI half). Root cause of the
stalls: codex kept exhausting its turn budget on broad directory enumeration (no `rg`
in its sandbox) instead of targeted reads; grok ran out of usage credits (402) mid-task.
Architect wrote apps/os/src/modules/connect/ConnectPanel.tsx and wired it into the scope
page after finding a prop-shape mismatch left by a stray still-running codex process
(see AGENTS.md files for final contract). All acceptance criteria met except the final
staging live-verify, done separately after merge.
module: packages/api (new module `connect`) + apps/os
branch: task/M6-02

## Goal

Every scope page gets a "Connect to MCP" panel: an authorized user mints a scoped agent
token, copies a ready-to-paste config snippet for their tool, and has a working remote
agent connection in under one minute — with no possibility of minting beyond their own
access.

## Context

- M6-01 shipped `MCP_PUBLIC_URL` (`${COMPANYOS_URL}/api/mcp`) and per-request HTTP auth.
- Kernel (verified): `issueToken({principalId, name, expiresAt?})`, `grantRole`,
  `revokeToken`, `resolveAccess`, `listGrants`. Provisioning already follows the
  agent-principal + grant + token pattern (`provisionScope` returns plaintext once with
  `storeNow: true`) — expose that à la carte, not via full provisioning.
- Role ranks live in `kernel/grants.ts` (agent ranks with editor).
- UI module precedent: apps/os modules agent/canvas/dashboards/docs — panel follows
  DESIGN-SYSTEM tokens, writes via server actions → service layer.
- M6-00 decisions 1 (no escalation), 2 (dedicated agent principal per mint), 10
  (mint is first-time/renewal only; token then lives in client config).

## Permission matrix (M6-00 decision 11 — the actor's kernel grant role on the scope)

| Role on scope | See connections | Mint | Revoke own mints | Revoke others' tokens |
|---------------|-----------------|------|------------------|-----------------------|
| viewer        | yes (read-only) | no   | no               | no                    |
| editor        | yes             | yes (≤ own role) | yes  | no                    |
| admin         | yes             | yes  | yes              | yes (single here; bulk in M6-03) |

No separate mint-permission setting anywhere — the grant role IS the control.

## Do — API (`packages/api/src/modules/connect/`)

0. New module-owned table `connections` (packages/db, new schema file + migration):
   `id`, `token_id` (unique, fk tokens cascade), `scope_id` (fk scopes), `minted_by`
   (fk principals), `created_at`. Records who minted what, where — kernel has no
   minted_by (verified), and "editor revokes own mints only" needs it. NOT a kernel
   schema change; connect module owns it.
1. `mintConnectionToken(db, { scopePath, name, role, expiresAt? }, actorPrincipalId)`
   - Require actor's resolved role on `scopePath` ≥ requested `role` (and ≥ editor to mint
     at all). Requested role limited to `agent | viewer`.
   - Create `principal(kind=agent, name=<connection name>)`; `grantRole` on the target
     scope ONLY; `issueToken` with expiry.
   - Insert the `connections` row (minted_by = actor) in the same transaction.
   - Return `{ token: plaintext, storeNow: true, tokenId, principalId, expiresAt }` —
     plaintext returned once, never persisted or logged.
   - Emit `connection.minted` (payload: scopePath, role, tokenId, name, expiresAt).
2. `listConnectionTokens(db, { scopePath }, actor)` — viewer+ on scope. Tokens whose
   connection principals hold a grant on this scope (join tokens → principals → grants):
   name, principal name, role, createdAt, expiresAt, lastUsedAt, revoked. Never leak
   tokens from scopes outside the actor's visible subtree.
3. `revokeConnectionToken(db, { tokenId }, actor)` — per the matrix: editor on the
   token's scope may revoke only if `connections.minted_by = actor`; admin on the scope
   may revoke any token there. Emit `connection.revoked`.
4. Expiry presets are a UI concern; service takes an absolute `expiresAt?`.

## Do — UI (apps/os)

"Connect to MCP" panel/section on every scope page:

1. Mint form: name, role (`agent` default | `viewer`), expiry preset (24h / **7d default**
   / 90d / none) → token shown ONCE with copy button + "you won't see this again".
2. Snippets pre-filled with `MCP_PUBLIC_URL` + the fresh token:
   - `claude mcp add companyos <url> --transport http --header "Authorization: Bearer …"`
   - VS Code / Cursor `mcp.json` block
   - Codex `config.toml` block
   - Claude Desktop connector steps (HTTP + header)
   - Note (docs only, don't automate): ChatGPT web = paste into its connector UI.
3. "This scope's connections" table: name, minted-by, role, created, expiry, last_used,
   revoke button (shown per matrix: editors on their own mints, admins on all).
4. Viewer role sees the panel read-only (docs + existing tokens, no mint/revoke) — matches
   the service gate.

## Don't

- Don't store or log plaintext tokens server-side (hash only — kernel already does this).
- Don't mint on a human principal — always a dedicated agent principal per mint.
- Don't add grant-editing UI (M5-04) or admin bulk views (M6-03).
- Don't start before M6-01 staging sign-off; snippets must use the live `MCP_PUBLIC_URL`.
- Don't touch kernel schema, provisioning, or other modules' schemas.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] Escalation rejected: viewer-on-scope cannot mint; editor cannot mint above own role;
      mint on a scope outside actor's grants denied (tested)
- [x] Revoke matrix enforced: editor revokes own mint; editor revoking another's token
      denied; admin revokes any token on the scope; viewer revokes nothing (tested)
- [x] `connections` row written transactionally with each mint (minted_by correct)
- [x] Actor with grants on N clients can list/mint for exactly those subtrees (tested)
- [x] Minted token authenticates over the M6-01 HTTP transport and has access to exactly
      the target subtree (integration test through service + transport)
- [x] Plaintext appears only in the mint return value; nowhere in DB, events, or logs
- [x] `connection.minted` / `connection.revoked` events emitted with correct scope
- [x] Revoked connection 401s on next MCP request
- [x] New module AGENTS.md written; `packages/api/src/index.ts` re-exports additive
- [ ] Architect live-verifies: mint on staging scope page → paste into a real tool →
      whoami shows the single scoped grant
