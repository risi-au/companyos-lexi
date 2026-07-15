# CompanyOS -- Agent Map

You are in the CompanyOS repo: a self-hosted, AI-native, multi-tenant (instance-per-tenant) system of record for running businesses. SaaS product; tenant #1 is our own holding company.

**Start here:** `ONBOARDING.md` (TRIP: intake -> triage -> plan -> implement -> gate -> review -> release).

**Read in this order for code work:**
1. `ONBOARDING.md` -- entry, triage (self vs orchestrate), board, gates
2. `docs/CONSTITUTION.md` -- non-negotiable rules + lean ladder + agent conduct
3. `docs/ORCHESTRATION.md` -- TRIP roles, plans, review verdicts, finish report
4. `docs/MODEL-POLICY.md` -- model tiers; confirm expensive with owner
5. `docs/DESIGN.md` / `docs/DESIGN-SYSTEM.md` -- only if the task needs them
6. Module `AGENTS.md` for the module you touch -- only that module

**Board:** GitHub Issues (`feature` / `bug` templates). Ops short path: `docs/ops/COCKPIT.md`.

**Layout:**
- `apps/os` -- the tenant product (Next.js). Modules under `apps/os/src/modules/<name>/`, each with its own `AGENTS.md` -- read only the module you're working on.
- `apps/control-plane` -- platform super-admin (tenant fleet; thin, parked until a second tenant).
- `packages/db` (Drizzle schemas), `packages/api` (service layer -- all business logic), `packages/mcp` (MCP server), `packages/ui` (primitives + design tokens), `packages/brain` (wiki maintenance engine), `packages/wizard` (intake/provisioning logic).
- `infra/` -- Docker Compose, backup sidecar, deploy assets.
- `legacy/` -- the superseded 2025 plan. Historical reference only; do not follow it.

For a self-contained product overview (for agents without repo access), see `COMPANYOS-PRIMER.md`.

**Prime directives:** modules never import each other; all logic in `packages/api`; every write emits an event; markdown for content, jsonb for flexibility; no hardcoded config; update the module AGENTS.md in the same commit; surgical changes only; never push to main (PR + owner merge).
