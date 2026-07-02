# infra AGENTS.md

Module: infra
Purpose: Development (and later prod-parity) Docker Compose bundle for the shared data and model-gateway layer. Enables one-command local boot of the adopted engines (Postgres, LiteLLM) + docs for Plane CE sidecar.

## Contract / invariants
- Single `docker compose -f infra/docker-compose.dev.yml up -d` boots postgres + litellm.
- Three logical DBs created: companyos (OS), plane (tasks), litellm (keys/spend).
- LiteLLM exposes only role aliases (`cheap` | `analysis` | `reasoning`); raw provider models never referenced from code.
- All secrets/config via env vars only (12-factor). No secrets in git.
- Compose + scripts are the source of truth for bring-up; same files reused on VPS.
- db:migrate / db:seed are the entrypoints (delegated from root).

## Files
- `docker-compose.dev.yml` — postgres:17 + litellm (ghcr pinned). Healthchecks, volumes, init script.
- `postgres-init.sql` — init-db script creating the three DBs.
- `litellm.config.yaml` — model aliases + os.environ key refs. Enables per-key spend tracking via DB.
- `README.md` — exact bring-up order, reset, ports, Plane side-by-side instructions, VPS note.
- (root) `package.json` scripts: `infra:up`, `infra:down`, `db:migrate`, `db:seed`.
- `.env.example` — all referenced vars with placeholders.
- `packages/db/` scripts updated to execute drizzle-kit for migrate (delegated).
- n8n (M2-05+): `docker-compose.dev.yml` adds n8nio/n8n (basic-auth, sqlite, port 5678, own volume). Demo workflow + README in `infra/n8n/`.

## Ports (host)
- 5432: postgres
- 4000: litellm

## How to test
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (from root) — must pass.
- Scripts defined and delegating correctly.
- YAML valid (manual review); images pinned; healthchecks present.
- Config uses only env var refs.
- README covers full flow and reset.
- db scripts run drizzle (kit for migrate path).

## Do not
- Do not run `docker` or `docker compose` commands in environments where Docker is absent.
- Do not inline full Plane compose (use official setup.sh + external DB config).
- Do not touch docs/, root README/AGENTS, legacy/.
- Never commit real keys.

## Related
- Constitution §8 (12-factor, Docker Compose as install path).
- DESIGN §3 (adopted engines: Postgres, Plane CE, LiteLLM).
- ORCHESTRATION for task flow.

Update this file in any commit that changes infra behavior or files.
