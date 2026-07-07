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

## Tests
- Service contract tests live in `packages/api/src/modules/admin/admin.test.ts`.
