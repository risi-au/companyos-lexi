# Baseline Gate Receipt — Lexi Fork

*Date: 2026-07-22. Purpose: prove the fork builds green BEFORE any Lexi shot lands. Any future shot's gate results are compared against this.*

## Revision

- Repo: `C:\dev\companyos-lexi` (fresh clone of `github.com/risi-au/companyos`)
- HEAD: `7e54338` — "Make the Wiki clear and trustworthy (#116)" (= origin/main at fork time)
- Snapshot tag: `pre-lexi-2026-07-22` (annotated, created locally; push pending owner confirmation)
- Mirror backup: `G:\BACKUPS\companyos-mirror-2026-07-22.git` (all branches + tags)
- Original checkout `C:\dev\companyos` was NOT modified (it remains 16 commits behind with its local uncommitted tweaks)

## Environment

- OS: Windows 11 (win32), PowerShell 5.1
- pnpm: 11.1.3 (install: 21.2s, warm store)
- Toolchain: typescript 5.9.3, turbo 2.10.2, vitest 3.2.6, eslint 9.39.4

## Commands & results

| Command | Result | Duration |
|---|---|---|
| `pnpm install` | OK (1 benign warning: `companyos-mcp` bin stat pre-build) | 21.2s |
| `pnpm typecheck` | **14/14 tasks successful** | 18.1s |
| `pnpm lint` | **14/14 tasks successful** (6 cached) | 4.4s |
| `pnpm test` | **58 files / 537 tests passed** | 117.1s |

Pre-existing non-blocking notes: turbo warns "no output files found" for `api/brain/db/ui/wizard#build` (outputs key in turbo.json) — present on a clean clone, not shot-related.

## Notes

- `.env` copied from `C:\dev\companyos` (not committed; values never leave the file).
- `V2 - LEXI/` plan docs copied into the fork (untracked; decide whether to commit to a docs branch).
- Receipt valid while HEAD stays at `7e54338` and toolchain files are unchanged.
