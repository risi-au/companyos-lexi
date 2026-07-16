# FEAT-connected-apps-list: Connected apps section in ConnectPanel

status: in-progress
type: feature
issue: #67 (M11 decision 12 visible half, follow-up to the closed #53 arc)
module: apps/os connect (UI only)
branch: task/M11-connected-apps-list
size: standard (two files, render-only; no schema/service changes)
triage: orchestrate (codex plugin lane, gpt-5.6-terra)

> TRIP plan. No production code in this file -- design and checklists only.
> Owner approval: Rishi, 2026-07-16 (handoff Task 1 + lane confirmed in-session)

## Overview

The Connect tab shows the signed-in user's OAuth-connected apps (Claude Code, ChatGPT, ...)
next to the existing worker-tokens table. Today the data layer exists and is tested
(`listOAuthConnections`) but nothing renders it; after this ships, decision 12's
user-visible half is done.

## Problem Statement

1. M11 decision 12 (amended 2026-07-16) promised a connected-apps list; only the service
   layer landed with the #53 arc.
2. Users who connect via the OAuth wizard have no way to see which apps are connected or
   when they were last seen.

## Solution Architecture

- Reuse `api.listOAuthConnections({ principalId: actor }, actor)` — already re-exported
  from `@companyos/api` and covered by `packages/api/src/modules/connect/connect.test.ts`.
- One new "use server" action following the existing `actions.ts` pattern (actor from
  `getCurrentActorPrincipalId()`, throw on missing session).
- Render-only client-side section in `ConnectPanel.tsx`, fetched in the existing
  `refresh()` `Promise.all`.
- No writes → no new events. No schema, service, or MCP changes.

## Implementation Details (file-level)

### 1. Server action

**File**: `apps/os/src/modules/connect/actions.ts`

- Add `listOAuthConnectionsAction()` mirroring `listConnectionTokensAction` (no args:
  connections are per-principal, not per-scope; no `since` filter).
- Verify: typecheck; action returns rows for the signed-in principal.

### 2. Connected apps section

**File**: `apps/os/src/modules/connect/ConnectPanel.tsx`

- New section between the `ConnectWizard` card and the worker-tokens card.
- Non-empty: card matching the tokens card conventions (same border/surface/radius
  tokens), header with lucide icon + "Connected apps" + muted subtitle noting these are
  the signed-in user's OAuth apps; table columns App / First used / Last seen using the
  existing `formatDate` helper and `tabular-nums` date cells.
- Empty state: ONE muted line (no card) — matches handoff spec.
- Loading: reuse the existing `loading` state (fetch joins the `refresh()` Promise.all).
- Verify: Playwright against the Docker dev DB (has real OAuth connection rows).

### 3. Module docs

**File**: `apps/os/src/modules/connect/AGENTS.md` — document the new section + action.

## Files to modify

| Path | Change |
|---|---|
| `apps/os/src/modules/connect/actions.ts` | add `listOAuthConnectionsAction` |
| `apps/os/src/modules/connect/ConnectPanel.tsx` | add Connected apps section + row type + fetch |
| `apps/os/src/modules/connect/AGENTS.md` | contract update |

## Test impact

- No new tests: service behavior already covered in `connect.test.ts`; no component test
  harness exists for this module (do not introduce one here).
- Gate: `pnpm typecheck && pnpm lint && pnpm test` from repo root + browser check.

## Don't

- Per-app OAuth revoke (needs real refresh-token/consent revocation — separate task).
- Sessions-started counts.
- Schema, service, or `packages/api` changes of any kind.
- Touch: USER DATA/, legacy/, .env*, vps-login.txt; no drive-by refactors.

## Phased to-dos

- [x] Plan + brief (this file + FEAT-connected-apps-list-brief.md)
- [x] Implement (codex CLI lane, gpt-5.6-terra/high — plugin lane died on the
      elevated-sandbox landmine; CLI lane with `windows.sandbox="unelevated"` worked)
- [x] Gates green (orchestrator-run)
- [x] Playwright verification on dev DB (port 3100, throwaway user, seeded demo rows,
      cleaned up after)
- [x] Module AGENTS.md updated
- [ ] PR to main referencing the issue; owner merges

## Acceptance criteria

- [x] Connect tab shows a Connected apps card listing client name, first used, last seen
      for the signed-in principal when connections exist.
- [x] Empty state renders exactly one muted line, no card.
- [x] No new service/schema surface; diff limited to the three files above.
- [x] `pnpm typecheck && pnpm lint && pnpm test` green.

## Finish report

- Files changed: `apps/os/src/modules/connect/actions.ts` (new listOAuthConnectionsAction),
  `apps/os/src/modules/connect/ConnectPanel.tsx` (Connected apps section),
  `apps/os/src/modules/connect/AGENTS.md` (contract update).
- Deviations from plan: none. Implementer note: codex wrote AGENTS.md with CRLF;
  normalized to LF during the encoding sweep.
- Left undone: none (revoke + counts deferred by design).
- Gate: typecheck green | lint green | tests 388 passed (45 files). Browser check:
  empty state = single muted line; seeded card shows named client, client-id fallback
  for NULL name, desc firstUsedAt order, formatted dates.
