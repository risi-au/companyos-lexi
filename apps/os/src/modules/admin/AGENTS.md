# admin module - AGENTS.md

Tenant-admin UI for root admins.

## Purpose
Render the `/admin` section for day-to-day instance operations: users, grants, activity, automations, settings, and LiteLLM key management.

## Contract
- All business logic goes through `@companyos/api` via `apps/os/src/lib/api.ts`.
- Routes under `/admin` are gated by `resolveAccess(actor, "root")` and `notFound()`.
- Secret values are never rendered. LiteLLM key values are accepted only as form inputs for revoke/update calls and are not echoed.
- Cross-link to `/admin/health` and `/admin/mcp`; do not duplicate those existing surfaces.

## Files
- `actions.ts`: server actions for admin forms.
- `UserCreateForm.tsx`: client form that displays the one-time temporary password returned from account creation.
- `ConfirmSubmitButton.tsx`: client submit wrapper for server-action forms that
  need `useConfirm` before destructive/admin-sensitive actions.
- Admin pages should stay server components and compose shared `@companyos/ui`
  Tabs/Table/Card/EmptyState primitives for V2-native surfaces.
- `/admin/health` renders `getOpsHealth().wikiContributions` as the compact "Wiki contributions (14d)" table and shows "No wiki activity yet." when all counts are zero.

## Tests
- Service contract tests live in `packages/api/src/modules/admin/admin.test.ts`.
## UX-06C Notes
- Admin overview uses existing admin settings and alert loaders for integration rows, stat sub-lines, recent activity labels, and the shell degraded-count pill.
- Recent activity must render human event labels from `apps/os/src/lib/labels.ts`; raw event type strings are not UI copy.
