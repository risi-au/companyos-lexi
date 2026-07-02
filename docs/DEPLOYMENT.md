# Deployment & Promotion Model

*How code and the running system move from development to live. Ratified 2026-07-02.*

## Environments

| | `local` (dev) | `live` (VPS) |
|---|---|---|
| Where | Docker Desktop on the dev machine | VPS, Docker Compose |
| Compose file | `infra/docker-compose.dev.yml` | `infra/docker-compose.prod.yml` (M5; same services + Caddy/TLS) |
| Data | seed/test data only | the real tenant data |
| Runs | whatever you're developing (`main` or task branches) | **tagged releases only** |
| Always-on | no (machine-dependent) | yes (crons, webhooks, Discord/alert agents) |

Same images, same env-var contract, same migrations. The only deltas: `.env` values, TLS/domains, backup jobs.

## Promotion flow

1. Develop + test locally. Task branches → architect-reviewed merge to `main`. `main` is always CI-green and deployable.
2. When a state is tested and wanted live: tag it — `git tag v0.x.y && git push --tags`.
3. The VPS moves tag-to-tag only. Deploy = (M5: GitHub Actions on tag → build → GHCR → SSH → `docker compose pull && up -d` → run migrations. Until M5: the same steps manually, documented in infra/README.md).
4. Rollback = redeploy the previous tag (+ `git revert` on main for the fix-forward).

## Data rules

- Live data lives on the VPS. Nightly `pg_dump` → encrypted → offsite object storage.
- Local never receives live data automatically. Restoring a prod dump locally for debugging is a deliberate manual act.
- Migrations are forward-only and must be compatible with a one-version-back rollback.

## GitHub layout

- `main` — protected by discipline (single-maintainer): only reviewed merges, CI must be green.
- `task/*` — implementer branches, deleted after merge.
- Tags `v*` — the only deployable artifacts; release notes generated from merged task titles.
- CI on every push/PR (typecheck, lint, test). Deploy workflow triggers on tags (added in M5).
