# CompanyOS — Agent Onboarding (point new agents here)

*Stable entry point for any agent joining mid-project. It contains no project status —
status goes stale; instead it tells you exactly where to find the current state and which
docs to read for YOUR task, so you start working instead of exploring. Read top to bottom
once (~3 min), then follow the routing table.*

## 0. Who you are

Unless your prompt says otherwise, you are the **architect/orchestrator**
(docs/ORCHESTRATION.md): you write briefs, dispatch implementers, verify, and merge.
**You do not write feature code yourself** — headless implementers (codex, grok) do.
Your context window is the most expensive resource in the loop; every file you open must
earn its place. If you were instead pointed at a single brief in `docs/tasks/`, you are an
**implementer**: read that brief + the module's `AGENTS.md`, implement exactly that,
nothing else, and stop.

## 1. First 5 minutes — establish state (in this order, stop when you know your task)

1. **Auto-memory** (Claude sessions opened in this folder get it automatically): the
   `CompanyOS state` memory is the running truth — open PRs, in-flight branches, what's
   next, known landmines. Trust it over anything below unless it's contradicted by git.
2. **Newest handoff**: `ls docs/HANDOFF-*.md` → read only the newest. It's the previous
   session's exit note.
3. **Reality check** (cheap, always do):
   `git worktree list` · `git log --oneline -5` · `gh pr list`
   Work often lives in sibling worktrees (`C:/dev/companyos-<task>`, one branch each) —
   **check worktrees before assuming the main folder is where the action is.**
4. If the owner gave you a task directly, skip ahead; don't re-derive history you don't need.

## 2. The live environment (verify, don't assume — snapshots go stale)

- **Dev server**: usually http://localhost:3000, often serving a *task worktree*, not this
  folder. Find which: `Get-NetTCPConnection -LocalPort 3000 -State Listen` → owning
  process command line shows the worktree path. Restarting it + deleting that worktree's
  `apps/os/.next` is the safe rebuild.
- **Database**: Postgres in Docker, container `companyos-postgres`
  (`docker exec companyos-postgres psql -U companyos -d companyos -c "..."`).
  Gotchas: multi-statement `psql -c` runs in one transaction — one failure rolls back
  all (run cleanup as separate `-c` calls). Hand-applied migrations also need their
  drizzle bookkeeping row (`hash` = sha256 of the .sql text, `created_at` = journal
  "when") or the next `pnpm db:migrate` dies re-running them. PGlite (used by tests)
  tolerates SQL the real pg driver rejects — drive new server pages against the Docker
  DB, not just tests. Local Plane 500s when two scope NAMES share initials (identifier
  collision) — use distinct test-scope names.
  Local test login for UI checks: `verify-bot@dev.local` (root grant) exists in the dev
  DB but its password drifts between sessions — recipe: sign up a throwaway user via
  `/sign-up`, copy its password hash onto verify-bot
  (`UPDATE account SET password = (SELECT password FROM account WHERE user_id = '<throwaway>' AND provider_id = 'credential') WHERE user_id = '<verify-bot>' AND provider_id = 'credential';`
  — better-auth tables are singular `user`/`account`, snake_case columns; get the two
  auth ids from `SELECT id, email FROM "user"`), sign in as verify-bot, then delete the
  throwaway: its grant → principal → `user` row → its empty `personal-<principalId>`
  scope, as separate statements. **Local DB content is demo data** — don't spend
  effort restoring it if a test damages it, but say so.
- **Browser verification**: Playwright MCP tools are available and may already have a
  signed-in session. Use accessibility snapshots + targeted `getComputedStyle` probes;
  screenshots only when judging visuals.
- **Staging**: https://cos-staging.risi.au (VPS, `ssh aios@159.13.38.87`, key-based,
  authorized; `cos.risi.au` does not resolve — it's reserved for future live, see VPS.md).
  Deploy path is tag-based and staging-first — never deploy untagged code
  (docs/DEPLOYMENT.md + docs/VPS.md; credentials in gitignored `vps-login.txt`).
- **Gates** (green before any merge, run from repo root):
  `pnpm typecheck && pnpm lint && pnpm test` (tests use PGlite; no dev DB needed).

## 3. Routing table — read ONLY what your task touches

| Task touches | Read (in order) | Do NOT read |
|---|---|---|
| Any code at all | `docs/CONSTITUTION.md` (short, non-negotiable) | the whole codebase |
| One module's behavior | that module's `AGENTS.md` (`apps/os/src/modules/<x>/` or `packages/<x>/`) | other modules' AGENTS.md |
| UI / styling / components | `docs/DESIGN-SYSTEM.md` + `packages/ui` AGENTS.md | docs/design/* archives |
| Data model / migrations | `packages/db` AGENTS.md; never hand-edit `drizzle/meta/_journal.json` | — |
| MCP tools / agent surface | `packages/mcp` AGENTS.md + DESIGN.md §6 | — |
| New milestone / big feature | `docs/DESIGN.md` (esp. §7 build order) + `docs/tasks/M<x>-*overview*.md` | completed task briefs |
| Deploy / infra / backups | `docs/VPS.md`, `docs/DEPLOYMENT.md`, `infra/README` | — |
| Dispatching implementers | §4 below, then `docs/SUBAGENTS.md` for failure modes | — |
| Product context only (no repo) | `COMPANYOS-PRIMER.md` | — |

## 4. Delegation quickstart (the 90% you need; full manual = docs/SUBAGENTS.md)

Write a brief first — `docs/tasks/<name>-brief.md` with Do / Don't / Acceptance criteria
and **pinned file paths + line refs** so the implementer doesn't re-explore. Then the
one-command path (worktree + ACLs + env + install + dispatch + LIMIT-ALERT monitor +
post-run encoding check; run it in the background and read its final output):

```powershell
.\scripts\dispatch-codex.ps1 -Task <name>            # -ServeApp to copy apps/os/.env
.\scripts\dispatch-codex.ps1 -Task <name> -Resume    # re-dispatch after a broken run
```

Model policy (owner): routine briefs = gpt-5.5 at medium reasoning — the script's
defaults (2026-07-11); TRIP-workflow feature runs = gpt-5.6-terra at high (2026-07-14).
Don't dispatch at gpt-5.6-sol/xhigh (too token-hungry). Manual equivalents:

```bash
# codex (default lane) — headless, background, stdin MUST be closed
codex exec --sandbox workspace-write -c model=gpt-5.5 -c model_reasoning_effort=medium -C "<worktree>" "<prompt>" < /dev/null
# grok (second lane) — --always-approve is what makes it actually write
grok -p "<prompt>" -m grok-composer-2.5-fast --always-approve --no-auto-update --cwd "<worktree>"
```

Non-negotiables (each cost a real incident):
- **Exit 0 ≠ work done.** Always `git status --short` + read the diff. Never trust "gates pass".
- **Dispatch commands must START with `grok` / `codex` / `.\scripts\dispatch-codex.ps1`.**
  The machine allowlist (Claude Code permission rules, added 2026-07-15) is prefix-matched
  against the whole command string — `cd <worktree> && grok …` falls through to the
  permission classifier and may be blocked. Use grok `--cwd` / codex `-C` instead of `cd`.
- Two lanes may share a worktree only with **disjoint file boundaries stated in both prompts**.
- Tell implementers about pre-existing uncommitted changes ("do NOT revert X").
- Implementers **cannot commit** (sandbox). The architect commits after review.
- Arm a limit monitor: grep logs for `^LIMIT-ALERT:|out of credits` (anchored, `grep -a`).
- After codex runs, sweep its files for BOMs/mojibake (`â€`, `âŒ˜`, …) — see the
  encoding memory / SUBAGENTS.md.
- Prompt template: "Read docs/tasks/<brief>.md in this worktree and implement it exactly.
  Do not commit. Verify with tsc/eslint/vitest. Report every file changed. On limits print
  LIMIT-ALERT: and stop."

## 5. Verify → commit → merge (architect only)

1. Diff review against the brief (diffs, not whole files).
2. Root gates: `pnpm typecheck && pnpm lint && pnpm test` — run them yourself.
3. Drive the change in the real app (Playwright) for anything user-visible.
4. Commit on the task branch (`task/<name>` convention), PR to `main`; the **owner merges**
   product PRs unless he's said otherwise. Staging deploy only via tags (§2).

## 6. Hard rules (violating these is how you get rolled back)

- `USER DATA/` — never touch, never commit, never read into context.
- `legacy/` — superseded; historical only.
- Modules never import each other; all business logic in `packages/api`; every write emits
  an event; update the module's `AGENTS.md` in the same commit that changes its contract.
- Don't create files in the repo while an implementer with "commit everything" runs.
- Secrets: `.env`, `vps-login.txt` are gitignored — keep them out of briefs, logs, PRs.

## 7. Where learnings go (memory routing — applies to ALL agents)

Private agent memory (Claude auto-memory, ChatGPT memory, provider-specific stores) is
**invisible to every other agent, account, and machine**. Before writing a learning
anywhere, route it to the most-shared layer it belongs in:

| Learning | Home |
|---|---|
| Repo/tooling/dispatch mechanics (CLI flags, sandbox landmines, verify recipes, env gotchas) | `docs/SUBAGENTS.md` (dispatch) or this file §2 (environment) — commit it this session |
| A module's contract or behavior | that module's `AGENTS.md`, in the same commit as the change |
| Session exit state (in-flight work, next step) | newest `docs/HANDOFF-*.md` |
| Machine-wide, cross-project agent conventions | `~/.agents/` (owner-managed — propose, don't edit) |
| Durable business/ops knowledge | the CompanyOS wiki via MCP (the product IS the shared memory) |
| Mechanics only your own runtime cares about (your provider's permission quirks, your session recipes) | your private memory — and ONLY those |

The rule (owner directive, 2026-07-15): **shared layer first; private memory is a
cache.** If an agent on a different account or provider would benefit from a learning,
it must not live only in your private memory. Never point a shared doc at a private
memory — a previous version of this file did exactly that with the verify-bot login
recipe, which trapped it where only one agent could read it. Private notes should carry
pointers INTO the shared layers, not the other way around.

## 8. When you stop

Write/refresh `docs/HANDOFF-<date>-<slug>.md` (what changed, what's in-flight, exact next
step, open landmines), route any new learnings per §7, and update your private memory's
state pointer if you have one. If any fact in §2 changed (ports, containers, worktree
layout), fix it here in the same commit — this file only works if it never lies.

## 9. What this repo is (30 seconds)

CompanyOS: self-hosted, AI-native system of record for running businesses — Postgres
kernel (scopes tree, principals, grants, events, records) + modules (dashboards, docs/wiki,
canvas, worklog, sessions, credentials, intake) in a pnpm/turbo monorepo (`apps/os` =
Next.js product; `packages/api|db|mcp|ui|brain|wizard`). Agents interact via the MCP server.
Owner: Rishi (risi-au); instance #1: "Brissie Digital". Full narrative: `COMPANYOS-PRIMER.md`.
