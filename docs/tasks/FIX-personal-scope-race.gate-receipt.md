# Gate receipt — FIX-personal-scope-race (#70)

- Branch: `fix/personal-scope-race`
- Diff hash (staged): `d09884e18ae7e99583c9bb488f1b6d143d6371ac`
  (supersedes pre-review `128b52b8…`; rev 2 = FOCUSED_FIX for review findings R1/R2)
- Scope: `packages/api` (kernel/scopes.ts, kernel/grants.ts, kernel/scopes.race.test.ts) + plan/receipt docs
- Tools: node v24.15.0, pnpm 11.1.3, vitest 3.2.6, typescript 5.9.3

| Check | Command | Result |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` (packages/api) | ✅ exit 0 |
| Lint | `pnpm exec eslint src/` (packages/api) | ✅ exit 0 |
| Tests | `pnpm exec vitest run` (packages/api) | ✅ 282 passed / 27 files |
| Regression (red→green) | `pnpm exec vitest run src/kernel/scopes.race.test.ts` | ✅ RED on pre-fix code (raw 23505), GREEN after fix |

Notes:
- Red repro captured pre-fix: concurrent `ensurePersonalScope` threw raw Postgres
  `23505` on `scopes_path_unique` (scopes.ts) and, one layer down, on
  `grants_principal_scope_unique` (grants.ts).
- Rev 2 (FOCUSED_FIX): after Codex FULL_REVIEW flagged that catching 23505 aborts a
  surrounding transaction, switched both to `ON CONFLICT` (scopes: DO NOTHING →
  DuplicatePathError on empty; grants: DO UPDATE role) — atomic, transaction-safe.
- Full suite (282) run on the rev-2 candidate; no source changed since.
