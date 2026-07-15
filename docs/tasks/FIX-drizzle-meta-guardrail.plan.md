# FIX-drizzle-meta-guardrail: stop drizzle meta/ chain rot at the source

status: in-progress
type: bugfix
issue: #56
module: packages/db
branch: task/FIX-drizzle-meta-guardrail
size: standard
triage: orchestrate (well-pinned test + docs; codex gpt-5.5/medium default lane)

> TRIP plan. No production code in this file.

## Problem

`packages/db/drizzle/meta/` rotted silently across ~10 migrations (hand-authored SQL
without `drizzle-kit generate`): missing snapshot files, three snapshots claiming the same
parent, and schema changes never captured — `pnpm db:generate` broke until #55 repaired
the head of the chain. Full history in issue #56.

## Decision (owner direction 2026-07-15)

- **Defer** the historical snapshot rebuild (introspect/pull reconstruction of the missing
  0002–0026 snapshots). The chain is accepted as-is up to `0028_snapshot.json`, which is a
  verified full-current-state snapshot; future `generate` runs are clean from there.
- **Add the guardrail now** so the rot cannot recur unnoticed:
  1. A contributor rule in `packages/db/AGENTS.md`.
  2. A lightweight chain-consistency test that runs in the normal `pnpm test` gate (no CI
     config change needed).

## Repro / current facts (verified 2026-07-15 on main @ 92d9403)

- Journal has 29 entries, `idx` 0–28, newest tag `0028_past_spitfire`.
- Snapshot files present: 0000, 0001, 0003–0007, 0010–0013, 0020, 0024, 0025, 0027, 0028,
  and `20260710083235_snapshot.json` (attention_items). All other tags have no snapshot —
  that set is FROZEN as the historical allowlist.
- Snapshot files are named by the numeric/timestamp prefix of the journal `tag`.

## Fix design

New test `packages/db/src/meta-chain.test.ts` (plain vitest, reads
`drizzle/_journal` + `drizzle/meta/` + `drizzle/*.sql` from disk) asserting:

1. Journal `idx` values are 0..n-1, strictly increasing, unique tags.
2. Every journal tag has a matching `drizzle/<tag>.sql` file and vice versa.
3. Every journal tag has a snapshot file UNLESS it is in the frozen historical allowlist
   (exact tag list pinned in the test). Any migration added after `0028_past_spitfire`
   therefore MUST ship its snapshot.
4. No two snapshot files share the same `prevId` (the parent collision that broke
   `generate`).
5. Walking `prevId` from the newest snapshot visits every existing snapshot in reverse
   journal order (gaps allowed only across allowlisted missing tags) and terminates at
   `0000`.

`packages/db/AGENTS.md` gains a Migrations rule: migrations are produced ONLY by
`pnpm --filter @companyos/db db:generate`; if SQL must be hand-adjusted, adjust the
generated file but keep its generated snapshot + journal entry; the meta-chain test will
fail any migration landed without bookkeeping; never extend the historical allowlist —
fix the chain instead.

## Files to modify

| Path | Change |
|---|---|
| `packages/db/src/meta-chain.test.ts` | new chain-consistency test |
| `packages/db/AGENTS.md` | migration bookkeeping rule + pointer to the test |

## Test impact

- New test must pass on the current (accepted-historical) chain and fail if: a snapshot is
  deleted, a journal entry is appended without a snapshot, or two snapshots share a parent.
  (Negative cases exercised with in-test fixture data, not by mutating the real files.)
- Gate: `pnpm typecheck && pnpm lint && pnpm test`.

## Acceptance criteria

- [ ] Chain-consistency test exists, runs in `pnpm test`, green on current main
- [ ] Frozen allowlist matches the facts above exactly; adding a future migration without
      a snapshot fails the suite
- [ ] AGENTS.md rule landed in the same PR
- [ ] Historical rebuild explicitly deferred — noted on issue #56, not attempted

## Finish report (filled 2026-07-15)

- Files changed:
  - `packages/db/src/meta-chain.test.ts` -- new guardrail test (pure validators + real-file
    integration check + negative fixtures)
  - `packages/db/AGENTS.md` -- migration bookkeeping rule
- Deviations from plan:
  - Implementation discovered the live chain still violates assertion 4: `0028_snapshot.json`
    carries `prevId` = the attention_items snapshot id instead of its true parent `0027`
    (leftover of the #55 head repair), so `0024` and `0028` share a parent. Per the
    defer-repairs decision this is FROZEN as an explicit allowance
    (`HISTORICAL_DUPLICATE_PARENTS` + a walk jump) and documented in-file; the one-field
    repair is the owner's call, noted on issue #56. New duplicate parents still fail.
  - Plan's assertion 5 ("terminates at 0000") is implemented with explicit frozen walk
    jumps across the allowlisted gaps rather than implicit gap-skipping -- stricter.
- Left undone: historical snapshot rebuild + root-cause confirmation (deferred by design);
  optional `0028.prevId` one-field repair (owner decision).
- Gate: typecheck ok | lint ok (14/14) | tests 378 passed (44 files, incl. 4 new)
