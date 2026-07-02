# Build Orchestration Protocol

*How this repo gets built: Claude (Fable) orchestrates and reviews; Grok implements. Coordination happens through files in this repo — never through chat memory.*

## Roles

- **Architect/Reviewer (Claude Fable, in Claude Code):** writes task briefs, reviews every diff against the brief + CONSTITUTION.md, runs tests, merges or writes fix lists. Owns kernel contracts, architecture decisions, and anything an implementer circles on twice.
- **Implementer (Grok, headless):** executes exactly one task brief per run. Invoked as:
  ```
  grok -p "Read docs/ORCHESTRATION.md, then implement docs/tasks/<BRIEF>.md exactly. Respect docs/CONSTITUTION.md." --cwd <repo> --permission-mode acceptEdits --effort high --check
  ```
- **Owner (Rishi):** approves milestones, makes product calls, provides credentials/accounts when needed.

## The loop

1. Architect writes `docs/tasks/M<x>-<nn>-<slug>.md` (template below) and creates a branch `task/M<x>-<nn>`.
2. Implementer runs on that branch. Commits with message `M<x>-<nn>: <summary>`.
3. Architect reviews: diff vs brief, constitution compliance, tests pass.
   - **Pass** → merge to main, mark brief `status: done`, next brief.
   - **Fail** → write `docs/tasks/<BRIEF>.review.md` with a concrete numbered fix list; implementer re-runs with the review file as input; repeat (max 2 cycles, then architect takes over the task).
4. Milestone complete → owner walkthrough → tag release.

## Rules for implementers

- Touch only files the brief names or that live inside the brief's module.
- Never modify: `docs/DESIGN.md`, `docs/CONSTITUTION.md`, kernel schema, MCP tool signatures — flag instead if the brief seems to require it.
- Update the module's `AGENTS.md` in the same commit.
- Acceptance criteria → tests, in the same commit. If a criterion can't be met, say so in the commit body; don't fake it.

## Task brief template

```markdown
# M<x>-<nn>: <title>
status: todo | in-progress | done
module: <kernel | module name | infra>
branch: task/M<x>-<nn>

## Goal
<one paragraph — what exists after this task that didn't before>

## Context
<pointers to DESIGN.md sections, existing files, prior tasks>

## Do
<numbered, concrete steps>

## Don't
<explicit exclusions and files not to touch>

## Acceptance criteria
<checklist — each one testable>
```
