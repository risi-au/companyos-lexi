# CompanyOS — Agent Map

You are in the CompanyOS repo: a self-hosted, AI-native, multi-tenant (instance-per-tenant) system of record for running businesses. SaaS product; tenant #1 is our own holding company.

**Read in this order:**
1. `docs/CONSTITUTION.md` — the non-negotiable engineering rules. Violations fail CI/review.
2. `docs/DESIGN.md` — what we're building and why (requirements contract, component map, data model, MCP contract, build order).
3. `docs/DESIGN-SYSTEM.md` — the visual contract (tokens, typography, UX rules) for any UI work.
4. If you are implementing a task: `docs/ORCHESTRATION.md` + your brief in `docs/tasks/`.

**Layout:**
- `apps/os` — the tenant product (Next.js). Modules under `apps/os/src/modules/<name>/`, each with its own `AGENTS.md` — read only the module you're working on.
- `apps/control-plane` — platform super-admin (tenant fleet; thin, parked until a second tenant).
- `packages/db` (Drizzle schemas), `packages/api` (service layer — all business logic), `packages/mcp` (MCP server), `packages/ui` (primitives + design tokens), `packages/brain` (wiki maintenance engine), `packages/wizard` (intake/provisioning logic).
- `infra/` — Docker Compose, backup sidecar, deploy assets.
- `legacy/` — the superseded 2025 plan. Historical reference only; do not follow it.

For a self-contained product overview (for agents without repo access), see `COMPANYOS-PRIMER.md`.

**Prime directives:** modules never import each other; all logic in `packages/api`; every write emits an event; markdown for content, jsonb for flexibility; no hardcoded config; update the module AGENTS.md in the same commit.
