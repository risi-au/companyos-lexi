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

## Don't (already firm)

- No multi-tenant control-plane concerns here (that's M5-05) — this is WITHIN one instance.
- No billing.
