# UX-07 — Docs surface: layout, read/edit modes, metadata presentation, editor bugs

status: implemented
branch: task/UX-07 (off main @ c9df0b3)

## Context

Owner reviewed the Docs tab on staging (2026-07-10) and wants a cosmetic/UX pass NOW,
ahead of M10-04 (which will rebrand Docs→Wiki and add a structured editor on top of
this surface — do not build any of that here). The docs substrate (documents /
document_revisions / body_md canonical markdown) is ratified and stays exactly as-is:
**every change in this task is render-layer only.**

Current layout: doc list card stacked ABOVE the document card; the document renders
raw frontmatter as body text; the whole doc is always-editable (BlockNote live on
click); editor overlay menus are broken.

## Files you own

- `apps/os/src/modules/docs/DocsView.tsx`, `DocEditor.tsx`, `actions.ts`,
  `docs.test.ts`, `index.ts`
- `packages/api/src/modules/docs/*` — ADDITIVE only (expose doc author kind in the
  list shape; no removals, no signature breaks)
- `packages/ui/src/globals.css` / `tokens.css` ONLY if the BlockNote overlay fix
  genuinely needs theme vars mapped for its popovers (check what exists first)
- Tests for the above.

## Do

1. **Three-column layout.** Document becomes the CENTER column; the documents list
   moves to a RIGHT column (app sidebar remains the left column). Right column:
   compact list rows (title, updated date, revisions/archive actions on hover) +
   "New doc" at top. Keep the existing responsive behavior intact — at the 820px
   breakpoint the right column stacks (list above doc) rather than disappearing.
2. **Split the doc list: people vs AI.** Group the right-column list under two
   headers: "Your docs" (documents whose `createdBy` principal is `human`) and
   "AI-maintained" (`agent`/system principals). Additive change to the docs list
   service/query to carry the author kind — no schema change, no new endpoint.
   Empty groups collapse (don't render a header with no rows).
3. **Read mode by default + explicit Edit.** Opening a doc shows a READ-ONLY render
   (no BlockNote editing surface active, nothing editable on click). A clear "Edit"
   button sits at the top of the doc card; clicking it switches to the existing
   BlockNote editor with the existing autosave PLUS a manual "Save" button and a
   "Done" (exit edit mode) affordance. The "Autosaves as you work / Saved HH:MM"
   status line only appears in edit mode.
4. **Frontmatter presentation.** The YAML frontmatter block (`learned_at`,
   `verified_at`, `stale_after`, `confidence`, etc.) must never render as body
   text/headings in read mode. Parse it and render a compact metadata row of quiet
   chips under the title (e.g. "Verified 7 Jul 2026 · Confidence: high · Review by
   7 Oct 2026"; omit chips for absent keys). `body_md` stays byte-identical in
   storage; edit mode may keep showing the raw frontmatter (fine for now — M10-04
   owns the fancy editor).
5. **Sources accordion.** In read mode, extract the trailing `## Sources` section
   from the rendered body and render it instead as a collapsed accordion at the doc
   FOOTER ("Sources (N)") that expands on click. Presentation-only: the section
   stays in `body_md` and stays visible in edit mode. If a doc has no Sources
   section, no accordion.
6. **Fix the editor overlay bugs** (owner screenshots): the BlockNote slash menu
   ("+" / typing "/") and the text-selection formatting toolbar render with a
   TRANSPARENT background (page bleeds through, unreadable) and stay fixed in place
   while the page scrolls (detach from their anchor). Likely causes to investigate:
   BlockNote/shadcn popover CSS vars not mapped under our `data-theme` maps, and the
   overlay portal positioning vs the scrolling container. Required outcome: menus
   render on an opaque `--raised`-style surface with border/shadow, positioned at
   their anchor, and reposition or close on scroll. Both light and dark themes.
7. **Fix the selection-highlight bug**: clicking a different doc in the list opens
   it but the PREVIOUS doc stays highlighted (e.g. open "Intake Process", "ai-ready
   Wiki" keeps the selected style). Find the actual root cause in DocsView's
   `selectedSlug` handling (likely a sync issue between local state and the
   `initialDocSlug`/URL) — don't paper over it with a second state.
8. **Tests**: update assertions affected by the new list shape/labels; add coverage
   for the frontmatter-parse + Sources-split helpers (pure functions). Suite stays
   green (312 tests currently; new tests on top are fine).
9. Flip this file's status line to `status: implemented` + add a short Deviations
   section if you skip anything, with why.

## Don't

- **No M10-04 scope**: no Docs→Wiki rebrand, no structured page editor
  (Title/Aliases/Definition/Sections), no backlinks panel, no outline, no Following,
  no review states/badges. This is the pre-M10 cosmetic pass only.
- **No storage/schema/API contract changes**: `body_md` byte-identical through a
  read→edit→save cycle when the user changes nothing; no migrations; docs service
  changes additive only; MCP tools untouched.
- No editor swap — BlockNote stays. No new dependencies, no lockfile changes.
- No raw hex (validate-tokens); use theme vars; no direct gsap imports.
- Copy per STRING-AUDIT §6 (no em/en dashes in new UI strings, calm second person).
- Don't touch `docs/design/*`, other `docs/tasks/*`, `USER DATA/`.
- Don't attempt to commit (sandbox denies .git writes; architect commits).

## Acceptance criteria

- [ ] Three columns: sidebar / document / doc list; 820px stacks gracefully.
- [ ] Right list grouped "Your docs" / "AI-maintained" from real author kind.
- [ ] Docs open read-only; nothing editable until "Edit"; edit mode has autosave +
      manual Save + Done; save status only visible in edit mode.
- [ ] Read mode: no raw YAML visible; metadata chips render; `## Sources` renders
      only as a collapsed footer accordion.
- [ ] Slash menu + formatting toolbar: opaque themed surface, correct positioning,
      sane behavior on scroll — both themes.
- [ ] List highlight always matches the open doc.
- [ ] `body_md` unchanged by presentation (verified by a no-op edit round-trip test).
- [ ] `tsc -b`, `eslint`, `vitest` green in-sandbox; orchestrator re-runs real
      `pnpm typecheck/lint/test` after.

If you hit a rate/usage limit, print a line starting `LIMIT-ALERT:` and stop.

## Deviations

- `packages/api/src/modules/docs/service.ts` could not be written from the codex sandbox (writes under that directory were denied while `apps/os` and `packages/ui` were writable). RESOLVED by the architect post-run: `listDocs` now left-joins `principals` and returns `createdByKind` ("human" | "agent" | null), completing the Your docs / AI-maintained grouping end to end.
