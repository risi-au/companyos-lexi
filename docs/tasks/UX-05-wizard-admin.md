# UX-05: Wizard 6-step rail + completion animation + admin tabs/tables/empty-states

status: todo (written 2026-07-09, against DESIGN-SYSTEM-V2.md §4.2/§4.3/§5)
module: packages/ui (new shared primitives) + apps/os (intake wizard, scope tab bar, admin)
branch: task/UX-05 (off main after UX-02 merged @ 3ab937a)

## Why

Foundations (UX-01), feedback layer (UX-02) are merged; UX-04 (sidebar/drawer) runs in
parallel on its own branch. UX-05 is the last big package: the interactive core of the
mockup — the creation wizard as a **6-step rail** with the **completion "dopamine"
animation** (§4.3, owner-flagged as important) and a **provisioning sequence**, plus the
**admin** section's tabs/tables/empty-states. It also builds the shared **Tabs / Table /
Card / EmptyState / Stepper** primitives that don't exist yet, which both the wizard,
the scope-page tab bar, and admin all consume.

Read **`docs/design/DESIGN-SYSTEM-V2.md` §5 (wizard, admin, scope-page header, stat
ribbon, activity table bullets), §4.2 (durations/eases), §4.3 (CSS keyframes + the
completion reward)** before starting. Visual reference:
`docs/design/reference/CompanyOS.dc.html` — serve over local HTTP (`python -m
http.server` from `docs/design/reference/`; NOT `file://`). Read exact markup/spacing,
the wizard rail spine-fill, the provisioning step timing, and the completion animation
off the rendered mockup + its unpacked inline `<script>` (largest inline script after the
bundler unpacks the blob). §4/§5 are the distilled contract; the file is ground truth for
anything not pinned to an exact value.

## Foundations already in place (build on these)

- `packages/ui/src/motion.ts`: `anim(fn)` / `df(duration)` / `rm()`. Use for every GSAP
  animation (tab underline slide, wizard step enter, spine-fill, stat count-up, copy
  bounce, provisioning spinner). Do NOT import `gsap` directly; do NOT reimplement the
  reduced-motion check. GSAP is already a dependency — **no new dependency of any kind.**
- `packages/ui/src/tokens.css`: all v2 tokens under `body[data-theme=...]`. `var(--token)`
  only, no raw hex (validate-tokens gate). `--space-*`, `--font-size-*`, `--radius-2/-3/-4`,
  `--font-mono` all exist.
- `useConfirm` / `useToast` from `@companyos/ui` (UX-02) — use `useConfirm` for the
  wizard "…" menu actions and every admin destructive action; `useToast` for
  success/error feedback. Provider is already mounted app-wide.
- The scope-page tab bar at `apps/os/src/app/(app)/s/[...path]/page.tsx` (~lines 186–257)
  is the visual reference for the Tabs primitive (highlighted underline style, 12 real
  tabs). The admin tab bar (`admin/layout.tsx`) is currently un-highlighted `<Link>`s.

## Current state (from a full read — preserve behavior)

- **Wizard** = `apps/os/src/modules/intake/IntakePanel.tsx` (`IntakePanel` + inner
  `WizardWorkspace`). Today it is a **single long scrolling form of 5 stacked
  `<section>`s, all visible at once, NO step gating**: (1) Framing, (2) Related history,
  (3) Brain reuse, (4) External pack (the copy-paste-back to an external LLM), (5) Review
  (JSON textareas + Save/Approve/Provision/Reject). Progression is driven by
  `intake.status` (`draft|awaiting_external|needs_review|approved|provisioned|rejected|
  dismissed`) and per-button `disabled` guards — there is **no `maxStep`/stepper concept**
  today. All server actions live in `apps/os/src/modules/intake/actions.ts`
  (`saveFramingFieldsAction`, `findRelatedHistoryAction`, `saveRelatedHistoryAction`,
  `findReusePatternsAction`, `acceptReusePatternAction`, `externalPackAction`,
  `submitPasteAction`, `saveReviewAction`, `approveIntakeAction`, `provisionIntakeAction`,
  `rejectIntakeAction`, `dismissIntakeAction`, `reopenIntakeAction`). **This is a UI
  reorganization into a stepped rail — NOT a logic rewrite.** Keep every action call and
  the status-driven semantics intact.
- Wizard mounts as the **Intake tab** of the scope page (`s/[...path]/page.tsx`,
  `?wizard={intakeId}` forces that tab, renders `<IntakePanel initialOpenId={wizardParam}/>`).
- **Admin** = `apps/os/src/app/(app)/admin/` — all server components. `layout.tsx` tab
  bar is hand-rolled `<Link>`s with **no active highlighting**. Every table
  (`users`, `grants`, `settings`, `automations`, `activity`, `intake`, `health`) is a raw
  `<table>`; empty states are ad-hoc inline text / `colSpan` rows. Destructive actions are
  plain server-action `<form>` submit buttons (`disableAdminUserAction`,
  `revokeAdminGrantAction`, `revokeLiteLlmKeyAction`, `resetAdminUserTempPasswordAction`)
  — **none use `useConfirm` yet**. Server actions in `apps/os/src/modules/admin/actions.ts`.
- **No Tabs / Table / Card / EmptyState / Stepper primitive exists** anywhere — all inline.

## Do — build in this order (so partial completion still lands useful foundations)

### A. Shared primitives in `packages/ui` (hand-rolled, exported via `index.ts`)
1. **`Tabs`** — grouped tab bar with an **animated sliding underline** (§4.2: tab
   underline slide 0.2s `power3.out`, via `anim()`+`df()`; instant under `rm()`). Support
   both link-style tabs (href per tab, for the scope page) and controlled state tabs (for
   admin/wizard-internal). `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, arrow-key
   nav.
2. **`Table`** — a thin styled wrapper (header row, zebra/hover per §1 tokens, borderless
   per the mockup) that renders columns + rows generically; must cover the `Who · What ·
   When` activity shape and the admin users/keys shapes. Include a built-in empty-state
   slot.
3. **`Card`** — borderless surface card (no border, just `--surface`/`--raised` bg +
   `--shadow` per §1) for the stat ribbon and admin overview tiles. A `StatCard` variant
   whose number **counts up on enter** (§4.2: 0.8s `power2.out`, via the motion helper) is
   in scope.
4. **`EmptyState`** — icon (lucide) + title + one-line body, per §5 admin requirement.
5. **`Stepper`** (wizard rail) — `01`–`06` mono numerals (`--font-mono`) with a **spine
   line that fills to the current step** (§4.2: spine-fill rail height 0.35s `power2.out`,
   GSAP height tween via `anim()`). Steps beyond the max-reached step are **locked** (not
   clickable). Controlled: `steps`, `current`, `maxReached`, `onStepClick`.

### B. Completion animation (§4.3) — the OS-wide "mark done" reward
6. Add the three CSS keyframes from §4.3 (`popIn`, `ringOut`, `riseFade`) to a shared
   stylesheet (`packages/ui/src/globals.css` or a new `keyframes.css` imported by the
   package). Build a small reusable helper/component that, on marking an item done, pops a
   moss-green circle in, bursts a ring outward, and floats a rising "N to go" (or "all
   clear ✓" at zero) cheer that fades. **Only the just-completed item animates** — track a
   "just-toggled index" and clear it once consumed (mirror the mockup's `burstQ`). These
   keyframes always run except under full reduced motion. Wire it into the wizard step-5
   checklist (below); note in AGENTS.md that it's meant to be reused for every "mark done"
   moment OS-wide (other call sites are out of scope for this package).

### C. Wizard 6-step rail (`apps/os/src/modules/intake/IntakePanel.tsx`)
7. Reorganize `WizardWorkspace`'s existing 5 sections into the **6-step rail**
   `Basics → Framing → History → Interview → Review → Provision` (§5), using the `Stepper`.
   Map the existing content onto steps (Basics = scope reason/framing intro; Framing =
   framing questions; History = related-history + brain-reuse; Interview = external pack
   copy-paste-back; Review = the review JSON/approve; Provision = new, see step 9). One
   step visible at a time; step body **enters** on change (§4.2: slide 0.22s `power3.out`,
   inner "stage" stagger 0.2s/0.05s/delay 0.04s `power2.out`). **Preserve every server
   action and the `intake.status` semantics** — steps beyond what the status permits are
   locked, exactly reflecting today's `disabled` guards. Do not remove any existing
   capability (save framing, find/accept history, find/accept reuse, assemble pack, submit
   paste, save review, approve, provision, reject, dismiss, reopen).
8. **Interview step**: keep the external-pack copy-paste-back. The **copy-pack button is
   fixed-width and must NOT resize when its label changes** (owner fix, chat-log 107–121).
   Copy-button press bounce (§4.2: 0.3s scale .94→1 `power3.out`). Keep the markdown-only
   warning + precheck behavior.
9. **Review step (step 5)**: render the open-questions as a checklist that fires the §4.3
   completion animation (step B) as each is checked. **Provision step (step 6)**:
   sequential provisioning — pending → running (spinner rotate §4.2: 1s linear `repeat:-1`)
   → done, one step at a time ~620ms apart (× 0.3 under reduced motion, **not skipped** —
   provisioning must still visibly complete), ending in a "Scope is live" state. Wire to
   `provisionIntakeAction` for the real work; the sequence is the visual layer over it.
10. A **"…" menu** on the wizard header exposing **send back / reject / dismiss**, each
    behind a `useConfirm` dialog (wired to `reopenIntakeAction`/`rejectIntakeAction`/
    `dismissIntakeAction`). Toasts for success/failure.

### D. Scope-page tab bar + admin
11. **Scope-page tab bar**: replace the inline `<a>` tab bar in `s/[...path]/page.tsx`
    with the `Tabs` primitive (animated underline). **Keep all 12 real tabs and their
    exact `?tab=` targets / `makeTabHref` behavior** — visual swap only, no route/param
    changes. (This file also mounts the wizard; leave that mount logic intact.)
12. **Admin**: `admin/layout.tsx` tab bar → `Tabs` with active highlighting (all existing
    tabs: Overview·Users·Grants·Activity·Automations·Settings·MCP·Health). Convert the raw
    admin tables to the `Table` primitive and give each tab a designed `EmptyState`
    (icon + title + one-line body) instead of bare "No X." text. Admin overview stat tiles
    → `Card`/`StatCard`. **Wire `useConfirm` to the destructive admin actions**
    (`disableAdminUserAction`, `revokeAdminGrantAction`, `revokeLiteLlmKeyAction`; and
    `resetAdminUserTempPasswordAction` — confirm-worthy). Admin pages are **server
    components**, so add small `"use client"` wrapper buttons (e.g. a
    `ConfirmSubmitButton`) that call `useConfirm` then submit the existing server-action
    form — do not convert whole pages to client components, and do not change any server
    action.
13. **AGENTS.md**: update `packages/ui/AGENTS.md` (new primitives + the reusable
    completion animation) and `apps/os`'s AGENTS.md (wizard rail + admin now on shared
    primitives). A sentence or two each.

## Don't

- **Do not touch the sidebar** (`Sidebar.tsx`) or the app-shell `layout.tsx` / mobile
  drawer — that's **UX-04's** branch, running in parallel. Your only shared file with it is
  `packages/ui/src/index.ts` (barrel exports) — expect a trivial merge there.
- Do not rewrite the wizard **logic** (`packages/wizard/*`) or change any intake status
  semantics, server-action signatures, route slugs, or `?tab=` values. UI reorg only.
- Do not drop or rename existing wizard capabilities or admin actions.
- Do not import `gsap` directly (use `motion.ts`); no raw hex; **no new dependency**.
- Do not migrate unrelated old-token consumers or restyle modules outside wizard/admin/
  scope-tab-bar.
- Do not modify `docs/design/reference/*`, other `docs/tasks/*` files (only this file's
  status line), or anything under `USER DATA/`.
- Do not touch the toast/confirm primitives themselves or the theme switcher.

## Acceptance criteria

- [ ] `Tabs`, `Table`, `Card`/`StatCard`, `EmptyState`, `Stepper` exist in `packages/ui`,
      exported from `index.ts`, styled with `var(--token)` only (no raw hex).
- [ ] Wizard renders as a 6-step rail (`01`–`06` mono, spine fills to current step, steps
      beyond max-reached locked); one step at a time with the §4.2 enter motion; every
      existing server action still reachable and the `intake.status` flow unchanged.
- [ ] Interview copy-pack button is fixed-width (no resize on label change); Review
      checklist fires the §4.3 completion animation (only the just-toggled item);
      Provision step runs the sequential pending→running→done sequence ending "Scope is
      live"; "…" menu send-back/reject/dismiss each gated by a confirm dialog.
- [ ] §4.3 keyframes (`popIn`/`ringOut`/`riseFade`) present and reusable; run except under
      full reduced motion.
- [ ] Scope-page tab bar uses the `Tabs` primitive with all 12 tabs + unchanged `?tab=`
      targets; admin tabs highlight the active tab; admin tables use `Table`; each admin
      tab has a designed `EmptyState`; admin destructive actions gated by `useConfirm` via
      client wrapper buttons (pages stay server components).
- [ ] All GSAP via the `motion.ts` helper; reduced motion respected (provisioning still
      completes visibly); no new dependency added.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from root.
