# Gate receipt — FEAT-token-expiry-edit (#81)

- Branch: `feat/token-expiry-edit` (off main)
- Implementer: self (Claude). Code diff hash: `37b71fbd81b0e5b9f7a29baa6ea9c54277f73fb4`
  (rev 2 = FOCUSED_FIX: atomic conditional update, review BLOCKING #1)
- Review: Codex FULL_REVIEW → 1 BLOCKING (non-atomic revoked-check/update TOCTOU) →
  FOCUSED_FIX (conditional `UPDATE ... WHERE revokedAt IS NULL` + rowcount) →
  FOCUSED_REREVIEW → **VERDICT: APPROVED**.
- Tools: node v24.15.0, pnpm 11.1.3, vitest 3.2.6, typescript 5.9.3

| Check | Command | Result |
|---|---|---|
| API typecheck | `pnpm exec tsc --noEmit` (packages/api) | ✅ exit 0 |
| API lint | `pnpm exec eslint` (changed files) | ✅ exit 0 |
| Connect tests | `pnpm exec vitest run src/modules/connect/connect.test.ts` | ✅ 19 passed (3 new) |
| Full API suite | `pnpm exec vitest run` (packages/api) | ✅ 284 passed / 26 files |
| apps/os typecheck | `pnpm exec tsc --noEmit` (apps/os) | ✅ exit 0 |
| apps/os lint | `pnpm exec eslint` (changed files) | ✅ exit 0 |

Acceptance (covered by connect.test.ts `token expiry editing (#81)`):
- admin extend → row updated, `authenticateToken` succeeds
- admin clear (null) → never expires, auth succeeds
- admin shorten to past → auth rejected, status `expired`
- non-admin (viewer + editor own-mint) → `AccessDeniedError`, unchanged
- revoked token → error; unknown token → `TokenNotFoundError`
- emits `token.expiry_updated`

Notes:
- Server behaviour (auth/status/guard/events) is proven by tests. UI is an additive
  admin-only inline editor in ConnectPanel (tsc/lint clean); not manually driven — no
  component-test infra and spinning the full app+auth is disproportionate for the
  covered logic. Consistent with the #44 approach.
