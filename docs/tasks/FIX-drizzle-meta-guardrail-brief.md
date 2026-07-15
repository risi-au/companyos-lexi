# FIX-drizzle-meta-guardrail: drizzle meta chain-consistency test + AGENTS.md rule

status: todo
module: packages/db
branch: task/FIX-drizzle-meta-guardrail
issue: #56
plan: docs/tasks/FIX-drizzle-meta-guardrail.plan.md

## Goal

Add a lightweight guardrail so hand-authored drizzle migrations can never again land
without their snapshot/journal bookkeeping: a vitest chain-consistency test in
`packages/db` (runs in the normal `pnpm test` gate) plus a contributor rule in
`packages/db/AGENTS.md`. The historical snapshot rebuild is explicitly OUT of scope.

## Context (read these, nothing else)

- Plan: `docs/tasks/FIX-drizzle-meta-guardrail.plan.md` (facts + fix design — follow it exactly)
- Issue #56 body (in the plan's Problem section; no need to fetch it)
- `packages/db/drizzle/meta/_journal.json` — journal shape: `{ entries: [{ idx, version, when, tag, breakpoints }] }`
- `packages/db/drizzle/meta/*.json` — snapshot shape: has `id` and `prevId` string fields
- `packages/db/drizzle/*.sql` — one migration file per journal tag
- `packages/db/AGENTS.md` — add the rule to the existing Migrations section
- An existing small test in `packages/db` (e.g. near `src/`) for vitest style/config reference

## Do

1. Create `packages/db/src/meta-chain.test.ts`. Load the real files from disk with
   `node:fs`/`node:path` relative to the package root. Implement the five assertions from
   the plan's Fix design:
   1. journal `idx` 0..n-1 strictly increasing, tags unique;
   2. tag set == `drizzle/*.sql` basename set (both directions, list the diff in the
      assertion message);
   3. every tag has `drizzle/meta/<prefix>_snapshot.json` (prefix = tag up to the first
      `_`; the `20260710083235_attention_items` tag maps to `20260710083235_snapshot.json`)
      UNLESS the tag is in `HISTORICAL_MISSING_SNAPSHOTS` — a frozen, exact, alphabetized
      const listing precisely the tags missing today (derive it from the plan's facts:
      everything NOT in the present list). Include a comment: frozen 2026-07-15 per issue
      #56 — never extend, repair the chain instead;
   4. no two snapshots share a `prevId` (report the colliding pair);
   5. starting from the newest journal entry's snapshot, walking `prevId` visits every
      existing snapshot exactly once in reverse journal order and ends at the `0000`
      snapshot (skipping allowlisted gaps).
2. Factor the assertions over pure helper functions that take plain data
   (journal entries, `{tag -> snapshot}` map) so negative cases are testable without
   touching the real files. Add negative tests using small inline fixtures: appended
   journal entry with no snapshot fails #3; duplicated `prevId` fails #4; broken walk
   fails #5.
3. Update `packages/db/AGENTS.md` Migrations section: migrations are produced only by
   `pnpm --filter @companyos/db db:generate`; hand-adjusting the generated SQL is allowed
   but the generated snapshot + journal entry must be kept; the meta-chain test enforces
   this; never extend the historical allowlist. Keep it to ~4 lines matching the file's tone.
4. Verify: `pnpm typecheck && pnpm lint && pnpm test` from the repo root (if pnpm is
   unavailable in your sandbox, run tsc/eslint/vitest directly and say so).

## Don't

- Commit (orchestrator commits after review)
- Touch any file under `drizzle/` (no repairs, no rebuilds, no journal edits — the test
  READS only)
- Touch USER DATA/, legacy/, `.env*`, vps-login.txt
- Add CI workflow files or new dependencies
- Non-ASCII characters or BOMs in source files

## Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from repo root
- [ ] Test green on the current chain; the three negative fixtures prove it fails on:
      missing new snapshot, duplicate `prevId`, broken walk
- [ ] Allowlist is exact (test would fail if a listed snapshot actually exists)
- [ ] AGENTS.md rule added
- [ ] Report every file changed

On usage limits print `LIMIT-ALERT:` and stop.
