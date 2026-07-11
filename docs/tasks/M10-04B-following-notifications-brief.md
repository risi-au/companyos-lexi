# M10-04B — Per-page Following + notifications + brain project-overview page

*Implementer brief. Read this + `packages/api/src/modules/docs/AGENTS.md` +
`packages/api/src/modules/attention/` + `packages/db/AGENTS.md`. Implement exactly this,
nothing else. Do NOT commit. All line refs verified against `main @ d91d033`.*

Second half of M10-04 in `docs/tasks/M10-living-wiki-overview.md` (lines 147-151,
decisions 6 + 8). Owner design call (2026-07-11, settled — do not revisit):

- **Delivery = coalesced `page_update` attention kind.** New `attention_kind` enum value
  `page_update`, **dismiss-only** lifecycle, rendered in a separate **"Following"**
  section of "Things to resolve" below the decision items. Flood control by coalescing:
  at most ONE open item per (followed page, follower); each further change **updates that
  open item in place** (latest event + change count) instead of inserting a new row.
  Dismissing clears it; the next change after dismissal creates a fresh item.
- **Auto-follow on author/verify.** Creating a page auto-follows its author; clicking
  Verify auto-follows the verifier — **human principals only** (the brain/agents must not
  auto-follow pages they author). Explicit Follow/Unfollow toggle on the wiki page for
  everyone. **No backfill** for pre-existing pages.

## Do

### 1. Schema (`packages/db`)

1. **`docFollows` table** in `packages/db/src/schema/documents.ts`, directly after
   `docLinks` (:97-116 — copy its style):
   - `documentId` uuid FK → `documents.id` cascade delete
   - `principalId` uuid FK → `principals.id` cascade delete
   - `createdAt` timestamptz default now
   - unique index on `(documentId, principalId)`; index on `principalId`.
   - Export a `DocFollow` interface matching the file's existing typed-model pattern.
2. **`attention_items.target_principal_id`**: nullable uuid FK → `principals.id`
   (`onDelete: "cascade"`), in `packages/db/src/schema/attention.ts` (:27-52). Null =
   scope-visible decision item (all existing rows/behavior unchanged); non-null = the
   item belongs to exactly that principal (used by `page_update`). Add index
   `(target_principal_id, status)`. Extend the `AttentionItem` interface (:54-68) and
   kind union (:57) with `"page_update"` + the new field.
3. **Enum value**: add `"page_update"` to `attentionKindEnum` (:13-18).
4. **Migrations**: run `pnpm db:generate`. If drizzle does not emit the
   `ALTER TYPE "attention_kind" ADD VALUE 'page_update'` correctly, hand-write it as a
   plain-SQL migration with a proper `drizzle/meta/_journal.json` entry (NEVER hand-edit
   existing journal entries). Postgres note: the added enum value cannot be *used* by DML
   in the same migration/transaction that adds it — keep the ADD VALUE in its own
   migration/statement, before anything that references it. Do NOT apply migrations to
   any live DB; the architect handles that.

### 2. Follow service (`packages/api/src/modules/docs/`)

New `follows.ts` (or extend `service.ts` if <100 lines; keep the module's style):

- `followDoc(db, {scopePath, slug}, actor)` / `unfollowDoc(db, {scopePath, slug}, actor)`
  — viewer permission suffices to follow; idempotent upsert/delete; each emits an event
  (`doc.followed` / `doc.unfollowed`, payload `{slug, documentId, principalId}` —
  constitution: every write emits an event).
- `isFollowing(db, {scopePath, slug}, actor)` and `listFollowers(db, documentId)` helpers.
- **Auto-follow**: in `saveDoc` on the *create* path only, and in `verifyDoc`, upsert a
  follow row for the actor **iff the actor is a human principal**. Idempotent; must not
  fail the save/verify if the row already exists.

### 3. Notification fan-out (inline — there is NO event-subscriber/worker framework; do not build one)

Shared helper `notifyFollowers(db, {documentId, scopeId, scopePath, slug, title,
eventType, actor})` in the docs module, called after the event emission in each of:

- `saveDoc` → after `doc.saved` (service.ts:441)
- `verifyDoc` → after `doc.verified` (:542)
- `renameDoc` → after `doc.renamed` (:890)
- `archiveDoc` → after `doc.archived` (:944)
- `revertDoc` → after `doc.reverted` (:1059)

Behavior:

1. Load followers of the doc, **excluding the actor** (no self-notification).
2. Per follower: look up an **open** `page_update` item with
   `targetPrincipalId = follower` whose `payload.documentId` matches (query by
   kind+status+target index, match documentId in JS — volumes are small).
   - **Exists** → update in place: `payload.lastEventType`, `payload.lastActorId` (+
     display name if cheaply available), `payload.changeCount + 1`, refresh
     `payload.slug`/`payload.title` (renames), bump `updatedAt`, emit an
     `attention.updated` event.
   - **Missing** → `createAttentionItem` (attention `service.ts:135`) with
     `kind: "page_update"`, the doc's `scopeId`, `targetPrincipalId: follower`,
     `createdBy: actor`, title like `"<title>" changed`, payload
     `{documentId, slug, scopePath, title, lastEventType, lastActorId, changeCount: 1}`.
3. Failures in fan-out must not roll back or fail the doc write — same transaction is
   fine, but no throwing after the doc mutation succeeded (wrap + log).

### 4. Attention module changes (`packages/api/src/modules/attention/service.ts`)

- `createAttentionItem` (:135): accept optional `targetPrincipalId`.
- `listAttentionItems` (:175) + `countOpenAttentionItems` (:222): take the viewing
  principal; return items where `target_principal_id IS NULL` **or** `= viewer`. Other
  principals' targeted items must never appear anywhere (list, counts, get_context
  banner, MCP).
- `resolveAttentionItem` (:280): `page_update` items are **dismiss-only** — reject
  `approved`/`rejected` resolutions for that kind with a clear error.

### 5. UI (`apps/os`)

- **Follow toggle** on the wiki page view (`apps/os/src/modules/docs/DocsView.tsx` —
  place beside the existing verify action in the page header): "Follow" / "Following ✓",
  server action per the module's existing `actions.ts` pattern. Visible to any signed-in
  human viewer.
- **"Following" queue section**: `apps/os/src/modules/attention/AttentionCard.tsx` + the
  surface in `apps/os/src/app/(app)/s/[...path]/page.tsx`. `page_update` items render in
  a separate "Following" section *below* the decision items: page title linking to the
  wiki page, last event ("edited by codex", "verified by rishi", "archived", "renamed"),
  "N changes since you last looked" when `changeCount > 1`, and a single **Dismiss**
  button (no approve/reject affordances). Section hidden when empty. Follow the module's
  existing styles — no new design language.
- MCP: `list_attention_items` / `resolve_attention_item` / `get_context`
  (`packages/mcp/src/server.ts` :257/:282/:314) pick up the targeting filter via the
  service changes; verify the authenticated principal is threaded through and dismiss
  works over MCP for `page_update`. Do NOT add follow/unfollow MCP tools.

### 6. Brain-maintained project overview page (`packages/brain/src/engine.ts`)

Decision 8: every top-level project gets a brain-maintained `overview` wiki page —
same treatment as root's `scope-map`/`critical-facts`.

- Mirror `distillRoot` (:1063-…) as `distillProjectOverview`, invoked per scope inside
  the run loop over `targetTopLevelScopes` (call site :453, root distill at :489).
- Content: what this project is, current state, recent-activity digest linking to
  changelog/decision records — inputs from `collectInputs` (:763, records + filtered
  events since watermark). Respect the same token counters/ceilings `distillRoot` takes
  (`runTokenCeiling`, `monthlyTokenBudget`).
- Write via `saveDoc` as the brain/system actor to reserved slug **`overview`** in the
  project's wiki (two-tier gate: brain writes in place; edits are retroactively
  reviewable). **Skip the save when the regenerated body is identical** to the current
  page — a daily no-op rewrite would ping every follower.
- The brain must NOT auto-follow the page (covered by human-only auto-follow) but
  followers DO get notified of real overview updates — that is a feature, not a bug.
- Document `overview` as a reserved slug in `docs/patterns/WIKI.md`.

### 7. Tests (vitest, PGlite — extend the modules' existing test files)

- follows: follow/unfollow idempotency, auto-follow on create + verify (human only —
  agent actor must NOT auto-follow), events emitted.
- fan-out: change to a followed page creates a targeted `page_update` item; second
  change coalesces (still ONE open item, `changeCount: 2`, payload refreshed); actor is
  never notified of own change; dismiss → next change creates a fresh item; rename
  refreshes slug/title in the open item's payload.
- attention: targeting filter (another principal's `page_update` invisible in list +
  count), `page_update` rejects approve/reject, resolves as dismissed.
- brain: overview page created for a top-level project scope on a run; unchanged inputs
  → no new revision/no `doc.saved`.
- All existing tests stay green (351 at last count).

### 8. Docs-with-contract rule

Update in the same change: `packages/api/src/modules/docs/AGENTS.md`,
`packages/api/src/modules/attention/` AGENTS.md (create if missing),
`apps/os/src/modules/attention/AGENTS.md`, `packages/db/AGENTS.md` (new table/column),
`packages/brain` AGENTS.md (overview page), `docs/patterns/WIKI.md` (reserved slug +
following conventions).

## Don't

- No event-subscriber/worker/poller framework; no server push; fan-out stays inline.
- No digest emails, no per-event notification rows, no notification settings UI.
- No MCP follow/unfollow tools; no follow UI anywhere but the wiki page.
- No behavior change to existing attention kinds; no backfill auto-follows.
- No second storage format; do not touch `USER DATA/`, `legacy/`, `.env`, secrets.
- Do not hand-edit existing `drizzle/meta/_journal.json` entries or existing migrations.
- Do not commit. Do not apply migrations to any live database.

## Acceptance criteria

1. `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
2. Following a page, then a save/rename/archive/verify/revert by someone else, yields
   exactly one open "Following" item for the follower, coalescing across repeated
   changes, dismiss-only, invisible to everyone else.
3. Author/verifier (human) auto-followed; brain/agents never auto-followed.
4. Brain run produces/updates a project `overview` page, skipping no-op rewrites.
5. Every file changed listed in your final report. On limits print `LIMIT-ALERT:` and stop.
