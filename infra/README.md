# infra - Dev Infrastructure and Prod Runbook

One-command dev stack for CompanyOS (Postgres + LiteLLM + n8n) and the production compose runbook. Plane CE runs side-by-side via its official installer.

## Stack

- **postgres:17** (shared): logical DBs `companyos`, `plane`, `litellm`. Port 5432 in dev.
- **litellm:main-stable** (ghcr): OpenAI-compatible gateway. Port 4000 in dev. Model aliases: `cheap`, `analysis`, `reasoning`.
- **n8n:2.25.3**: automation runner. Port 5678 in dev.
- **Plane CE**: run via official setup.sh (not inlined here).

All config is via env (12-factor). Prod uses GHCR images for the OS app and migration runner: `vX.Y.Z` tags for release promotion, plus the rolling `main` tag for quick staging-only iteration. TLS/ingress is handled outside this repo by the VPS Cloudflare tunnel or another external proxy.

## Prerequisites

- Docker + Docker Compose (v2+)
- pnpm (workspace root)

## Bring-up (exact order)

1. Copy `.env.example` to `.env` (gitignored) and fill real keys for providers you use.
   - At minimum: `DATABASE_URL`, `LITELLM_MASTER_KEY`, one of `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, or `MOONSHOT_API_KEY`.

2. Start the core infra (compose auto-loads `.env` for variable interpolation):
   ```
   pnpm infra:up
   ```
   This runs `docker compose -f infra/docker-compose.dev.yml up -d`.

3. Wait for healthy (or poll):
   ```
   docker compose -f infra/docker-compose.dev.yml ps
   ```
   Postgres health + LiteLLM `/health`.

4. Load `.env` for Node/pnpm (docker compose does not propagate to host `pnpm` processes) then run migrations:
   ```
   # bash/zsh
   set -a; source .env; set +a
   pnpm db:migrate
   ```
   ```
   # PowerShell (Windows)
   Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }
   pnpm db:migrate
   ```

5. Same env load, then seed (idempotent root scope + principal + grant):
   ```
   pnpm db:seed
   ```

6. Start the app(s):
   ```
   pnpm dev
   ```

The OS app connects via `DATABASE_URL` (localhost:5432/companyos).

## Reset / clean

- Stop + remove volumes (data loss):
  ```
  pnpm infra:down
  # or
  docker compose -f infra/docker-compose.dev.yml down -v
  ```

- Recreate fresh:
  ```
  pnpm infra:up
  pnpm db:migrate
  pnpm db:seed
  ```

Volumes live in Docker named volume `postgres_data` (inspect with `docker volume ls`).

## Ports

| Service  | Host Port | Container | Notes                         |
|----------|-----------|-----------|-------------------------------|
| postgres | 5432      | 5432      | Shared; use DB name in URL    |
| litellm  | 4000      | 4000      | OpenAI-compatible `/v1`       |
| n8n      | 5678      | 5678      | Automation UI/webhooks        |
| Plane    | (see its) | -         | Default 80/443 in its compose |

## Production (VPS)

Live production runs tagged releases only. The staging VPS may also use the rolling `main`
image tag for fast iteration. `infra/docker-compose.prod.yml` pulls the OS and migrate
images from GHCR, starts Postgres/LiteLLM/n8n, runs migrations once, then starts the OS app.
It includes no Caddy, no cloudflared, and no reverse proxy.

### First deploy

1. On the VPS, copy `.env.example` to `.env` and replace every prod placeholder with real values. `COMPANYOS_TAG` is required and has no default.

2. Log in to GHCR with a GitHub token that can read packages:
   ```
   docker login ghcr.io
   ```

3. Start the tagged release:
   ```
   COMPANYOS_TAG=v0.x.y docker compose --env-file .env -f infra/docker-compose.prod.yml up -d
   ```

4. Migrations run in the one-shot `migrate` service after Postgres is healthy and before `os` starts. Check it with:
   ```
   docker compose --env-file .env -f infra/docker-compose.prod.yml ps
   docker compose --env-file .env -f infra/docker-compose.prod.yml logs migrate
   ```

5. Point the existing Cloudflare tunnel or external proxy at:
   ```
   127.0.0.1:${OS_PORT}
   ```

### Upgrade tag-to-tag

1. Confirm the new `v*` tag has published `ghcr.io/risi-au/companyos-os:<tag>` and `ghcr.io/risi-au/companyos-migrate:<tag>`.
2. Set `COMPANYOS_TAG` to the new tag in `.env` or pass it inline.
3. Pull and start:
   ```
   COMPANYOS_TAG=v0.x.y docker compose --env-file .env -f infra/docker-compose.prod.yml pull
   COMPANYOS_TAG=v0.x.y docker compose --env-file .env -f infra/docker-compose.prod.yml up -d
   ```

### Quick staging iteration

`COMPANYOS_TAG=main` is valid on staging for fast fixes and testing. It points at the rolling
GHCR images built from every green push to `main`, and is overwritten by the next push. Use
`vX.Y.Z` values for tested releases intended to pass staging sign-off and eventually reach
live; live remains tag-only.

### Staging auto-deploy

`.github/workflows/release.yml` deploys staging after the release job publishes images. The
deploy target is `COMPANYOS_TAG=main` for green pushes to `main`, or the pushed `v*` tag for
release validation. Live promotion is still manual and tag-only.

The repository must define these GitHub Actions secrets before the `deploy-staging` job can
run:

- `STAGING_SSH_HOST`
- `STAGING_SSH_USER`
- `STAGING_SSH_KEY`

Do not commit deploy keys or environment secrets. The staging user's `~/app/.env` remains the
source of truth for runtime config; the deploy job updates only `COMPANYOS_TAG`, keeping
`.env.bak`, then runs `docker compose pull && docker compose up -d`, waits for `migrate`, and
smoke-tests the local app plus `https://cos.risi.au`.

### Rollback

1. Set `COMPANYOS_TAG` back to the previous known-good tag.
2. Pull and start the previous images:
   ```
   COMPANYOS_TAG=v0.x.y docker compose --env-file .env -f infra/docker-compose.prod.yml pull
   COMPANYOS_TAG=v0.x.y docker compose --env-file .env -f infra/docker-compose.prod.yml up -d
   ```
3. Migrations are forward-only and must remain compatible with one-version-back rollback.

Plane CE on the VPS remains side-by-side through Plane's official installer. Do not compose Plane here; configure the OS `PLANE_*` env vars to point at the Plane install when task integration is enabled.

## Plane CE (side-by-side)

Plane ships its own installer and compose. Do not inline it here.

1. In a sibling folder (for example `../plane-selfhost`):
   ```
   mkdir plane-selfhost && cd plane-selfhost
   curl -fsSL -o setup.sh https://github.com/makeplane/plane/releases/latest/download/setup.sh
   chmod +x setup.sh
   ./setup.sh
   # choose Install (arm64/x86)
   ```

2. After it creates `plane-app/` (or preview), edit `plane.env` (or the generated env) for external postgres:
   ```
   # Example overrides (adjust user/pass to match .env)
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=companyos
   POSTGRES_PASSWORD=devpassword123
   POSTGRES_DB=plane
   DATABASE_URL=postgresql://companyos:devpassword123@localhost:5432/plane
   WEB_URL=http://localhost:8080
   LISTEN_HTTP_PORT=8080
   CORS_ALLOWED_ORIGINS=http://localhost:8080
   ```

3. Start Plane from its dir:
   ```
   ./setup.sh
   # select 2) Start
   ```

Plane UI is at the `WEB_URL` you set. Use Plane for tasks; OS maps via `task_links`.

## .env vars referenced

See root `.env.example`. All vars referenced by compose/config/scripts are listed there. No secrets in repo.

## Health / debugging

- Postgres: `psql $DATABASE_URL -c '\l'`
- LiteLLM: `curl http://localhost:4000/health` ; `curl http://localhost:4000/models`
- Compose logs: `docker compose -f infra/docker-compose.dev.yml logs -f litellm postgres`
- Prod OS logs: `docker compose --env-file .env -f infra/docker-compose.prod.yml logs -f os`

## Notes

- Images pinned: `postgres:17`, `ghcr.io/berriai/litellm:main-stable`, `n8nio/n8n:2.25.3`.
- Healthchecks + `depends_on` ensure startup order.
- Prod migrations run through `ghcr.io/risi-au/companyos-migrate:${COMPANYOS_TAG}`.
- No Caddy, cloudflared, or reverse proxy is composed here.
- Do not run Docker on machines without it.
