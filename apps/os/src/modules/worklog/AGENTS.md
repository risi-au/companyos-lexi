# apps/os/src/modules/worklog - AGENTS.md

Work Log UI for rolled-up records on scope pages. It shows records from the current scope and its descendant scopes using the records service subtree mode.

## Purpose
Provide a scoped work history tab for any node in the scope tree. Root acts as the company-wide log; project/client scopes show their full subtree history. Reads go through server actions into `packages/api`; no direct database access.

## Files
- `WorkLogView.tsx`: client component with kind, since preset, and scope-path filters. Renders scope path, kind, title, and date in a compact table.
- `actions.ts`: server action wrapper around `api.listRecords({ includeDescendants: true })`.
- `index.ts`: public export for scope pages.
- `AGENTS.md`: this file.

## Contract
Consumes `listRecords` through `@/lib/api` with:
- `scopePath`
- `includeDescendants: true`
- optional `kind`
- optional `since`
- clamped `limit`

The service layer enforces viewer access on the requested scope and projects each row's originating `scopePath`.

## Testing
From repo root:
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

Browser verification: open a scope page, select Work Log, change kind/since/scope filters, and verify descendant records remain visible while sibling branches do not.
