# FEAT-scope-archive: Archive projects and scopes

status: done
type: feature
issue: #74
module: kernel + apps/os
branch: feat/scope-archive
size: heavy
triage: self

> TRIP plan. No production code in this file -- design and checklists only.
> Non-trivial work requires this plan (or equivalent) in docs/tasks/ BEFORE code.
> Owner approval: Rishi, 2026-07-16 (ratified issue comment and task brief)

## Overview

Scope admins can archive a scope subtree without deleting data, restore archived subtrees safely, and recover archived roots from the admin settings surface. Normal navigation hides archived scopes while direct URLs show an archived notice.

## Problem Statement

1. `archiveScope` only archives one row and does not enforce admin permission.
2. Archived scopes still appear in the visible navigation tree.
3. There is no restore service or UI, so archived data cannot be recovered safely.

## Solution Architecture

- Extend the existing kernel scope service and status enum; no schema migration or dependency is required.
- Keep Plane projects and all module data untouched; add linked Plane identifiers to the archive event only.
- Reuse the shared confirmation dialog through the existing server-action submit button pattern.
- Events emitted on writes: `scope.archived` and `scope.unarchived`.

## Implementation Details (file-level)

### 1. Kernel archive contract

**Files**: `packages/api/src/kernel/scopes.ts`, `packages/api/src/kernel.test.ts`

- Add admin-gated subtree archive, ancestor-safe subtree restore, archived-list queries, root guard, event payloads, and visibility filtering.
- Keep brain/recall subtree reads inclusive while excluding archived children from normal context/navigation callers.
- Verify with PGlite contract tests for cascade, restore, visibility, listing, and guards.

### 2. Thin app bindings and actions

**Files**: `apps/os/src/lib/api.ts`, `apps/os/src/app/(app)/_components/actions.ts`

- Bind the new services and add authenticated archive/restore server actions with path revalidation and safe redirects.

### 3. Scope and admin UI

**Files**: `apps/os/src/app/(app)/s/[...path]/page.tsx`, `apps/os/src/app/(app)/admin/settings/page.tsx`

- Render an archived direct-access state before loading normal tabs.
- Place Archive in the existing Members admin surface and archived roots with Restore controls in Admin Settings.
- Verify destructive/default confirmation copy and admin-only rendering.

### 4. Navigation callers and docs

**Files**: `packages/mcp/src/server.ts`, `packages/api/AGENTS.md`, `apps/os/AGENTS.md`

- Exclude archived scopes from normal tree/context output without changing brain traversal.
- Record the new service and UI contracts.

## Files to modify

| Path | Change |
|---|---|
| `packages/api/src/kernel/scopes.ts` | Archive/restore/list/visibility services |
| `packages/api/src/kernel.test.ts` | Kernel acceptance coverage |
| `packages/api/src/agent.ts` | Hide archived children in normal context |
| `packages/mcp/src/server.ts` | Hide archived nodes in tree navigation |
| `apps/os/src/lib/api.ts` | Bound service wrappers |
| `apps/os/src/app/(app)/_components/actions.ts` | Archive and restore actions |
| `apps/os/src/app/(app)/s/[...path]/page.tsx` | Archived state and Archive control |
| `apps/os/src/app/(app)/admin/settings/page.tsx` | Archived scopes list and Restore controls |
| `packages/api/AGENTS.md` | Kernel contract update |
| `apps/os/AGENTS.md` | UI/navigation contract update |

## Test impact

- New tests: `packages/api/src/kernel.test.ts`
- Gate: `pnpm --filter @companyos/os typecheck`, `pnpm --filter @companyos/os lint`, and root `pnpm test`

## Don't

- Touch: USER DATA/, legacy/, .env*, vps-login.txt
- Add hard-delete behavior or alter Plane projects
- Filter archived knowledge from brain, memory, or docs recall
- Add a migration or dependency
- Drive-by refactors outside this plan

## Phased to-dos

- [x] Phase 1: Implement and test kernel contract
- [x] Phase 2: Implement actions and UI
- [x] Tests green
- [x] Module AGENTS.md updated
- [x] Self-review against the ratified issue design
- [x] Leave changes uncommitted for architect review

## Acceptance criteria

- [x] Archive cascades through descendants, requires admin, rejects root, and emits one enriched event.
- [x] Restore activates the subtree and any archived ancestors and emits one event.
- [x] Default navigation omits archived scopes while archived knowledge remains recallable.
- [x] Direct archived URLs show a notice and admin-gated Restore action.
- [x] Admin Settings lists only visible top-level archived roots with Restore controls.
- [x] Required typecheck, lint, and root test gates pass.

## Finish report (fill when done)

- Files changed: kernel service/tests; OS API/actions/scope page/admin settings/confirm control; MCP tree; three AGENTS contracts.
- Deviations from plan: none.
- Left undone: release intentionally omitted; owner requested an uncommitted working tree.
- Gate: OS typecheck passed | OS lint passed | root tests 393 passed.
