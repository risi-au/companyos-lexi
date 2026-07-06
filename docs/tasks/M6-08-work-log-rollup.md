# M6-08: Work Log rollup (records across the subtree)

status: done — implemented 2026-07-06 by codex. listRecords gains includeDescendants
(branch-matched via scopes.path join, root special-cased to mean "everything"),
additive scopePath on each row, byte-identical default behavior. New Work Log tab
+ apps/os/src/modules/worklog/ (kind/since/scope-text filters).
module: packages/api (records) + apps/os
branch: task/M6-08

## Goal

The company-wide work log: any scope can list records from its whole subtree, so the root
scope answers "everything done across all clients this week" and every client node rolls
up its sub-projects. Today `listRecords` is exact-scope only (verified) — records written
at leaf scopes are invisible from above, so no cross-client log exists.

## Context

- `packages/api/src/modules/records/service.ts` — `listRecords({scopePath, kind?, since?,
  limit?})`, exact scope. Records hang off `scope_id`; scopes carry materialized `path`.
- Access model: viewer on the REQUESTED scope; subtree grants already inherit downward via
  kernel ancestor walk, so a viewer on `airbuddy` is a viewer on all its descendants —
  rollup leaks nothing they couldn't read scope-by-scope.
- UI: scope pages (`apps/os/src/app/(app)/s/[...path]/page.tsx`) show "Recent records"
  (limit 8) on Overview and events on Activity.
- Root scope = company-wide view (DESIGN §scope tree).

## Do

1. Extend `listRecords` with `includeDescendants?: boolean` (default false — existing
   callers unchanged): resolve the scope, then match records whose scope path is the
   scope or a descendant (branch semantics — same matching rule as skills scope patterns;
   use the scopes `path` column, e.g. `path = X OR path LIKE X || '/%'` via a join).
   Each returned record gains `scopePath` so the reader knows where it came from.
2. Keep existing filters (kind, since, limit with the 200 clamp) working in rollup mode;
   newest-first across the subtree.
3. UI — "Work Log" tab on scope pages (alongside Overview / Activity / Docs / Canvas /
   Dashboard): rolled-up records list with filters — kind, since (date presets), and a
   client/sub-scope text filter; each row shows scope path, kind badge, title, date, and
   links to the record. At root this IS the global work log; on a client it's that
   client's full history.
4. Update records module AGENTS.md + apps/os AGENTS.md.

## Don't

- Don't change the default (exact-scope) behavior of listRecords — additive param only.
- Don't roll up events/Activity in this task (noise; records are the curated log). If
  trivially shareable, the same helper may be extracted, but no events UI changes.
- Don't add search/FTS here (M6-09) — this is listing + filters only.
- No schema changes at all.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] includeDescendants returns leaf-scope records from an ancestor; sibling branches
      excluded (tested with two-client tree)
- [x] Default behavior byte-identical for existing callers (existing tests unchanged)
- [x] Rollup respects viewer access on the requested scope; a principal without a grant
      on the requested ancestor is denied even if granted on a descendant (tested)
- [x] kind/since/limit filters work in rollup mode; ordering newest-first (tested)
- [x] Work Log tab renders scope path + filters; root shows records from multiple clients
- [x] Records module AGENTS.md updated
- [ ] Architect live-verifies on staging: records logged on two clients' sub-scopes both
      appear in the root Work Log
