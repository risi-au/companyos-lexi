# apps/os/src/modules/sessions - AGENTS.md

Sessions UI for rolled-up agent/client sessions on scope pages. It shows sessions from the current scope and descendants using the sessions service subtree mode.

## Purpose
Provide a scope-tree session board so parallel agent work is visible from the OS. Reads go through server actions into `packages/api`; no direct database access.

## Files
- `SessionsView.tsx`: client component with status and scope-path filters. Renders scope, title, engine/model, status, stale flag, heartbeat age, worktree reference, and completed-session wrap-up summary/citation chips when present. Now renders the session `brief` (goal) and `structuredReturn` (outcome, follow-ups, friction) in the wrap-up expansion, and offers an "Unreviewed (completed) only" client-side filter. (Durable review-state tracking is a later shot — this filter treats all completed sessions as needing review.)
- `actions.ts`: server action wrapper around `api.listSessions({ includeDescendants: true })`.
- `index.ts`: public export for scope pages.
- `AGENTS.md`: this file.

## Contract
Consumes `listSessions` through `@/lib/api` with:
- `scopePath`
- `includeDescendants: true`
- optional `status`

The service layer enforces viewer access on the requested scope, projects each row's originating `scopePath`, and computes stale state at read time.
Completed rows may include stored `summary` and `citations`; citation chips link to the owning doc page.

## Testing
From repo root:
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

Browser verification: open a scope page, select Sessions, change status/scope filters, and verify descendant sessions remain visible while sibling branches do not.
