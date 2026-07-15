# Build Orchestration Protocol (TRIP)

*How work gets done in this repo. Coordination happens through files and GitHub Issues -- never through chat memory alone. Platform-agnostic: Orca, Claude Code, Codex, Grok, or others.*

Entry for new agents: **`ONBOARDING.md`**. Hard rules: **`docs/CONSTITUTION.md`**. Models: **`docs/MODEL-POLICY.md`**. CLI recipes: **`docs/SUBAGENTS.md`**.

## Roles

| Role | Who | Owns |
|---|---|---|
| **Owner** | Rishi | Product calls, merges to main, credentials, expensive-model approval |
| **Orchestrator** | Chat agent (often Claude Fable / frontier) | Triage, plans, briefs, dispatch, verify, commit, PR |
| **Implementer** | Headless/worker agent (codex, grok, ...) | Exactly one brief; no commit by default |
| **Reviewer** | Fresh session/model for non-trivial work | Diff vs plan + constitution; verdict only |

Default: **coordinator commits; implementers never commit** unless the dispatch prompt explicitly says they own commits.

## TRIP loop

```text
INTAKE -> TRIAGE -> PLAN (if non-trivial) -> IMPLEMENT -> GATE -> REVIEW -> RELEASE
```

### 1. Intake

Work starts as a **GitHub Issue** on `risi-au/companyos` (`feature` or `bug` template), or the owner pastes an equivalent request. Prefer an issue so the board stays the queue.

### 2. Triage (decide self vs orchestrate)

| Class | Criteria | Who codes | Plan file? |
|---|---|---|---|
| **Trivial** | Few lines, obvious, low risk, single module | Same agent may implement | Optional |
| **Standard** | Multi-file or behavior change | Plan + implementer dispatch | **Required** |
| **Heavy** | Schema/API/kernel, multi-module, security | Plan + mid/expensive lane per MODEL-POLICY | **Required** |

State the class and assumptions out loud. If unclear, stop and ask the owner (Karpathy: think before coding).

### 3. Plan (non-trivial)

Write under `docs/tasks/` using:

- `docs/tasks/_TEMPLATE-feature.plan.md` or
- `docs/tasks/_TEMPLATE-bugfix.plan.md`

Naming: `FEAT-<slug>.plan.md` / `FIX-<slug>.plan.md` (or legacy `M<x>-...` for milestones).

Plan contains: overview, file-level steps, files-to-modify, test impact, phased to-dos, acceptance criteria. **No production code in the plan.**

### 4. Implement

- Branch: `task/<slug>` (feature) or `fix/<slug>` (bug). Never push directly to `main`.
- Implementer brief (below) pins paths so workers do not re-explore.
- Dispatch: `docs/SUBAGENTS.md` / `scripts/dispatch-codex.ps1`. Models: `docs/MODEL-POLICY.md`.
- Surgical changes only; lean ladder in CONSTITUTION.

### 5. Gate (before claiming done)

From repo root, all green, no exceptions:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

New logic needs tests (service tests in `packages/api`, helper tests near the code). Orchestrator re-runs gates; never trust implementer "green" alone.

### 6. Review (non-trivial)

Fresh session/model reviews the **diff against the plan** + CONSTITUTION.

Verdicts:

- `APPROVED`
- `REQUEST_CHANGES` (concrete fix list; re-run implementer)
- `NEEDS_REWORK` (plan or approach wrong; re-plan)

Cap **5** review rounds. Critical/Major findings block release. Flag drive-by edits and overbuild as Major.

Optional Claude Code path for Codex review: `docs/OPTIONAL-CLAUDE-CODEX.md`. Any fresh model is valid.

### 7. Release

1. Orchestrator commits on the task branch.
2. PR to `main` with `Fixes #N` / `Closes #N`.
3. **Owner merges.** Deploy via existing tag/staging path -- not untagged main.
4. **Stacked PRs (base = another PR's branch): merge strictly bottom-up, one at a
   time, letting each base branch auto-delete BEFORE merging the next** -- GitHub only
   retargets a stacked PR to `main` when its base branch is deleted. Merging a stacked
   PR while its base branch still exists lands it on that BRANCH, not `main` (bitten
   2026-07-15: #60 "merged" 17s after #59 and never reached main; re-landed as #62).
   Orchestrator verifies each landed commit is on `origin/main` before calling it merged.

## Rules for implementers

- Touch only files the brief/plan names or that live inside the brief's module.
- Never modify without flagging: `docs/DESIGN.md`, `docs/CONSTITUTION.md`, kernel schema, MCP tool signatures (if the brief seems to require it, stop and report).
- Update the module's `AGENTS.md` in the same change set when the contract changes.
- Acceptance criteria become tests. If a criterion cannot be met, say so; do not fake it.
- Do not commit unless the dispatch prompt says you own commits.
- On usage limits: print `LIMIT-ALERT:` and stop.

## Implementer brief template

```markdown
# <slug>: <title>
status: todo | in-progress | done
module: <kernel | module name | infra>
branch: task/<slug> | fix/<slug>
issue: #<n>
plan: docs/tasks/<plan-file>.md

## Goal
<one paragraph>

## Context
<pointers to plan, DESIGN.md, module AGENTS.md, pinned paths>

## Do
1. ...

## Don't
- Drive-by refactors
- Commit (unless dispatch says otherwise)
- Touch USER DATA/, legacy/, .env*, vps-login.txt

## Acceptance criteria
- [ ] ...
- [ ] Gates: pnpm typecheck && pnpm lint && pnpm test
```

## Finish report (required when claiming done)

```text
Files changed:
- path -- one line why
Deviations from plan: <none | rationale>
Left undone: <none | list>
Gate: lint: <ok|fail> | typecheck: <ok|fail> | tests: N passed
```

Never claim done with a failing gate. Never mark a plan checkbox the diff does not satisfy.

## Historical note

Older milestone briefs (`M1-...`, `UX-...`) remain valid historical records. New work uses GitHub Issues + FEAT/FIX plans (or milestone overviews when the owner opens a new M-series).
