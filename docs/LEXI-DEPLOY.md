# Lexi OS — Deploy & Isolation Runbook

*How the Lexi fork deploys to `https://lexi.risi.au` WITHOUT ever touching
`cos-staging.risi.au`. This is a fork of CompanyOS; the two run side by side on
the same VPS as fully separate stacks.*

*Last updated: 2026-07-22.*

## Why this exists

This repo (`risi-au/companyos-lexi`) is a fork. The upstream `risi-au/companyos`
release pipeline auto-deploys every green `main` push to `cos-staging.risi.au`.
This fork's pipeline is deliberately retargeted so that can never happen here.

## Isolation invariants (do not break these)

| Concern | cos-staging (upstream) | Lexi (this fork) |
|---|---|---|
| Git repo | `risi-au/companyos` | `risi-au/companyos-lexi` |
| GHCR images | `companyos-{os,migrate}` | `companyos-lexi-{os,migrate}` |
| VPS app dir | `~/app` | `~/lexi` |
| Compose file | `docker-compose.prod.yml` | `docker-compose.lexi.yml` |
| Container names | `companyos-*-prod` | `lexi-*-prod` |
| Docker network | `companyos-prod` | `lexi-prod` |
| Named volumes | `postgres_data`, `n8n_data` | `lexi_postgres_data`, `lexi_n8n_data` |
| Published OS port | `127.0.0.1:3000` | `127.0.0.1:3001` (`OS_PORT`) |
| Public URL | `https://cos-staging.risi.au` | `https://lexi.risi.au` |
| Deploy image tag var | `COMPANYOS_TAG` | `LEXI_TAG` |
| GitHub SSH secrets | `STAGING_SSH_*` | `LEXI_SSH_*` |

Both stacks run under the same VPS user (`aios`, rootless Podman) but share
nothing above. The upstream `~/app` stack and `companyos-*` images/containers
are off-limits to this pipeline.

## One-time setup (manual — must be done by the owner)

The GitHub Actions pipeline cannot self-provision DNS, the VPS `.env`, or repo
secrets. Do these once before the first deploy.

### 1. GitHub repo secrets (`risi-au/companyos-lexi` → Settings → Secrets → Actions)

```
LEXI_SSH_HOST = 159.13.38.87
LEXI_SSH_USER = aios
LEXI_SSH_KEY  = <private key whose public half is in aios' authorized_keys>
```

(The existing dev/staging deploy key already trusted by `aios` can be reused;
these are just separately-named secrets on the new repo.)

### 2. VPS: create the Lexi stack dir and its `.env`

```bash
ssh aios@159.13.38.87
mkdir -p ~/lexi/backup
# aios is already `docker login ghcr.io`'d for companyos images; the same
# read:packages PAT covers companyos-lexi-* (same org). Re-login only if needed.
```

Create `~/lexi/.env` with FRESH secrets (never reuse cos-staging's values):

```env
# Image tag the deploy pipeline overwrites; seed it so first `up` works.
LEXI_TAG=main

# Published host port for the OS app (MUST differ from cos-staging's 3000).
OS_PORT=3001

# Public identity
COMPANYOS_URL=https://lexi.risi.au
INSTANCE_NAME=Lexi OS

# Core secrets — generate fresh, do NOT copy from ~/app/.env
POSTGRES_USER=lexi
POSTGRES_PASSWORD=<fresh>
LITELLM_MASTER_KEY=<fresh>
BETTER_AUTH_SECRET=<fresh 32+ bytes>
COS_VAULT_KEY=<fresh>

# n8n (only if used; give it its own hostname + tunnel route)
N8N_BASIC_AUTH_USER=<fresh>
N8N_BASIC_AUTH_PASSWORD=<fresh>
N8N_ENCRYPTION_KEY=<fresh>
N8N_WEBHOOK_URL=https://n8n-lexi.risi.au/
N8N_HOST=n8n-lexi.risi.au

# Plane — REUSE the existing Plane instance (do NOT run a second Plane).
# Use a DEDICATED Lexi workspace so tasks never intermix with cos-staging.
PLANE_BASE_URL=<existing Plane URL>
PLANE_API_TOKEN=<token for the Lexi workspace>
PLANE_WORKSPACE_SLUG=lexi
PLANE_WEBHOOK_SECRET=<fresh; used by a Lexi-only Plane webhook>

# Provider keys, GitHub, embeddings, backups — add as needed
# (same var names as docker-compose.lexi.yml).
```

**Plane:** Lexi does not bundle Plane — it connects to the existing instance via
the four `PLANE_*` vars above. Keep task data isolated by giving Lexi its own
workspace (`PLANE_WORKSPACE_SLUG=lexi`) rather than sharing cos-staging's, and
create a Lexi-only Plane webhook targeting `https://lexi.risi.au/api/v1/webhooks/plane`
with its own `PLANE_WEBHOOK_SECRET`. Not required for boot or for Shot 0.

### 3. Cloudflare: route `lexi.risi.au` → the VPS

Add a public hostname to the SAME tunnel that serves cos-staging (or a new
tunnel), pointing at the Lexi OS port:

```
lexi.risi.au  ->  http://127.0.0.1:3001
```

`lexi.risi.au` is a single-level subdomain, so the Cloudflare free-tier
edge cert covers it (unlike multi-level names). If n8n is enabled, add
`n8n-lexi.risi.au -> http://127.0.0.1:<n8n published port>` too (publish that
port in the compose file first — it is not published by default).

## Deploying

Automatic: merge to `main` (or push a `v*` tag) → `Release (Lexi OS)` workflow
builds `companyos-lexi-{os,migrate}` arm64 images → deploys to `~/lexi` →
smoke-tests `https://lexi.risi.au`.

Manual equivalent on the VPS:

```bash
cd ~/lexi
docker compose --env-file .env -f docker-compose.lexi.yml pull postgres litellm n8n migrate os brain-cron
docker compose --env-file .env -f docker-compose.lexi.yml up -d --build
docker compose --env-file .env -f docker-compose.lexi.yml logs migrate   # must end successfully
docker compose --env-file .env -f docker-compose.lexi.yml ps
```

## Smoke checklist

- `https://lexi.risi.au` loads: anonymous → `/sign-in`; after login → `/s/root`
- `docker compose -f docker-compose.lexi.yml logs migrate` ended successfully
- `docker compose -f docker-compose.lexi.yml ps` shows `lexi-os-prod` healthy
- cos-staging is unaffected: `https://cos-staging.risi.au` still loads, and
  `docker ps` still shows the `companyos-*-prod` containers untouched

## Rollback

Set `LEXI_TAG` back to a previous known-good tag in `~/lexi/.env`, then
`pull && up -d`. Migrations are forward-only; stay within one version.

## Backups

Lexi backups use `BACKUP_S3_PREFIX=lexi` (separate from cos-staging's
`companyos` prefix) so the two never overwrite each other in object storage.
Enable with `COMPOSE_PROFILES=backup`.
