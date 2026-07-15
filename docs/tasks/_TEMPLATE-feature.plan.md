# FEAT-<slug>: <title>

status: todo | in-progress | done
type: feature
issue: #<n>
module: <kernel | module name | infra | multi>
branch: task/<slug>
size: trivial | standard | heavy
triage: self | orchestrate

> TRIP plan. No production code in this file -- design and checklists only.
> Non-trivial work requires this plan (or equivalent) in docs/tasks/ BEFORE code.
> Owner approval: <name, date> (or "pending")

## Overview

<one short paragraph: what exists after this ships that does not today>

## Problem Statement

1. ...

## Solution Architecture

- Reuse existing modules/services where possible (lean ladder).
- List new tables/tools/UI only if required.
- Events emitted on writes: ...

## Implementation Details (file-level)

### 1. <step name>

**File**: `path/to/file`

- What changes (concrete)
- Verify: <check or test>

### 2. ...

## Files to modify

| Path | Change |
|---|---|
| `...` | ... |

## Test impact

- New tests: `packages/api/...` (or near code)
- Gate: `pnpm typecheck && pnpm lint && pnpm test` from repo root

## Don't

- Touch: USER DATA/, legacy/, .env*, vps-login.txt
- Drive-by refactors outside this plan
- Hand-edit drizzle/meta/_journal.json
- Invent scope structure or parallel process docs

## Phased to-dos

- [ ] Phase 1: ...
- [ ] Phase 2: ...
- [ ] Tests green
- [ ] Module AGENTS.md updated if contract changed
- [ ] Adversarial review (standard/heavy)
- [ ] PR to main, links issue

## Acceptance criteria

- [ ] <testable criterion>
- [ ] <testable criterion>

## Finish report (fill when done)

- Files changed: (one line each)
- Deviations from plan: (or none)
- Left undone: (or none)
- Gate: lint: ... | typecheck: ... | tests: N passed
