# UX-06B — Motion kit + wizard/completion reconciliation

## Context

The app has drifted from the intended design. The design handoff is copied into this
worktree at `design_handoff/` — `README.md` is the spec (exact values; see §Interactions,
§Keyframes, §Responsive), `CompanyOS.html` is the visual source of truth (search it,
don't read linearly), `LOCKED-DECISIONS.md` is rationale. `CompanyOS.dc.html`
markup/styles are reference; its runtime (`support.js`, `<x-dc>`, `{{ }}`) is pseudocode
— do not port. The audit behind this brief is `docs/tasks/UX-06-audit-report.md` — fix
its areas 2, 3, 4 (wizard items only), and the copy-button item. **Reconcile, don't
rebuild: keep the existing component structure and the GSAP-via-`packages/ui/src/motion.ts`
pattern (`anim`/`df`/`rm`). All wizard behavior, `?tab=` params, and the 13 intake server
actions + `intake.status` flow stay untouched.**

## Files you OWN (a parallel worker owns everything else — do NOT touch other files)

- `packages/ui/src/motion.ts`
- `packages/ui/src/components/button.tsx`, `completion-reward.tsx`, `stepper.tsx`
- `apps/os/src/modules/**` — esp. `intake/IntakePanel.tsx`, `dashboards/MetricCard.tsx`
- A NEW file `packages/ui/src/motion.css` for keyframes (import it from the components
  that use them), plus tests for the above.

Explicitly FORBIDDEN: `packages/ui/src/tokens.css`, `packages/ui/src/globals.css`,
`apps/os/src/app/layout.tsx`, `apps/os/src/app/(app)/_components/**` (AppShellChrome,
Sidebar). If a fix seems to need them, note it in your final summary instead. Theme
CSS variables (`--primarydark`, `--ok`, etc.) already exist — just consume them.

## Do

1. **Buttons — squash-and-release** (button.tsx, primary/solid variants): solid fill +
   `box-shadow:0 4px 0 var(--primarydark)`; on `:active` `translateY(3px)` and shadow
   collapses to `0 1px 0 var(--primarydark)`; `~.12s ease`. Remove the brightness/
   duration-200 hover states on those variants. Secondary/ghost variants keep a quiet
   hover (max `translateY(-1px)` + soft shadow). No bounce/elastic.
2. **Count-up** (motion.ts helper + MetricCard and other numeric stat cards): elements
   carry `data-count="<n>"`; on view enter tween 0→value, `.8×df`, `power2.out`.
   Respect `rm()` → render final value instantly.
3. **View enter**: standardize `[data-viewroot]` enter to `opacity 0→1, y 10→0`,
   `.24×df`, `power3.out` (IntakePanel currently uses .22 + stagger — align duration,
   keep the stagger only if it stays subtle).
4. **Keyframes** — create `motion.css` with the spec's verbatim keyframes:
   `attnGlow` (2.8s amber box-shadow pulse — export a class; usage rule is max ONE per
   screen), `popIn`, `ringOut`, `riseFade`. Add a `[data-pulse]` helper in motion.ts:
   opacity yoyo to .35, `1.1s`, `sine.inOut`, infinite.
5. **Completion "dopamine moment"** (completion-reward.tsx + IntakePanel step-5 usage):
   check circle `animation: popIn .4s cubic-bezier(.2,.7,.4,1.08) both, ringOut .55s
   ease-out both` (currently 160ms/620ms — fix); cheer text floats beside the row text
   with `riseFade 1.8s ease-out both` and copy **"N to go"** (remaining count) or
   **"all clear ✓"** on the last one — don't unmount it before the 1.8s completes; row
   settles into strikethrough faded text. ONLY the just-clicked row animates
   (`burstQ`-style index); pre-completed rows render settled with NO animation on mount
   — fix the current reinit-to-false behavior at IntakePanel.tsx:361 so done state
   survives remounts (derive from the persisted answer data already available, not
   transient local state). Reduced motion → instant settled state, no cheer animation.
6. **Wizard responsive @ max-width 820px** (stepper.tsx + IntakePanel wizard grid):
   desktop `.wiz-grid` = `210px 1fr` (currently 220px @1024px — change breakpoint to
   820px and width to 210px); below 820px the grid becomes `grid-template-rows:auto 1fr`
   and the step rail goes **horizontal**: steps in a row with horizontal scroll,
   vertical spine hidden, each step's number chip stacked centered above its label,
   connector lines between chips via `::before`. Spine-fill tween stays `.35×df power2.out`
   on desktop.
7. **Copy buttons** (step-6 provisioning in IntakePanel): "Copy pack" `min-width:120px`,
   "Copy MCP config" `min-width:172px`, centered content; on copy the label swaps to
   "Copied" WITHOUT the button changing size, plus the existing toast.
8. **Reduced-motion centrally**: make `anim()`/helpers guarantee the instant final state
   under `prefers-reduced-motion` instead of relying on each caller.

## Don't

- No new dependencies. No raw hex anywhere — use the theme CSS variables.
- No bounce/elastic easing. No confetti. No behavior/server-action changes.
- Don't touch the forbidden files; don't touch `design_handoff/`; don't commit anything.

## Acceptance

- `npx tsc -b` (or repo typecheck), `npx eslint .`, `npx vitest run` green from the
  worktree root using local node_modules (no network). List any gate you could not run.
- Final message: bullet list of every file changed + one line each on what changed, and
  any spec item you had to skip or reinterpret.

If you hit a rate/usage limit, print a line starting `LIMIT-ALERT:` and stop.
