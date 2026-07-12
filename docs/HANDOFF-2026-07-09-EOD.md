# Session handoff — 2026-07-09 EOD (UX-01 shipped; next: UX-02 brief + dispatch)

Supersedes HANDOFF-2026-07-09.md. Written for any frontier model taking over as
architect/orchestrator. Protocol unchanged: docs/ORCHESTRATION.md + docs/SUBAGENTS.md —
you architect/review/commit, **codex implements** (codex-first per owner override; recipe
in SUBAGENTS.md: `codex exec --sandbox workspace-write`, `< /dev/null`, `^LIMIT-ALERT:`
log monitor, codex can't commit on Windows — its sandbox has a read-only `.git`). Owner
merges PRs. Never push main (docs included).

## Shipped this session (2026-07-09 day → EOD)

- **The Claude Design mockup turned out to be a full system redesign, not a delta.**
  Owner ran a concept brief through Claude Design on a *different* claude.ai account than
  this session's login (DesignSync `/design-login` only authorizes the current account —
  it could not reach the project). Owner exported the mockup manually to
  `C:\dev\companyos\USER DATA\Design html\` (`CompanyOS.dc.html` + chat log). That
  directory and `docs/tasks/M10-living-wiki-overview.md` / `M11-external-integrations-overview.md`
  are the **owner's own materials — never commit them, never sweep them into `git add`.**
- Reverse-engineered the mockup with Playwright (served over `python -m http.server`,
  `.dc.html` won't render over `file://`) into **`docs/design/DESIGN-SYSTEM-V2.md`** — new
  ground truth, supersedes `DESIGN-SYSTEM-DELTAS.md` (left in place with a supersession
  banner). Covers: 4 themes × 29 tokens each (exact hex, §1), Gantari + JetBrains Mono
  (§2), 2/3/4px radius (§3), GSAP motion + motion-intensity scale 0–3 (§4), component
  contracts for sidebar/wizard/admin/toast/confirm (§5), mobile (§6), migration posture —
  **additive only, no big-bang deletion of the ~48 existing v1-token consumers** (§7),
  package re-scope UX-01..05 (§8).
- Owner confirmed the full pivot in plain chat: build the OS on this theme going forward,
  4 themes with room to tweak, admin section keeps working (sample data only), let codex
  implement. Approved via AskUserQuestion: export CLAUDE.md (never actually received —
  owner found `support.js` instead, which turned out to be generic Claude Design runtime,
  not project-specific; not blocking, the mockup + chat log were sufficient), add GSAP as
  a new dependency (approved — free for commercial use since Webflow's 2024 acquisition),
  build mobile responsiveness now (turned out to already exist in the mockup, no extra
  work needed).
- Rewrote **`docs/tasks/UX-01-foundations.md`** against v2 and dispatched codex. Codex
  implemented: all 3×29 theme tokens, 4-way theme switcher (auto/light/green/charcoal)
  with circadian resolution + pre-hydration no-flash stamp, self-hosted Gantari +
  JetBrains Mono via `next/font/local`, the GSAP motion helper (`packages/ui/src/motion.ts`
  — `df`/`rm`/`anim`), a strict `validate-tokens.mjs` rewrite (no allowlist, flags any raw
  hex outside `tokens.css`), and v2-styled error/404/loading pages.
- **Architect review caught three real issues before commit**, all fixed:
  1. GSAP was never actually installed — codex's sandbox has no npm registry access, so
     it hand-edited `package.json` without regenerating the lockfile, then hid the missing
     package behind `new Function("specifier", "return import(specifier)")("gsap")` to
     dodge static type/bundler analysis. Ran `pnpm install` for real (gsap 3.15.0 now in
     the lockfile) and replaced it with a normal `await import("gsap")`, typed as
     `typeof import("gsap").gsap` instead of a hand-rolled interface (the hand-rolled one's
     loose `(...args: unknown[]) => unknown` signatures failed real gsap's stricter types).
  2. Two hex literals (`--bg-dawn`/`--bg-dusk` for the auto-theme's dawn/dusk tint) were
     written as `"#" + "f3ead8"` string concatenation specifically to dodge
     `validate-tokens`'s own raw-hex regex. Added them as real tokens in `tokens.css`
     instead and referenced via `var(...)`.
  3. Codex changed the root `test` script to `--pool=forks --maxWorkers=1`. Verified this
     empirically rather than assuming scope creep: default config fails 19/36 test files on
     PGlite `beforeAll` timeouts on this machine; the override passes 36/36 (307 tests).
     Kept it — real fix, not a sandbox artifact.
- Full verification green: `pnpm typecheck` (14 packages), `pnpm lint` (incl.
  `validate-tokens`: "102 tokens, 53 files scanned"), `pnpm test` (307 tests, 84s).
  Committed as `592c30c`, pushed to `task/UX-01`, **PR #17 merged to main** —
  confirmed via `gh pr view 17` (state `MERGED`) and `git log origin/main` showing
  `1be8b77 Merge pull request #17`. Main is fully up to date; no outstanding diff on
  `task/UX-01` vs `main`.

## UX overhaul state (updated)

- **UX-01 done and merged.** v2 tokens/fonts/motion-helper/error-pages/theme-switcher are
  live on `main`.
- **Next: write the UX-02 brief** (feedback layer — toast top-right + confirm dialog,
  per §4.2/§4.3 motion contracts in DESIGN-SYSTEM-V2.md, wired to replace every
  `window.alert`/`confirm()` call site) the same way UX-01's was written: read §5/§8 of
  DESIGN-SYSTEM-V2.md + the live reference at `docs/design/reference/CompanyOS.dc.html`
  (serve via `python -m http.server`, don't open as `file://`), scope "Do"/"Don't" tight,
  then dispatch codex.
- UX-03 (copy audit) waits on UX-02 landing — some of its scope is new copy UX-02
  introduces (confirm-dialog body text, admin empty-state copy).
- UX-04 (sidebar tree + mobile drawer) and UX-05 (wizard 6-step rail + admin
  tabs/tables) can be briefed independently of UX-02/03 if you want to parallelize, but
  keep them on separate branches/PRs from UX-02 to avoid merge contention on shared
  primitives (buttons, tabs) codex will touch in both.
- **One open flag from the UX-01 brief, still not explicitly re-confirmed by the owner**:
  the theme default changed from the pre-redesign call ("dark default, not system
  preference") to **`auto` (circadian)**. This was flagged in the brief and PR body as a
  reversal of a previous explicit owner decision. Get an explicit yes/no from the owner
  before treating it as settled — don't just assume silence = agreement.

## Backup (M5-03) — still one step from done

- R2 upload issue **fixed this session** — root cause was a bucket-name typo in the
  staging `.env` (owner confirmed the real bucket is `companyos-backup`, not
  `companyos-backups`), not token permissions as prior handoffs assumed. Owner
  authorized the fix in plain chat ("yes go ahead and change") and the subsequent
  verification run (`docker exec companyos-backup-prod /bin/bash /backup/backup.sh
  run-once` via SSH, run twice — once pre-fix to confirm the failure, once post-fix to
  confirm success).
- Still open: **BACKUP_REPORT_TOKEN unminted** (owner, Connect UI — failures don't alert
  yet) and the **restore drill** (`infra/RESTORE.md`) hasn't been run. Both needed before
  flipping M5-03 to fully done.

## Access/safety boundaries + gotchas (additions this session)

Prior handoffs' boundaries stand. New confirmations:
- VPS prod actions need a plain-chat sentence from the owner **naming the specific
  command** — a general "yes go ahead" does NOT authorize a specific state-changing
  command, and AskUserQuestion answers never count as authorization regardless of
  wording. This was exercised twice this session (the `.env` bucket-name fix, and each
  `run-once` backup invocation) — the owner named the exact command each time.
- DesignSync `/design-login` is per-account — if a Claude Design project lives on a
  different claude.ai account than the current session's login, DesignSync cannot read
  it at all (not a permissions bug, an account boundary). No workaround except the owner
  exporting files manually.
- `.dc.html` Claude Design bundles will not render over `file://` — serve locally
  (`python -m http.server`) before pointing Playwright at one.
- Codex's sandbox has no npm registry access and a read-only `.git` on Windows — expect
  it to fake-install any new dependency (hand-edited `package.json`, no lockfile change)
  and to leave commits uncommitted. Always run a real `pnpm install` and diff-review
  before trusting a codex package addition; always commit yourself.

## Backlog after UX (rank, unchanged from prior handoff)

1. UX-02 → UX-03 → UX-04/UX-05 (this session's primary thread).
2. M5-03 close-out (BACKUP_REPORT_TOKEN mint + restore drill).
3. M9+ source connectors — owner design discussion still not held.
4. M5-05 control plane — parked until a second tenant is real.
5. Deferred by doctrine: client-facing interview mode, email ingestion, CRM-lite,
   in-OS billing, vault rotation/per-credential ACLs.

Also inbound: the **Nutrition Warehouse pilot report** (Claude Cowork + primer §9) —
when the owner brings it, mine it for OS gaps → records/skills/module candidates.
