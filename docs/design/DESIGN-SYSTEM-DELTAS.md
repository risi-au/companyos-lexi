# Design System Deltas — token, type, spacing, color changes (spec, not code)

*Companion to `docs/DESIGN-SYSTEM.md`. Everything here evolves the existing token system in `packages/ui/src/tokens.css`; nothing replaces it. Each delta says what changes, why, and what consumes it. An implementer should be able to scope tickets directly from the numbered items.*

*Ground truth read: `packages/ui/src/tokens.css`, `packages/ui/src/globals.css` (via import), `apps/os/src/app/globals.css`, and every UI file cited below.*

---

## 0. Current-state dial reading (Redesign Protocol §11.B)

Read against the taste-skill dials so the target is explicit:

| Dial | Current | Target | Evidence |
|---|---|---|---|
| DESIGN_VARIANCE | 2 (uniform bordered cards, symmetric grids everywhere) | 3 — keep Swiss/minimal, add hierarchy via type + spacing, not layout drama | Every module renders `rounded-[var(--radius-md)] border bg-[var(--surface)] p-[var(--space-4)]` cards: `s/[...path]/page.tsx:286,311,427`, `IntakePanel.tsx:123,149,167`, `admin/intake/page.tsx:28,61,74` |
| MOTION_INTENSITY | 0–1 (only `hover:bg` swaps; zero transitions defined) | 2–3 — 150–250ms ease-out on hover/expand/panel per DESIGN-SYSTEM.md §Motion, which is currently aspirational | No `transition-*` classes anywhere in `apps/os/src`; the reduced-motion kill switch exists (`tokens.css:110-118`) but there is no motion to reduce |
| VISUAL_DENSITY | 6 (compact, correct for an ops tool) | 6 — keep; fix rhythm, not density | 13px body (`--font-size-sm`) used as default everywhere |

**Mode:** Redesign — Preserve. The brand tokens (slate + blue-700 primary, amber accent, Inter/JetBrains Mono, 6/10/14 radius family) are sound and stay. The gap is not the palette; it is (a) missing tokens the code already references, (b) missing interaction/feedback layers (states, motion, toasts, scrims), and (c) inconsistent consumption (raw Tailwind vs tokens).

**What never changes silently (§11.F):** route slugs (`/s/...`, `/admin/...`, `?tab=` values), the `--background/--surface/--primary` hue family, Inter + JetBrains Mono, light-default/dark-first-class posture, the 4px grid. Any nomenclature change to `?tab=` values (see NOMENCLATURE.md) needs explicit owner approval + redirects.

---

## 1. Bugs in the token layer (fix before anything else)

### 1.1 `--space-5` is referenced but never defined — **P0**
- Defined scale (`tokens.css:28-35`): `--space-1..4, 6, 8, 12, 16`. There is no `--space-5`.
- Referenced in 4 files: `IntakePanel.tsx:229`, `admin/layout.tsx:25`, `admin/page.tsx:24`, `admin/settings/page.tsx:20` (`space-y-[var(--space-5)]`). The var resolves to nothing → `margin-top: ;` invalid → those stacks render with **no vertical rhythm at all**. This is why the wizard and admin pages feel cramped.
- **Spec:** add `--space-5: 20px` to the scale (4px grid holds). Alternatively re-point the four call sites at `--space-6`; either way the dangling reference must die. Add a CI check to `validate-tokens` (already mandated by DESIGN-SYSTEM.md §Non-negotiables) that fails on `var(--space-N)` / `var(--font-size-*)` names not present in tokens.css.

### 1.2 Font-size naming trap: `base` = 14px, `md` = 16px — **P1**
- `tokens.css:43-50`: `--font-size-base: 14px` but DESIGN-SYSTEM.md §Typography says "Base 16px". The doc and the tokens disagree, and the name `base` sitting *below* `md` invites wrong choices (BlockNote editor body is wired to `--font-size-base` = 14px in `apps/os/src/app/globals.css:72`, so long-form doc reading is 14px against the stated 16px intent).
- **Spec:** rename to a role scale (see §3) or at minimum: `--font-size-body: 16px` for prose surfaces (doc editor, wizard copy, empty states), keep 13–14px for tables/chrome. Document which surfaces get which. No silent global bump — table density is correct today.

### 1.3 Missing dark-mode scrim/overlay token — **P1**
- The only modal in the app uses `bg-[var(--muted)]/60` as its backdrop (`Sidebar.tsx:232`). `--muted` light = `#e9eef6` → a 60% *pale blue-white* scrim that barely dims the page in light mode and reads as a rendering glitch. ui-ux-pro-max: modal scrim should be 40–60% black-family in both themes.
- **Spec:** `--overlay: rgb(15 23 42 / 0.45)` light, `rgb(2 6 18 / 0.6)` dark. All dialogs/sheets consume it.

---

## 2. New semantic tokens (additive)

### 2.1 Interaction states
Today hover is improvised (`hover:bg-[var(--muted)]` everywhere) and pressed/selected states don't exist. Add:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surface-hover` | slate-100 `#f1f5f9` | `#16213a` | row/nav-item hover (replaces ad-hoc `--muted` hover, freeing `--muted` for fills) |
| `--surface-active` | `#e9eef6` | `#1b2740` | pressed rows, open menu triggers |
| `--surface-selected` | blue-700 @ 8% (`#1e40af14`) | blue-500 @ 16% | selected nav item, selected list card (IntakePanel packet list `IntakePanel.tsx:158` currently reuses `--muted`, indistinguishable from hover) |
| `--primary-hover` | `#1c3a9e` | `#529af7` | button hover (buttons currently have **no** hover state: `IntakePanel.tsx:132`, `change-password/page.tsx:30`) |
| `--border-strong` | slate-300 `#cbd5e1` | `#31446b` | input borders + focused-adjacent emphasis; `--border` stays for hairlines. Today inputs and hairline dividers share one border color, so forms read as flat outlines |

### 2.2 Status *surfaces* (soft variants)
Status colors exist only as foreground (`--status-ok/warn/error`, `tokens.css:66-69`). Every banner/badge improvises: the wizard's error box is a bare red border (`IntakePanel.tsx:356`), the markdown-only warning uses `border-[var(--destructive)] bg-[var(--background)]` (`IntakePanel.tsx:381`).

| Token | Spec |
|---|---|
| `--status-ok-bg` / `--status-warn-bg` / `--status-error-bg` / `--status-info-bg` | 8–12% tints of the status hue over `--surface`, per theme, WCAG-checked against their foregrounds |
| `--status-info` | blue-600 light / blue-400 dark (neutral-informational currently missing; "via Plane", "read-only" annotations would use it) |

Consumers: wizard step banners, credential "set/unset" chips, session status chips (`sessions/actions.ts:7` enum), capability run states, toast system (§2.4).

### 2.3 Motion tokens
DESIGN-SYSTEM.md §Motion specifies 150–250ms ease-out but no tokens exist and no component animates.

```
--duration-fast: 120ms;   /* hover, focus ring */
--duration-base: 180ms;   /* expand/collapse, tab underline slide */
--duration-panel: 260ms;  /* dialogs, drawers, toasts */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```
Consumers: sidebar chevron rotate + subtree expand, dialog enter (scale 0.98→1 + fade), toast slide-in, tab underline. The existing `prefers-reduced-motion` kill switch (`tokens.css:110`) already covers all of it.

### 2.4 Feedback layer tokens (toasts)
There is **no toast/notification system**; failures surface via `window.alert` (`Sidebar.tsx:219,225`) or native `confirm` (`CredentialsPanel.tsx:105`), and most success paths surface as nothing at all (every "Save" in the wizard gives zero confirmation). Spec a toast primitive in `packages/ui` consuming: `--surface` + `--shadow-md` + `--radius-md` + status tokens; bottom-right, 4s auto-dismiss, `aria-live="polite"`, never steals focus. This is a token+primitive delta because CONSTITUTION §7 requires modules compose primitives.

### 2.5 Layout + z-index scale
- `--sidebar-width: 256px` (today hardcoded `w-64`, `(app)/layout.tsx:63`) — needed once collapse/resize ships (CONCEPTS.md §2).
- `--header-height: 48px` (today `h-[var(--space-12)]` — abusing a spacing token as a height; rename for intent).
- Z-index scale as tokens: `--z-sticky: 10; --z-dropdown: 30; --z-overlay: 40; --z-modal: 50; --z-toast: 60`. Today the one modal hardcodes `z-50` (`Sidebar.tsx:232`).

### 2.6 Focus ring — make it real
`--ring` exists (`tokens.css:63`) but only CredentialsPanel consumes it (`CredentialsPanel.tsx:143` etc.). Buttons in the wizard, sidebar links, tab links, and both auth pages have **no visible focus style** beyond UA default, violating DESIGN-SYSTEM.md's own non-negotiable. **Spec:** a shared `focus-visible` recipe in `packages/ui` globals — `outline: 2px solid var(--ring); outline-offset: 2px` — applied by the button/input/link primitives, not per-callsite.

---

## 3. Typography deltas

Keep Inter + JetBrains Mono (Inter is explicitly correct here per taste-skill §4.1 override: neutral, Linear-style ops tool).

1. **Role names over T-shirt sizes.** Current scale (12/13/14/16/18/24/30/36) is fine; the *names* cause drift (§1.2). Add role aliases, keep primitives:
   - `--text-page-title: 24px/1.2, 600` (today pages use 30px `--font-size-2xl` semibold — one size too loud for an ops tool at 1280px; `s/[...path]/page.tsx:164`, `admin/intake/page.tsx:24`)
   - `--text-section: 16px/1.4, 600` — section headers are currently 13px medium (`text-[var(--font-size-sm)] font-medium`, e.g. `IntakePanel.tsx:243,270,314,345`), only one weight step from body → the wizard reads as an undifferentiated wall. This single change does more for hierarchy than any layout work.
   - `--text-body: 14px`, `--text-body-reading: 16px` (docs/wiki/empty states), `--text-caption: 12px`, `--text-code: 12.5px mono`.
2. **Tabular numerals globally for data:** `tabular-nums` is applied ad hoc (`s/[...path]/page.tsx:302` yes; `admin/intake/page.tsx:49` timestamps no). Spec: any timestamp/count/metric cell inherits `font-variant-numeric: tabular-nums` from a shared `.data-cell` primitive or the table primitive.
3. **Mono usage rule:** scope paths, IDs, event types, template paths stay mono (already the instinct: `s/[...path]/page.tsx:170`, `admin/intake/page.tsx:46,67`). But raw UUIDs should almost never be shown (STRING-AUDIT); mono is for *meaningful* machine text.
4. **Letter-spacing:** keep `-0.01em` ≥24px only. Remove the `tracking-[0.5px]` uppercase eyebrow on the sidebar "Project" label (`Sidebar.tsx:65`) — replace with sentence-case 12px `--muted-foreground` label; the uppercase-tracked micro-label is both an AI-tell and inconsistent (used exactly once in the whole app).

---

## 4. Shape & elevation deltas

1. **One radius system, enforced.** Tokens are right (6/10/14) but consumption is split between `rounded-[var(--radius-sm)]` and bare Tailwind `rounded` (4px — off-system): `IntakePanel.tsx:236,244,255,264` and ~20 more, `s/[...path]/page.tsx:297,299`, `admin/intake/page.tsx:65,78`, `MembersTab` selects (`s/[...path]/page.tsx:537,544`). **Spec:** map Tailwind's `rounded` utility to `var(--radius-sm)` in the Tailwind theme (so existing markup self-heals), and lint against `rounded-{sm,md,lg,full}` raw usage except `rounded-full` for the activity timeline dots.
2. **Elevation stays two-step.** Correct as specced. Delta: dialogs must actually use `--shadow-md` (the NewScopeDialog has no shadow, `Sidebar.tsx:234`) and dark mode should lean on surface contrast: add `--surface-raised: #16213a` (dark only; light = `--surface`) for popovers/dialogs/toasts.

---

## 5. Color deltas

1. **Accent (amber) is currently unused** — grep shows `--accent` consumed nowhere in `apps/os/src`. Either give it a job (the "attention" color for wizard steps needing human action, e.g. the paste-back step and "awaiting external" status) or drop it from the semantic layer. One accent with a defined job beats a reserved-but-dead token. Recommendation: keep, job = "waiting on a human/external action" — pairs perfectly with the wizard status model.
2. **Chart palette:** sound (`--chart-1..6`), consumed properly by widgets. Delta: define `--chart-grid` (= `--border` @ 60%) so Recharts `CartesianGrid` stops hardcoding `stroke="var(--border)"` at full strength, keeping gridlines subordinate (dataviz gridline-subtle rule).
3. **`--muted` overload.** `--muted` currently serves as: hover fill (Sidebar), selected fill (Sidebar active, IntakePanel selected card), badge bg (record kind chip `s/[...path]/page.tsx:299`), scrim (`Sidebar.tsx:232`), skeleton bone (widgets). After §2.1 lands, `--muted` = static subtle fill only (badges, skeletons); hover/selected/scrim get their own tokens. This is the single highest-leverage consistency fix.
4. **Do not add colors.** No purple, no gradients, no new hues. The restraint is the brand.

---

## 6. Component-level token contracts (new primitives in `packages/ui`)

`packages/ui/src/components/` currently ships **one** primitive (`button.tsx`); every module hand-rolls inputs, tables, dialogs, tabs, badges — which is exactly where the drift comes from. Spec these primitives (tokens-in, no new visual language):

| Primitive | Contract (all values from tokens above) |
|---|---|
| `Input` / `Textarea` / `Select` | h-36px (chrome) / h-40px (forms), `--radius-sm`, `--border-strong` border, `--background` fill, label 12px `--muted-foreground` **above**, error 12px `--status-error` **below**, focus ring per §2.6. Kills the 6+ hand-rolled input recipes (Sidebar dialog, IntakePanel, MembersTab, CredentialsPanel, auth pages) |
| `Table` | semantic `<table>`, header row 12px 500 `--muted-foreground` with `border-b`, rows `border-t --border` + `hover:--surface-hover`, cell padding `--space-2/--space-3`, numeric cells right-aligned tabular mono, wrapped in `overflow-x-auto` (only CredentialsPanel does this today) |
| `Dialog` | `--overlay` scrim, `--surface-raised`, `--radius-lg`, `--shadow-md`, enter `--duration-panel`, focus trap + Esc + `aria-modal` (NewScopeDialog currently has none of these) |
| `Badge`/`StatusChip` | 12px, `--radius-sm`, status-bg + status-fg pairs, always icon-or-text + color (never color alone) |
| `Tabs` | underline style as on scope page, but with overflow scroll + active `aria-current`; consumed by scope page + admin nav |
| `Toast` | §2.4 |
| `EmptyState` | icon (Lucide 20px) + one-line "what this is" + one action button; consumed by every "No X yet." site (currently 12+ bare-text empties, see UX-AUDIT §states) |
| `Stepper` | the wizard's numbered rail; spec in CONCEPTS.md §1 |
| `Skeleton` | `--muted` bone, `--radius-sm`, shimmer honoring reduced-motion; replaces "Loading credentials..." text (`CredentialsPanel.tsx:250`) and widget ad-hoc pulses |

---

## 7. Dark mode deltas

Dark tokens exist and are mostly coherent. Gaps:
1. No theme toggle and no `prefers-color-scheme` auto-adoption — `.dark` class is defined (`tokens.css:88`) but nothing sets it; the product ships light-only in practice despite "dark is first-class" (DESIGN-SYSTEM.md §Identity). Spec: system-preference default + manual toggle in the user menu, stored per user; stamp `data-theme`/`.dark` on `<html>` pre-hydration to avoid flash.
2. Scrim/overlay per §1.3, `--surface-raised` per §4.2 — without them dark dialogs would be invisible against dark canvas.
3. Verify `--primary-foreground` dark (`slate-950` on `blue-500`) — passes for large text only; check 13px button labels for AA, may need white at 90%.

---

## 8. Enforcement

1. Extend `validate-tokens` CI: (a) unknown `var(--*)` names (catches §1.1-class bugs), (b) raw `rounded`/`text-sm`/`p-3`-style utilities in modules where a token/primitive exists, (c) raw hex outside `tokens.css`.
2. Primitive-first rule already exists in CONSTITUTION §7 — the deltas above make it *possible* to follow; the audit shows it is currently impossible (no Input/Table/Dialog primitives to compose).

## Effort summary

| Delta | Effort |
|---|---|
| §1 token bugs | S |
| §2 state/status/motion/z tokens | S |
| §3 type roles | S (tokens) + M (sweep call sites) |
| §4–5 radius mapping, muted split, accent job | M |
| §6 primitives | L (but pays for every concept in CONCEPTS.md) |
| §7 dark toggle | M |
