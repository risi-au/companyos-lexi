# packages/ui - AGENTS.md

Shared UI primitives, global CSS, tokens, and motion helpers for CompanyOS.

## Design Tokens

- `src/tokens.css` intentionally carries two token generations during the UX-01 transition.
- V1 tokens live in `:root` and `.dark` (`--background`, `--foreground`, `--muted-foreground`, `--radius-sm/md/lg`, etc.). They remain defined for unmigrated consumers and should not gain new consumers.
- V2 tokens from `docs/design/DESIGN-SYSTEM-V2.md` are canonical for new work. They are scoped under `body[data-theme="light|green|charcoal"]` and include the 29-token set: `--bg`, `--surface`, `--raised`, `--sidebar`, `--border`, `--borderstrong`, `--hover`, `--active`, `--selected`, `--muted`, `--mutedfg`, `--faded`, `--fg`, `--primary`, `--primaryhover`, `--primarydark`, `--primaryfg`, `--accent`, `--accentfg`, `--ok`, `--okbg`, `--warn`, `--warnbg`, `--err`, `--errbg`, `--info`, `--infobg`, `--overlay`, `--shadow`.
- The V2 radius scale is additive: `--radius-2`, `--radius-3`, `--radius-4`. New V2-native surfaces should use these. Do not change V1 `--radius-sm/md/lg` until all old consumers migrate.

## Theme Contract

- The app stamps the resolved concrete theme on `document.body.dataset.theme`.
- Persisted user choice is `localStorage.theme` with `auto | light | green | charcoal`.
- `auto` resolves by the circadian schedule in `DESIGN-SYSTEM-V2.md`: charcoal from 21:00-04:59, otherwise light, with dawn/dusk `--bg` tints.
- The app also toggles `.dark` on `<html>` for resolved `green` or `charcoal` so V1 consumers keep dark-mode behavior during migration.

## Motion

- `src/motion.ts` exports the shared GSAP guard pattern: `df()`, `rm()`, and `anim(fn)`.
- Motion intensity is persisted in `localStorage.motionIntensity` as `0 | 1 | 2 | 3`, mapping to multipliers `0 | 0.7 | 1 | 1.4`; OS reduced motion forces `0`.
- Later packages should call `rm()` before non-GSAP motion and wrap GSAP calls in `anim((gsap) => ...)` rather than importing GSAP directly in feature modules.
- `ToastProvider`/`useToast` are the canonical feedback primitive for app notifications; use the top-right V2 token-styled toast instead of native `window.alert`.
- `ConfirmProvider`/`useConfirm` are the canonical destructive-action gate; native `window.confirm`/`confirm()` is banned in `apps/os/src`.
- Feedback primitive animations must go through `src/motion.ts` (`anim`, `df`, `rm`) and must not import GSAP directly.

## UX-05 Shared Primitives

- `Tabs`, `Table`, `Card`/`StatCard`, `EmptyState`, and `Stepper` are exported from `src/index.ts` for V2-native module surfaces.
- `Tabs`, `Stepper`, `StatCard`, and any other animated primitive must use `src/motion.ts` helpers only; feature code must not import GSAP directly.
- `CompletionReward` is the reusable OS-wide "mark done" reward pattern: pop-in circle, ring burst, and rising count text. It currently ships for the intake wizard checklist and should be reused for future completion moments instead of one-off animations.
## UX-06C Shared Primitive Notes
- `StatCard` values are sans semibold tabular numerals and may include a muted sub-line; do not use mono for human-readable stat values.
- `Stepper` matches the wizard rail contract: 24px round mono number chips, 13px sans labels, 2px rail gap, and a visible step count.
