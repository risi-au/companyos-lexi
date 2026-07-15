# FIX-<slug>: <title>

status: todo | in-progress | done
type: bug
issue: #<n>
module: <kernel | module name | infra>
branch: fix/<slug>
size: trivial | standard | heavy
triage: self | orchestrate

> TRIP bugfix plan. Diagnosis before patch. No production code in this file.
> Owner approval: <name, date> (or "pending")

## Symptom

What the user/agent sees. Link issue #<n>.

## Repro

1. Steps that fail reliably
2. Expected vs actual
3. Environment (local / staging / which worktree)

## Minimise

Smallest failing path (file + function if known). What is *not* involved.

## Hypotheses (ranked)

1. ...
2. ...

## Root cause

(filled after diagnosis -- not guessed)

## Fix plan (surgical)

### 1. <change>

**File**: `path`

- What changes
- Verify: <check>

## Regression test

- Failing test first (red), then fix (green)
- Path: `...`

## Files to modify

| Path | Change |
|---|---|
| `...` | ... |

## Don't

- Fix adjacent "while I'm here" issues (file a new issue instead)
- Broad refactors
- Secrets or live DB migrations from the task

## Acceptance criteria

- [ ] Repro no longer fails
- [ ] Regression test covers the bug
- [ ] Gate green: `pnpm typecheck && pnpm lint && pnpm test`
- [ ] No drive-by file changes

## Finish report (fill when done)

- Files changed: (one line each)
- Deviations from plan: (or none)
- Left undone: (or none)
- Gate: lint: ... | typecheck: ... | tests: N passed
