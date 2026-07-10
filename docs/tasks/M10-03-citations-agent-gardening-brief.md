# M10-03: citations + agent gardening — implementation brief

Implements decision 9 of `docs/tasks/M10-living-wiki-overview.md` plus the MCP
gardening tools. Ratified scope (overview line 144-146): *loop-level recall-hit
tracking, citations on agent messages + session wrap-ups, wrap-up contract field for
external tools, chips UI, MCP exposure of `rename_doc` / `archive_doc` / backlinks /
link-graph.* M10-03 is independent of M10-01; M10-04 will build on the chips.

**Citation object contract** (overview line 124-126, do not deviate):

```ts
type Citation = {
  slug: string;
  scopePath: string;
  revisionId?: string; // revision at read time
  source: "scope" | "ancestor" | "root-pattern" | "critical-facts" | "personal";
  title?: string; // extension for chip labels; harmless extra
};
```

`"personal"` is forward-compat for M10-02 — include it in the union, nothing emits it
yet. This extends the existing recall-hit shape; **no new retrieval machinery**.

---

## A. Citation type + `revisionId` on recall hits (`packages/api`)

1. Define and export the `Citation` type next to `RecallMemoryHit` in
   `packages/api/src/modules/memory/service.ts` (hit shape at lines 16-27). It is
   re-exported via `packages/api/src/index.ts` (memory exports at lines 52-53).
2. Extend `RecallMemoryHit` with `revisionId: string | null` — the id of the
   document's **latest `document_revisions` row at read time** (table defined in
   `packages/db/src/schema/documents.ts` lines 43-57; revisions have `documentId`,
   `createdAt`). Populate it in `recallMemory`
   (`packages/api/src/modules/memory/service.ts:231-385`) without an N+1 — one extra
   query over the hit set (e.g. `DISTINCT ON (document_id) ... ORDER BY created_at
   DESC`) is fine. Docs with no revision rows get `null`.

## B. Loop-level recall-hit tracking + citations on agent messages

File: `packages/api/src/modules/agent/service.ts`.

1. In `runTurn` (lines 427-566), collect citations from tool calls executed during
   the loop. Tool dispatch is `executeToolCall` (lines 403-420: `search` at 403,
   `recall_memory` at 417-419); tool results are persisted at lines 519-528. Capture
   the **structured** results (not the stringified text):
   - `recall_memory` → map each `RecallMemoryHit` to a `Citation`
     (`slug`/`scopePath`/`revisionId`/`source`, `title` from the hit).
   - `search` → doc-type hits only (`packages/api/src/modules/search/service.ts`
     hits with `type: "doc"`). Set `source: "scope"` (search is scope-scoped; don't
     rebuild recall's `sourceFor` logic for this). Include `revisionId` only if the
     search hit already carries enough to fetch it in the same batched query;
     otherwise omit.
   - Dedupe by `scopePath + slug`, first occurrence wins. Preserve encounter order.
2. Persist citations on the **final assistant message**: the `persistMessage` call at
   line 541 currently writes `{ text: finalText }` into the jsonb `content` column —
   write `{ text: finalText, citations }` when citations is non-empty; omit the key
   entirely when empty. No schema change needed (`agentMessages.content` is jsonb;
   `loadHistory` at lines 260-289 passes unknown keys through untouched).
3. Add `citationCount: number` to the `agent.turn_completed` event payload (emit at
   lines 550-563).
4. Include the citations in `RunTurnResult` (lines 157-161) so the HTTP/UI path gets
   them on the live turn, not just on history reload.

## C. Session wrap-up storage + external-tool contract

1. Schema (`packages/db/src/schema/sessions.ts`): add to `agentSessions`:
   - `summary` — nullable text.
   - `citations` — nullable jsonb (array of `Citation`).
   Generate the migration with drizzle-kit per `packages/db` AGENTS.md. **Never
   hand-edit `drizzle/meta/_journal.json`.** Do NOT run the migration against the dev
   DB — the architect applies it after review; tests run on PGlite.
2. `completeSession` (`packages/api/src/modules/sessions/service.ts:213-248`):
   - `CompleteSessionInput` (lines 36-39) gains `citations?: Citation[]`.
   - Persist `summary` and `citations` onto the session row (today `summary` is
     event-payload-only — that's the gap being closed).
   - `session.completed` event payload (lines 236-245) carries both.
3. MCP `complete_session` (`packages/mcp/src/server.ts:446-470`, input at 451-454):
   add optional `citations` input — zod array of `{ slug, scopePath, revisionId?,
   source? }` (default `source` to `"scope"` when absent). Description should tell
   external tools to report which wiki pages informed the session. This is the
   "wrap-up contract field for external tools".

## D. Chips UI (`apps/os`)

1. **Chat**: `apps/os/src/modules/agent/AgentChatPanel.tsx`, assistant branch of
   `renderMessage` (lines 124-130). When `content.citations` is a non-empty array,
   render a chip row under the `<ReactMarkdown>` block. Chip label:
   `title ?? slug`; each chip is a Next `<Link>` to
   `` `/s/${scopePath}?tab=docs&doc=${encodeURIComponent(slug)}` `` (the pattern used
   at `apps/os/src/modules/docs/DocsView.tsx:424`). Reuse the metadata-chip styling
   from `apps/os/src/modules/docs/DocEditor.tsx:274-285` (token-based span:
   `rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--muted)]
   px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)]
   text-[var(--muted-foreground)]`). A small local component in the agent module is
   right; do NOT create a shared `packages/ui` chip component (M10-04's call).
2. **Sessions**: `apps/os/src/modules/sessions/SessionsView.tsx` (table at lines
   129-176). For completed sessions with a stored wrap-up, show the summary and the
   same citation chips — a compact expandable row or a line under the session row;
   keep it minimal, no redesign. Extend the sessions fetch to include the two new
   columns.

## E. MCP gardening tools (`packages/mcp/src/server.ts`)

The API layer is already done — expose it. Register four tools following the
`save_doc`/`revert_doc` pattern (lines 1709-1852: `registerTool` + `ensurePrincipal`
at 233-238 + `formatError` at 89-133), adding imports to the `@companyos/api` block
at lines 24-31:

| Tool | Wraps (`packages/api/src/modules/docs/service.ts`) | Notes |
|---|---|---|
| `rename_doc` | `renameDoc` (line 514) — `{scopePath, slug, newTitle?, newSlug?}` | emits `doc.renamed` already |
| `archive_doc` | `archiveDoc` (line 595) | emits `doc.archived` already |
| `get_backlinks` | `getBacklinks` (line 315) → `Backlink[]` | JSON-stringify result |
| `get_link_graph` | `getLinkGraph` (line 380) → `{nodes, edges}` | JSON-stringify result |

Input schemas mirror the service inputs; descriptions should say these are wiki
gardening tools for agents (rename/archive propagate via existing events/links
machinery — `docLinks` upkeep is already handled by the service functions).

## F. Tests + AGENTS.md

- Vitest (PGlite, run from repo root): extend existing test files for the touched
  modules —
  1. `recallMemory` returns `revisionId` matching the latest revision (and `null`
     when no revisions).
  2. `runTurn` with a mocked LLM that calls `recall_memory` persists a final
     assistant message whose `content.citations` is the deduped mapped array; a turn
     with no recall/search persists no `citations` key.
  3. `completeSession` stores `summary` + `citations` on the row and in the
     `session.completed` payload.
  4. MCP: cover the four new tools at whatever level existing MCP tools are tested;
     if server.ts tools have no test harness, service-level coverage above suffices.
- Update the `AGENTS.md` of every module whose contract changed in the same change
  set: `packages/api` agent + sessions + memory module docs, `packages/mcp`,
  `packages/db`, and `apps/os/src/modules/agent` (and sessions) if they have one.

## Don't

- **No relevance filtering / LLM judgment of which hits "count"** — a citation is any
  recall/search doc hit surfaced during the loop, deduped. Cheap and honest.
- No backlinks panel, on-this-page outline, aliases, unreviewed badges, or any wiki
  surface work — that's M10-04. MCP exposure only.
- No `personal` recall source implementation — M10-02. Type union only.
- No new retrieval machinery, no new storage format: chat citations live inside the
  existing `content` jsonb; only `agent_sessions` gets new columns.
- Don't touch the M10-01 `save_doc` proposal interception in the agent loop
  (`agent/service.ts:375-402`) or the direct-write MCP `save_doc`.
- Modules never import each other; all business logic stays in `packages/api`.
- Don't run DB migrations against the dev database; don't hand-edit drizzle journal.
- Do not commit. Do not touch `USER DATA/`, `legacy/`, `.env`, `vps-login.txt`.

## Acceptance criteria

1. `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
2. A `runTurn` whose model calls `recall_memory` persists the final assistant message
   with deduped `content.citations` conforming to the Citation contract, each with a
   real `revisionId`; `RunTurnResult` carries the same array; `agent.turn_completed`
   payload has `citationCount`.
3. `recall_memory` hits include `revisionId` (latest revision at read time).
4. `complete_session` over MCP accepts `summary` + `citations`; the `agent_sessions`
   row stores both; `session.completed` event payload includes both.
5. MCP server registers `rename_doc`, `archive_doc`, `get_backlinks`,
   `get_link_graph`, each functional against the existing service layer.
6. Assistant messages with citations render clickable chips that navigate to the doc
   page (`/s/{scopePath}?tab=docs&doc={slug}`); completed sessions show wrap-up
   summary + chips.
7. New drizzle migration generated for the two `agent_sessions` columns; journal not
   hand-edited.
8. AGENTS.md updated for every module whose contract changed.
9. Report every file changed. On usage limits print `LIMIT-ALERT:` and stop.
