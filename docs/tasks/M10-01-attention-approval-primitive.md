# M10-01: attention & approval primitive ("Things to resolve")

Read `docs/tasks/M10-living-wiki-overview.md` first — decisions 2, 6, 7 and the
"Conventions" section govern this brief. This task is the milestone's foundation:
a generic attention-items/proposals construct that wiki canonization, brain lint
findings, graduation, and external gates all consume.

Work in THIS worktree on branch `task/M10-01`. Do NOT commit — the architect commits.

## 1. Schema — `packages/db/src/schema/attention.ts` (new)

Copy conventions from `documents.ts` (uuid pk defaultRandom, scopeId FK cascade,
principal FKs, timestamptz defaultNow, hand-written `interface` + `New` type,
indexes in the table callback). Register with one `export *` line in `schema/index.ts`.

Table `attention_items`:
- `id`, `scopeId` (FK scopes, cascade), `kind` (pgEnum `attention_kind`:
  `wiki_proposal | lint_finding | graduation | external_gate`), `status`
  (pgEnum `attention_status`: `open | approved | rejected | dismissed`),
- `title` text notNull; `summary` text (short human-readable line),
- `payload` jsonb notNull — typed per kind; for `wiki_proposal`:
  `{ slug, title, proposedMd, baseRevisionId?, currentMd? }` (page diff = proposed vs
  current; store both sides so the item is self-contained),
- `createdBy` (principal FK), `resolvedBy` (principal FK, null), `resolvedAt`
  (timestamptz null), `resolutionNote` text null, `createdAt`/`updatedAt`.
- Indexes: `(scopeId, status, createdAt)`, `(kind, status)`.

Run `pnpm db:generate` to produce the migration; never hand-edit
`drizzle/meta/_journal.json`.

## 2. Service — `packages/api/src/modules/attention/` (new module)

Standard 3-file shape (`service.ts`, `attention.test.ts`, `AGENTS.md` — see
`packages/api/src/modules/docs/` as the template). Export via one `export *` line in
`packages/api/src/index.ts`.

Functions (all `(db, input, actorPrincipalId)`; enforce access via the same
resolveAccess patterns other modules use — creating needs editor+ on the scope,
resolving needs admin/owner... check how docs module gates writes and mirror it):
- `createAttentionItem({ scopePath, kind, title, summary?, payload })` → emits
  `attention.created` via `emitEvent` (`packages/api/src/kernel/events.ts`).
- `listAttentionItems({ scopePath?, status?, kind?, includeDescendants?, limit })` —
  root listing must aggregate across scopes the actor can see (mirror how
  listRecords does includeDescendants).
- `countOpenAttentionItems({ scopePath, includeDescendants })` — cheap count for
  banners.
- `resolveAttentionItem({ id, resolution: "approved"|"rejected"|"dismissed",
  note? })` — guards status==="open" (mirror `approveIntakePacket`'s guard style,
  `packages/api/src/modules/intake/service.ts:717`). On **approve** of a
  `wiki_proposal`: apply the proposal by calling the existing `saveDoc` with the
  proposed markdown (actor = the approving human — authorship/verified semantics per
  overview decision 2). On any resolution: emit `attention.resolved` AND create a
  decision record via `createRecord(kind:"decision")`
  (`packages/api/src/modules/records/service.ts:65`) titled from the item, body
  containing what was decided + link `[[slug]]` when a wiki page was involved.

Tests (PGlite like docs.test.ts): create→list→count; approve wiki_proposal applies
the doc and writes decision record + events; reject leaves doc untouched; double
resolve fails; viewer cannot resolve.

## 3. Ask OS interception — `packages/api/src/modules/agent/service.ts`

In `executeToolCall`, the `save_doc` branch (~line 374) currently writes directly.
Change: when the agent targets an EXISTING doc, divert to
`createAttentionItem(kind:"wiki_proposal")` with proposed vs current markdown and
return a message telling the agent the edit was filed for human approval (so the
LLM can relay that). Creating a NEW doc stays direct (it's additive, brain-style
unreviewed) — per overview decision 2 only edits to existing pages need the gate.
Keep `log_change`/`log_decision`/etc. untouched.

## 4. Brain lint findings → attention items — `packages/brain/src/engine.ts`

Where `reportBrainRun` currently packs `lintFindings` into the capability run
report (~545-590): additionally create one attention item per `action==="flagged"`
finding (kind `lint_finding`, payload = the finding object, scopePath = the scope
that was linted). Dedupe: don't create a new open item if one with the same
scope+slug-set+type is already open (check via a targeted select). Alerts stay as
they are (ALERTS.md pattern unchanged).

## 5. MCP tools — `packages/mcp/src/server.ts`

Follow the `registerTool` pattern (see `get_context` at ~250 and `save_doc` at
~1648): 
- `list_attention_items({ scopePath?, status?, limit? })` — text table of items.
- `resolve_attention_item({ id, resolution, note? })` — human-mediated approvals
  from inside tools; same access rules as the service.
And in `getContextBundle` (`packages/api/src/agent.ts`, `sectionMarkdown` pattern):
add a banner line when open items exist: `N items need you — resolve in the OS or
via resolve_attention_item` (count via `countOpenAttentionItems`; do NOT inline
item bodies — banner + count only, per overview "no always-loaded context").

## 6. Home surface — "Things to resolve"

`apps/os/src/app/(app)/s/[...path]/page.tsx` (ScopePage): add a "Things to resolve"
card as the FIRST card of the Overview tab (and root page), server-fetched via the
new service (mirror the `api.listRecords` fetch-then-map pattern, limit 10). Each
row: kind chip, title, age, and for open items Approve / Reject buttons via server
actions (mirror `apps/os/src/modules/intake/actions.ts` approve pattern). For
`wiki_proposal` rows show a compact diff summary (proposed title/slug + first ~200
chars of proposed body); full diff UX is M10-04, keep this minimal. Empty state:
"Nothing needs you."

Use design tokens only; this page was just reworked (ScopeTabs/ScopeTabPanel) —
do not restructure it, just add the card + a small `AttentionCard` component
colocated under `apps/os/src/modules/attention/` (new UI module dir with
`actions.ts` for the server actions, mirroring modules/intake layout).

## 7. Docs

Append a `## Proposals & attention items` section to `docs/patterns/WIKI.md`
covering: two-tier edit gate (decision 2), what becomes an attention item, the
resolve→decision-record trail, and the disagreement convention (attributed variant
blocks — copy wording from the milestone overview "Conventions"). Update the new
module AGENTS.md files (api module + UI module) in the same change.

## Don't

- No chat/threads/Talk surface; no notification poller; no MCP server-push.
- No changes to intake approve flow, alerts pattern, or `recall_memory`.
- No new storage format for proposals — payload jsonb with the shapes above.
- Don't inline attention item BODIES into get_context (banner + count only).
- Don't touch apps/os pages other than ScopePage + the new attention UI module.

## Acceptance

- Migration generates cleanly; `pnpm typecheck && pnpm lint && pnpm test` green.
- Ask OS editing an existing wiki page files a proposal (item visible on the scope's
  Overview + root aggregate) instead of writing; approving it applies the edit,
  emits events, writes a decision record; rejecting leaves the page untouched.
- Brain flagged lint findings appear as open items exactly once.
- `get_context` shows the count banner when items are open; MCP list/resolve tools
  work end to end.
- New tests cover the lifecycle; existing suites untouched and green.
On rate/usage limits print a line starting `LIMIT-ALERT:` and stop.
