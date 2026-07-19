# infra AGENTS.md

Module: infra
Purpose: Development and production Docker Compose bundles for the shared data/model/automation layer, plus production runbook. Enables local boot of Postgres, LiteLLM, and n8n; prod runs multi-arch (amd64+arm64) OS images from GHCR with Plane CE side-by-side, and the release pipeline auto-deploys published images to staging.

## Contract / invariants
- Single `docker compose -f infra/docker-compose.dev.yml up -d` boots postgres + litellm + n8n for dev.
- `infra/docker-compose.prod.yml` runs postgres, litellm, n8n, one-shot migrate, os from GHCR images, an opt-in brain cron sidecar (`COMPOSE_PROFILES=brain`), and an opt-in backup sidecar (`COMPOSE_PROFILES=backup`).
- Prod OS images are `ghcr.io/risi-au/companyos-os:${COMPANYOS_TAG}` and `ghcr.io/risi-au/companyos-migrate:${COMPANYOS_TAG}`. `COMPANYOS_TAG` has no default and must fail fast when unset.
- `COMPANYOS_TAG=main` is a supported rolling-tag value for fast staging iteration only. It is distinct from semver `vX.Y.Z` release tags, which remain the only live-promotion artifacts.
- `.github/workflows/release.yml` publishes OS/migrate images, then deploys staging with `COMPANYOS_TAG=main` or the pushed `v*` tag after the release job succeeds.
- Staging deploy automation uses only GitHub Actions secrets named `STAGING_SSH_HOST`, `STAGING_SSH_USER`, and `STAGING_SSH_KEY`; no keys or host credentials are stored in the repo.
- Prod ingress/TLS is external to this repo. The OS app binds only `127.0.0.1:${OS_PORT:-3000}:3000`; no Caddy, cloudflared, or reverse proxy belongs here.
- Three logical DBs created: companyos (OS), plane (tasks), litellm (keys/spend).
- Backups are sidecar-owned, not host-cron-owned: the `backup` profile builds from `postgres:17`, runs `infra/backup/backup.sh daemon`, dumps `BACKUP_DATABASES` nightly at 03:00 UTC by default, includes the mounted host `.env` in the encrypted artifact, uploads to S3-compatible storage, verifies with HEAD, and prunes only after successful upload.
- Backup retention is 7 daily objects plus 4 weekly Sunday objects under `BACKUP_S3_PREFIX`; upload/prune uses curl SigV4 against endpoint-agnostic S3 APIs. Cloudflare R2 uses `BACKUP_S3_REGION=auto`.
- Backup run reporting posts to `/api/v1/capabilities/report-run` as capability `db-backup` when `BACKUP_REPORT_TOKEN` is set; failure reports include a critical alert. Register the capability on `BACKUP_REPORT_SCOPE` before expecting persisted alerts.
- LiteLLM exposes only role aliases (`cheap` | `analysis` | `reasoning`); raw provider models never referenced from code.
- All secrets/config via env vars only (12-factor). No secrets in git.
- Compose + scripts are the source of truth for bring-up.
- db:migrate / db:seed are the entrypoints (delegated from root).

## Files
- `docker-compose.dev.yml` - postgres:17 + litellm + n8n. Healthchecks, volumes, init script.
- `docker-compose.prod.yml` - prod stack: postgres, litellm, n8n, migrate, os, brain-cron, backup. Migrate gates OS startup with `service_completed_successfully`; brain-cron calls `/api/v1/brain/run` for nightly ingest and weekly lint using `BRAIN_ENGINE_TOKEN` and only starts under the `brain` compose profile. Backup starts only under the `backup` compose profile.
- `backup/Dockerfile` - tiny backup sidecar image from `postgres:17` plus curl/CA certs for S3 SigV4.
- `backup/backup.sh` - internal scheduler + one-shot backup runner; uses the Postgres 17 client, openssl AES-256-CBC PBKDF2 encryption, S3 upload/HEAD/delete, retention, and report-run.
- `RESTORE.md` - manual encrypted-backup restore runbook and quarterly drill procedure.
- `postgres-init.sql` - init-db script creating the three DBs.
- `litellm.config.yaml` - model aliases + os.environ key refs. Enables per-key spend tracking via DB.
- `README.md` - exact dev bring-up order, prod first deploy/upgrade/rollback, reset, ports, Plane side-by-side instructions.
- `apps/os/Dockerfile` - two final targets: `os` (Next standalone runtime) and `migrate` (Drizzle migration runner).
- (root) `package.json` scripts: `infra:up`, `infra:down`, `db:migrate`, `db:seed`.
- `.env.example` - all referenced vars with placeholders.
- `COS_VAULT_KEY` is passed through to the prod OS service and documented in
  `.env.example`; missing values keep the app bootable but disable credential vault
  reads/writes.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are optional prod OS pass-through
  values. Both must be non-empty to enable Google social login; either missing or
  blank keeps the instance bootable with email/password auth only.
- Existing same-email password users link Google through the authenticated
  link-after-password flow; never weaken Better Auth's implicit-link verification
  guard. Personal-only Google users must land on their own personal scope.
- `.github/workflows/release.yml` - gates, builds/pushes GHCR images, deploys staging over SSH, and smoke-tests staging.
- `packages/db/scripts/migrate.mjs` runs migrations via the drizzle-orm programmatic migrator (delegated from root db:migrate; drizzle-kit remains for generate only).

## Ports (host)
- 5432: postgres (dev)
- 4000: litellm (dev)
- 5678: n8n (dev)
- prod OS: `127.0.0.1:${OS_PORT:-3000}`

## How to test
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (from root) - must pass.
- `pnpm --filter @companyos/os build` must pass and produce `.next/standalone`.
- Scripts defined and delegating correctly.
- YAML valid (manual review or actionlint in implementer sandbox); images pinned; healthchecks present; staging deploy summary reports tag, image digests, migrate result, and smoke status.
- Backup changes: run `shellcheck infra/backup/backup.sh` when available, otherwise `bash -n infra/backup/backup.sh`; validate `docker compose -f infra/docker-compose.prod.yml --profile backup config` when Docker/Podman is available.
- Config uses only env var refs.
- Google auth compose config must use fail-open empty defaults, never required
  interpolation, so unconfigured instances continue to boot.
- README covers dev, first deploy, upgrade, rollback, and Plane side-by-side.
- db migrate path uses the drizzle-orm programmatic migrator (packages/db/scripts/migrate.mjs); the drizzle-kit CLI dies silently on 0018's nested dollar-quoted DO block.
- In implementer sandboxes without Docker, do not run Docker. The orchestrator verifies `docker build` and `docker compose config`.

## Do not
- Do not run `docker` or `docker compose` commands in environments where Docker is absent.
- Do not move backup scheduling to host cron; rootless Podman environments rely on the sidecar loop.
- Do not inline full Plane compose (use official setup.sh + external DB config).
- Do not add Caddy, cloudflared, reverse proxies, SSH deploy automation inside infra compose/runbook mechanics, or `latest` image tags here. Staging deploy automation belongs in `.github/workflows/release.yml`.
- Do not touch docs/, root README/AGENTS, legacy/ unless a task brief explicitly allows it.
- Never commit real keys.

## Related
- Constitution section 8 (12-factor, Docker Compose as install path).
- DESIGN section 3 (adopted engines: Postgres, Plane CE, LiteLLM).
- ORCHESTRATION for task flow.

Update this file in any commit that changes infra behavior or files.
