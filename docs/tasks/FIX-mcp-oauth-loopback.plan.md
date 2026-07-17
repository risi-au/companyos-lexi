# FIX — MCP OAuth loopback redirect matching (#90 follow-up)

Lane: Bugfix · Size: Standard · Risk: **R2 (auth)** · Plan: plan-lite + contract (R2-small).
Owner approval: given in chat 2026-07-17 (approach + self-implement waiver). Reviewer: Codex (fresh, cross-vendor).
Diagnosis: `docs/tasks/DIAG-mcp-oauth-invalid-redirect.md`.

## CONTRACT
- **Purpose:** Make MCP OAuth (codex, Claude, and any loopback-based client) succeed
  against COS instead of dead-ending at `/sign-in?error=invalid_redirect`.
- **Root effect fixed:** The deployed OAuth server matches an `/authorize` request's
  loopback redirect host `127.0.0.1` as `localhost`. Clients that *register* a
  `127.0.0.1:<port>` redirect (codex does) therefore never match. Proven: a client
  whose stored redirect is `localhost:<port>` accepts a `127.0.0.1:<port>` request.
- **Approach:** At Dynamic Client Registration, **expand** any loopback redirect_uri
  to all equivalent loopback forms — `127.0.0.1`, `localhost`, `[::1]` — at the same
  port/path/query/scheme. The client then matches whether the request arrives (or is
  normalized) as any loopback form. Robust in BOTH directions: works with today's
  `127→localhost` rewrite (localhost variant matches) AND if a future better-auth
  removes the rewrite (127 variant matches exactly). Non-loopback redirects untouched.
- **In scope:** `apps/os/src/lib/auth.ts` (wire a `hooks.before` on `/oauth2/register`),
  new pure helper + unit test.
- **Exclusions:** Not changing better-auth; not removing the underlying rewrite (needs
  instrumented deploy — deferred cleanup); not #91 hardening (separate task); not #86.
- **Safety invariants:**
  - Only `/oauth2/register` requests are touched; only redirect_uris with a loopback
    host are expanded; all other URIs pass through byte-identical.
  - Preserves RFC-7591 DCR (does not disable registration) — #91 constraint.
  - No new stored redirect broadens beyond loopback (no phishing surface added;
    loopback can't be a remote attacker target).
  - Idempotent + de-duplicated (re-registration doesn't accumulate duplicates).
- **Acceptance checks:**
  1. Unit: `expandLoopbackRedirects` expands 127.0.0.1/localhost/::1 → all 3 forms,
     preserves port+path+query, dedups, leaves non-loopback + unparseable untouched.
  2. Gate green (typecheck + lint + test) from repo root.
  3. Post-deploy staging: re-run codex `Authenticate` on `cos_test` → reaches consent/
     login (no `invalid_redirect`); and curl DCR(127.0.0.1:port)+authorize(exact) → ACCEPT.
- **Deployment boundary:** Deploy is a SEPARATE owner approval. Frozen-lockfile build
  already in `apps/os/Dockerfile` (verified) — no build change needed.

## Files
- `apps/os/src/lib/oauth-loopback.ts` — new: `expandLoopbackRedirects(uris): string[]`.
- `apps/os/src/lib/oauth-loopback.test.ts` — new: regression test (durability lock).
- `apps/os/src/lib/auth.ts` — wire `hooks.before` calling the helper on `/oauth2/register`.

## Verification note (bugfix lane substitution)
The hook's end-to-end effect is environment-bound (needs the running better-auth + DB).
Unit test + typecheck verify the code; the codex/curl re-run on staging is the real
end-to-end check and happens POST-DEPLOY — tracked in the PR, not claimed done before.
