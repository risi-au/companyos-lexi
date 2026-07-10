# UX-06C — Visual-fidelity DELTA audit report

Audited 2026-07-10 against `CompanyOS.html` + handoff README. UX-06A/B fixes (264px shell, top-right theme swatches, search pill, side tick, A-/A+, 820px wizard CSS) verified present — not re-reported below.

## 1. Duplicate theme selector

theme selector | P1 | CHROME fix-now | theme control top-right only (4 circular swatches in view chrome) → duplicate full text theme list (Auto/Circadian, Light — Terrazzo Quiet, Dark — Green Hall, Dark — Charcoal) pinned in sidebar bottom user block | apps/os/src/app/(app)/_components/UserMenu.tsx:93
theme selector | P2 | CHROME fix-now | sidebar bottom empty after system links (ends at Brain/Ops/Admin rows, `padding-bottom:12px`) → `mt-auto` footer renders user card + theme grid | apps/os/src/app/(app)/_components/AppShellChrome.tsx:102
theme selector | MATCHES | top-right circular theme swatches + A-/A+ in 48px header match prototype `themeModes` placement | apps/os/src/app/(app)/_components/AppShellChrome.tsx:119

## 2. Sidebar work tree

sidebar tree | P1 | CHROME fix-now | every scope/nav row has 14px lead icon (home/chev/grid per node) → scope rows text-only; Home icon only on inactive root | apps/os/src/app/(app)/_components/Sidebar.tsx:310
sidebar tree | P1 | CHROME fix-now | active-scope module rows: `margin-left:47px` + `border-left:2px solid var(--primary)` spine + 14px icon per row → text-only links, no spine, no icons | apps/os/src/app/(app)/_components/Sidebar.tsx:384
sidebar tree | P2 | CHROME fix-now | section headers `work`/`system`: JetBrains Mono 11px quiet → 12px + `tracking-[0.08em]` reads oversized/loud | apps/os/src/app/(app)/_components/Sidebar.tsx:173
sidebar tree | P2 | CHROME fix-now | scope rows `min-height:30px`, `gap:7px`, label 13.5px Gantari → `py-[var(--space-1)]` rows feel sparse/tall | apps/os/src/app/(app)/_components/Sidebar.tsx:317
sidebar tree | P2 | CHROME fix-now | search pill includes mono `⌘K` shortcut chip → plain placeholder only | apps/os/src/app/(app)/_components/Sidebar.tsx:157
sidebar tree | P3 | CHROME fix-now | tree indent driven by spine column (fixed module offset 47px) → `level * 16px + 20px` padding only | apps/os/src/app/(app)/_components/Sidebar.tsx:375
sidebar tree | IA-DEFER | ~6 module tabs per scope in prototype vs ~12 in staging (real module set) — IA not chrome | apps/os/src/app/(app)/_components/Sidebar.tsx:21
sidebar tree | MATCHES | system links (Brain, Ops Health, Admin) carry 16px Lucide icons; active scope row has 3px primary side tick + subtle fill | apps/os/src/app/(app)/_components/Sidebar.tsx:214

## 3. Admin overview

admin overview | P1 | CHROME fix-now | view top bar shows shield icon + "Admin" + org chip pill → global chrome still hardcodes "Scope" on admin pages | apps/os/src/app/(app)/_components/AppShellChrome.tsx:117
admin overview | P1 | CHROME fix-now | stat tiles: label + Gantari 28px number + muted sub-line ("12 sub-projects", "9 people · 5 agents") → label + bare mono number, no sub-line | apps/os/src/app/(app)/admin/page.tsx:30
admin overview | P1 | CHROME fix-now | stat big numbers Gantari semibold `tabular-nums` → `font-mono` via shared StatCard | packages/ui/src/components/card.tsx:51
admin overview | P1 | COPY string-fix | recent activity human title (sans) + optional mono path → raw event enums (`capability.run_reported`, `token.issued`) in mono | apps/os/src/app/(app)/admin/page.tsx:40
admin overview | P1 | CHROME fix-now | Integrations rows with status pills (Tasks·Plane, etc.) → MISSING section on overview | apps/os/src/app/(app)/admin/page.tsx:26
admin overview | P2 | CHROME fix-now | admin 48px bar includes degraded/alert status pill → alert data not surfaced in shell header | apps/os/src/app/(app)/admin/layout.tsx:18
admin overview | MATCHES | admin page title/subtitle and tab row use sans Gantari; LiteLLM row uses `labelForIntegrationState` (sans) | apps/os/src/app/(app)/admin/page.tsx:56

## 4. Wizard chrome

wizard chrome | P1 | CHROME fix-now | full-screen `view:'wizard'` takeover with dedicated 48px header → embedded Setup tab panel inside scope page | apps/os/src/modules/intake/IntakePanel.tsx:267
wizard chrome | P1 | CHROME fix-now | header = "Set up" + mono path chip + status pill + "Esc saves & closes" hint → sans path in title, no Esc hint | apps/os/src/modules/intake/IntakePanel.tsx:496
wizard chrome | P2 | CHROME fix-now | rail step chips 24px round, mono 14px numbers; `wiz-stepcount` "Step N of 6" above rail → 20px chips (`h-5 w-5`), step count only in body header | packages/ui/src/components/stepper.tsx:67
wizard chrome | P2 | CHROME fix-now | Basics meta values (status/template/date labels) sans Gantari → all values forced `font-mono` including "In progress" | apps/os/src/modules/intake/IntakePanel.tsx:703
wizard chrome | P3 | CHROME fix-now | rail `gap:2px`, padding `16px 14px` → `gap-[var(--space-3)]`, border/padding via embedded card wrapper | packages/ui/src/components/stepper.tsx:51
wizard chrome | MATCHES | desktop `wiz-grid` 210px/1fr, vertical spine + fill, mono step numbers, copy buttons `minWidth` 120px/172px | apps/os/src/modules/intake/IntakePanel.tsx:530

## 5. Mono usage

mono usage | rule | prototype sets JetBrains Mono on: section headers work/system, paths/breadcrumbs/scope keys, step-rail numbers, code/paste blocks, API aliases, provision tags, ⌘K badge, attention counts, numbered instruction indices, event path suffixes — Gantari everywhere else (nav labels, stat labels, stat big numbers, stat sub-lines, status pill text, wizard step labels, human activity titles, timestamps)
mono usage | P1 | CHROME fix-now | stat metric values → `font-mono` in StatCard (prototype Gantari 28px) | packages/ui/src/components/card.tsx:51
mono usage | P1 | CHROME fix-now | intake status label "In progress" → `font-mono` in Meta (prototype sans status text) | apps/os/src/modules/intake/IntakePanel.tsx:703
mono usage | P1 | COPY string-fix | activity event type strings → `font-mono` raw enums (prototype sans human title) | apps/os/src/app/(app)/admin/page.tsx:40
mono usage | MATCHES | scope path breadcrumb, wizard step numbers, provision tags, code textareas correctly mono | apps/os/src/app/(app)/s/[...path]/page.tsx:172

---

**Summary:** The three highest-impact fixes are (1) remove the duplicate sidebar theme list and leave theme control only in the header, (2) narrow mono to paths/counts/code by fixing `StatCard` and wizard/admin status labels so human-readable strings use Gantari, and (3) rebuild sidebar scope/module rows with per-row icons and the primary left spine so the work tree matches prototype density and hierarchy.