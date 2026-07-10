# UX-08 — Sidebar v2 (scope tree), fluid content width, themed scrollbars, resizable panel

status: implemented 2026-07-10
branch: task/UX-08 (stacked on task/UX-07 — UX-07 ships first)

## Context

Owner UX review of staging (2026-07-10, second round). Three problems:
(1) content is capped at `max-width:1240px` leaving dead space on wide monitors;
(2) native unthemed scrollbars, fixed 264px sidebar;
(3) the sidebar tree mixes PLACES (projects / scopes / sub-scopes) with VIEWS (the
module list: Dashboard, Docs, Canvas…) at equal weight, auto-expanded, without clear
toggles — it reads as noise and duplicates the page-header tab bar.

Owner-ratified direction (2026-07-10, supersedes the design-handoff values it
contradicts — note this in code comments where you override handoff geometry):
fluid full-width content, sidebar = scope tree only with folder metaphor + strict
accordion, module items opt-in via (+) on the active scope row, resizable sidebar,
themed scrollbars.

## Files you own

- `apps/os/src/app/(app)/_components/Sidebar.tsx`, `AppShellChrome.tsx`
- `packages/ui/src/globals.css` (scrollbar theming), `tokens.css` only if a needed
  var is genuinely missing
- `apps/os/src/modules/docs/DocsView.tsx` — ONLY the center-column reading cap (item 1)
- Tests for the above.

## Do

1. **Fluid content width.** Remove the `max-width:1240px` cap on the content area
   (AppShellChrome): content fills the window minus sidebar, keeping the existing
   22px padding. In DocsView, cap the CENTER (document) column at ~860px reading
   width — the column centers within its available space; list column keeps its
   natural width. All other surfaces (dashboard, admin, tables) go fluid as-is.
2. **Sidebar v2 — scope tree only, folder metaphor.**
   - Top-level projects render as FOLDERS (closed folder icon; open-folder icon when
     expanded), collapsed by default.
   - A chevron button on the row toggles expansion; clicking the NAME navigates to
     the project (and expands it). The chevron is its own hit target — toggling must
     not navigate. `aria-expanded` + keyboard (Enter/Space) on the toggle.
   - **Strict accordion at every level**: expanding a project collapses other
     projects; expanding a scope collapses sibling scopes. Only one branch of the
     tree is open at any time.
   - Scopes and sub-scopes nest with clear indent + the existing 2px spine; give the
     three levels visually distinct icons (folder / scope glyph / sub-scope glyph —
     reuse the Lucide set already imported).
   - Navigating to a URL inside a collapsed branch auto-expands that branch
     (accordion still collapses the rest).
3. **Module items are opt-in.** Remove the auto-expanded module list (Dashboard,
   Overview, Activity, …) from the tree. The ACTIVE scope row gets a small (+)
   affordance ((−) when open) that expands the module shortcut list inline under it.
   Default collapsed; remember the choice in localStorage; the header tab bar
   remains the primary module navigation. Module set/labels/URLs unchanged.
4. **Resizable sidebar.** Drag handle on the sidebar's right edge: range 220–420px,
   width persisted in localStorage, double-click resets to the 264px default.
   Cursor + subtle hover affordance on the handle. The ≤820px drawer behavior stays
   exactly as-is (fixed drawer width, no handle).
5. **Themed scrollbars app-wide** (globals.css): thin scrollbars using theme vars —
   `scrollbar-width: thin; scrollbar-color: var(--borderstrong) transparent` plus
   the `::-webkit-scrollbar` set (≈8px, transparent track, rounded thumb in
   `--borderstrong`, hover `--mutedfg`). Applies to sidebar, content, and inner
   scroll containers in BOTH light and dark themes. No raw hex.
6. Keep untouched: workspace switcher row, search pill + ⌘K chip, `work`/`system`
   section headers, system links (Brain/Ops Health/Admin), footer user row, mobile
   drawer open/close logic.
7. **Tests**: update Sidebar/AppShell assertions; add coverage for the accordion
   reducer/expansion logic and the width clamp (pure logic). Suite green
   (316 currently; add on top).
8. Flip this file's status to `implemented`; add Deviations if you skip anything.

## Don't

- No route, `?tab=`, module-set, or label changes — presentation only.
- No new dependencies (implement drag-resize by hand, no resize libs), no lockfile
  changes, no raw hex (validate-tokens), no direct gsap imports (motion.ts only).
- Don't reintroduce the removed sidebar theme list or touch the header controls.
- Don't touch `docs/design/*`, other `docs/tasks/*`, `USER DATA/`.
- Don't attempt to commit (architect commits).

## Acceptance criteria

- [ ] No 1240px cap: content fills wide screens; doc reading column caps ~860px.
- [ ] Projects = folders, collapsed by default; chevron toggles without navigating;
      name navigates; strict accordion at every level; deep-link auto-expands its
      branch.
- [ ] No module list in the tree by default; (+) on the active scope row expands
      shortcuts inline; preference persisted.
- [ ] Sidebar drag-resizes 220–420px, persists, double-click resets; drawer
      behavior at ≤820px unchanged.
- [ ] Scrollbars themed (thin, token colors) in both themes everywhere.
- [ ] `tsc -b`, `eslint`, `vitest` green in-sandbox; architect re-runs real gates.

If you hit a rate/usage limit, print a line starting `LIMIT-ALERT:` and stop.
