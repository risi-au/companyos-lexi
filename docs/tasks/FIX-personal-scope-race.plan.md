# FIX-personal-scope-race: ensurePersonalScope races on first sign-up

status: done
type: bug
issue: #70
module: kernel (packages/api/src/kernel)
branch: fix/personal-scope-race
size: standard
triage: self (owner waiver — fix smaller than a worker packet)

> TRIP bugfix plan. Diagnosis before patch. No production code in this file.
> Owner approval: Rishi, 2026-07-17 (Session Brief approved; self-implement + Codex review)

## Risk profile

R2 — concurrency + auth/first-session path. Trigger: two concurrent renders race an
INSERT. Blast radius small (one kernel function + one additive catch). No schema/API
change, no migration, reversible.

## Symptom

On a fresh sign-up, the sign-up POST succeeds but the first page render 500s:

    Failed query: insert into "scopes" ... duplicate key value violates unique
    constraint "scopes_path_unique"
      at createScope (packages/api/src/kernel/scopes.ts:95)
      at ensurePersonalScope (packages/api/src/kernel/personal.ts:43)
      at linkAuthUser (packages/api/src/kernel/auth-link.ts:94)

Recovers on reload (scope now exists). First-session UX shows an error page. (#70)

## Repro

Two concurrent `linkAuthUser` / `ensurePersonalScope` calls for the same new
principal (React double-render / concurrent requests on first sign-up). Both find no
personal scope, both attempt to create it; the second INSERT violates
`scopes_path_unique`.

## Minimise

Smallest failing path: `createScope` (`packages/api/src/kernel/scopes.ts`) uses
**check-then-insert**:

1. pre-check `SELECT ... where path = X` → throws `DuplicatePathError` if a row exists
2. `INSERT` (line 95)

`ensurePersonalScope` (`personal.ts:42-58`) already catches `DuplicatePathError` and
recovers (re-select + `ensureOwnerGrant`). Not involved: grants, events, the schema.

## Root cause

TOCTOU race. `DuplicatePathError` is raised **only** by the pre-check SELECT. Under
true concurrency both callers pass the pre-check, then the losing INSERT throws a raw
Postgres `23505` — which is **not** a `DuplicatePathError`, so `ensurePersonalScope`'s
recovery catch (`if (!(error instanceof DuplicatePathError)) throw error`) re-throws
it and the render 500s. The existing catch only covers the *sequential* duplicate.

## Fix plan (surgical)

### 1. Translate the INSERT-level unique violation into DuplicatePathError

**File**: `packages/api/src/kernel/scopes.ts`

- Add a local `isUniqueViolation(error)` helper mirroring `intake/service.ts:138`
  (walk `.cause` chain up to depth 3 for `code === "23505"`). Kernel must not import
  from a module, so the 6-line helper is duplicated intentionally.
- Wrap the `INSERT` in try/catch; on `isUniqueViolation` throw `DuplicatePathError(path)`.
- **Keep** the pre-check SELECT: it gives clean sequential errors and avoids aborting
  any surrounding transaction on the common path. The catch is purely additive — it
  changes behaviour only when the insert actually collides (the race), so
  `ensurePersonalScope`'s existing recovery now handles the race too.

Verify: existing sequential `DuplicatePathError` behaviour unchanged; concurrent
create surfaces `DuplicatePathError` (recoverable), not a raw 500.

## Regression test

- Red-first: N concurrent `ensurePersonalScope` calls for one new principal.
  - Old code: at least one INSERT hits raw `23505` → unhandled → rejects (RED).
  - New code: translated → recovered; all resolve, exactly one scope + one owner
    grant, all return the same scopePath (GREEN).
- Path: `packages/api/src/kernel/scopes.race.test.ts` (PGlite, mirrors auth-link.test.ts setup).

## Files to modify

| Path | Change |
|---|---|
| `packages/api/src/kernel/scopes.ts` | add `isUniqueViolation`; try/catch translate INSERT `23505` → `DuplicatePathError` |
| `packages/api/src/kernel/scopes.race.test.ts` | new concurrency regression test |

## Don't

- Remove the pre-check (tx-abort risk in provisioning callers).
- Touch provisioning / intake / ensurePersonalScope recovery logic.
- Refactor the duplicated `isUniqueViolation` into a shared util (drive-by).

## Acceptance criteria

- [ ] Concurrency repro no longer 500s (test red on old, green on new)
- [ ] Regression test covers the race
- [ ] Gate green: typecheck + lint + test (packages/api)
- [ ] No drive-by file changes

## Finish report

- Files changed:
  - `packages/api/src/kernel/scopes.ts` — `createScope` INSERT now
    `.onConflictDoNothing({ target: scopes.path })`; empty return → `DuplicatePathError`.
  - `packages/api/src/kernel/grants.ts` — `grantRole` is now a single atomic upsert
    (`.onConflictDoUpdate` on `(principalId, scopeId)`), replacing check-then-insert/update.
  - `packages/api/src/kernel/scopes.race.test.ts` — new concurrency regression (red→green).
  - `docs/tasks/FIX-personal-scope-race.{plan,gate-receipt}.md` — plan + receipt.
- Deviations from plan:
  1. **Scope expanded to `grantRole` (auth/grants)** — the regression test revealed a
     twin TOCTOU race one layer down (`grants_principal_scope_unique`); the scope-only
     fix left #70's 500 intact. Owner approved the extension 2026-07-17.
  2. **Approach changed from catch-`23505` to `ON CONFLICT`** — Codex FULL_REVIEW
     flagged (BLOCKING ×2) that catching a raised unique violation aborts a surrounding
     transaction, so the recovery re-select would fail for any transactional caller.
     `ON CONFLICT` avoids raising the error entirely: atomic, transaction-safe, and it
     removes the TOCTOU window rather than papering over it. The `isUniqueViolation`
     helper introduced mid-work was removed (no longer needed).
- Review: FULL_REVIEW (Codex @ medium) → 2 BLOCKING → FOCUSED_FIX → FOCUSED_REREVIEW
  → R1 RESOLVED, R2 RESOLVED, no new issues, **VERDICT: APPROVED**.
- Left undone: none for #70. (Note: `intake/service.ts` still has its own local
  `isUniqueViolation`; unrelated to this fix.)
- Gate: typecheck ok | lint ok | tests 282 passed (27 files); see gate-receipt.md.
