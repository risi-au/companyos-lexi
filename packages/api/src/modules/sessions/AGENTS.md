# packages/api/src/modules/sessions - AGENTS.md

Sessions module (M6-07): cooperative registry for active agent/client work sessions on the scope tree. This is visibility, not orchestration; there are no daemons or background heartbeat jobs.

## Purpose
Expose services for agents and UI clients to register, heartbeat/update, complete, and list sessions. Session rows are scoped to `scopes`, can reference a token, and record the authenticated principal running the session.

## Tables
- `agent_sessions` in `packages/db/src/schema/sessions.ts`
  - scope-owned rows with `title`, `engine`, optional `model`, `token_id`, `principal_id`, `worktree_ref`
  - `status`: `running | waiting | idle | completed | error`
  - `last_heartbeat` is bumped by every `updateSession` and `completeSession`

## Contract / Functions
All functions take `db: DB` first and are re-exported from `@companyos/api`.

- `registerSession(db, { scopePath, title, engine, model?, tokenId?, worktreeRef? }, actor)`: editor/agent. Inserts a `running` session, sets heartbeat, emits `session.registered`, and returns the row.
- `updateSession(db, { sessionId, status?, title?, worktreeRef? }, actor)`: editor/agent on the session scope. Always bumps heartbeat. Emits `session.updated` only when one of the mutable fields changes.
- `completeSession(db, { sessionId, summary? }, actor)`: editor/agent. Sets `completed`, bumps heartbeat, emits `session.completed`.
- `listSessions(db, { scopePath, status?, includeDescendants?, idleWindowMs? }, actor)`: viewer. Returns rows with `scopePath` and read-time `stale` flag. Descendant mode follows the records module subtree pattern.

## Events
- `session.registered` payload: `scopePath`, `sessionId`, `title`, `engine`, `model`
- `session.updated` payload: `sessionId`, `scopePath`, `changed`
- `session.completed` payload: `sessionId`, `scopePath`, `summary`

Bare heartbeat updates must not emit `session.updated`.

## How to test
- `pnpm --filter @companyos/api test -- sessions`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

## Do / Don't
- Do use kernel `requireAccess`, `getScope`, and `emitEvent`.
- Do compute staleness at read time only.
- Do not add cron, daemons, auto wrap-up, or hard session enforcement.
- Do not touch resident-agent conversation schema or UI.
