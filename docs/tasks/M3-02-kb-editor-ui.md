# M3-02: KB editor UI (BlockNote, Docs tab)
status: done
module: web (apps/os)
branch: task/M3-02

## Goal
A **Docs** tab on every scope page: doc list, Notion-style editing via BlockNote, markdown in/out through the M3-01 services. A human edits the same documents agents write via MCP.

## Context
- KB services merged (`packages/api/src/modules/docs/`): saveDoc/getDoc/listDocs/renameDoc/archiveDoc/listRevisions/revertDoc. **Markdown is canonical** — the editor converts md→blocks on load and blocks→md on save (BlockNote's `blocksToMarkdownLossy` / `tryParseMarkdownToBlocks`). Constrain content to markdown-representable blocks: do not enable BlockNote features that don't survive the round-trip (no multi-column; images allowed as markdown image links only).
- Use `@blocknote/core` + `@blocknote/react` + its shadcn-compatible view package (verify current package names/setup via web — the ecosystem moves).
- Theming: BlockNote must inherit our tokens (map its CSS variables to ours: background/surface/foreground/muted/border/primary; light+dark). No visual clash with the shell.
- Data path: client editor component; saves via **server actions** calling the service layer with the session principal (CONSTITUTION §2). Debounced autosave (1.5s idle) + explicit save indicator ("Saved · 12:04" / "Saving…").

## Do
1. **Docs tab** on scope page (after Dashboard/Overview/Activity): two-pane layout — left: doc list (title, updated date; archived hidden; "+ New doc" button, inline rename via double-click, archive via context/hover menu with confirm); right: editor pane for the selected doc (`?doc=slug` searchParam).
2. Editor component `apps/os/src/modules/docs/DocEditor.tsx`: BlockNote instance, md→blocks on mount, blocks→md on change (debounced autosave via server action), save state indicator, read-only mode when the session principal only has viewer access (resolveAccess via server → prop).
3. Revision affordance: small "History" popover listing last 10 revisions (date, by whom) with a Restore button (calls revertDoc, reloads).
4. Empty states: no docs yet ("Create the first doc — agents can also write here via save_doc"); no doc selected.
5. New-doc flow: dialog (title) → saveDoc with empty body → navigate to it.
6. Keep all styling on tokens/primitives; editor container matches card styling of other tabs.
7. Tests: md round-trip guard — a small unit test that runs BlockNote's md→blocks→md conversion (jsdom env) over a fixture doc (headings, lists, code, table, image link, bold/italic) and asserts semantic stability (allow whitespace normalization). UI verified by architect in browser.

## Don't
- No workbench file sync (M4). No comments/collab/multiplayer. No BlockNote AI plugin. No image uploads (markdown links only for now).
- Don't modify KB services except additive needs (flag in commit). Don't touch docs/, legacy/, other modules.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Docs tab: create doc, type rich content, autosave fires, reload shows content (architect browser-verifies)
- [ ] A doc saved via MCP `save_doc` (markdown) renders correctly in the editor, and after human edit remains valid markdown via `get_doc` (architect verifies both directions)
- [ ] Read-only rendering for viewer-role principals
- [ ] md round-trip test passes; BlockNote themed to tokens in light + dark
