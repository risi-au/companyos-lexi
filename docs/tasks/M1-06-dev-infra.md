# M1-06: Dev infrastructure bundle (Compose: Postgres, Plane, LiteLLM)
status: done
module: infra
branch: task/M1-06

## Goal
One command (`docker compose -f infra/docker-compose.dev.yml up -d`) brings up the full dev stack — Postgres, Plane, LiteLLM — and the OS app connects to it after `pnpm db:migrate && pnpm db:seed`. Everything env-var configured (CONSTITUTION §8), identical shape to the future VPS deployment.

## Context
- `docs/DESIGN.md` §3 (adopted engines) and §10-equivalent deployment notes; CONSTITUTION §8.
- Docker is NOT available on this machine yet — author the files carefully, they will be validated in review once Docker Desktop is installed. Prefer pinned image versions and official docs' compose patterns over invention. Use WebSearch/WebFetch to confirm current self-host compose requirements for Plane CE and LiteLLM (they change between versions — verify, don't recall).
- `packages/db` has migrate/seed script stubs reading `DATABASE_URL`.

## Do
1. `infra/docker-compose.dev.yml`:
   - `postgres` (pinned 17.x): port 5432, volume, POSTGRES_MULTIPLE_DATABASES or init script creating three DBs: `companyos`, `plane`, `litellm`; healthcheck.
   - `litellm` (pinned ghcr image): port 4000, mounts `infra/litellm.config.yaml`, connects to its DB for key/spend tracking; master key via env.
   - Plane CE per its current official self-host pattern (its own compose or integrated services — follow what Plane documents NOW; if Plane ships its own compose/installer that shouldn't be inlined, document running it side-by-side in infra/README.md and wire only ports/env).
2. `infra/litellm.config.yaml`: model aliases per DESIGN §3 — `cheap` (deepseek/deepseek-chat), `analysis` (anthropic/claude-sonnet-5), `reasoning` (anthropic/claude-opus-4-8 or fable if available) — keys from env vars, placeholders in `.env.example`. Budgets: enable per-key spend tracking.
3. Root `.env.example`: DATABASE_URL (companyos db), LITELLM_MASTER_KEY, provider key placeholders, PLANE_* essentials. Update `packages/db` migrate/seed scripts if needed so they run against DATABASE_URL and apply committed migrations (drizzle-kit migrate).
4. `infra/README.md`: exact bring-up order (compose up → wait healthy → migrate → seed → pnpm dev), how to reset, where volumes live, ports table, and a "VPS later" note (same files + Caddy).
5. Root scripts: `pnpm infra:up`, `pnpm infra:down`, `pnpm db:migrate`, `pnpm db:seed` working end-to-end (the db ones must actually run drizzle migrations — test them compiling/parsing even without a live DB).
6. Root AGENTS.md pointer is NOT to be edited; add module doc as `infra/AGENTS.md` instead.

## Don't
- Don't attempt `docker` commands (not installed). Don't add n8n/Flowise yet (M4/M5). No Caddy/TLS (VPS task).
- Don't touch packages/api, packages/mcp, apps/, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` still pass from root
- [ ] Compose file is valid YAML, images pinned, healthchecks present, three DBs provisioned
- [ ] litellm.config.yaml defines the three role aliases with env-var keys only (no secrets in git)
- [ ] `.env.example` covers every env var referenced by compose/config/scripts
- [ ] infra/README.md documents the full bring-up + reset flow
- [ ] db:migrate / db:seed scripts execute drizzle-kit correctly (dry-verifiable without live DB)
