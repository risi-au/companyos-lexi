# CompanyOS -- Agent Onboarding (point new agents here)

*Stable entry point for any agent. Read top to bottom once (~3 min), then act. Platform-agnostic.*

Canonical process: **TRIP** (`docs/ORCHESTRATION.md`). Hard rules: `docs/CONSTITUTION.md`. Models: `docs/MODEL-POLICY.md`. Ops short path: `docs/ops/COCKPIT.md`.

## 0. Who you are

| If your prompt... | You are | Do |
|---|---|---|
| Points at this file / an issue / a feature or bug request | **Orchestrator** (default) | Triage, plan if needed, dispatch or self-implement per class, gate, review, commit, PR |
| Points at a single brief in `docs/tasks/` and says implement | **Implementer** | Read that brief + module `AGENTS.md`, implement exactly that, do not commit unless told, stop |

Orchestrator context is expensive: open only files that earn their place. Prefer dispatch for non-trivial code (see triage).

## 1. First actions (stop when you know the task)

1. Read `docs/CONSTITUTION.md` (agent conduct + hard rules) if you will touch code.
2. If given **issue #N** or a URL: `gh issue view N` -- that is intake.
3. Reality check: `git status -sb` · `git log --oneline -5` · `gh pr list`
4. Check worktrees before assuming this folder is where code lives: `git worktree list`
5. Newest handoff only if you lack a task: newest `docs/HANDOFF-*.md` (optional)
6. Private auto-memory (if your provider has it) is a **cache only** -- see §9 memory routing. Prefer shared docs over private notes.

## 2. Board (GitHub Issues)

Queue lives on **GitHub Issues** for `risi-au/companyos`.

| Label group | Labels |
|---|---|
| Type | `feature`, `bug` |
| Triage | `needs-triage`, `ready`, `blocked` |
| Size | `trivial`, `standard`, `heavy` |
| Process | `needs-plan`, `in-progress`, `in-review` |

Templates: Feature request, Bug report (`.github/ISSUE_TEMPLATE/`).

Workflow: open/pick issue -> triage -> set size + `ready` -> work branch -> PR with `Fixes #N` / `Closes #N` -> owner merges.

## 3. Triage -- self vs orchestrate

```text
INTAKE -> TRIAGE -> PLAN (if non-trivial) -> IMPLEMENT -> GATE -> REVIEW -> RELEASE
```

| Class | Criteria | Who codes | Plan in `docs/tasks/`? |
|---|---|---|---|
| **Trivial** | Few lines, obvious, low risk, one module | You may implement directly | Optional |
| **Standard** | Multi-file or behavior change | Write plan + brief; dispatch implementer | **Required** |
| **Heavy** | Schema/API/kernel, multi-module, security | Plan + brief; mid/expensive per MODEL-POLICY | **Required** |

State class, assumptions, and model tier out loud. If multiple interpretations exist, present them -- do not pick silently. Confirm with the owner before **expensive** models (`docs/MODEL-POLICY.md`).

Feature plan: `docs/tasks/_TEMPLATE-feature.plan.md`  
Bugfix plan: `docs/tasks/_TEMPLATE-bugfix.plan.md` (repro -> minimise -> fix -> regression test)

## 4. Live environment (verify, do not assume)

- **Dev server**: usually http://localhost:3000, often serving a *task worktree*, not this
  folder. Find which: `Get-NetTCPConnection -LocalPort 3000 -State Listen` -> owning
  process command line shows the worktree path. Restarting it + deleting that worktree's
  `apps/os/.next` is the safe rebuild.
- **Database**: Postgres in Docker, container `companyos-postgres`
  (`docker exec companyos-postgres psql -U companyos -d companyos -c "..."`).
  Gotchas: multi-statement `psql -c` runs in one transaction -- one failure rolls back
  all (run cleanup as separate `-c` calls). Hand-applied migrations also need their
  drizzle bookkeeping row (`hash` = sha256 of the .sql text, `created_at` = journal
  "when") or the next `pnpm db:migrate` dies re-running them. PGlite (used by tests)
  tolerates SQL the real pg driver rejects -- drive new server pages against the Docker
  DB, not just tests. Local Plane 500s when two scope NAMES share initials (identifier
  collision) -- use distinct test-scope names.
  Local test login for UI checks: `verify-bot@dev.local` (root grant) exists in the dev
  DB but its password drifts between sessions -- recipe: sign up a throwaway user via
  `/sign-up`, copy its password hash onto verify-bot
  (`UPDATE account SET password = (SELECT password FROM account WHERE user_id = '<throwaway>' AND provider_id = 'credential') WHERE user_id = '<verify-bot>' AND provider_id = 'credential';`
  -- better-auth tables are singular `user`/`account`, snake_case columns; get the two
  auth ids from `SELECT id, email FROM "user"`), sign in as verify-bot, then delete the
  throwaway: its grant -> principal -> `user` row -> its empty `personal-<principalId>`
  scope, as separate statements. **Local DB content is demo data** -- don't spend
  effort restoring it if a test damages it, but say so.
- **Browser verification**: Playwright MCP tools are available and may already have a
  signed-in session. Use accessibility snapshots + targeted `getComputedStyle` probes;
  screenshots only when judging visuals.
- **Staging**: https://cos-staging.risi.au (VPS, `ssh aios@159.13.38.87`, key-based,
  authorized; `cos.risi.au` does not resolve -- it's reserved for future live, see VPS.md).
  Deploy path is tag-based and staging-first -- never deploy untagged code
  (docs/DEPLOYMENT.md + docs/VPS.md; credentials in gitignored `vps-login.txt`).
- **Gates** (required before done), from repo root:
  `pnpm typecheck && pnpm lint && pnpm test` (PGlite; no dev DB needed for tests).

## 5. Routing table -- read ONLY what the task touches

| Task touches | Read (in order) | Do NOT read |
|---|---|---|
| Any code | `docs/CONSTITUTION.md` | whole codebase |
| One module | that module's `AGENTS.md` | other modules' AGENTS.md |
| UI / styling | `docs/DESIGN-SYSTEM.md` + `packages/ui` AGENTS.md | docs/design/* archives |
| Migrations | `packages/db` AGENTS.md; never hand-edit drizzle meta journal | -- |
| MCP | `packages/mcp` AGENTS.md + DESIGN.md MCP section | -- |
| Big feature / milestone | `docs/DESIGN.md` + relevant overview in docs/tasks | completed unrelated briefs |
| Deploy / infra | `docs/VPS.md`, `docs/DEPLOYMENT.md`, `infra/README` | -- |
| Dispatch CLIs | `docs/SUBAGENTS.md` + MODEL-POLICY | -- |
| Product narrative only | `COMPANYOS-PRIMER.md` | -- |

## 6. Delegation quickstart

Full manual: `docs/SUBAGENTS.md`. Models: `docs/MODEL-POLICY.md`.

```powershell
.\scripts\dispatch-codex.ps1 -Task <name>            # -ServeApp to copy apps/os/.env
.\scripts\dispatch-codex.ps1 -Task <name> -Resume
```

```bash
# codex (default mid lane) -- close stdin
codex exec --sandbox workspace-write -c model=gpt-5.5 -c model_reasoning_effort=medium -C "<worktree>" "<prompt>" < /dev/null
# grok (cheap/second lane) -- --always-approve required to write
grok -p "<prompt>" -m grok-composer-2.5-fast --always-approve --no-auto-update --cwd "<worktree>"
```

Non-negotiables:

- Exit 0 != work done. Always `git status --short` + read the diff.
- **Dispatch commands must START with `grok` / `codex` / `.\scripts\dispatch-codex.ps1`.**
  Prefix-matched allowlists block `cd <worktree> && grok ...`. Use grok `--cwd` / codex `-C`.
- Implementers do not commit by default; orchestrator commits after review.
- Disjoint file boundaries if two lanes share a worktree.
- LIMIT-ALERT monitor; encoding sweep after codex (SUBAGENTS.md).
- Prompt: implement the brief exactly; do not commit; report files changed; gates.

Optional Claude Code + Codex plugin: `docs/OPTIONAL-CLAUDE-CODEX.md`.

## 7. Verify -> commit -> PR (orchestrator)

1. Diff vs plan/brief (surgical? lean? constitution?).
2. Gates yourself: `pnpm typecheck && pnpm lint && pnpm test`.
3. UI check for user-visible changes.
4. Commit on `task/<slug>` or `fix/<slug>`; PR to `main`; **owner merges**.
5. Finish report (ORCHESTRATION.md): files, deviations, undone, gate line.

## 8. Hard rules (rollback territory)

- Never touch: `USER DATA/`, `legacy/` (read-only history), `.env*`, `vps-login.txt`
- Modules never import each other; business logic in `packages/api`; every write emits an event
- Design tokens only in UI; no secrets in docs/issues/logs
- Windows: plain ASCII in source string literals; no BOMs
- Surgical changes only; no drive-by refactors (CONSTITUTION agent conduct)
- Don't create files in the repo while an implementer with "commit everything" runs

## 9. Where learnings go (memory routing -- ALL agents)

Private agent memory (Claude auto-memory, ChatGPT memory, provider-specific stores) is
**invisible to every other agent, account, and machine**. Before writing a learning
anywhere, route it to the most-shared layer it belongs in:

| Learning | Home |
|---|---|
| Repo/tooling/dispatch mechanics (CLI flags, sandbox landmines, verify recipes, env gotchas) | `docs/SUBAGENTS.md` (dispatch) or this file §4 (environment) -- commit it this session |
| A module's contract or behavior | that module's `AGENTS.md`, in the same commit as the change |
| Process / TRIP / model policy | `docs/ORCHESTRATION.md`, `docs/MODEL-POLICY.md`, or this file |
| Session exit state (in-flight work, next step) | newest `docs/HANDOFF-*.md` |
| Machine-wide, cross-project agent conventions | `~/.agents/` (owner-managed -- propose, don't edit) |
| Durable business/ops knowledge | the CompanyOS wiki via MCP (the product IS the shared memory) |
| Mechanics only your own runtime cares about (provider quirks, session recipes) | your private memory -- and ONLY those |

**Shared layer first; private memory is a cache.** If an agent on a different account or
provider would benefit from a learning, it must not live only in private memory. Never
point a shared doc at private memory. Private notes should carry pointers INTO the shared
layers, not the other way around.

## 10. When you stop

Refresh `docs/HANDOFF-<date>-<slug>.md` if the session was long or mid-flight. Route new
learnings per §9. Update issue labels. Do not leave a failing gate claimed green. If any
fact in §4 changed (ports, containers, worktree layout), fix it here in the same commit.

## 11. What this repo is (30 seconds)

CompanyOS: self-hosted, AI-native system of record -- Postgres kernel (scopes, principals,
grants, events) + modules in a pnpm/turbo monorepo (`apps/os`,
`packages/api|db|mcp|ui|brain|wizard`). Agents via MCP. Owner: Rishi (risi-au). Full
narrative: `COMPANYOS-PRIMER.md`.
