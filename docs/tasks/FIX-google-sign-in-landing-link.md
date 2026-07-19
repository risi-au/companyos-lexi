# FIX-google-sign-in-landing-link: Safe Google linking and personal-scope landing

status: done
type: bug
issue: #111
module: apps/os auth + navigation
branch: fix/google-sign-in-landing-link
size: standard
triage: self (single-agent T0; multi-agent dispatch not requested)

> TRIP bugfix plan. Diagnosis before patch. No production code in this file.
> Owner approval: Rishi, 2026-07-19 (continued Google sign-in rollout and staging report)

## Symptom

On staging, an existing credential owner who chooses Google returns to the sign-in
page. A new Google user authenticates successfully but lands on `/s/root`, which
renders the CompanyOS not-found page. See #111.

## Repro

1. Sign in with Google using an email already owned by an unverified local
   credential account. Expected: a safe path to link both accounts. Actual: Better
   Auth rejects implicit linking and returns to sign-in.
2. Sign in with Google as a user with no root or project grant. Expected: land on
   the user's personal scope. Actual: `/s/root` only falls back to a visible project
   and otherwise calls `notFound()`.
3. Environment: staging, `https://cos-staging.risi.au`, main at PR #110.

## Minimise

- Existing-account path: `sign-in-form.tsx` starts ordinary social sign-in but has
  no authenticated `linkSocial` continuation after the expected account-link guard.
- Landing path: `(app)/s/[...path]/page.tsx` considers only `type === "project"`
  when a principal lacks root access.
- Google credentials, callback URI, kernel auth linking, and personal-scope creation
  are healthy. Read-only staging rows prove the new Google user owns a personal scope.

## Hypotheses (ranked)

1. Confirmed: Better Auth's default/local-email verification guard blocks implicit
   same-email linking for the existing credential account.
2. Confirmed: root fallback ignores the guaranteed personal scope.

## Root cause

The initial Google implementation preserved the correct anti-pre-hijacking guard
but supplied no explicit linking flow for existing password users. It also reused
the historical `/s/root` post-auth destination without covering principals whose
only visible top-level scope is personal.

## Fix plan (surgical)

### 1. Select an accessible fallback scope

**Files**: `apps/os/src/lib/auth-redirect.ts`,
`apps/os/src/app/(app)/s/[...path]/page.tsx`

- Prefer the first visible project, preserving current behavior.
- Otherwise select the actor's visible personal scope before returning not-found.
- Verify with a pure regression test.

### 2. Continue rejected implicit linking safely

**File**: `apps/os/src/app/sign-in/sign-in-form.tsx`

- Mark Google attempts in the error callback URL.
- Only after an account-link error and successful password authentication, call
  Better Auth's authenticated `linkSocial({ provider: "google" })` endpoint.
- Preserve safe internal redirects and MCP OAuth authorization resume state.
- Keep `requireLocalEmailVerified: true`; do not configure trusted providers or
  different-email linking.

### 3. Document the auth contract

**File**: `apps/os/AGENTS.md`

- Record the explicit link-after-password path and personal-scope landing fallback.

## Regression test

- Failing tests first, then fix.
- Path: `apps/os/src/lib/auth-redirect.test.ts`
- Cover project preference, personal-only fallback, no fallback, and strict detection
  of the link-after-password continuation.

## Files to modify

| Path | Change |
|---|---|
| `apps/os/src/lib/auth-redirect.ts` | Pure landing/link decision helpers |
| `apps/os/src/lib/auth-redirect.test.ts` | Regression coverage |
| `apps/os/src/app/sign-in/sign-in-form.tsx` | Authenticated Google linking continuation |
| `apps/os/src/app/(app)/s/[...path]/page.tsx` | Personal-scope fallback |
| `apps/os/AGENTS.md` | Updated auth/home-routing contract |

## Don't

- Disable Better Auth's local-email verification guard.
- Add Google as a trusted provider for implicit linking.
- Mutate staging auth or kernel rows.
- Change unrelated navigation or OAuth behavior.

## Acceptance criteria

- [x] A personal-only user reaches their own personal scope instead of 404.
- [x] An existing same-email credential user can link Google only after password auth.
- [x] MCP OAuth resume and safe internal redirects remain intact.
- [x] Regression tests cover both bugs.
- [x] Gate green: `pnpm typecheck && pnpm lint && pnpm test`
- [x] Fresh review is APPROVED.
- [x] No drive-by file changes.

## Finish report (fill when done)

- Files changed: auth redirect helpers/tests; sign-in explicit-link continuation;
  root-scope fallback; `apps/os` auth contract; this plan.
- Deviations from plan: none.
- Left undone: staging verification after owner merge/deploy.
- Gate: typecheck PASS | lint/encoding/tokens PASS | tests 57 files / 490 tests PASS.
- Review: fresh Codex read-only review APPROVED with no blocking findings.
