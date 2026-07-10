# UX-04: Sidebar tree navigation rewrite + mobile drawer

status: done (PR #19 merged 2026-07-09; written against DESIGN-SYSTEM-V2.md §4.2/§5 sidebar/§6 mobile)
module: apps/os (app shell + sidebar) + packages/ui (a small collapsible/tree helper if warranted)
branch: task/UX-04 (off main after UX-02 merged @ 3ab937a)

## Why

UX-01 landed v2 foundations; UX-02 landed the feedback layer. The sidebar is still the
old construct: a `<select>` project-switcher plus a flat, prefix-filtered list with
manually-computed px indentation (`apps/os/src/app/(app)/_components/Sidebar.tsx`). The
v2 design replaces this with a real expand/collapse **tree**, moves module navigation
*inside* the tree, and adds a **mobile drawer** (the shell has zero responsive handling
today — fixed `w-64` aside at all widths). UX-04 does exactly that and nothing else.

Read **`docs/design/DESIGN-SYSTEM-V2.md` §5 (Sidebar tree bullet + Scope page header
note), §6 (Mobile/responsive), §4.2 (sidebar chevron/stagger timings)** before starting.
Visual reference: `docs/design/reference/CompanyOS.dc.html` — serve over local HTTP
(`python -m http.server` from `docs/design/reference/`, open the file over
`http://localhost:8000/...`; it will NOT render over `file://`). Read the exact tree
markup/indent/chevron/dot treatment and the mobile drawer behavior (resize the browser to
~390×844) off the rendered mockup. §5/§6 are the distilled contract; the file is ground
truth for spacing/markup.

## Foundations already in place (build on these)

- `packages/ui/src/motion.ts`: `anim(fn)` / `df(duration)` / `rm()` — use these for the
  chevron rotate + subtree stagger. Do NOT import `gsap` directly, do NOT re-implement the
  reduced-motion check. GSAP is already a dependency.
- `packages/ui/src/tokens.css`: all v2 tokens under `body[data-theme=...]`. Use
  `var(--token)` only — no raw hex (validate-tokens gate). Relevant: `--sidebar`,
  `--fg`/`--mutedfg`/`--faded`, `--primary`, `--hover`/`--active`/`--selected`, `--border`,
  `--accent`/`--warn` (badge), `--overlay` (drawer scrim), `--space-*`, `--radius-2/-3/-4`,
  `--font-mono` (mono lowercase group labels).
- Do **not** add a new dependency. If a tiny shared collapsible/tree helper reads cleaner
  as a `packages/ui` component, add it there (hand-rolled) and export via `index.ts`;
  otherwise keep it local to the sidebar. Your call — but no new package.

## Current state (from a full read of the code — preserve this behavior)

- `Sidebar.tsx` props: `{ tree: Scope[], selected?, taskManagerUrl?, instanceName?,
  rootRole? }`. `Scope` (from `@companyos/db`): hierarchy is encoded in the `path` string
  (slash-delimited; depth = `path.split("/").length`), `type ∈ root|project|subproject`,
  plus `name`/`id`/`status`.
- Selection is server-resolved (cookie `nav.selectedProject`) and passed as `selected`.
  Server actions in `./actions.ts`: `setSelectedProject(formData)` (sets cookie +
  redirects) and `createNewScope(formData)` (→ `{path,intakeId,error?}`). **Keep both
  working exactly as-is.**
- Module links today point at `/s/{path}?tab={tab}` (full navigations). The **real** app
  module/tab set (from the scope page `s/[...path]/page.tsx`) is: Dashboard, Overview,
  Activity, Work Log (`work-log`), Sessions, Docs, Canvas, Connect, Credentials, Intake,
  and Members (conditional). The sidebar today shows a *divergent* 6-item subset.
- The `Brain / Ops Health / Admin` block already exists (shown when
  `rootRole ∈ owner|admin`), each a `<Link>` with a lucide icon.
- Shell: `apps/os/src/app/(app)/layout.tsx` (async server component) —
  `<FeedbackProviders>` › `<div flex>` › `<aside w-64>` (instance-name block + `<Sidebar>`
  + `<UserMenu>` at bottom) › `<div flex-1>` (`<header h-space-12>` with only a static
  "Scope" placeholder + `<main>`). No breakpoints, no drawer, no burger anywhere.

## Do

1. **Rewrite the sidebar as a real tree** (`Sidebar.tsx`), matching the §5 contract and
   the reference file's visual treatment:
   - **Two groups:** a `work` group (mono lowercase label via `--font-mono`, e.g. "work")
     that is the expand/collapse project tree, and a `system` group (flat: the existing
     Brain / Ops Health / Admin items — no children). Keep `system` gated on `rootRole`
     as today.
   - **Real expand/collapse tree** for `work`: nest project → subproject via the `path`
     hierarchy (build a tree from the flat `Scope[]` using `path`/`parentId`). Each
     expandable node has a **chevron that rotates** on toggle and its children
     **stagger-fade** in. Depth via **16px indent steps** (nested structure or computed —
     but real collapse state per node, `aria-expanded` on toggles). Replace the
     `<select>` project switcher entirely; the tree shows the full visible forest with
     collapse, not one prefix-filtered subtree.
   - **Selected leaf**: colored **dot** + `--primary`-colored label (per §5). Track
     selection from the URL/`selected` prop as today.
   - **Module rows inside the tree**: under the **selected** scope leaf, render the
     module nav rows inline (indented one more step). **Render the real module set + real
     `?tab=` slugs listed above — do NOT rename/drop modules to match the mockup's sample
     labels** ("Overview/Activity/Docs/Canvas/Setup/Tasks" in the doc are the mockup's
     illustrative set, not a spec to force onto the real app). Preserve the current
     Members / Task-Manager conditionals. This replaces the top-selected-project inline
     module list that exists today; it does not change where those links point.
   - **Badge counts** (small `--accent`/`--warn` circle) on rows that have a real
     attention signal. If no count source exists in the current data, **omit the badge —
     do not fabricate counts**; leave a clearly-commented seam for wiring later.
2. **Mobile drawer** (§6) in the shell:
   - Add a `@media (max-width: 820px)` behavior: the `<aside>` becomes a slide-in drawer
     (`translateX(-100%)` ↔ `0`, `0.28s` transition — a plain CSS transition is fine here,
     it's not GSAP), with an `--overlay` **scrim backdrop** behind it, and a **burger
     toggle** added to the shell `<header>` (left side). Tapping the scrim or a nav item
     closes the drawer; Esc closes it; focus is sensible (move into drawer on open).
   - The drawer open/close state is client-side. Since `layout.tsx` is a server component,
     introduce a small `"use client"` shell-chrome wrapper (e.g. a `MobileNav`/`AppShell`
     client component) that owns the toggle state and renders the burger + aside +
     scrim; keep the server layout responsible for data fetching and pass the rendered
     sidebar/children through. Do not turn the whole layout into a client component.
   - At ≥820px the drawer logic is inert and the sidebar is the normal fixed column.
   - Port/verify the reference file's exact breakpoint + transition; check the stat-ribbon
     and content reflow aren't broken at ~390px (visual check, don't restyle content).
3. **Motion** via the helper: chevron rotate **0.18s** and subtree **stagger 0.03s**,
   `power2.out` (§4.2), wrapped in `anim()`+`df()`; instant expand/collapse under `rm()`
   (reduced motion) — still fully functional, just no animation.
4. **Accessibility**: tree uses `aria-expanded` on collapsible nodes, `aria-current` on
   the active leaf/module row; the drawer burger has an `aria-label` and
   `aria-expanded`; keyboard: Enter/Space toggles a node, Esc closes the drawer.
5. **AGENTS.md**: update `apps/os`'s AGENTS.md (create a short one if none exists, else
   append) noting the new tree sidebar + mobile drawer shell wrapper and that the module
   nav now lives inside the tree. One or two sentences.

## Don't

- **Do not touch the scope-page tab bar** or `apps/os/src/app/(app)/s/[...path]/page.tsx`
  — that grouped tab bar (animated underline) and the shared Tabs primitive are **UX-05's**
  scope. UX-04 stays in the sidebar, the shell layout/header, and any new sidebar-local
  or `packages/ui` tree/collapsible helper.
- Do not change route slugs, `?tab=` values, the `nav.selectedProject` cookie, or the
  `setSelectedProject`/`createNewScope` server-action contracts. Navigation targets must
  be identical to today.
- Do not migrate unrelated old-token consumers or restyle module bodies. Additive.
- Do not import `gsap` directly (use `motion.ts`); no raw hex; no new dependency.
- Do not rebuild the mobile drawer from scratch if the reference file already has it —
  port and finish it.
- Do not modify `docs/design/reference/*`, other `docs/tasks/*` files (only this file's
  status line), or anything under `USER DATA/`.
- Do not touch the toast/confirm primitives or the theme switcher.

## Acceptance criteria

- [ ] Sidebar renders a real expand/collapse tree (per-node collapse state,
      `aria-expanded`, chevron rotate + child stagger via the motion helper); the
      `<select>` switcher is gone; selected leaf shows a dot + `--primary` label.
- [ ] Module rows render inline under the selected leaf using the **real** module set and
      **unchanged** `?tab=` targets; Members/Task-Manager conditionals preserved.
- [ ] `work` (mono label, tree) and `system` (flat, gated on rootRole) groups both render.
- [ ] Below 820px the sidebar is a slide-in drawer with scrim + header burger; opens/
      closes via burger, scrim, nav-item, and Esc; ≥820px it's the normal fixed column.
      `layout.tsx` remains a server component (drawer state in a client shell wrapper).
- [ ] Reduced motion (`prefers-reduced-motion`) skips the GSAP tree animations; nav still
      fully works.
- [ ] Styled with `var(--token)` only (validate-tokens passes); no new dependency added.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from root.
