# M5-05: Control plane v1 (multi-instance provisioning + fleet view)

status: draft — needs owner product decisions before dispatch
module: apps/control-plane
branch: task/M5-05

## Goal (draft)

First real slice of the SaaS control plane (`apps/control-plane`, currently a stub): a
private internal app where the operator (Rishi) can register CompanyOS instances (tenant
name, host, tag deployed, health URL), see fleet status (version, up/down, last backup,
alert counts pulled from each instance's API), and record per-tenant config. This is the
"one-command Docker bundle" consumer view: each tenant = one compose stack somewhere.

## Open decisions for the owner (answer before this becomes dispatchable)

1. **Deployment model for tenants v1**: all tenants as separate users on your VPS (like
   staging/live today), or one host per tenant? Affects what "provision instance" means.
2. **Control plane persistence**: its own small Postgres schema (proposed: reuse the same
   postgres with a `controlplane` DB) — ok?
3. **Instance health contract**: is a public `/api/health` + authed status endpoint on each
   instance acceptable, or should instances push heartbeats to the control plane instead?
4. **Auth for the control plane itself**: single operator account v1 (proposed) — ok?

## Likely shape (to be firmed up)

- `apps/control-plane`: Next.js app (exists as stub), instances table + CRUD, fleet dashboard
  polling each instance's health endpoint, deploy-notes per tenant.
- Later slices: automated tenant provisioning (create VPS user / compose stack), billing,
  central alert aggregation.

## Don't (already firm)

- No automated tenant provisioning in v1 — registration is manual data entry.
- Nothing tenant-facing; this app is operator-only.
