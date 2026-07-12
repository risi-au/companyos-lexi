# Handoff — 2026-07-12 (M10 CLOSED; next: sequential queue below)

*Next session: read ONBOARDING.md + this file. Auto-memory has the same facts
compressed. Owner instruction for the next agent: work the queue ONE ITEM AT A
TIME — finish + verify + get the owner's merge/sign-off before touching the next.*

## State

- **main = `1462c61`** — M10 living-wiki milestone COMPLETE: #37 (M10-04B
  following/notifications + brain overview page), #38 (dispatch tooling), #39
  (encoding checker self-flag fix), #40 (M10-05 cos-* self-docs + seeding polish +
  wiki ops metric, closes M10). All merged by owner (#37/#38 gh-merged by architect
  with explicit owner authorization after his UI merge clicks silently failed twice
  — ALWAYS verify merges with `gh pr view <n> --json state`, not the owner's word
  or your own optimism).
- **Staging**: green through #39; #40's Release run should be checked (item 1).
  #38's Release failed (self-flag bug, superseded by #39 — no action).
- **Worktrees**: ALL pruned; only the main folder remains. No open PRs.
- **Dev DB**: migrated through 0026 with drizzle bookkeeping. Six `cos-*` pages +
  a "CompanyOS self-docs" agent principal (root EDITOR grant — deliberately not
  admin; see grants.ts:100-123 personal-wiki carve-out) exist from live testing.
  airbuddy/client-brief carries three harmless "Verification pass note" lines.
- **Dispatch**: `.\scripts\dispatch-codex.ps1 -Task <name>` is the standard path
  (ONBOARDING §4). Model policy: gpt-5.5 / medium reasoning / unelevated sandbox —
  all script defaults; do not override upward. Codex CANNOT run vitest/git in its
  sandbox (spawn EPERM) — its self-verification is typecheck-only; architect gates
  + driving the real app are the real check (this session that caught a root-grant
  security fix, a never-executed test, PGlite-vs-pg Date params, and a Next.js
  edge-bundle break).

## The queue (do in this order, one at a time)

1. **Staging check for #40** (10 min): `gh run list --workflow Release --limit 1`
   → confirm green; if the migration-free deploy failed, diagnose before anything
   else. Also confirm https://cos-staging.risi.au boots and seeded the cos-* pages
   (instrumentation runs on boot; check root wiki via the UI or MCP).
2. **Docs PR** (30 min): commit the loose untracked docs in the main folder —
   `docs/tasks/M11|M12|M13-*-overview.md`, `docs/HANDOFF-2026-07-09*|10|11|12*.md`,
   `docs/agent-tools/` if sensible (NEVER `USER DATA/`, `.claude/`,
   `.playwright-mcp/`). Branch + PR, owner merges.
3. **Nomenclature ruling session** (owner + agent, ~15 min, then a cheap dispatch):
   AskUserQuestion through `docs/tasks/M10-06-audit-report.md` §2 (3 candidates:
   Scope setup, Automations-vs-n8n, People & agents) + §3 (10 ambiguous cases).
   Then brief + dispatch the mechanical rename (grok lane viable; zero schema/API
   changes). Update NOMENCLATURE.md in the same change.
4. **Nutrition Warehouse pilot report** (architect-authored, no code): owner has
   wanted this for days. Ask him for scope/audience before writing.
5. **v0.9 tag + owner walkthrough**: M10 feature walkthrough (wiki editor, follow/
   notifications, cos-* self-docs via Ask OS, personal wikis, citations) + the
   still-pending vault e2e verify. Tag only after the walkthrough passes
   (docs/DEPLOYMENT.md; semver v* tags are live-promotion artifacts).
6. **M11-01 brief** (external integrations, overview committed in item 2): first
   design read of `docs/tasks/M11-external-integrations-overview.md`, then the
   standard brief → dispatch-codex.ps1 pipeline.

Parked, not in the queue: M10-04A cosmetic nit (leading `# H1` in the form
Definition field — fold into any polish pass); token expiries ~2026-10-05
(brain-engine + skills PAT, ops panel tracks); M5-05 until SaaS is real;
2026-07-08 leftovers to verify on staging /admin/health (R2 backup upload perms,
BACKUP_REPORT_TOKEN).

## Landmines (new ones this session)

- Owner "merged it" ≠ merged: GitHub merge clicks failed silently TWICE. Verify.
- The encoding lint guard scans all TRACKED files — a new file passes lint while
  untracked and can fail after commit. Run `pnpm lint` AFTER `git add`.
- PGlite tolerates things real Postgres rejects (Date SQL params) — any new raw
  SQL must be exercised against the Docker dev DB, not just the test suite.
- Next.js instrumentation: only the if-block `NEXT_RUNTIME === "nodejs"` pattern
  dead-code-eliminates node-only imports from the edge bundle.
- `.ps1` files must stay pure ASCII (PS 5.1 parses BOM-less files as ANSI; the
  lint guard forbids BOMs).
- Older landmines still hold: apps/os/.env not auto-loaded from root; hand-applied
  migrations need bookkeeping rows; `Get-Process codex` before declaring a run
  dead; USER DATA/ untouchable.
