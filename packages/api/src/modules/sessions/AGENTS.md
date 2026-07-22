# packages/api/src/modules/sessions - AGENTS.md

Sessions module (M6-07): cooperative registry for active agent/client work sessions on the scope tree. This is visibility, not orchestration; there are no daemons or background heartbeat jobs.

## Purpose
Expose services for agents and UI clients to register, heartbeat/update, complete, and list sessions. Session rows are scoped to `scopes`, can reference a token, and record the authenticated principal running the session.

## Tables
- `agent_sessions` in `packages/db/src/schema/sessions.ts`
  - scope-owned rows with `title`, `engine`, optional `model`, `token_id`, `principal_id`, `worktree_ref`
  - `status`: `running | waiting | idle | completed | error`
  - nullable `brief` (jsonb SessionBrief): optional structured kickoff with goal, contextRefs, kickoffArtifactRef, expectedReturn
  - completed wrap-up fields: nullable `summary` and nullable `citations` array using the memory `Citation` shape, nullable `structured_return` (jsonb SessionStructuredReturn) with outcome, artifacts, recordsLogged, humanInterventions, friction, followUps
  - `last_heartbeat` is bumped by every `updateSession` and `completeSession`

## Contract / Functions
All functions take `db: DB` first and are re-exported from `@companyos/api`.

- `registerSession(db, { scopePath, title, engine, model?, tokenId?, worktreeRef?, brief? }, actor)`: editor/agent. Inserts a `running` session, sets heartbeat, emits `session.registered`, and returns the row. Optional `brief` (SessionBrief) is validated for a non-empty goal.
- `getSession(db, sessionId, actor)`: viewer read of one session by id including brief. Supports join-by-id (a second tool reads the brief, then heartbeats via updateSession).
- `updateSession(db, { sessionId, status?, title?, worktreeRef? }, actor)`: editor/agent on the session scope. Always bumps heartbeat. Emits `session.updated` only when one of the mutable fields changes.
- `completeSession(db, { sessionId, summary?, citations?, structuredReturn? }, actor)`: editor/agent. Sets `completed`, stores wrap-up summary/citations/structuredReturn, bumps heartbeat, emits `session.completed`. Optional `structuredReturn` (SessionStructuredReturn) is validated for a non-empty outcome and included in the event payload.
- `listSessions(db, { scopePath, status?, includeDescendants?, idleWindowMs? }, actor)`: viewer. Returns rows with `scopePath` and read-time `stale` flag. Descendant mode follows the records module subtree pattern.

## Events
- `session.registered` payload: `scopePath`, `sessionId`, `title`, `engine`, `model`
- `session.updated` payload: `sessionId`, `scopePath`, `changed`
- `session.completed` payload: `sessionId`, `scopePath`, `summary`, `citations`, `structuredReturn`

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
