# FIX-mcp-oauth-error-surfacing: surface OAuth/auth errors instead of dead-ending at /s/root (#90)

status: done
type: bug
issue: #90
module: apps/os (middleware + sign-in)
branch: fix/mcp-oauth-flow
size: standard
triage: orchestrate (implementer: Grok; reviewer: Codex)

> Owner approval: Rishi, 2026-07-17 (Brief #4). Risk R1 (auth boundary, error-surfacing
> only — no permission/logic/config change).

## Symptom
Connecting any MCP client via OAuth (Codex `codex mcp login`, in-app plugin auth) opened
`https://cos-staging.risi.au/s/root` and stalled; no error, "No apps connected via OAuth yet."

## Investigation (CONFIRMED via live curl against staging)
- Discovery metadata correct (`resource`, `authorization_servers`, `issuer` all on cos-staging) — ruled out env/URL misconfig.
- A correctly-registered client (dynamic registration) + matching redirect_uri + PKCE authorizes fine → `302 /sign-in?client_id=…&sig=…`. OAuth server is NOT broken.
- **Root cause**: pre-redirect authorize errors (`invalid_client`, `invalid_redirect`) → `302 /api/auth/error?error=…` → `302 /?error=…` (app root) → middleware sends authed→`/s/root`, unauthed→`/sign-in`, DROPPING the `error` query. Every such error dead-ends silently.
- Class is client-agnostic: the silent dead-end hits ALL OAuth clients, not just Codex.
- Post-redirect_uri errors (e.g. missing PKCE) are returned to the client correctly (not swallowed).

## Root cause (one line)
Auth errors bounce through `/?error=` and middleware discards the `error` query, so no message ever reaches the user.

## Fix (surgical — surfacing only)
- `apps/os/src/middleware.ts`: after the existing bypass block, intercept any request with an `error` query and 302 to `/sign-in`, preserving `error` + `error_description`. `/sign-in` is bypassed earlier, so no redirect loop.
- `apps/os/src/app/sign-in/page.tsx`: read `error`/`error_description` from the query (`useSearchParams`, Suspense-wrapped for Next 15) and initialize the existing error banner (friendly mapping for `invalid_client`/`access_denied`/`server_error`, else the raw code / description).

## Regression test
`apps/os/src/middleware.test.ts` (run from repo root — the root vitest projects config rejects an `apps/os` cwd): `/?error=invalid_client&error_description=nope` → `/sign-in?error=…` (RED without the middleware change); `/sign-in?error=…` → `next()` (no loop). 2/2, red-first proven.

## Out of scope (follow-ups)
- The UNDERLYING Codex authorize failure (invalid_client / redirect_uri) — invisible until this ships; re-run Codex post-deploy and read the surfaced error.
- OAuth dynamic-client-registration hardening → filed as #91.

## Finish report
- Files: middleware.ts (error interceptor), sign-in/page.tsx (banner from query + Suspense), middleware.test.ts (regression).
- Implementer: Grok. Reviewer: Codex (FULL_REVIEW → APPROVED, no findings).
- Note: caught Grok running vitest from `apps/os` (root project config errors there) and misreporting PASS; re-ran from root — 2/2, red-first confirmed.
- Repro is an evidence chain (curl) per the bugfix lane — re-verify the live Codex flow after deploy.
- Gate: apps/os tsc ok · eslint ok · middleware test 2/2.
