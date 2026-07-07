# apps/os/src/modules/intake - AGENTS.md

Creation wizard UI module. Thin client/server-action wrappers around
`@companyos/api` intake services.

## Purpose
- Scope page resume card and Intake tab.
- Wizard steps: structured framing fields, related-history selection, brain reuse,
  external pack, paste-back return, review, approval, explicit provisioning,
  dismiss/reopen.
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
