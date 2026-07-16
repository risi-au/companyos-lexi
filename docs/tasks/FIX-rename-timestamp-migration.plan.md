# FIX-rename-timestamp-migration: rename 20260710083235_attention_items into the 00NN sequence

status: in-progress
type: bugfix
issue: #56 (first checkbox; the historical snapshot rebuild checkbox stays open)
module: packages/db (migration metadata only; zero schema or DB changes)
branch: fix/DB-rename-timestamp-migration
size: standard (small diff, but migration-metadata surgery with owner-gated edits)
triage: self-implement (orchestrator) with owner approval on drizzle/meta edits

> TRIP plan. Owner approval: Rishi, 2026-07-16 (approach approved in-session:
> "Minimal rename, no DB SQL").

## Overview

`pnpm db:generate` works without manual repair: the timestamp-named migration is renamed
to `0023a_attention_items` so drizzle-kit's lexicographic snapshot sort matches the real
chain order and the diff base is the true head (0030) again.

## Problem statement (root cause, verified against installed sources)

- drizzle-kit@0.31.10 `prepareOutFolder` does `fs.readdirSync(meta).sort()` and
  `preparePrevSnapshot` takes the LAST element as the generate diff base.
- `20260710083235_snapshot.json` sorts lexicographically after every `00NN_snapshot.json`
  (`'2' > '0'`), so every generate diffs against the pre-0024 schema state: it re-emits
  applied 0024-0030 objects and writes a colliding prevId (issue #56; landmine in
  packages/db/AGENTS.md).

## Why the minimal rename is safe (verified, drizzle-orm@0.44.7)

- Runtime migrator (`readMigrationFiles` + pg dialect `migrate`) iterates `_journal.json`
  entries IN ORDER, resolves each file by `tag`, and decides "already applied" purely by
  `Number(lastDbMigration.created_at) < migration.folderMillis` (journal `when` vs the
  max `created_at` row in `drizzle.__drizzle_migrations`).
- The stored `hash` (sha256 of SQL text) is written but NEVER read; the tag is never
  stored. The rename changes neither the SQL text nor any `when`.
- Therefore: NO `__drizzle_migrations` updates on dev or staging. Zero DB changes.
- meta-chain test resolves snapshots via `migrationPrefix(tag)_snapshot.json` (prefix =
  text before first `_`). Prefix `0023a` is unique (plain `0023` would collide with
  `0023_ops_health` and trip the frozen missing-snapshot allowlist) and sorts between
  `0020_snapshot.json` and `0024_snapshot.json`, i.e. its true chain position (idx 23,
  parent of 0024).

## Changes (one PR)

1. `git mv packages/db/drizzle/20260710083235_attention_items.sql`
   -> `packages/db/drizzle/0023a_attention_items.sql` (content byte-identical).
2. `git mv packages/db/drizzle/meta/20260710083235_snapshot.json`
   -> `packages/db/drizzle/meta/0023a_snapshot.json` (content untouched; id/prevId UUIDs
   are filename-independent).
3. `packages/db/drizzle/meta/_journal.json`: idx-23 entry `tag` ->
   `0023a_attention_items`. `when`/`idx`/everything else unchanged. (Hand-edit is
   normally banned; owner-approved exception, same precedent as 2026-07-15.)
4. `packages/db/src/meta-chain.test.ts`: re-key HISTORICAL_WALK_JUMPS to
   `"0023a_attention_items": "0020_neat_vulcan"` + update the comment. The jump itself
   stays: 0021/0022/0023 snapshots are still missing (rebuild checkbox stays open).
5. `packages/db/AGENTS.md`: replace the KNOWN LANDMINE paragraph with a short resolved
   note (generate is clean again from 0030; rebuild of historical snapshots still open
   under #56).
6. Probe (not committed): trivial schema change -> `pnpm --filter @companyos/db
   db:generate` -> assert the generated SQL contains ONLY the probe change and the new
   snapshot's prevId == 0030's id (`4fe38aa2...`) -> revert probe artifacts.

## Don't

- No `__drizzle_migrations` SQL on any env (verified unnecessary; see above).
- No historical snapshot rebuild (issue #56 checkbox 2 stays open).
- No edits to historical docs/handoffs that mention the old tag (they are history).
- Every migration file stays plain SQL; no DO $$.

## Acceptance criteria

- [x] meta-chain test green with the re-keyed jump; full gates green.
- [x] Generate probe produces a clean minimal diff with prevId = 0030's snapshot id
      (probe: temp `documents.probe_temp` column -> `0031_rainy_the_liberteens.sql` held
      exactly one ALTER TABLE, snapshot prevId `4fe38aa2-...`; all probe artifacts
      reverted).
- [x] `pnpm --filter @companyos/db db:migrate` against the Docker dev DB is a no-op
      (`drizzle.__drizzle_migrations` unchanged: 31 rows, max created_at still 0030's
      when 1784114627708).
- [x] Diff = 2 renames + journal tag + test + AGENTS.md only.

## Finish report

- Files changed: `packages/db/drizzle/{20260710083235->0023a}_attention_items.sql`
  (rename only), `packages/db/drizzle/meta/{20260710083235->0023a}_snapshot.json`
  (rename only), `packages/db/drizzle/meta/_journal.json` (idx-23 tag only),
  `packages/db/src/meta-chain.test.ts` (walk-jump re-key + comment),
  `packages/db/AGENTS.md` (landmine note resolved).
- Deviations: none. Handoff step 3 (dev+staging `__drizzle_migrations` updates) verified
  unnecessary and dropped, owner-approved.
- Adversarial review (fresh codex gpt-5.6-terra, read-only): REQUEST-CHANGES on two nits
  (AGENTS.md hash wording; journal trailing newline), both applied; mechanics
  independently confirmed including a PGlite no-op migration and `drizzle-kit check`.
- Gate: typecheck green | lint green | tests 388 passed + db 10/10.
