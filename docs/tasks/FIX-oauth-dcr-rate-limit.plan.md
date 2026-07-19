# FIX-oauth-dcr-rate-limit: Lock dynamic client registration rate policy

status: done
type: bug
issue: #91
module: apps/os auth
branch: fix/oauth-dcr-rate-limit
size: standard
triage: orchestrate

> TRIP bugfix plan. Diagnosis before patch. No production code in this file.
> Owner approval: Rishi, 2026-07-18 (continue queued #91)

## Symptom

CompanyOS intentionally permits unauthenticated RFC 7591 dynamic client registration so Codex,
Claude, and other MCP clients can onboard. The application does not declare its own registration
rate policy in `apps/os/src/lib/auth.ts`, leaving this security control implicit in the installed
better-auth oauth-provider implementation. See #91.

## Repro

1. Inspect the `oauthProvider` options in `apps/os/src/lib/auth.ts`.
2. Observe that public DCR is enabled but no `rateLimit.register` policy is declared.
3. Inspect `@better-auth/oauth-provider` 1.6.23: it currently supplies an implicit default of five
   `/oauth2/register` requests per 60 seconds.
4. Expected: CompanyOS owns, documents, and tests the registration policy. Actual: behavior can
   drift with the dependency and cannot be tuned through instance configuration.

## Minimise

The change is limited to oauth-provider configuration and a small environment parser in
`apps/os`. Token issuance, consent, redirect validation, client cleanup, admin UI, database schema,
and MCP resource authentication are not involved.

## Hypotheses (ranked)

1. Passing better-auth's built-in `rateLimit.register` option is sufficient and preserves public
   RFC 7591 DCR.
2. Small positive-integer environment overrides can make the policy instance-configurable without
   adding a new limiter, storage layer, or database write.

## Root cause

The original issue described DCR as unbounded. In the currently installed oauth-provider 1.6.23,
registration is already subject to an upstream implicit default of 5 requests per 60 seconds.
The remaining hardening gap is that CompanyOS neither pins nor tests that policy, so a dependency
change or accidental `false` override could silently change the exposed auth surface.

## Fix plan (surgical)

### 1. Add a CompanyOS-owned DCR rate policy helper

**File**: `apps/os/src/lib/oauth-dcr-rate-limit.ts`

- Default to the upstream-compatible policy: 60-second window, maximum 5 registrations.
- Accept positive-integer overrides through `OAUTH_DCR_RATE_LIMIT_WINDOW_SECONDS` and
  `OAUTH_DCR_RATE_LIMIT_MAX`.
- Fall back safely for unset, invalid, zero, or negative values.
- Verify with focused unit tests.

### 2. Wire better-auth's built-in register limiter

**File**: `apps/os/src/lib/auth.ts`

- Pass the helper result as `oauthProvider({ rateLimit: { register: ... } })`.
- Keep `allowDynamicClientRegistration` and `allowUnauthenticatedClientRegistration` enabled.
- Do not add a parallel limiter or custom persistence.

### 3. Document the auth contract

**File**: `apps/os/AGENTS.md`

- Record the default and the two supported environment overrides.
- State that public DCR remains required for MCP client onboarding.

## Regression test

- Failing test first: the helper returns the documented default and sanitizes invalid overrides.
- Green after implementation: valid positive-integer overrides are passed through.
- Path: `apps/os/src/lib/oauth-dcr-rate-limit.test.ts`.
- Typecheck proves the helper output satisfies better-auth's native `rateLimit.register` contract.

## Files to modify

| Path | Change |
|---|---|
| `apps/os/src/lib/oauth-dcr-rate-limit.ts` | Add the environment-backed DCR rate policy helper |
| `apps/os/src/lib/oauth-dcr-rate-limit.test.ts` | Cover defaults, valid overrides, and safe fallback |
| `apps/os/src/lib/auth.ts` | Wire the helper into `oauthProvider.rateLimit.register` |
| `apps/os/AGENTS.md` | Document public DCR rate limiting and configuration |
| `docs/tasks/FIX-oauth-dcr-rate-limit.plan.md` | Record diagnosis, scope, and gate evidence |

## Don't

- Disable public DCR; Codex and Claude onboarding depend on it.
- Add redirect allowlists, client expiry/GC, revocation UI, or scoped consent from #107.
- Add a second rate-limiting package or custom database table.
- Fix adjacent issues or touch `.env`, `USER DATA/`, or `legacy/`.
- Perform staging registrations or database writes from this task.

## Acceptance criteria

- [x] `oauthProvider.rateLimit.register` is explicitly configured.
- [x] Default policy is 5 registrations per 60 seconds.
- [x] Positive-integer environment overrides work; invalid values fall back safely.
- [x] Public unauthenticated DCR remains enabled.
- [x] Focused regression tests pass.
- [x] Gate green: `pnpm typecheck && pnpm lint && pnpm test`.
- [x] Fresh inline read-only review returns APPROVED.
- [x] No drive-by file changes or database writes.

## Finish report (fill when done)

- Files changed: `apps/os/src/lib/oauth-dcr-rate-limit.ts`, its focused test, `auth.ts`,
  `apps/os/AGENTS.md`, and this plan.
- Deviations from plan: the dispatched implementer completed the red-phase test, then its local
  post-tool review hook deadlocked in interactive PowerShell prompts. The coordinator took the
  partial handback and completed the planned implementation without expanding scope. The first
  package-filtered focused-test command used the root Vitest config from `apps/os` and failed path
  resolution; the corrected repo-root direct invocation passed.
- Left undone: none in scope. Client expiry/cleanup, redirect restrictions, admin UI, and scoped
  connection design remain intentionally deferred.
- Gate: lint: passed (including encoding and token validation) | typecheck: passed | tests: passed
  (55 files, 467 tests; focused test 3/3) | review: APPROVED
