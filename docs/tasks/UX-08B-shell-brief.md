# UX-08B (shell lane): tab navigation, sidebar affordances, breadcrumbs

Owner walkthrough feedback on the UX-07+UX-08 combined build. Work in THIS worktree
(`C:/dev/companyos-ux08`, branch `task/UX-08`). Do NOT commit — the architect commits.

**Pre-existing uncommitted work you must NOT revert or redo:**
`packages/ui/src/globals.css` now has an `@source "./";` directive. It fixes Tailwind v4
missing utilities for classes that only appear in packages/ui source. Leave it exactly as is.

## Item 1 — Scope tabs: soft navigation + content transition

Problem: switching tabs (Activity, Work Log, …) on `/s/[...path]` does full document
loads ("two hard refreshes" feel). Root cause: `packages/ui/src/components/tabs.tsx`
renders plain `<a href>` for items with `href` (line ~133) instead of a Next.js `Link`,
so every click is a full page navigation.

Do:
- Add an optional `linkComponent` prop to `Tabs` (type: any React component accepting
  `href`, `className`, `children`, ref). Default stays `"a"` so packages/ui gains no
  Next dependency. Use it for href items.
- In `apps/os/src/app/(app)/s/[...path]/page.tsx`, pass `next/link` as that prop.
  Passing the `Link` component reference from a server component to the client `Tabs`
  is allowed (it's a client component reference). If you hit a serialization error,
  create a thin client wrapper `apps/os/src/app/(app)/_components/ScopeTabs.tsx` that
  imports both `Tabs` and `Link` and takes plain-data items.
- Add a subtle enter transition for the tab panel content so switches feel smooth:
  use the existing GSAP helpers `anim`, `df`, `rm` from `@companyos/ui` (see how
  `tabs.tsx` and `Sidebar.tsx` use them): fade/slide-up the panel container ~0.18s on
  tab change, no animation when `rm()` (reduced motion). Since the page is a server
  component, put the animation in a small client wrapper around the tab content, keyed
  by tab id.

Don't:
- Don't convert the page to a client component or change data fetching.
- Don't add framer-motion or any new dependency. GSAP is already there via `anim`.

Acceptance:
- Clicking tabs never triggers a full document load (verify: set `window.__marker = 1`
  in devtools, switch tabs, marker survives).
- Active underline still animates; keyboard arrows still work; no layout shift.

## Item 2 — Sidebar: chevron + module-shortcut affordances

File: `apps/os/src/app/(app)/_components/Sidebar.tsx` (+ `sidebar-state.ts` if state
shape changes; update `sidebar-state.test.ts` accordingly).

Problems (owner): the `+` (module shortcuts toggle) only appears on the ACTIVE scope
row (`moduleToggle`, ~line 385), so users don't discover it; scope rows without
children have an empty spacer instead of a chevron, so nothing signals that clicking
the name opens/expands things vs the `+` opening module shortcuts.

Do:
- Render the `+` toggle on EVERY scope row (all levels), visible by default (not
  hover-only). Clicking `+` on any row expands/collapses that row's module shortcut
  links (`ModuleRows`) inline under it — this must work without the row being active,
  since the links are plain `/s/<path>?tab=<tab>` hrefs. Track open state per path
  (e.g. `Set<string>` replacing the single boolean `moduleShortcutsOpen`; keep
  localStorage persistence semantics reasonable — persisting just the active scope's
  state or the set, your call, but don't break existing key
  `SIDEBAR_MODULES_STORAGE_KEY` semantics silently: update `sidebar-state.ts` +
  its test).
- Always render a chevron slot before scope names: keep the current rotating chevron
  button when the scope has children; for leaf scopes render a muted, non-interactive
  chevron (e.g. same `ChevronRight` at reduced opacity, `aria-hidden`) instead of the
  empty spacer, so the affordance column reads consistently.
- Keep the GSAP chevron rotation + children stagger exactly as is.

Don't:
- Don't change accordion behavior (one branch open per level), drag-resize, search,
  or the New-project dialog.

Acceptance:
- Every row shows chevron-space + name + `+`; clicking `+` on a non-active project
  shows its module links; clicking again hides them; active-row behavior unchanged
  otherwise; `pnpm test` passes including sidebar-state tests.

## Item 3 — Scope header breadcrumbs: real links, real names, styled

File: `apps/os/src/app/(app)/s/[...path]/page.tsx` (~lines 172-179).

Problems (owner): breadcrumbs are raw path segments in mono ("website" instead of the
scope's display name "Website Revamp"), not clickable, unstyled.

Do:
- Build breadcrumb items for every ancestor path prefix (e.g. `airbuddy`,
  `airbuddy/website`): resolve each ancestor's display NAME. The page already calls
  `api.getScope(scopePath)`; fetch ancestors with `api.getScope` per prefix (it's a
  server component — parallelize with `Promise.all`) or reuse a tree call if cheaper.
  Fall back to the raw segment if a scope isn't visible to the actor.
- Each crumb except the last links to `/s/<prefix>` via `next/link`. Last crumb is
  the current scope: not a link, `aria-current="page"`.
- Style with existing tokens: `text-[var(--font-size-sm)]`, muted foreground for
  links with hover → `var(--fg)` + underline, a nicer separator (e.g. `ChevronRight`
  size 12 from lucide, or `/` in `var(--faded)`), remove `font-mono`. Wrap in
  `<nav aria-label="Breadcrumb">`.
- Root crumb: show the instance name ("Brissie Digital") linking to `/s/root` when
  the actor has root access; omit it otherwise (grant-filtered users shouldn't get a
  dead link — mirror the existing root-redirect logic's spirit).

Acceptance:
- On `/s/airbuddy/website` the crumbs read like: Brissie Digital / AirBuddy /
  Website Revamp — first two clickable, last one not; no mono font; typecheck clean.

## Gates (run from worktree root; you have no pnpm — use direct binaries)
`tsc -b`, `eslint`, `vitest run` for touched packages. Report every file changed.
On rate/usage limits print a line starting `LIMIT-ALERT:` and stop.
