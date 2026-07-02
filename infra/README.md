# infra — Dev Infrastructure

One-command dev stack for CompanyOS (Postgres + LiteLLM). Plane CE runs side-by-side via its official installer.

## Stack

- **postgres:17** (shared): logical DBs `companyos`, `plane`, `litellm`. Port 5432.
- **litellm:main-stable** (ghcr): OpenAI-compatible gateway. Port 4000. Model aliases: `cheap`, `analysis`, `reasoning`.
- **Plane CE**: run via official setup.sh (not inlined here).

All config via env (12-factor). Same compose shape will be used (plus Caddy + apps) on VPS.

## Prerequisites

- Docker + Docker Compose (v2+)
- pnpm (workspace root)

## Bring-up (exact order)

1. Copy `.env.example` to `.env` (gitignored) and fill real keys for providers you use.
   - At minimum: `DATABASE_URL`, `LITELLM_MASTER_KEY`, one of `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY`.

2. Start the core infra (compose auto-loads `.env` for variable interpolation):
   ```
   pnpm infra:up
   ```
   This runs `docker compose -f infra/docker-compose.dev.yml up -d`

3. Wait for healthy (or poll):
   ```
   docker compose -f infra/docker-compose.dev.yml ps
   ```
   Postgres health + litellm /health.

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

| Service   | Host Port | Container | Notes                          |
|-----------|-----------|-----------|--------------------------------|
| postgres  | 5432      | 5432      | Shared; use DB name in URL     |
| litellm   | 4000      | 4000      | OpenAI-compatible /v1          |
| Plane     | (see its) | -         | Default 80/443 in its compose  |

## Plane CE (side-by-side)

Plane ships its own installer and compose. Do not inline.

1. In a sibling folder (e.g. `../plane-selfhost`):
   ```
   mkdir plane-selfhost && cd plane-selfhost
   curl -fsSL -o setup.sh https://github.com/makeplane/plane/releases/latest/download/setup.sh
   chmod +x setup.sh
   ./setup.sh
   # choose Install (arm64/x86)
   ```

2. After it creates `plane-app/` (or preview), edit `plane.env` (or the generated) for external postgres (our shared one):
   ```
   # Example overrides (adjust user/pass to match .env)
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=companyos
   POSTGRES_PASSWORD=devpassword123
   POSTGRES_DB=plane
   DATABASE_URL=postgresql://companyos:devpassword123@localhost:5432/plane
   # web
   WEB_URL=http://localhost:8080
   LISTEN_HTTP_PORT=8080   # avoid conflict with other
   CORS_ALLOWED_ORIGINS=http://localhost:8080
   ```

3. Start Plane from its dir:
   ```
   ./setup.sh
   # select 2) Start
   ```

Plane UI at the WEB_URL you set. Use Plane for tasks; OS maps via task_links later.

On VPS later: same compose files + Caddy for TLS/reverse proxy in front of os + plane + litellm.

## .env vars referenced

See root `.env.example`. All referenced by compose/config/scripts are listed there. No secrets in repo.

## Health / debugging

- Postgres: `psql $DATABASE_URL -c '\l'`
- LiteLLM: `curl http://localhost:4000/health` ; `curl http://localhost:4000/models`
- Compose logs: `docker compose -f infra/docker-compose.dev.yml logs -f litellm postgres`

## Notes

- Images pinned (postgres:17, ghcr.io/berriai/litellm:main-stable).
- Healthchecks + depends_on ensure order.
- No n8n/Flowise/Caddy in this task (later milestones).
- Do not run docker on machines without it (this dev env).
