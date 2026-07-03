# CompanyOS — Agent Onboarding (read this first)

*One-page brief so any AI agent (or human) can work on this repo without reading the whole
project. Deep-dive docs are linked; read them lazily, only when your task touches them.*

## What this is

CompanyOS is an agency operating system being built as a future SaaS product: one Postgres-backed
kernel (scopes tree, principals, grants, events, records) with modules layered on top — tasks
(Plane CE adapter), metrics + dashboards, knowledge base (BlockNote), canvas, capabilities
registry (external automations + run history + alerts), skills index, and provisioning. Agents
interact through an MCP server (`packages/mcp`) and an HTTP API inside the Next.js app.
Owner: Rishi (risi-au). Org instance: "Brissie Digital".

## How this repo gets built (roles — do not skip)

- **docs/ORCHESTRATION.md** — the build protocol. Claude (architect) writes task briefs in
  `docs/tasks/`, reviews, and merges; headless implementers (codex preferred, grok fallback)
  do the coding. If you are an implementer: implement exactly one brief, nothing else.
- **docs/SUBAGENTS.md** — operational manual for dispatching the implementer CLIs and their
  known failure modes. Read before any dispatch.
- **docs/CONSTITUTION.md** — non-negotiable rules for all code. **docs/DESIGN.md** — the
  ratified design (data model §5, MCP contract §6, build order §7).

## Repo map (monorepo: pnpm + turbo)

```
apps/os              Next.js 15 app (UI + HTTP API routes) — the deployable product
apps/control-plane   future SaaS control plane (stub)
packages/api         kernel + module services (the business logic; modules under src/modules/)
packages/db          drizzle schema + migrations (never hand-edit drizzle/meta/_journal.json)
packages/mcp         MCP server exposing the tools agents use
packages/ui          shared UI components
infra/               docker compose (dev + prod), litellm config, n8n; README has runbooks
docs/tasks/          one brief per task (M<milestone>-<nn>-<slug>.md) — the build history
```

Per-module contracts live in colocated `AGENTS.md` files — read the one for the module you
touch, not all of them.

## Local setup (dev)

1. `cp .env.example .env`, fill at minimum `DATABASE_URL`, `POSTGRES_*`, `LITELLM_MASTER_KEY`,
   `BETTER_AUTH_SECRET`.
2. `pnpm install` → `pnpm infra:up` (postgres + litellm via Docker) → `pnpm db:migrate`.
3. `pnpm dev` → http://localhost:3000. Optional: `pnpm db:seed-demo`.
4. Gates that must be green before any merge: `pnpm typecheck && pnpm lint && pnpm test`
   (tests use in-memory PGlite — no dev DB needed).

## Local → staging → live (the only path to production)

Defined in **docs/DEPLOYMENT.md** (model) and **docs/VPS.md** (environments + step-by-step
process). Short version: merge to `main` (CI green) → tag `vX.Y.Z` → GitHub Actions builds
`ghcr.io/risi-au/companyos-{os,migrate}:<tag>` → deploy the tag to **staging**
(`aios` user on the VPS, https://cos.risi.au) → smoke-test per docs/VPS.md → only then the
same tag goes to **live**. Never deploy untagged code; never skip staging. VPS credentials:
`vps-login.txt` (gitignored, repo root on the dev machine).

## Current status (update when it changes)

- Milestones M1–M4 complete (see docs/tasks/). M5 (SaaS hardening) in progress:
  M5-01 (images + release pipeline) done — first published release: **v0.5.1**.
- Next up: M5-02 deploy automation, M5-03 backups + DR, tenant admin, control plane v1.
