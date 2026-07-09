# UX-06A — Theme unification + shell/sidebar chrome (design reconciliation)

## Context

The app has drifted from the intended design. The design handoff is copied into this
worktree at `design_handoff/` — `README.md` is the spec (exact values), `CompanyOS.html`
is the visual source of truth (inspect its CSS/markup when in doubt; search it, don't
read linearly), `LOCKED-DECISIONS.md` is rationale. `CompanyOS.dc.html` markup/styles are
reference; its runtime (`support.js`, `<x-dc>`, `{{ }}`) is pseudocode — do not port.
The audit that produced this brief is at `docs/tasks/UX-06-audit-report.md` — fix its
areas 1, 4 (drawer items only), 5, and 6. **Reconcile, don't rebuild: keep the existing
component structure, GSAP-via-`packages/ui/src/motion.ts` pattern, and all behavior/routes.**

## Files you OWN (a parallel worker owns everything else — do NOT touch other files)

- `packages/ui/src/tokens.css`, `packages/ui/src/globals.css`
- `apps/os/src/app/layout.tsx`
- `apps/os/src/app/(app)/_components/AppShellChrome.tsx`
- `apps/os/src/app/(app)/_components/Sidebar.tsx`
- Plus: any theme-resolver/util module these already import, the lint token validator
  config if token renames require it, and tests for the above.

Explicitly FORBIDDEN: `packages/ui/src/motion.ts`, `components/button.tsx`,
`components/completion-reward.tsx`, `components/stepper.tsx`,
`apps/os/src/modules/**` (incl. IntakePanel, MetricCard). If a fix seems to need them,
note it in your final summary instead.

## Do

1. **Make the 4 `data-theme` maps the ONLY active color system.** `tokens.css` already
   defines correct `body[data-theme=…]` maps (`--bg --surface --raised --sidebar --fg
   --muted --mutedfg --faded --border --borderstrong --primary --primarydark --primaryfg
   --primaryhover --accent --accentfg --ok/okbg --warn/warnbg --err/errbg --info/infobg
   --hover --active --selected --overlay --shadow`) but the app still paints from the old
   slate layer (`--background: var(--primitive-slate-50)` etc. in tokens.css:64/102,
   consumed via globals.css). Retarget every old semantic alias
   (`--background --foreground --primary-old --card` etc. and the Tailwind
   `--color-*` bridge in globals.css) to the new theme vars, and delete the slate/blue
   primitives they pointed at. Cross-check final hex values against
   `design_handoff/README.md` §"Exact theme token maps" — they must match exactly.
   `pnpm lint` runs `validate-tokens` (102 tokens / 65 files today) — keep it green,
   updating its manifest if that's where token names are enumerated.
2. **Theme swap feel**: `html,body { transition: background .6s ease, color .6s ease }`.
3. **Auto/Circadian default, no SSR flash**: default mode `auto` resolves charcoal
   21:00–05:00 local, else light; `--bg` tinted `#f3ead8` before 08:00 and `#f0dcc4`
   after 17:00 (light hours only); re-evaluate on a ~60s timer. `layout.tsx` currently
   hardcodes `data-theme="light"` on the server — emit a tiny inline script before paint
   that reads the stored preference (default auto) and sets `data-theme` so first paint
   is already correct. Keep the existing theme-switcher UI working (4 modes).
4. **Shell geometry** (AppShellChrome): root `display:grid; grid-template-columns:264px
   1fr; height:100vh; overflow:hidden`; right column flex-col `min-width:0; height:100vh;
   overflow:hidden` with each view's content area scrolling under a **48px top bar**
   (`--surface` bg, `border-bottom:1px solid var(--border)`, `padding:0 20px`). Content
   area: `padding:22px; display:flex; flex-direction:column; gap:20px; max-width:1240px`.
   Base UI font-size **14px** (globals.css currently 16px) — sanity-check key screens
   don't break, since everything was authored against 16.
5. **Sidebar chrome** (Sidebar.tsx): `--sidebar` bg + right `1px solid var(--border)`,
   own scroll. Top→bottom: workspace-switcher row (26px rounded-7px square in
   `--primary` with the workspace's initial letter, name from existing instance/org data,
   down-chevron; on mobile this row also holds the drawer close-X), then a Search pill
   (bordered, `--bg` fill — wire to existing search if one exists, else a visual pill
   that focuses nothing is NOT acceptable; make it at least focus a text input filtering
   the nav tree client-side), then the existing nav tree (keep its expand/collapse
   behavior and `?tab=` targets untouched). Active nav item: `--active` bg + **3px side
   tick** (tree rows) or 2px solid underline (flat rows). Hover: hairline underline-draw
   via `background-image:linear-gradient(...); background-size:0%→100% 1.5px; .25s ease`.
6. **Mobile drawer @ max-width 820px** (AppShellChrome): grid → 1 column; sidebar
   `position:fixed; width:264px` (currently 280), `transform:translateX(-100%)` → `0`
   when open, `transition .28s ease`, `box-shadow:var(--shadow)`; scrim `--overlay`
   **z-index 75** (drawer above it); burger stays in the top bar; add the **close X**
   in the drawer header; drawer closes on any nav selection (already does — keep).
7. **A-/A+ global font-size control** in the top bar (near the theme switcher): scales
   root font-size between 0.85× and 1.4× in 0.1 steps (rem-based on `html`, NOT
   `body.style.zoom`), persisted to localStorage, applied pre-paint by the same inline
   script as the theme to avoid flash.

## Don't

- No new dependencies. No raw hex outside `tokens.css` (validate-tokens enforces this).
- No behavior/route/server-action changes; UI chrome only.
- No bounce/elastic easing anywhere; respect `prefers-reduced-motion` (instant states).
- Don't touch the forbidden files above; don't touch `design_handoff/` or commit it.
- Don't commit at all — leave work in the tree; the architect commits after review.

## Acceptance

- `npx tsc -b` (or repo typecheck), `npx eslint .`, and `npx vitest run` green from the
  worktree root using local node_modules binaries (no network available). List any gate
  you could not run.
- Grep proves no remaining consumer of the old slate primitives/aliases.
- Final message: bullet list of every file changed + one line each on what changed, and
  any spec item you had to skip or reinterpret.

If you hit a rate/usage limit, print a line starting `LIMIT-ALERT:` and stop.
