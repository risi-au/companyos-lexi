# M6-07: Sessions registry (scope-tree session board)

status: done — implemented 2026-07-07 by codex (the most involved remaining
M6 task: new schema+migration, kernel-only service module, four MCP tools,
scope-page UI tab, and a two-line addition to M6-05's session ritual). All
local acceptance criteria verified; architect's own live-verify (two parallel
sessions going stale on staging) still pending the batched deploy pass.
module: packages/api (new module `sessions`) + packages/db + packages/mcp + apps/os
branch: task/M6-07

## Goal

The owner's daily board: Client → Project → Sessions, visible on the scope tree — which
agent sessions exist, on which engine/model, running/waiting/idle/stale — so parallel
work across many clients is trackable from the OS instead of from scattered terminals.
Registration is cooperative (agents/clients call the tools per AGENTS.md ritual); this is
visibility, not orchestration.

## Context

- New module — does NOT touch or replace the agent module's `agent_conversations`
  (resident-agent chat is a different thing; that stays).
- Engines are open-ended text (same convention as capabilities.engine).
- M6-02 mints tokens; a session MAY reference the token/principal it runs under.
- M6-05's managed AGENTS.md session ritual is where register/update/complete instructions
  land for terminal agents (append to that template in THIS task — small addition, marker
  rules apply).
- M6-00 decision 7: no auto wrap-up; stale detection is the safety net.
- Constitution: own schema file + migration; every write emits an event; kernel-only
  imports.

## Do — schema (packages/db, new `sessions.ts` + migration)

`agent_sessions`: id, scope_id (fk cascade), title, engine (text), model (text, nullable),
status (enum: running | waiting | idle | completed | error), token_id (fk, nullable),
principal_id (fk, nullable), worktree_ref (text, nullable), last_heartbeat (timestamptz),
created_by (fk principals), created_at, updated_at. Index (scope_id, status, updated_at).

## Do — API (`packages/api/src/modules/sessions/`)

1. `registerSession(db, { scopePath, title, engine, model?, tokenId?, worktreeRef? }, actor)`
   — editor/agent. Sets status running, heartbeat now. Emits `session.registered`.
2. `updateSession(db, { sessionId, status?, title?, worktreeRef? }, actor)` — bumps
   heartbeat always (a bare call IS the heartbeat). Emits `session.updated` only on field
   changes (not bare heartbeats — event noise).
3. `completeSession(db, { sessionId, summary? }, actor)` — terminal status. Emits
   `session.completed`.
4. `listSessions(db, { scopePath, status?, includeDescendants? }, actor)` — viewer.
   Staleness computed at read time: running/waiting with heartbeat older than a
   configurable idle window (env or param, default 30m) → flagged `stale: true`
   ("needs wrap-up") — no cron, no background job.
5. MCP tools (additive): `register_session`, `update_session`, `complete_session`,
   `list_sessions`.

## Do — UI (apps/os)

1. Sessions section on scope pages: collapsible list showing descendants' sessions rolled
   up at client level (tree feel), each row: title, engine, model, status badge, stale
   badge, age, worktree ref.
2. Does not replace the Connect panel or resident-agent chat — third section.
3. Optional (architect call at review): Connect mint flow gains "name a session too"
   convenience linking token + session at birth.

## Don't

- Don't build heartbeat daemons, cron, or auto-detection of dead terminals — stale is a
  read-time computation.
- Don't auto-commit/push git on session close (out of scope per M6-00).
- Don't touch agent module schema or conversations UI.
- Don't make session registration mandatory for any MCP tool to work.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] Multiple sessions per scope visible; two engines on the same scope = two rows (tested)
- [x] Bare update_session bumps heartbeat without emitting session.updated (tested)
- [x] Session with old heartbeat flagged stale after the configured window (tested with
      injected clock/window)
- [x] Events emitted: registered / updated (field changes) / completed (tested)
- [x] Access: viewer lists, editor/agent registers/updates; subtree inheritance (tested)
- [x] listSessions with includeDescendants rolls up a client's sub-project sessions (tested)
- [x] New module AGENTS.md; MCP AGENTS.md tool list updated; managed AGENTS.md template
      gains the session ritual lines (M6-05 marker rules respected)
- [ ] Architect live-verifies: two parallel real agent sessions on one scope appear and
      one goes stale after idle
