# tenant admin module - AGENTS.md

Root-admin services for operating a tenant instance: users, grants, activity, automations, instance settings, and LiteLLM virtual keys.

## Contract
- Service functions live in `service.ts` and `litellm.ts` and are exported from `@companyos/api`.
- No tables are owned by this module. It reuses kernel tables, Better Auth tables, capability tables, and env-backed LiteLLM configuration.
- Every mutation emits an event on the root scope.
- User creation is mediated through an injected Better Auth admin surface; the service never hashes passwords itself.

## Gating
- Every admin service requires `admin` or `owner` on the root scope through `requireAccess(db, actor, "root", "admin")`.
- App routes must still gate with `resolveAccess(actor, "root")` and `notFound()` so non-admins cannot discover the admin section.

## Temp Passwords
- Admin-created accounts receive a generated temporary password unless one is explicitly supplied by the caller.
- Forced first-login password change is tracked in the existing Better Auth `account.scope` field for the credential account as JSON metadata:
  `{ "companyos": { "forcePasswordChange": true } }`.
- No migration is required for this metadata.

## LiteLLM
- LiteLLM admin calls use `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY`.
- If `LITELLM_MASTER_KEY` is unset, the service returns a UI notice and does not throw.
- On first admin visit, visible env-backed virtual keys for `LITELLM_EMBED_KEY` and `BRAIN_LITELLM_API_KEY` get the default monthly budget of USD 25 when no budget is set. Repeated visits are idempotent.
- Key values and provider env values are never returned or written to events.

## Tests
- `admin.test.ts` covers root-admin permission gating, temp-password first-login metadata flow, LiteLLM budget idempotency, and key-value redaction.
