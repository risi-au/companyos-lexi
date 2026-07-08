# UX-01: Foundations — token bugs, error/loading pages, dark default, hardcoded colors
status: todo
module: ui + apps/os (app shell level only)
branch: task/UX-01

## Goal
The token layer stops lying (no dangling `var()` references, no off-token colors), the
app has designed error/404/loading moments, and dark mode actually ships as the default
with no flash. This is the foundation package of the owner-approved UX overhaul; every
later package (UX-02..05) consumes the tokens this one defines.

## Context
- docs/design/DESIGN-SYSTEM-DELTAS.md §1 (token bugs), §2 (new semantic tokens), §7 (dark)
- docs/design/UX-AUDIT.md P0-4 (no error/loading pages), P0-7 (`--space-5`), P0-10
  (SessionsView hardcoded palette), P2-9 (scrim inconsistency), P2-12 (error-color split)
- Ground truth: `packages/ui/src/tokens.css`, `packages/ui/src/globals.css`,
  `apps/os/src/app/layout.tsx`, `apps/os/src/app/(app)/_components/UserMenu.tsx`
- Note: docs/design/ files are untracked in this working tree (they merge via a separate
  docs PR). Read them; do NOT commit or modify them.

## Do
1. **`--space-5`**: add `--space-5: 20px;` to the spacing scale in `tokens.css`
   (theme-independent, define once). Verify the four call sites
   (`IntakePanel.tsx:229`, `admin/layout.tsx:25`, `admin/page.tsx:24`,
   `admin/settings/page.tsx:20`) now resolve.
2. **Additive semantic tokens** in `tokens.css`, light + dark values per
   DESIGN-SYSTEM-DELTAS.md §1.3, §2.1–2.5 exactly:
   - interaction: `--surface-hover`, `--surface-active`, `--surface-selected`,
     `--primary-hover`, `--border-strong`
   - status surfaces: `--status-ok-bg`, `--status-warn-bg`, `--status-error-bg`,
     `--status-info-bg`, `--status-info`
   - `--overlay` (scrim), `--surface-raised` (dark-only distinct value; light = surface)
   - motion: `--duration-fast/base/panel`, `--ease-out`
   - layout/z: `--sidebar-width`, `--header-height`, `--z-sticky/dropdown/overlay/modal/toast`
   - `--chart-grid`
   Definitions only — do NOT sweep the app to consume them, except the specific fixes
   in steps 5–6. Later packages do the sweeps.
3. **Token lint** (DESIGN-SYSTEM.md non-negotiable, currently missing): create
   `scripts/validate-tokens.mjs` (plain Node, no new deps) that fails when
   (a) any `var(--x)` referenced in `apps/os/src` or `packages/ui/src` is not defined in
   `tokens.css`, and (b) a raw hex color literal appears in `.tsx`/`.css` under those
   trees outside `tokens.css` (allowlist: none — fix offenders in step 6 instead).
   Wire it as root script `"validate-tokens"` and append it to the root `"lint"` script
   so CI (which runs `pnpm lint`) enforces it. Add a vitest test only if trivial;
   the script itself is the gate.
4. **Route-level states** in `apps/os/src/app/`: `not-found.tsx`, `error.tsx`,
   `global-error.tsx`, and a root `loading.tsx` for the `(app)` group. Token-styled,
   calm copy in product voice (no stack traces, no dev jargon): 404 = "This page
   doesn't exist." + link back to `/s/root`; error = short apology + "Try again"
   button wired to Next's `reset()`. Keep them dependency-free server/client
   components per Next 15 conventions.
5. **Dark default, no flash**: inline a tiny pre-hydration script in
   `apps/os/src/app/layout.tsx` (`<head>`, `dangerouslySetInnerHTML`) that reads
   `localStorage.theme` and stamps `.dark` on `<html>`; **when no stored value, default
   to dark** (owner call: dark default, not system preference). Simplify UserMenu's
   mount-sync effect to match (it stays the toggle + persistence owner; the stamp script
   is the source of truth on first paint). `suppressHydrationWarning` on `<html>`.
6. **Kill hardcoded colors** (make step 3's check pass):
   - `SessionsView.tsx:42-46` status badges: emerald/amber/red/sky Tailwind classes →
     the new `--status-*-bg`/`--status-*` token pairs.
   - `CanvasView.tsx` `#ffffff` → appropriate token (`--surface` or Excalidraw
     background prop fed from a token value).
   - Modal scrims `bg-black/40`, `bg-black/30`, `bg-[var(--muted)]/60`
     (`Sidebar.tsx:232`, `DocsView.tsx:443,481`, `CanvasView.tsx:341`) →
     `bg-[var(--overlay)]`. Scrim color only — do NOT restructure the dialogs
     (focus traps etc. are UX-02).
   - `TableWidget.tsx:22` `--destructive` → `--status-error` (align with siblings).
   - Any further raw hex the validator finds in those trees: same treatment.
7. Update `packages/ui/AGENTS.md` (and the apps/os one if it exists) with the new
   token groups and the validate-tokens gate, same commit.

## Don't
- No string/copy changes beyond the new error pages (UX-03), no sidebar work (UX-04),
  no wizard changes (UX-05), no toast system or dialog semantics (UX-02).
- No new primitives in packages/ui; no renaming existing tokens (`--font-size-base`
  stays as-is this package).
- Don't touch route slugs, `?tab=` values, intake service calls, or anything under
  `docs/design/` or `docs/tasks/` other than this file's status line.
- No new dependencies.

## Acceptance criteria
- [ ] `pnpm validate-tokens` exists, passes, and fails when given a dangling
      `var(--nope)` or a raw hex in a module (demonstrate in the run output or a test).
- [ ] `--space-5` defined; wizard + admin pages regain vertical rhythm.
- [ ] All §2 tokens defined in both themes; grep shows no consumer sweeps beyond step 5–6 files.
- [ ] `/nonexistent-route` renders the styled 404; a thrown server error renders the
      styled error page; `(app)` routes show the loading state.
- [ ] Fresh browser session (no localStorage) paints dark with no light flash; toggle
      still works and persists both directions.
- [ ] No raw hex or Tailwind palette color classes remain in `apps/os/src` or
      `packages/ui/src` outside `tokens.css`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from root.
