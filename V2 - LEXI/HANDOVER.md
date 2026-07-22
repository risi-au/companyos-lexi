# HANDOVER — Lexi V2 Experiment Session

*Generated: 2026-07-22. Point any agent at this folder and say "read HANDOVER.md and continue."*

---

## UPDATE — Session 2 (2026-07-22): fork is live + harness hardened

**This is now a real fork, deployed and running. Read this section first.**

### Fork + deploy (isolated from cos-staging)
- Git: `origin` = `github.com/risi-au/companyos-lexi` (private); `upstream` = original `companyos`.
- Deploys to **https://lexi.risi.au** on merge to `main` (separate VPS stack, port 3001, `lexi-*` containers). Full contract in `docs/LEXI-DEPLOY.md`. cos-staging is untouched.
- VPS + Cloudflare + GitHub secrets (`LEXI_SSH_*`) were set up by an agent; Lexi is live (307→/sign-in). `main` @ Shot 0 merged.

### Board + OmniRoute (durable)
- **Launch the board with `V2 - LEXI/start-lexi-board.cmd`** — NOT `cline --kanban` (broken: `kanban@0.1.70` ships no `dist/entry.js`). The board itself works from `dist/cli.js`.
- The board's **AI planner sidebar is broken** (same bug). Do decomposition/execution via **headless cline** or **board cards** (card execution works: worktree-isolated, per-card model override, auto-PR).
- OmniRoute API: `PUT /api/combos/{id}` (Bearer gateway key — held by owner, not committed). Combos are cost-safe; compositions + rules in `OMNIROUTE-CLINE-SETUP.md`.
- **Cost-safety (after a codex-burn incident):** board default = `lexi-mechanical`; `lexi-orchestrator` = codex **sol-medium** (single planning call/shot); `lexi-implementer` leads **kiro-agentic → deepseek-v4-pro** (codex last). `opencode-go` decommissioned. `kiro`+direct `deepseek` adopted.

### Progress
- **Shot 0 (hygiene) — DONE, merged (PR #1).** Primer §7 lists all 64 MCP tools; 3 stale task statuses → `done`.
- **Next: Shot 1 — M11-01 arming ritual** on `lexi-cheap` (no codex). First real-code shot → first live deploy.

### Autonomous `/goal` runner — owner-approved policy
Run shots as **board cards** (visible: Backlog→In Progress→Review→Done), one card per shot, per-card tier. Loop: create card → execute (worktree) → gate (`typecheck && lint && test`) → review (+`lexi-reviewer` for R2) → **auto-merge when green+clean** → deploy → next.
- **Auto-merge** authorized when gate green + review clean.
- **PAUSE and ask only for:** security/secrets/auth, and genuinely ambiguous requirements. (Migrations/R2 proceed autonomously.)
- **Hard-safety guardrail (always):** still confirm before irreversibly deleting data, sending real external messages, or entering credentials.

---

## What happened in this session

### Fork + safety net
- Fresh clone at `C:\dev\companyos-lexi` from origin/main `7e54338`
- Baseline gate: typecheck 14/14, lint 14/14, tests 537/537 passed
- Tag `pre-lexi-2026-07-22` pushed to origin — restore point
- Mirror backup at `G:\BACKUPS\companyos-mirror-2026-07-22.git`
- Original `C:\dev\companyos` untouched

### OmniRoute (http://localhost:20128, API key: `sk-76385974580730b1-029db5-609874ae`)
- Claude OAuth provider **enabled** (was inactive; claude-sonnet-5/opus-4-8 live)
- 9 working providers, 2 codex accounts (generous GPT-5.6), grok-cli dead
- 5 custom combos created:

| Combo | Strategy | Best use |
|---|---|---|
| `lexi-orchestrator` | priority | GPT-5.6-sol → Claude-Sonnet-5 → fallback — the /goal brain |
| `lexi-implementer` | priority | GPT-5.6-terra → Claude-Sonnet-4-6 → fallback — R2/mid shots |
| `lexi-cheap` | lkgp | Cerebras/cf/nvidia/opencode — bulk executor (free/cheap, 7 targets) |
| `lexi-mechanical` | cost-optimized | Groq/cf/cerebras/nvidia — docs/trivial (6 targets, picks cheapest live) |
| `lexi-reviewer` | priority | Claude-Sonnet-5 → DeepSeek-v4 → GLM — cross-vendor review |

- All 5 combos verified routing live (each returns 200 with correct upstream)
- **Do NOT lean on opencode-go** — low limits on that account; it's the LAST target in cheap/reviewer
- Compression: RTK standard active on tool results (instructions preserved, diffs untouched)

### Cline CLI (3.0.46)
- Provider `openai-compatible` registered → OmniRoute
- Headless execution tested: `lexi-mechanical` created a test file successfully
- **Board is now running at http://127.0.0.1:3484** — start cards there!
- Config dir: `%USERPROFILE%\.cline`

### Key files in this folder
- `V2 - LEXI\COS-TO-LEXI-GAP-REPORT.md` — the plan (Kim K3's 10-shot implementation guide)
- `V2 - LEXI\MEMORY-SYSTEM-COMPARISON.md` — supplement (memory architecture analysis)
- `V2 - LEXI\BASELINE-GATE-RECEIPT.md` — clean-fork gate results before any shot
- `V2 - LEXI\OMNIROUTE-CLINE-SETUP.md` — full reproducible setup reference
- `V2 - LEXI\HANDOVER.md` — this file

---

## The plan: 10 shots to build Lexi from COS

**Sequencing:** 0 → 1 → 2 → 3 → **4 (digest early)** → 5 → 7 → 6, with 8's L1/L1b/L2 pulled early, 9 last.

### Critical constraints (the COS constitution)
- Modules never import each other (enforced by `eslint-plugin-boundaries`)
- ALL business logic in `packages/api`
- Every write emits an event
- Markdown canonical + jsonb for flexibility
- Update module `AGENTS.md` in the same commit (the module you touched)
- PR only, never push to main; owner merges
- Gate = `pnpm typecheck` + `pnpm lint` + `pnpm test` (537 tests)

### Shot card assignments (set model in card settings on the board)

| Shot | Card model | Risk flags |
|---|---|---|
| **0 — Hygiene** | `lexi-mechanical` | Trivial: fix 3 stale status lines, update primer tool count 57→63, resolve DNS/doc mismatch, rotate the codex bearer token in cos-learning |
| **1 — M11-01 Arming ritual** | `lexi-cheap` | MCP `registerPrompt` for start/wrap ritual; tool-surface audit doc; OAuth smoke test. Done when: fresh Hermes/Claude client connects OAuth and is guided start→work→wrap without custom prompt |
| **2 — M13-02 Briefed sessions** | `lexi-implementer` | ⚠️ **R2 — DB migration** (sessions gains `brief`/`structured_return` jsonb). Needs owner plan approval per MODEL-POLICY. Verify: migration applies, gate green, wrap-up structured+queryable+reviewable |
| **3 — Assistant bundles** | `lexi-cheap` | Bundle schema in skills repo, reference Meta Ads Assistant from 2026-07-17 session |
| **4 — M13-05 Daily digest** | `lexi-cheap` (escalate to `lexi-implementer` if complex) | **Highest perceived value.** New `digest` module, 5-lane composition, digest as landing surface. This is what makes COS FEEL like Lexi |
| **5 — M13-04 Kickoff gradient** | `lexi-cheap` | Defaulting cascade, kickoff artifact gradient, reuse intake wizard machinery |
| **6 — M13-03 Two-layer capture** | `lexi-implementer` | Platform mirror (Meta via n8n), draft records, reconciliation loop |
| **7 — M13-06 Standing roles** | `lexi-cheap` | Wire assistants as capabilities, approval-queue-proxied autonomy, OS-side scheduling |
| **8 — Lexi Core contracts** | `lexi-implementer` | ⚠️ **Expensive tier, owner-confirmed.** L1 metadata, L1b review_state fix (the verification bug), export/import bundle + 9 conformance tests, engine adapter. Deferred: federation, Individual Lexi |
| **9 — M14 Prod gate** | `lexi-implementer` + `lexi-reviewer` deep review | ⚠️ **R2/security.** Rate limiting, security headers, token hygiene, pnpm audit, e2e smoke, uptime monitoring, external alert delivery, UX P0 fixes |

### Orchestrator flow per shot
1. **Sidebar agent** on kanban decomposes the shot brief into cards (use `lexi-orchestrator` model)
2. Each card gets an **implementer packet** as the card description: allowed files, forbidden actions, "done when" criteria, verify commands
3. Card runs at assigned cheap/mid tier
4. Gate runs: `pnpm typecheck && pnpm lint && pnpm test` in the card's worktree
5. **Review:** diff reviewed on the board (inline comments). For R2 cards (2, 8, 9): also run a separate `lexi-reviewer` pass
6. Escalation: if a cheap card fails gate twice → re-run card at `lexi-implementer`
7. Commit → PR → owner merges (never auto-merge)

### Card packet template
```
TASK: <one line from plan>
ALLOWED FILES: <paths>
FORBIDDEN: <constitution violations to actively avoid>
SUCCESS CRITERIA ("done when"): <from plan>
VERIFY: pnpm typecheck && pnpm lint && pnpm test in worktree
MODULE AGENTS.md: update packages/<module>/AGENTS.md in the same commit
```

### Quick commands
```powershell
# Headless shot (replace model + prompt)
cline -P "openai-compatible" -m "lexi-cheap" -c "C:\dev\companyos-lexi" --auto-approve true "Card prompt here"

# Plan-only decomposition
cline -P "openai-compatible" -m "lexi-orchestrator" -p -c "C:\dev\companyos-lexi" "decompose: <shot description>"

# Gate
Set-Location -LiteralPath "C:\dev\companyos-lexi"; pnpm typecheck; pnpm lint; pnpm test

# OmniRoute status
iwr http://localhost:20128/api/v1/models | % Content  # list all models
```

---

## Where to start now

1. **Open the board at http://127.0.0.1:3484** — it's running
2. **Verify the board loads** (if blank, `npm i -g cline@latest` then `cline --kanban`)
3. **Create the first card for Shot 0** (hygiene — trivial, safe warm-up):
   - Model: `lexi-mechanical`
   - Card prompt: fix 3 stale status lines + update COMPANYOS-PRIMER.md tool count
4. **Review the Shot 0 diff** on the board, commit, PR
5. **Then Shot 1** (arming ritual — the foundation for all of M13)

---

*Date: 2026-07-22. Next agent: read this file, use OmniRoute combos as listed, work in `C:\dev\companyos-lexi`, PR to main, owner merges.*
