# UX-08B (docs lane): wider docs area + frontmatter-safe editing

Owner walkthrough feedback on the UX-07+UX-08 combined build. Work in THIS worktree
(`C:/dev/companyos-ux08`, branch `task/UX-08`). Do NOT commit — the architect commits.
Touch ONLY `apps/os/src/modules/docs/**` and (if needed for editor min-height)
`apps/os/src/app/globals.css`.

## Item 1 — Docs tab has too much empty space; make the docs area bigger

File: `apps/os/src/modules/docs/DocsView.tsx` (~line 400 grid, ~line 455 main column).

Problems (owner, on a wide monitor): the reader/editor column is `max-w-[860px]`
centered with `mx-auto`, leaving large dead gutters left and right; the whole tab
feels mostly empty.

Do:
- Let the doc column use the available width: remove the `mx-auto` centering and raise
  the cap so the card fills the grid column (e.g. drop `max-w-[860px]` entirely; if
  unbounded lines read poorly, cap the PROSE inside the card at a comfortable measure
  like `max-w-[75ch]` while the card itself fills the column).
- Keep the Documents list column at a fixed ~300px on the right (existing
  `min-[820px]:grid-cols-[minmax(0,1fr)_300px]` is fine).
- Raise the reader/editor vertical presence: the read body already flexes; bump
  `.bn-container .bn-editor` min-height in `apps/os/src/app/globals.css` from 380px to
  something like 60vh so edit mode doesn't look like a small box in a tall card.
- Tighten obvious dead padding you find while in there, but stay token-based
  (var(--space-*)) and keep the existing visual language.

Acceptance:
- At ~1700px viewport width the doc card spans the full main column (no centered
  island with big side gutters); the doc list stays ~300px; mobile (<820px) layout
  unchanged; no horizontal scroll.

## Item 2 — Edit mode destroys YAML frontmatter (real data-loss bug, reproduced today)

File: `apps/os/src/modules/docs/DocEditor.tsx` (+ tests in
`apps/os/src/modules/docs/docs.test.ts`).

Reproduced: opening an AI-maintained doc (which starts with a `---` YAML frontmatter
block) in Edit mode hydrates the FULL markdown into BlockNote
(`tryParseMarkdownToBlocks(initialMarkdownRef.current)` — frontmatter included).
BlockNote parses `---` as a horizontal rule / text, and the autosave then persists the
mangled result: frontmatter becomes body text, metadata chips disappear. The read view
already knows how to split it (`parseFrontmatter`), but edit mode ignores that.

Do:
- Before hydrating the editor, split with the existing `parseFrontmatter`: hydrate
  BlockNote with the BODY only; keep the raw frontmatter block (the exact original
  `---\n...\n---\n` text) in a ref.
- On every save path (debounced autosave, Ctrl+S, Done), re-prepend the preserved raw
  frontmatter to the serialized markdown before calling `onSave`. Docs without
  frontmatter must round-trip byte-identical in behavior (nothing prepended).
- Keep the `markdownForSave` dirty-guard semantics (an untouched doc must still save
  its original markdown, frontmatter intact).
- Add unit tests: (a) frontmatter doc → enter edit → save without typing → markdown
  unchanged including frontmatter; (b) frontmatter doc → body edit → saved markdown =
  original frontmatter + new body; (c) no-frontmatter doc unaffected. Pure-function
  level is fine (extract a helper like `reattachFrontmatter(frontmatterRaw, body)`
  and test that + the split logic together).

Don't:
- Don't try to render frontmatter as editable UI — out of scope.
- Don't change server actions or the docs service.

Acceptance:
- Editing an AI-maintained doc and pressing Done leaves its `---` frontmatter intact
  and metadata chips still render in read view; new tests pass.

## Gates
`tsc -b`, `eslint`, `vitest run` for the app. Report every file changed.
On rate/usage limits print a line starting `LIMIT-ALERT:` and stop.
