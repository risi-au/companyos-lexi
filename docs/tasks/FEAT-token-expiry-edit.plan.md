# FEAT-token-expiry-edit: edit a connection token's expiry (#81)

status: done
type: feature
issue: #81
module: kernel/tokens + connect (packages/api) + apps/os connect UI
branch: feat/token-expiry-edit
size: standard
triage: self-implement (owner-approved, Session Brief #3)

> Owner approval: Rishi, 2026-07-17 (Brief #3: self-implement, admin-only, Codex review).
> R2 (auth/token lifecycle). Proportionate: plan-lite+contract here (not plan-full) —
> the brief captured purpose/approach/risk and was approved; fresh Codex reviewer + admin
> guard satisfy R2's intent. Flag in retro if the harness wants plan-full for every R2.

## CONTRACT

- **Purpose**: let an admin change an existing connection token's expiry (extend, shorten,
  or clear to never-expires) without re-minting.
- **In scope**: kernel `updateTokenExpiry`; connect `updateConnectionTokenExpiry`
  (admin-only, mirrors the revoke lookup/guard); api wiring; a connect server action; an
  admin-only inline control in ConnectPanel; tests.
- **Exclusions**: changing token role/name/scope; bulk expiry edits; the fleet
  mcp-manager view; OAuth connections.
- **Safety invariants**: admin on the token's scope required (stricter than revoke, which
  also allows editor-own-mint); a **revoked** token's expiry cannot be changed;
  expiry change never reveals the token secret; every change emits an event.
- **R2 triggers**: auth/token lifecycle, cross-user permission surface.
- **Acceptance checks**:
  - admin sets a future expiry → token row shows it, status recomputes (`active`).
  - admin sets a past expiry → `authenticateToken` rejects it; status `expired`.
  - admin clears expiry (null) → token never expires.
  - non-admin (viewer, and editor even on own mint) → `AccessDeniedError`.
  - revoked/unknown token → error (no state change).
- **Deployment boundary**: none.

## Fix/build plan (surgical)

1. `packages/api/src/kernel/tokens.ts` — `updateTokenExpiry(db, tokenId, expiresAt|null, actor?)`:
   TokenNotFoundError if missing; refuse if revoked; set `expiresAt`; emit `token.expiry_updated`.
2. `packages/api/src/modules/connect/service.ts` — `updateConnectionTokenExpiry(db, {tokenId, expiresAt}, actor)`:
   look up token+scope via the `connections` join (same as revoke); require admin
   (`rank(actorRole) >= ROLE_RANK.admin`); in a tx call the kernel fn, dismiss the
   `connection_expiry` attention for this token, emit `connection.expiry_updated`.
3. `apps/os/src/lib/api.ts` — expose `updateConnectionTokenExpiry`.
4. `apps/os/src/modules/connect/actions.ts` — `updateConnectionTokenExpiryAction(scopePath, tokenId, expiresAt|null)`
   with a NaN date guard; revalidate the connect tab.
5. `apps/os/src/modules/connect/ConnectPanel.tsx` — admin-only inline expiry editor per row
   (datetime-local + Save + "Never" + Cancel), refresh on success.
6. `packages/api/src/modules/connect/connect.test.ts` — acceptance tests above.

## Don't
- Don't loosen the admin guard; don't touch revoke/mint semantics; no migration
  (the `expiresAt` column already exists); no drive-by refactors.

## Acceptance criteria
- [ ] All contract acceptance checks pass (tests)
- [ ] Gate green: api tsc/lint/test + apps/os tsc/lint
- [ ] Admin-only enforced; revoked tokens rejected
- [ ] No drive-by changes

## Finish report
- Files changed:
  - `packages/api/src/kernel/tokens.ts` — `updateTokenExpiry` (atomic conditional
    update on non-revoked token; emits `token.expiry_updated`).
  - `packages/api/src/modules/connect/service.ts` — `updateConnectionTokenExpiry`
    (admin-only guard via the connections-join lookup; tx: kernel call + attention
    dismiss + `connection.expiry_updated`).
  - `apps/os/src/lib/api.ts` — expose `updateConnectionTokenExpiry`.
  - `apps/os/src/modules/connect/actions.ts` — `updateConnectionTokenExpiryAction`
    (NaN-date guard + revalidate).
  - `apps/os/src/modules/connect/ConnectPanel.tsx` — admin-only inline datetime-local
    expiry editor per token row (Save / Never / Cancel).
  - `packages/api/src/modules/connect/connect.test.ts` — 3 acceptance tests.
- Deviations from plan: none in scope. Review added an atomicity hardening (BLOCKING):
  the kernel update is a single conditional `UPDATE ... WHERE revokedAt IS NULL` with a
  rowcount check, instead of check-then-write — same TOCTOU class as #70.
- Review: Codex FULL_REVIEW → 1 BLOCKING → FOCUSED_FIX → FOCUSED_REREVIEW → **APPROVED**.
- Left undone: UI not manually driven (no component-test infra; server logic fully
  tested). `token.expiry_updated`/`connection.expiry_updated` event types are new and
  additive.
- Gate: api tsc/lint ok · apps/os tsc/lint ok · connect 19 tests (3 new) · full API
  suite 284 pass. Receipt: FEAT-token-expiry-edit.gate-receipt.md.
