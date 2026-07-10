# UX-01: Foundations — v2 design system tokens, GSAP motion plumbing, 4-theme switcher, shell restyle

status: done (PR #17 merged 2026-07-09; brief rewritten 2026-07-09 against DESIGN-SYSTEM-V2.md)
module: ui + apps/os (app shell level only)
branch: task/UX-01

## Why this brief was rewritten

The prior version of this brief scoped against `docs/design/DESIGN-SYSTEM-DELTAS.md`
(additive tokens on the existing slate+blue-700, Inter, 6/10/14-radius system). The
owner has since run a full Claude Design exploration and **locked a wholesale visual
redesign** — four themes, a new terracotta/amber palette, Gantari + JetBrains Mono,
2/3/4px radius, GSAP-driven motion. Read **`docs/design/DESIGN-SYSTEM-V2.md`** end to
end before touching anything — it is the new ground truth and supersedes
DESIGN-SYSTEM-DELTAS.md in full. The reference implementation is
`docs/design/reference/CompanyOS.dc.html` — a real interactive mockup, open it in a
browser (serve it over local HTTP, e.g. `python -m http.server`; `file://` breaks its
blob-URL asset unpacking) and click through every screen/theme before starting.

## Goal

Stand up the v2 token system, the GSAP motion-intensity plumbing, the 4-way theme
switcher, and the new font stack — **without breaking the current app**, since UX-02/
04/05 do the actual per-module migration off the old tokens. This package's job is
foundations + the app-shell-level surfaces (error/404/loading pages, the theme switcher
itself), not a full sweep.

## Context

- `docs/design/DESIGN-SYSTEM-V2.md` — full spec: theme token tables (§1), typography
  (§2), radius (§3), motion/GSAP (§4), component contracts (§5), mobile (§6), migration
  posture (§7), package breakdown (§8).
- `docs/design/reference/CompanyOS.dc.html` + `CompanyOS.dc.chat-log.txt` — the built
  mockup and the design conversation that produced it. Ground truth for anything not
  nailed down as an exact value in the V2 doc (e.g. exact type scale — read it off the
  rendered mockup).
- Current state to preserve compatibility with: `packages/ui/src/tokens.css` (old
  token set, stays defined — see Don't), `apps/os/src/app/layout.tsx` +
  `apps/os/src/app/(app)/_components/UserMenu.tsx` (current light/dark toggle:
  `.dark` class on `<html>`, `localStorage.theme`, no pre-hydration stamp yet — this
  package replaces the mechanism).
- `docs/design/UX-AUDIT.md` P0-4 (no error/loading pages) still applies — it's about
  the app never having designed error states at all, independent of which visual
  system fills them in.

## Do

1. **New v2 tokens, additive** — add the full §1.1 token list to `tokens.css` for all
   three concrete themes (`light`/`green`/`charcoal`, §1.2 exact hex values), scoped
   under `body[data-theme="light|green|charcoal"]` selectors per §1.3 (not `:root`/
   `.dark` — that scoping is load-bearing, the new component work in later packages
   assumes vars resolve from `body`). **Do not remove or rename any existing token**
   (`--background`, `--foreground`, `--muted`, `--primary`, etc.) — they stay exactly as
   they are, still driven by `:root`/`.dark`, until UX-02/04/05 migrate their consumers
   off them module by module (§7 of the V2 doc). Comment the old block
   `/* v1 tokens — migrating to v2 per DESIGN-SYSTEM-V2.md, do not add new consumers */`.
2. **Theme resolution + switcher.** Replace the light/dark boolean in `UserMenu.tsx`
   with the 4-way model: state `theme ∈ auto|light|green|charcoal`, persisted the same
   `localStorage` key. On resolve:
   - Set `document.body.dataset.theme` to the *resolved* concrete id (never literally
     `auto`) per §1.4's circadian schedule — same literal hour thresholds and dawn/dusk
     `--bg` tint as the reference file.
   - **Also** toggle `.dark` on `<html>` whenever the resolved theme is `green` or
     `charcoal` (both count as "dark" for every old-token consumer that hasn't migrated
     yet) — this is what keeps the other 40+ files that reference old tokens looking
     correct (generically dark, not yet theme-specific) without touching them.
   - Inline pre-hydration script in `layout.tsx` (`<head>`, `dangerouslySetInnerHTML`,
     `suppressHydrationWarning` on `<html>`) that reads `localStorage.theme`, resolves
     it (including the circadian branch — the hour is available synchronously, no
     async needed), and stamps both `data-theme` and `.dark` before first paint. No
     flash on any of the 4 choices, including a cold `auto` with no stored preference.
   - Default when nothing is stored: **`auto`** (matches the reference file's own
     default and the owner's live walkthrough of it) — this supersedes the earlier
     "dark default, not system preference" call from before the redesign. Flag this
     change explicitly in the PR description since it reverses a previous explicit
     owner decision; call it out for a quick re-confirm rather than assuming silently.
   - Swatch UI: 4 options exactly as the reference file's theme menu (title strings
     verbatim: "Auto (Circadian)", "Light — Terrazzo Quiet", "Dark — Green Hall",
     "Dark — Charcoal"), each a small preview swatch, selected one ringed in `--primary`.
3. **Fonts.** Self-host Gantari (variable or the weights actually used in the mockup)
   alongside the existing JetBrains Mono, wired via `next/font/local` the same way Inter
   is today. New `--font-sans` value points at Gantari; `--font-mono` unchanged. Don't
   remove the Inter font loading yet if anything still depends on `--font-sans`
   resolving to it during the transition — check before deleting (likely fine to swap
   outright since `--font-sans` is one value, not per-theme, but verify no component
   hardcodes "Inter" as a literal string anywhere).
4. **GSAP.** Add as a real dependency (package.json, not a CDN tag) — your call on
   `packages/ui` vs `apps/os`, pick one and keep it there. Build the shared helper
   pattern from §4.1 of the V2 doc: a motion-intensity setting (0/1/2/3 → multiplier
   0/0.7/1/1.4, default 2), persisted alongside theme, `prefers-reduced-motion` forces
   intensity 0. Ship it as an importable helper (e.g. `packages/ui/src/motion.ts`) with
   the `df()` (duration factor) / `rm()` (should-skip-GSAP) / `anim(fn)` (guarded GSAP
   entry point) shape from the reference file — later packages call into this rather
   than each reinventing the reduced-motion check. **Definitions + helper only in this
   package** — do not wire GSAP into any existing component yet (sidebar, wizard,
   toasts are 02/04/05's job); the one exception is the shell fade-in on route change if
   it's cheap, since that's genuinely app-shell-level and mirrors the reference file's
   `enter()` view-transition.
5. **Radius.** Add new tokens for the tighter v2 scale (name them however reads best —
   e.g. `--radius-2/-3/-4` at 2/3/4px) as **new, additional** names; do not change the
   values of the existing `--radius-sm/md/lg` (6/10/14px) — those stay for unmigrated
   consumers. New shell-level surfaces built in this package (error pages, theme
   switcher, toast — wait, toast is UX-02, skip it) use the new scale.
6. **Token lint**, rewritten scope: `scripts/validate-tokens.mjs` (plain Node, no new
   deps beyond GSAP already added) fails when (a) any `var(--x)` referenced in
   `apps/os/src` or `packages/ui/src` is not defined in `tokens.css` — checked against
   **both** old and new token names, since both are live during the transition, and
   (b) a raw hex color literal appears in `.tsx`/`.css` under those trees outside
   `tokens.css` (no allowlist). Wire as root script `"validate-tokens"`, appended to
   root `"lint"`.
7. **Route-level states** in `apps/os/src/app/`: `not-found.tsx`, `error.tsx`,
   `global-error.tsx`, root `loading.tsx` for the `(app)` group. Styled with the new v2
   tokens + new radius scale (these are new surfaces, not migrations — build them
   v2-native). Calm product-voice copy, no stack traces: 404 = "This page doesn't
   exist." + link back to `/s/root`; error = short apology + "Try again" wired to
   Next's `reset()`.
8. Update `packages/ui/AGENTS.md` (and `apps/os`'s if one exists) documenting: both
   token generations and which is canonical going forward, the `body[data-theme]`
   mechanism, the motion helper and how later packages should use it, the new radius
   scale. Same commit.

## Don't

- **No sweep.** Do not touch any of the ~48 existing files that consume old token names
  (`SessionsView.tsx`, `CanvasView.tsx`, `TableWidget.tsx`, `Sidebar.tsx`, admin pages,
  auth pages, etc.) beyond what step 2 requires in `layout.tsx`/`UserMenu.tsx`. UX-02/
  04/05 migrate their own areas; a later cleanup step deletes the old token block once
  nothing references it.
- No sidebar tree rewrite (UX-04), no wizard/admin work (UX-05), no toast/confirm-dialog
  primitives (UX-02), no string/copy audit beyond the four new error-page strings
  (UX-03 territory otherwise).
- Do not delete or rename any existing token — additive only, this package.
- Don't wire GSAP into any existing interactive component (sidebar chevrons, tabs,
  wizard, toasts) — helper + shell fade-in only.
- Don't modify `docs/design/reference/*` (read-only ground truth) or anything under
  `docs/tasks/` other than this file's status line.
- Don't touch route slugs, `?tab=` values, or intake service calls.

## Acceptance criteria

- [ ] All 3×29 new v2 tokens defined under `body[data-theme="light|green|charcoal"]`,
      matching `docs/design/DESIGN-SYSTEM-V2.md` §1.2 hex values exactly.
- [ ] Theme switcher offers all 4 modes with the exact reference titles; picking any
      persists and resolves correctly on reload with no flash (verify by throttling/
      hard-reloading, not just SPA navigation).
- [ ] `auto` resolves per the circadian schedule (spot-check by mocking the system
      clock or temporarily lowering the night threshold in a local test).
- [ ] Old-token consumers (spot check `SessionsView.tsx`, `Sidebar.tsx`) render
      unchanged from current main when resolved theme is `light`, and generically dark
      (as today's `.dark` class produces) when resolved theme is `green` or `charcoal`.
- [ ] Gantari renders as the sans body font; JetBrains Mono unchanged.
- [ ] GSAP importable from the shared helper; `pnpm why gsap` shows one resolved
      location. Reduced-motion (`prefers-reduced-motion: reduce`) verified to skip it.
- [ ] `pnpm validate-tokens` exists, passes, and fails when given a dangling
      `var(--nope)` or a raw hex in a module (demonstrate in run output or a test).
- [ ] `/nonexistent-route`, a thrown server error, and `(app)` loading all render
      styled, v2-token-native pages.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from root.
