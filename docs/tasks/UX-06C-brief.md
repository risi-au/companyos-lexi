# UX-06C — Visual fidelity fixes (design reconciliation, delta pass)

status: implemented 2026-07-10
branch: task/UX-06C (off main @ 07ade77)

## Context

UX-06A/B are merged but the app still visibly diverges from the design prototype.
**The spec for this task is `docs/tasks/UX-06C-audit-report.md`** (in this worktree):
fix every row tagged `CHROME fix-now` and `COPY string-fix`. Skip the `IA-DEFER` row.
Rows marked `MATCHES` need nothing.

The design handoff is at `design_handoff/` in this worktree: `README.md` = exact values,
`CompanyOS.html` = visual source of truth (large — SEARCH it for the relevant markup/CSS,
never read linearly), `LOCKED-DECISIONS.md` = rationale. `CompanyOS.dc.html` markup is
reference only; its runtime (`support.js`, `<x-dc>`, `{{ }}`) is pseudocode — do not port.

**Reconcile, don't rebuild**: keep existing component structure, the
GSAP-via-`packages/ui/src/motion.ts` pattern, all routes, `?tab=` values, server actions,
and data flow.

## Files you own

- `apps/os/src/app/(app)/_components/AppShellChrome.tsx`, `Sidebar.tsx`, `UserMenu.tsx`
- `apps/os/src/app/(app)/admin/page.tsx`, `admin/layout.tsx`
- `apps/os/src/modules/intake/IntakePanel.tsx`
- `packages/ui/src/components/stepper.tsx`, `card.tsx`
- `apps/os/src/lib/labels.ts` (COPY rows)
- Tests for the above. `packages/ui/src/tokens.css`/`globals.css` ONLY if a var you need
  is genuinely missing (unlikely — check first).

## Do

1. **Kill the duplicate theme selector** (audit Â§1). Remove the theme list from the
   sidebar footer; the header swatches are the only theme control. For the user block
   (name/email/sign-out) currently in the footer: match what `CompanyOS.html` does with
   user identity; if the prototype has no sidebar user affordance, keep a single minimal
   row (name + sign-out icon button, no email line, no theme grid) and note it in your
   final summary. Prototype sidebar otherwise ends after the system links.
2. **Sidebar work tree** (audit Â§2): 14px lead icon on every scope/nav row (Lucide,
   matching the prototype's glyph per node type — inspect `CompanyOS.html` sidebar
   markup); active-scope module rows hang off `margin-left:47px` +
   `border-left:2px solid var(--primary)` spine with a 14px icon per module row; row
   density `min-height:30px`, `gap:7px`, labels 13.5px Gantari; section headers
   `work`/`system` JetBrains Mono 11px quiet (drop the 0.08em tracking); search pill gets
   the mono `⌘K` chip; indent driven by the spine column, not `level*16px` padding.
3. **Admin overview** (audit Â§3): top bar must reflect the current section — shield icon
   + "Admin" + org chip on `/admin/**` (and the correct title on other system pages),
   never hardcoded "Scope"; stat tiles get the muted sub-line per prototype ("12
   sub-projects", "9 people · 5 agents" pattern — derive from data already loaded by the
   page); `StatCard` big number switches `font-mono` â†’ Gantari semibold `tabular-nums`
   (this is the shared component — intended, fixes all stat tiles app-wide); add the
   Integrations section (rows + status pills, e.g. "Tasks · Plane / Connected") reusing
   integration state the admin area already fetches elsewhere — if no existing
   loader/query is reachable from the overview page, note it in your summary instead of
   inventing a new endpoint; surface the existing alerts/degraded count as a status pill
   in the admin 48px bar.
4. **Wizard full-screen takeover** (audit Â§4): render the setup wizard as the prototype's
   full-screen `view:'wizard'` takeover with its dedicated 48px header — "Set up" + mono
   path chip + status pill + "Esc saves & closes" hint. Esc triggers the EXISTING
   save-and-close path (wizard already autosaves per step — wire, don't invent
   persistence). The Setup tab remains the entry point (summary card + Resume/Start
   opens the takeover) per the prototype's structure. Rail: 24px round step chips with
   mono 14px numbers, "Step N of 6" count above the rail, rail `gap:2px` +
   `padding:16px 14px`. Basics meta VALUES (status, template, dates) render sans
   Gantari — mono stays only on the path chip.
5. **Mono cleanup** (audit Â§5 rule line): JetBrains Mono is ONLY for section headers,
   paths/breadcrumbs/scope keys, step-rail numbers, code/paste blocks, API aliases,
   provision tags, ⌘K badge, attention counts, instruction indices. Everything
   human-readable (nav labels, stat labels/numbers/sub-lines, status pill text, wizard
   step labels, activity titles, timestamps) is Gantari. Fix the three P1 sites and any
   other `font-mono` you touch that violates the rule.
6. **COPY rows**: admin Recent activity renders human titles via a `labelFor*` map in
   `apps/os/src/lib/labels.ts` (extend the existing pattern) — sans title, optional mono
   path suffix per prototype. Raw enums (`capability.run_reported`, `token.issued`)
   must not render anywhere.
7. **Tests**: update assertions that reference changed strings/classes; add coverage for
   new label map entries. Suite must stay green (310 tests; new tests on top are fine —
   never weaken test logic).
8. Flip this file's status line to `status: implemented` and add a short "Deviations"
   section for anything you intentionally skipped and why.

## Don't

- No behavior, route, IA, or contract changes: `?tab=` values, route slugs, enums, DB/API
  values, MCP names, the 13 intake server actions, `intake.status` flow — byte-identical.
- Don't change which module tabs exist (the IA-DEFER row is out of scope).
- No new dependencies, no lockfile changes, no raw hex (validate-tokens gate — use the
  existing theme vars), no direct `gsap` imports (only via `motion.ts`).
- Don't modify `design_handoff/`, `docs/tasks/UX-06C-audit-*.md`, `docs/design/*`, other
  `docs/tasks/*` files, anything under `USER DATA/`.
- String style per STRING-AUDIT Â§6: no em/en dashes in new UI strings, one real ellipsis
  "…", second person, calm.
- Don't attempt to commit (sandbox denies `.git` writes — the architect commits). Leave
  the work in the tree.

## Acceptance criteria

- [ ] Sidebar footer theme list gone; header swatches are the only theme control.
- [ ] Every sidebar nav row has its icon; module rows on the 2px primary spine at 47px;
      headers mono 11px; ⌘K chip present; row density per prototype.
- [ ] `/admin` top bar: shield + "Admin" + org chip (no "Scope"); tiles have sub-lines;
      Integrations section present (or noted as blocked); StatCard numbers Gantari;
      alerts pill in admin bar.
- [ ] Wizard runs as full-screen takeover with the specified header incl. "Esc saves &
      closes"; Esc uses the existing save path; rail chips 24px; meta values sans.
- [ ] Grep-level: no `font-mono` on StatCard values, intake meta values, or activity
      titles; no raw event enums rendered.
- [ ] `tsc -b`, `eslint`, `vitest` green in-sandbox (orchestrator runs the real
      `pnpm typecheck/lint/test` gates after).
- [ ] Status line flipped + Deviations section added.

If you hit a rate/usage limit, print a line starting `LIMIT-ALERT:` and stop.
## Deviations

- The prototype has no sidebar user identity affordance; kept the allowed minimal footer row with name and sign-out icon only.
- Admin activity path suffixes render only when the existing event payload includes `scopePath` or `path`; no new API endpoint or joined event loader was added.
