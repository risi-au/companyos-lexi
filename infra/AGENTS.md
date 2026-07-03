# infra AGENTS.md

Module: infra
Purpose: Development and production Docker Compose bundles for the shared data/model/automation layer, plus production runbook. Enables local boot of Postgres, LiteLLM, and n8n; prod runs tagged multi-arch (amd64+arm64) OS images from GHCR with Plane CE side-by-side.

## Contract / invariants
- Single `docker compose -f infra/docker-compose.dev.yml up -d` boots postgres + litellm + n8n for dev.
- `infra/docker-compose.prod.yml` runs postgres, litellm, n8n, one-shot migrate, and os from tagged GHCR images.
- Prod OS images are `ghcr.io/risi-au/companyos-os:${COMPANYOS_TAG}` and `ghcr.io/risi-au/companyos-migrate:${COMPANYOS_TAG}`. `COMPANYOS_TAG` has no default and must fail fast when unset.
- Prod ingress/TLS is external to this repo. The OS app binds only `127.0.0.1:${OS_PORT:-3000}:3000`; no Caddy, cloudflared, or reverse proxy belongs here.
- Three logical DBs created: companyos (OS), plane (tasks), litellm (keys/spend).
- LiteLLM exposes only role aliases (`cheap` | `analysis` | `reasoning`); raw provider models never referenced from code.
- All secrets/config via env vars only (12-factor). No secrets in git.
- Compose + scripts are the source of truth for bring-up.
- db:migrate / db:seed are the entrypoints (delegated from root).

## Files
- `docker-compose.dev.yml` - postgres:17 + litellm + n8n. Healthchecks, volumes, init script.
- `docker-compose.prod.yml` - prod stack: postgres, litellm, n8n, migrate, os. Migrate gates OS startup with `service_completed_successfully`.
- `postgres-init.sql` - init-db script creating the three DBs.
- `litellm.config.yaml` - model aliases + os.environ key refs. Enables per-key spend tracking via DB.
- `README.md` - exact dev bring-up order, prod first deploy/upgrade/rollback, reset, ports, Plane side-by-side instructions.
- `apps/os/Dockerfile` - two final targets: `os` (Next standalone runtime) and `migrate` (Drizzle migration runner).
- (root) `package.json` scripts: `infra:up`, `infra:down`, `db:migrate`, `db:seed`.
- `.env.example` - all referenced vars with placeholders.
- `packages/db/` scripts execute drizzle-kit for migrate (delegated).

## Ports (host)
- 5432: postgres (dev)
- 4000: litellm (dev)
- 5678: n8n (dev)
- prod OS: `127.0.0.1:${OS_PORT:-3000}`

## How to test
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (from root) - must pass.
- `pnpm --filter @companyos/os build` must pass and produce `.next/standalone`.
- Scripts defined and delegating correctly.
- YAML valid (manual review in implementer sandbox); images pinned; healthchecks present.
- Config uses only env var refs.
- README covers dev, first deploy, upgrade, rollback, and Plane side-by-side.
- db scripts run drizzle-kit for migrate path.
- In implementer sandboxes without Docker, do not run Docker. The orchestrator verifies `docker build` and `docker compose config`.

## Do not
- Do not run `docker` or `docker compose` commands in environments where Docker is absent.
- Do not inline full Plane compose (use official setup.sh + external DB config).
- Do not add Caddy, cloudflared, reverse proxies, SSH deploy automation, or `latest` image tags here.
- Do not touch docs/, root README/AGENTS, legacy/ unless a task brief explicitly allows it.
- Never commit real keys.

## Related
- Constitution section 8 (12-factor, Docker Compose as install path).
- DESIGN section 3 (adopted engines: Postgres, Plane CE, LiteLLM).
- ORCHESTRATION for task flow.

Update this file in any commit that changes infra behavior or files.
