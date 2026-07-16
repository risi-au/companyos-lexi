# Gate Receipt — FIX-intake-sendback-approved (#42, R2 expanded scope)

Candidate: risi-au/wizard-send-back-on-an-approved-intake-is-a-sile @ 7a4d3aa + working-tree diff (pre-commit, R2 candidate with provisioning claim)
Base: main @ 7a4d3aa
Diff fingerprint: 8 modified + 2 new migration files —
  packages/api/src/modules/intake/{service.ts, intake.test.ts, AGENTS.md},
  packages/db/{src/schema/intake.ts, AGENTS.md, drizzle/0031_*.sql, drizzle/meta/{_journal.json, 0031_snapshot.json}},
  apps/os/src/{lib/labels.ts, modules/intake/IntakePanel.tsx}
Environment: node v24.15.0, pnpm 11.1.3, vitest 3.2.6, typescript 5.9.3 (PGlite tests incl. migration 0031, no dev DB)

| Check | Command | Result | Duration |
|---|---|---|---|
| typecheck | pnpm typecheck | ok (14/14 turbo tasks) | ~1 min |
| lint | pnpm lint | ok (14/14 turbo tasks) | ~1 min |
| tests | pnpm test | 407 passed / 0 failed (46 files, incl. db meta-chain) | ~3 min |

Run by: Claude (Fable 5, orchestrator/implementer with owner waiver) at 2026-07-17 08:20 local

History: 403 passed (pre-review candidate) -> 404 (guarded-updates candidate,
review cycle 1) -> 406 (R2 provisioning-claim candidate; owner-approved re-plan
after review cycle 2) -> 407 (claim fencing via updated_at token, FOCUSED_FIX for
R2 FULL_REVIEW findings R2-01/R2-02). One interim failure: duplicate test import, fixed.

Invalidation: void if the candidate diff, dependencies, lockfile, or relevant
config change. Deployment smoke tests are NEVER covered by this receipt.
Staging re-check of the original repro happens post-deploy (tracked in PR).
Migration 0031 applies on the next deploy's standard db:migrate step.
