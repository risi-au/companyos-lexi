# UX-08C: sidebar module shortcuts — hover-reveal +, single-open, no dead chevrons

Owner reviewed a prototype and chose "hover-reveal". Work in THIS worktree
(`C:/dev/companyos-ux08`, branch `task/UX-08`). Do NOT commit — the architect commits.
Files: `apps/os/src/app/(app)/_components/Sidebar.tsx`, `sidebar-state.ts`,
`sidebar-state.test.ts` ONLY.

Current state (from commit 90ede89): every scope row shows a `+` module-shortcuts
toggle all the time (owner: "too many +, looks really bad"), multiple rows' module
lists can be open at once (owner: at most ONE, opening one must close the other), and
leaf rows render a decorative non-interactive chevron (owner: "the > on sub-projects
does nothing" — it reads as a broken button).

## Do

1. **Hover-reveal the toggle.** The `+` button stays in the layout (same slot, so rows
   don't shift) but is invisible by default: `opacity-0` + reveal on row hover and on
   `focus-visible` (keyboard users must reach it), transition ~150ms, respect reduced
   motion. The row whose module list is OPEN always shows its toggle as `−`
   (visible, `text-[var(--primary)]`). Everything else about the button (size,
   hover bg, aria-label, aria-expanded) stays.
   Implementation: group-hover — add `group` to the row wrapper div and
   `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` (+ always-visible
   class when open) on the button.

2. **Single-open accordion.** Replace the `Set<string>` module-shortcut state with a
   single `string | null` open path. Opening a row's modules closes any other.
   Update `sidebar-state.ts`: `parseStoredModuleShortcuts` / `serializeStoredModuleShortcuts` /
   `toggleModuleShortcutPath` become single-value semantics (rename sensibly, e.g.
   `parseStoredModuleShortcut` returning `string | null`). Backward compat for stored
   values: `"open"` → the active scope path; `"closed"`/null → null; a JSON array
   (the just-shipped format) → the active scope path if the array contains it, else
   the array's first entry, else null. Persist the new value as the plain path string
   or `"closed"`. Rewrite the related tests for the new semantics (keep the accordion
   + clamp tests untouched).

3. **Kill decorative chevrons.** Rows without children render the empty spacer again
   (`<span aria-hidden className="inline-block h-[30px] w-[18px] shrink-0" />`) —
   NOT a muted ChevronRight. Real chevron buttons only where `hasChildren`.

## Don't

- Don't touch ModuleRows content, ScopeTabs/ScopeTabPanel, breadcrumbs, drag-resize,
  search, accordion-branch logic for children, or anything outside the three files.
- Don't remove the localStorage persistence.

## Acceptance

- Default render: zero `+` icons visible; hovering any scope row fades its `+` in;
  the open row (if any) shows a primary-colored `−` at all times.
- Clicking `+` on row X while row Y's modules are open: Y's list closes, X's opens —
  never two module lists in the DOM at once.
- Tab-focusing the toggle makes it visible (focus-visible), aria-expanded correct.
- Leaf scopes show no chevron glyph at all; alignment unchanged.
- `tsc -b`, eslint, and the sidebar-state vitest suite pass.
On rate/usage limits print a line starting `LIMIT-ALERT:` and stop.
