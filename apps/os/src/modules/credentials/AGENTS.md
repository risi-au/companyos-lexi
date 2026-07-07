# apps/os/src/modules/credentials - AGENTS.md

Per-scope credential vault UI (M8-09). Thin client/server-action wrappers around
`@companyos/api` credential services.

## Purpose
- Show credential metadata for the current scope.
- Let admins add, update, and delete named credential values.
- Let the intake setup flow list requested credentials and quick-fill name/description
  fields after provisioning.

## Files
- `CredentialsPanel.tsx`: client component for requested-credential rows, write-only
  value form, metadata table, refresh/edit/delete controls.
- `actions.ts`: server actions calling `api.listCredentials`,
  `api.setCredential`, and `api.deleteCredential`.
- `index.ts`: public export for scope pages.
- `AGENTS.md`: this file.

## Data / Contract
Consumes from `@companyos/api` via `@/lib/api`:
- `listCredentials({ scopePath }, actor)` returns metadata only.
- `setCredential({ scopePath, name, description?, value }, actor)` writes encrypted
  values; the action never returns plaintext.
- `deleteCredential({ scopePath, name }, actor)` removes a credential.

## Permissions
The service layer is authoritative. The UI mirrors it:
- viewer/editor/agent can see metadata.
- admin/owner can add, update, or delete.
- values are never fetched by this UI.

## Do / Don't
- Values are write-only in the UI. Never display, prefill, copy, log, or include
  existing values in client state.
- Server actions + api wrappers only; never direct DB access.
- Update this AGENTS.md on behavioral changes.
