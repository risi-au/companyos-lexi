# M10-04A: wiki surface — implementation brief

First half of M10-04 (overview `docs/tasks/M10-living-wiki-overview.md` lines 147-151,
decisions 1 + 10). This brief covers: **structured page editor, on-this-page outline,
backlinks panel, unreviewed badges + verify action, aliases (index + wikilink
resolution), wikilink rendering, scope-namespaced browsing, and Wiki wording in the
docs module itself.** Deliberately EXCLUDED (do not build): per-page Following +
notifications, brain-maintained project overview page (both = M10-04B, separate
brief); tab/nav label renames outside the docs module (a parallel M10-06 branch owns
Sidebar.tsx/page.tsx label strings — do NOT rename the tab arrays; `?tab=docs` keys
and route/action names stay everywhere).

Canonical format rule (decision 1, non-negotiable): `body_md` markdown stays the ONLY
storage format. The structured editor is a scaffold over it; round-trips must be
byte-safe for content the form can't express — the markdown wins.

## A. Structured page editor (decision 10, verbatim fields: Title · Aliases ·
Definition · Details · Sections)

File: `apps/os/src/modules/docs/DocEditor.tsx` (+ small helpers, may add a sibling
`structured-editor.ts` for pure mapping logic — keep it pure and unit-testable).

1. Add a **Write mode toggle**: "Form | Markdown" (+ existing Preview/read mode).
   Markdown mode = the existing BlockNote editor (`:154`, `:324-330`) untouched.
2. Form mode fields and their PURE markdown mapping (convention, no new storage):
   - **Title** → the doc title (existing `title` handling; `saveDoc` input).
   - **Aliases** → frontmatter `aliases:` — comma/list input, written as a YAML list
     into the frontmatter block (extend the existing frontmatter helpers
     `parseFrontmatter` `:37` / `reattachFrontmatter` `:55` / `markdownForSave` `:91`;
     they already preserve raw frontmatter — extend to update a single key without
     disturbing others).
   - **Definition** → the lede paragraph (first paragraph after frontmatter, before
     the first `##`).
   - **Details** → remaining body content before the first `##` heading.
   - **Sections** → one entry per `##` heading (title + content textarea), addable/
     removable/reorderable (simple up/down buttons fine).
3. Mapping contract: parse body_md → form; edit; serialize form → body_md.
   Round-trip of a doc that fits the form shape must be byte-stable (modulo the
   edited field). Content that does NOT fit (nested `###`, code fences spanning
   sections, HTML) → form shows those sections as opaque "markdown blocks" (rendered
   textarea of raw markdown) rather than destroying them. Add a unit test like the
   existing BlockNote roundtrip test (`apps/os/src/modules/docs/docs.test.ts`).
4. "Skip for now" on the New-doc modal (`DocsView.tsx:477` modal): creates a stub
   page (title + empty lede) — small addition to the existing create flow.
5. Autosave (`:225` debounce), Ctrl-S (`:233`), `onSaveStateChange`, and the
   frontmatter-preservation ref (`:140,158`) must keep working in form mode.

## B. On-this-page outline + backlinks panel (layout)

File: `apps/os/src/modules/docs/DocsView.tsx` (grid at `:400`), `DocEditor.tsx`.

1. Grid becomes `[minmax(0,1fr)_300px]` → three regions on wide screens
   (`min-[1100px]:grid-cols-[200px_minmax(0,1fr)_300px]` or similar): **outline
   left**, content center, existing doc-list aside right; below the doc list, add a
   **Backlinks panel**. Narrow screens: outline collapses into the content column
   top (or hidden ≤820px), backlinks stay under the aside. Match existing styling
   (inherited-wiki panel `:415-433` is the visual precedent; tokens only, no raw
   hex).
2. Outline: derived from the current doc's `##`/`###` headings (parse body, not
   BlockNote), anchor links that scroll (`id` slugs on rendered headings — add a
   heading renderer to the ReactMarkdown read view `DocEditor.tsx:335`). Read mode
   only.
3. Backlinks panel: new server action `getBacklinksAction` in
   `apps/os/src/modules/docs/actions.ts` wrapping the existing `getBacklinks`
   (`packages/api/src/modules/docs/service.ts:315-357`, returns `Backlink[]` with
   `fromScopePath/fromSlug/fromTitle/resolved`). Render as links to
   `/s/{fromScopePath}?tab=docs&doc={fromSlug}`. Empty state: "No pages link here
   yet."

## C. Unreviewed badges + verify action

1. New service fn `verifyDoc(db, {scopePath, slug}, actorPrincipalId)` in
   `packages/api/src/modules/docs/service.ts`: requires editor role AND a **human**
   principal (`principals.kind === "human"` — reject agent actors with
   AccessDenied); read-modify-write the doc's frontmatter setting
   `verified_at: <ISO date>` and `verified_by: <principal name>` (only frontmatter
   keys touched; body preserved byte-exact; reuse/port the frontmatter helpers —
   note the api-side parser lives at
   `packages/api/src/modules/memory/service.ts:132`, but WRITE helpers exist only in
   DocEditor.tsx — put a small shared read/write util in the docs service, do NOT
   import across modules). Writes a revision like saveDoc does, emits
   `doc.verified` event. Wrap as `verifyDocAction` (actions.ts) and MCP is NOT
   needed (human-only action).
2. **Unreviewed badge rule** (overview conventions, lines 117-120): a page is
   `unreviewed` when its latest revision author is an agent AND
   (`verified_at` absent OR `verified_at` < `learned_at`). Implement the predicate
   in `listDocs` (`service.ts:472-505`) — it already joins principals for
   `createdByKind`; extend to expose `unreviewed: boolean` (latest-revision author
   kind via `document_revisions.saved_by` + frontmatter check needs bodyMd — compute
   from `learned_at`/`verified_at` frontmatter of the current body + latest revision
   author kind; one extra batched query max).
3. UI: amber "Unreviewed" chip in the doc list rows (`DocsView.tsx` grouped list)
   and next to the metadata chips in read mode (`DocEditor.tsx:274-285`); a
   "Mark verified" button (read mode, human sessions are the only UI users) calling
   `verifyDocAction`, which refreshes chips.

## D. Aliases: index + wikilink resolution

1. Frontmatter `aliases:` (YAML list or comma string — parse both) is the source.
2. **Wikilink resolution fallback**: `extractLinksForDocument`
   (`packages/api/src/modules/docs/service.ts:91-157`) — when the exact
   `(scopeId, slug)` lookup (`:132-136`) misses, attempt alias match: a doc in the
   same target scope whose frontmatter aliases contain the link target (normalize:
   lowercase, spaces→hyphens). Batched: load candidate docs' frontmatter once per
   extract, not per link. An alias match counts as resolved (`toDocumentId` set).
3. **Search**: aliases already ride inside body_md for FTS/embeddings (tsvector at
   `search/service.ts:78` covers body_md) — NO index schema change. Just add a test
   asserting an alias term in frontmatter is findable via search.
4. `resolveInboundLinksForDocument` (`:84-89`): after a save adds/changes aliases,
   re-resolve inbound unresolved links to this scope (extend the existing call site
   in saveDoc — it already re-resolves by exact slug; add the alias pass).

## E. Wikilink rendering + scope-namespaced browsing

1. **Render `[[...]]` as links**: in DocEditor's read-mode ReactMarkdown (`:335`),
   pre-process the markdown body: replace `[[target]]` / `[[label|target]]` /
   `[[scope-path:slug]]` with standard markdown links to
   `/s/{scope}?tab=docs&doc={slug}` (current scope when unqualified; parse with the
   same conventions as `parseWikilinks`, docs service `:67-82` — duplicate the tiny
   parser client-side or export it; do not import server service into the client).
   Unresolvable links render with a muted "missing" style (dashed underline) — still
   clickable (target page may be created later via the New-doc flow).
2. **Subtree browsing**: `listDocs` gains `includeDescendants?: boolean` using
   `subtreeCondition` (`service.ts:61-65`, pattern in `getLinkGraph:392-402`),
   returning `scopePath` per row. DocsView doc list: when the current scope has
   sub-scopes with docs, group the list by scope (current scope first, then
   sub-scopes by path) with small scope-path headers — this is the
   "scope-namespaced browsing within a project wiki". Inherited-wiki panel
   (`:415-433`) stays as-is for ancestor wikis.

## F. Wiki wording inside the docs module

Since this brief owns `apps/os/src/modules/docs/**`: update user-facing copy in
DocsView/DocEditor to wiki terminology ("Wiki", "page(s)" instead of "doc(s)") —
e.g. "Your docs"/"AI-maintained" group headers become "Your pages"/"AI-maintained",
modal titles, empty states, button copy. See `docs/tasks/M10-06-audit-report.md`
(committed on a parallel branch — if absent here, apply the principle) for the
audited strings. Do NOT rename: file names, component names, action names, `?tab=`
keys, routes, events, or anything non-display.

## Don't

- No Following/notifications, no doc_follows table, no digest, no brain engine
  changes (M10-04B).
- No tab-label renames in `Sidebar.tsx` / `s/[...path]/page.tsx` (parallel M10-06
  branch owns those files' label strings — avoid editing them at all if possible).
- No second storage format, no new doc columns for aliases/verify (frontmatter is
  the store; decision 1).
- No changes to memory/recall, citations, sessions, attention modules.
- No new deps (BlockNote/ReactMarkdown/remark already present; hand-roll the
  wikilink preprocessing).
- Don't hand-edit drizzle journal (there should be NO migration in this task).
- Do not commit. Do not touch `USER DATA/`, `legacy/`, `.env`.

## Acceptance criteria

1. `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
2. Form mode: create/edit via Title/Aliases/Definition/Details/Sections; switching
   Form↔Markdown preserves content; non-form-shaped markdown survives byte-exact
   through a form edit of an unrelated field (unit-tested roundtrip).
3. Outline renders for `##`/`###` headings and scroll-navigates; hidden/collapsed on
   narrow viewports.
4. Backlinks panel lists linking pages with working cross-scope navigation; empty
   state correct.
5. `verifyDoc`: human editor sets `verified_at`/`verified_by` frontmatter without
   disturbing body; agent actor rejected; `doc.verified` emitted; revision written.
6. Unreviewed badge appears exactly per the convention predicate; disappears after
   verify.
7. `[[link]]`, `[[label|link]]`, `[[scope:slug]]` render as working links in read
   mode; unresolved links get the missing style; alias-only targets resolve in
   `extractLinksForDocument` and count as resolved backlinks.
8. Search finds a page by alias term (test).
9. Subtree browsing: docs of child scopes listed under scope headers via
   `includeDescendants`; single-scope behavior unchanged by default.
10. Docs-module copy says Wiki/pages; no tab keys/routes/API names changed.
11. AGENTS.md updated: `apps/os/src/modules/docs/AGENTS.md`, `packages/api` docs
    module section, search module if touched.
12. Report every file changed with a one-line summary. On usage limits print
    `LIMIT-ALERT:` and stop.
