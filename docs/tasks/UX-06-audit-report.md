## 1. Theme Token Maps

Theme token maps | P1 visual-breaking | `--bg/--fg` theme tokens should drive app background/text -> global CSS still maps body to old `--background/--foreground` slate layer | packages/ui/src/globals.css:29
Theme token maps | P1 visual-breaking | Terrazzo/Green/Charcoal semantic values should replace old slate/blue tokens -> old primitives and semantic `--background/#f8fafc`, `--primary/#1e40af`, etc. remain as active Tailwind aliases | packages/ui/src/tokens.css:63
Theme token maps | P2 clearly-off | `background/color .6s ease` on `html,body` theme swap -> no transition declared on body | packages/ui/src/globals.css:29
Theme token maps | P2 clearly-off | Auto/Circadian default should be default user mode -> server body starts `data-theme="light"` before script resolves stored/default auto | apps/os/src/app/layout.tsx:79

## 2. Motion Kit

Motion kit | P1 visual-breaking | Buttons `box-shadow:0 4px 0 var(--primarydark)` + press `translateY(3px)`/`0 1px 0` at `.12s ease` -> shared button has no squash shadow/translate and uses `duration-200` brightness states | packages/ui/src/components/button.tsx:15
Motion kit | P1 visual-breaking | Count-up `[data-count]` `.8 x df power2.out` -> stats render static formatted values with no `data-count` or tween | apps/os/src/modules/dashboards/MetricCard.tsx:29
Motion kit | P2 clearly-off | View enter `.24 x df power3.out` -> intake stage uses `.22 x df` plus child stagger | apps/os/src/modules/intake/IntakePanel.tsx:371
Motion kit | P2 clearly-off | Pulse dots `[data-pulse]` opacity yoyo `1.1s sine.inOut infinite` -> MISSING | packages/ui/src/motion.ts:67
Motion kit | P2 clearly-off | `attnGlow` keyframe `~2.8s`, max one per screen -> MISSING keyframe/usage | packages/ui/src/tokens.css:237
Motion kit | P3 nit | Reduced motion should fall back to instant final state -> `anim()` returns without applying any fallback unless each caller handles it | packages/ui/src/motion.ts:67

## 3. Step-5 Task-Completion Dopamine Moment

Step-5 completion | P1 visual-breaking | `popIn .4s cubic-bezier(.2,.7,.4,1.08)` + `ringOut .55s` + `riseFade 1.8s` -> `popIn 160ms ease-out`, `ringOut 620ms` delayed, `riseFade 820ms` | packages/ui/src/components/completion-reward.tsx:29
Step-5 completion | P2 clearly-off | cheer copy `"N to go"` / `"all clear ✓"` -> final cheer renders `"all clear"` without check mark | apps/os/src/modules/intake/IntakePanel.tsx:944
Step-5 completion | P2 clearly-off | pre-completed rows render settled without animating on load -> open-question done state is local-only and reinitializes all rows false from question list | apps/os/src/modules/intake/IntakePanel.tsx:361
Step-5 completion | P3 nit | cheer should rise/fade for `~1.8s` beside row text -> positioned beside check but removed after 900ms/820ms animation | packages/ui/src/components/completion-reward.tsx:22

## 4. Responsive @ Max-Width 820px

Responsive 820 | P1 visual-breaking | mobile sidebar drawer width `264px` -> `max-[820px]:w-[280px]` | apps/os/src/app/(app)/_components/AppShellChrome.tsx:84
Responsive 820 | P1 visual-breaking | wizard rail at `max-width:820px` becomes horizontal stacked progress, spine hidden, connector lines -> no 820px CSS; `.wiz-ol` remains `flex-col` and spine remains visible | packages/ui/src/components/stepper.tsx:44
Responsive 820 | P2 clearly-off | scrim `--overlay` z-75 -> z-40 | apps/os/src/app/(app)/_components/AppShellChrome.tsx:76
Responsive 820 | P2 clearly-off | close X appears in drawer header -> MISSING | apps/os/src/app/(app)/_components/AppShellChrome.tsx:88
Responsive 820 | P2 clearly-off | `.wiz-grid` desktop `210px 1fr`, mobile rows at 820px -> current grid is 1 column by default and switches to `220px 1fr` at `lg`/1024px | apps/os/src/modules/intake/IntakePanel.tsx:508

## 5. A-/A+ Global Font-Size Control

Font-size control | P1 visual-breaking | header A-/A+ global size control, `0.85-1.4` in `0.1` steps -> MISSING | apps/os/src/app/(app)/_components/AppShellChrome.tsx:99

## 6. Layout / Typography / Chrome

Layout/chrome | P1 visual-breaking | root shell `display:grid; grid-template-columns:264px 1fr; height:100vh; overflow:hidden` -> flex `min-h-screen`, no fixed viewport overflow contract | apps/os/src/app/(app)/_components/AppShellChrome.tsx:71
Layout/chrome | P1 visual-breaking | sidebar `264px` -> `w-64`/256px desktop | apps/os/src/app/(app)/_components/AppShellChrome.tsx:84
Layout/chrome | P1 visual-breaking | content area `padding:22px; max-width:1240px` -> main padding `var(--space-4)`/16px and no max-width | apps/os/src/app/(app)/_components/AppShellChrome.tsx:113
Layout/chrome | P1 visual-breaking | base UI font-size `14px` -> body uses `var(--font-size-md)`/16px | packages/ui/src/globals.css:33
Layout/chrome | P2 clearly-off | 48px top bar `--surface` bg + bottom border + `padding:0 20px` -> top bar has 48px height and border but no `--surface` bg and uses 16px horizontal padding | apps/os/src/app/(app)/_components/AppShellChrome.tsx:99
Layout/chrome | P2 clearly-off | sidebar workspace switcher row with 26px brick "B", org name, chevron -> replaced by plain instance title/ops record | apps/os/src/app/(app)/_components/AppShellChrome.tsx:88
Layout/chrome | P2 clearly-off | sidebar Search pill -> MISSING | apps/os/src/app/(app)/_components/Sidebar.tsx:110
Layout/chrome | P2 clearly-off | active nav 2px underline / 3px side tick -> active scope uses 6px dot and selected fill | apps/os/src/app/(app)/_components/Sidebar.tsx:253
Layout/chrome | P2 clearly-off | nav hover hairline underline-draw `.25s ease` -> hover uses background fill only | apps/os/src/app/(app)/_components/Sidebar.tsx:259
Layout/chrome | P2 clearly-off | scope page has 12 tabs via `?tab=` -> implementation has 10 base tabs plus conditional Members, no Admin/Usage-style twelfth tab | apps/os/src/app/(app)/s/[...path]/page.tsx:190
Layout/chrome | P2 clearly-off | copy buttons fixed min-widths `120px`/`172px` with `"Copied"` label swap -> both buttons `w-36`/144px and label never swaps | apps/os/src/modules/intake/IntakePanel.tsx:866
Layout/chrome | P3 nit | app fonts should be Gantari + JetBrains Mono with no Inter/Roboto/Arial -> font loading matches, but fallback includes generic system sans | packages/ui/src/tokens.css:95
Layout/chrome | P3 nit | toast top-right slide-in and no footer overlap -> MATCHES | packages/ui/src/components/toast.tsx:143

Summary: Biggest fixes are to make the new `--bg/--fg` theme layer the only active color system, rebuild the shell/sidebar/wizard responsive chrome to the 264px/820px handoff geometry, and bring the motion kit/buttons/completion reward to the exact GSAP timing and squash-shadow contract.
