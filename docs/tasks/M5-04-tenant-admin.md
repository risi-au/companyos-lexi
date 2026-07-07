# M5-04: Tenant admin (users, roles, observability UI)

status: draft — needs owner product decisions before dispatch
module: apps/os + packages/api
branch: task/M5-04

## Goal (draft)

An admin area inside the OS app for running a tenant day-to-day without the architect:
manage users/principals (invite, disable, role grants per scope), see system health
(capability runs, alerts, recent events, sync states), and manage instance settings
(INSTANCE_NAME, skills repo, integrations status). DESIGN §7 M5: "tenant admin (users, SSO,
observability UI)".

## Open decisions for the owner (answer before this becomes dispatchable)

1. **SSO scope for v1**: email/password only (current better-auth) vs adding Google SSO now?
   (better-auth supports it; needs OAuth app credentials.)
2. **Invite flow**: email invites (needs SMTP/provider creds) or admin-created accounts with
   temp passwords for v1?
3. **Observability surface v1**: is capability runs + alerts + events list enough, or do you
   want container/host metrics too (needs an agent on the VPS — bigger scope)?
4. **Where admin lives**: `/admin` section gated by root-scope admin role (proposed) — ok?

## Likely shape (to be firmed up)

- `packages/api`: admin service fns reusing kernel grants (`requireAccess(root, "admin")`),
  user CRUD via better-auth admin API, list wrappers over events/capabilities/alerts.
- `apps/os`: `/admin` routes — Users, Grants, Activity (events), Automations (capabilities +
  runs + alerts), Settings.
- No new tables expected besides possibly `invites`.

## LLM & keys admin (owner request 2026-07-07 — in scope for this task)

Root-admin surface for the instance's LLM plumbing, so key/model management doesn't
require SSH + curl (the M8 activation pass did all of this by hand):

- **Virtual keys**: list LiteLLM virtual keys (alias, created, budget, spend), mint new
  ones (the `/key/generate` flow used for LITELLM_EMBED_KEY/BRAIN_LITELLM_API_KEY),
  revoke, set per-key budgets. OS talks to LiteLLM with LITELLM_MASTER_KEY it already
  holds.
- **Model/alias status**: show the alias table (cheap/analysis/reasoning/code/embed →
  provider model) from LiteLLM, and which provider env keys are present (names only,
  never values) — surfaces "embed alias has no OPENAI_API_KEY" class problems.
- **Usage/spend**: per-key and per-model spend from LiteLLM's tracking DB; complements
  /admin/mcp (M7-03) which covers agent-side token usage, and M9-01 which covers
  liveness/expiry alerting. Cross-link all three rather than duplicating.
- Provider API keys themselves stay in `.env` (compose-managed) — display presence and
  test-probe them, don't store or edit secrets in the DB.

## Don't (already firm)

- No multi-tenant control-plane concerns here (that's M5-05) — this is WITHIN one instance.
- No billing.
