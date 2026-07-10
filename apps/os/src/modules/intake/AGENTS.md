# apps/os/src/modules/intake - AGENTS.md

Creation wizard UI module. Thin client/server-action wrappers around
`@companyos/api` intake services.

## Purpose
- Scope page resume card and Intake tab.
- Wizard steps: structured framing fields, related-history selection, brain reuse,
  external pack, paste-back return, review, approval, explicit provisioning,
  dismiss/reopen.
- UX-05 presents the same flow as a 6-step rail (`Basics -> Framing -> History
  -> Interview -> Review -> Provision`) using `@companyos/ui` Stepper and the
  reusable completion reward for the review checklist.
- Provisioning has local visual sequencing over the existing
  `provisionIntakeAction`; do not move provisioning business logic into the UI.
- Review displays the stored pack snapshot and warns loudly when a return was
  markdown-only without a fenced JSON packet.
- Root admin `/admin/intake` queue and template editor.

## Contract
- No direct DB access.
- Server actions call `src/lib/api.ts` only.
- All writes are persisted by `packages/api/src/modules/intake`.

## How to test
- UI actions are typechecked through `@companyos/os`.
- Service behavior is covered in `packages/api/src/modules/intake/intake.test.ts`.
## UX-06C Notes
- The Intake tab is the entry point; opening a setup renders `WizardWorkspace` as a right-pane full-screen takeover with its own 48px header.
- Escape closes the takeover through the existing local close path. Persistence remains in the existing per-step server actions.
