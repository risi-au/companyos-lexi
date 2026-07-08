# M5-03: Backups + DR drill (nightly pg_dump → encrypted → offsite; documented restore)

status: in-progress (PR #8 merged 2026-07-07; sidecar running on staging, dump+encrypt verified; BLOCKED at R2 upload AccessDenied — owner to fix token perms in Cloudflare, then rerun run-once + restore drill per infra/RESTORE.md)
module: infra
branch: task/M5-03

## Goal

The staging (and later live) database survives losing the VPS: a nightly job dumps the
instance's logical DBs (env-driven list — see decision 7), encrypts the dump, ships it to offsite object
storage with retention, and a written restore runbook is PROVEN by a drill — restore last
night's staging backup into a fresh compose stack and pass the smoke checklist.

## Context

- docs/DEPLOYMENT.md data rules: nightly `pg_dump` → encrypted → offsite; local never gets
  live data automatically; migrations forward-only, one-version-back compatible.
- Staging stack: `infra/docker-compose.prod.yml` on VPS user `aios` (rootless docker, NO
  sudo, NO system cron guarantees — verify user crontab works; if not, use a compose
  `backup` sidecar with an internal scheduler).
- Postgres 17 official image; dumps must use the matching client (run pg_dump inside the
  postgres container or a postgres:17 sidecar — do not rely on host binaries).

## Architect decisions (do not relitigate)

1. **Backup mechanism: compose sidecar** service `backup` in `docker-compose.prod.yml`
   (postgres:17 base + a small shell loop or supercronic-style schedule) — works identically
   under rootless docker on any host, no host crontab dependency. Nightly at 03:00 UTC.
2. **Encryption: age or openssl enc -aes-256** with a key from env (`BACKUP_ENCRYPTION_KEY`,
   required var). Prefer `openssl` (present in the postgres image) to avoid new binaries.
3. **Offsite target: S3-compatible object storage** via env — DECIDED 2026-07-08: Cloudflare
   R2, bucket `companyos-backups` (APAC), scoped Object-Read&Write token. Exact env names as
   installed in staging .env: `BACKUP_S3_ENDPOINT` (https://<account>.r2.cloudflarestorage.com),
   `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`. Keep code
   endpoint-agnostic (any S3-compatible works). Upload with `curl` AWS SigV4 or a tiny
   static client (`mc` single binary) — implementer picks the smallest reliable option and
   documents it. Note R2 quirk: no object ACLs; region string is `auto`.
4. **Retention**: keep 7 daily + 4 weekly; prune after successful upload; never prune on
   upload failure.
5. **Every run reports**: on completion the sidecar POSTs to the OS HTTP capability endpoint
   (`/api/v1/capabilities/report-run`) as a registered `db-backup` capability with an `alert`
   (severity `critical`) on failure — dogfooding the M4-07 alert pattern. Token comes from
   env `BACKUP_REPORT_TOKEN` (optional: skip reporting when unset, log a warning).
6. **Restore runbook + drill are part of the task**: `infra/RESTORE.md` with exact commands;
   acceptance includes a drill performed on staging (architect runs it, implementer writes it).
7. **DB list is env-driven**: `BACKUP_DATABASES` (comma-separated), default `companyos,litellm`.
   Staging has NO plane DB — a hardcoded three-DB list would fail every night. If a listed DB
   is missing, FAIL the run (explicit config error beats a silently partial backup).
8. **Include `.env` in the backup artifact**: the tar must contain `~/app/.env` alongside the
   dumps — it holds COS_VAULT_KEY, without which restored vault credentials are unreadable.
   The artifact is encrypted before upload, so secrets never land offsite in plaintext.
9. **Encryption key env name**: `BACKUP_ENCRYPTION_KEY` (already provisioned in staging .env;
   owner holds an escrow copy in their password manager).

## Do

1. Add the `backup` sidecar to `infra/docker-compose.prod.yml` (profile `backup` so dev-like
   minimal stacks can omit it; staging runs with `--profile backup`).
2. Backup script `infra/backup/backup.sh` (mounted in): pg_dump all three DBs, tar, encrypt,
   upload, verify upload (HEAD/stat), prune per retention, report run per decision 5. Set
   `set -euo pipefail`; every failure path exits non-zero and reports.
3. Extend `.env.example` prod section with all `BACKUP_*` vars + comments.
4. `infra/RESTORE.md`: restore-into-fresh-stack runbook (download, decrypt, `psql` restore
   into a clean postgres volume, run app, smoke checklist pointer) + quarterly drill note.
5. Update `infra/AGENTS.md` and docs/VPS.md (backup column in the env table, drill cadence).
6. Tests/verification in-sandbox: shellcheck-clean script (or careful manual review if
   shellcheck unavailable); compose config validates with the new profile + vars.

## Don't

- Don't touch application code, the OS/migrate images, or existing services' config.
- Don't store any real credential in the repo; env names only.
- Don't implement restore automation — restore is a documented manual runbook by design.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [ ] `docker compose --profile backup config` validates; sidecar runs nightly, produces an
      encrypted artifact offsite, prunes per retention (architect verifies one manual run on
      staging with real creds).
- [ ] Failure paths report a `critical` alert via report-run when `BACKUP_REPORT_TOKEN` set.
- [ ] `infra/RESTORE.md` exists and the architect completes one restore drill on staging.
- [ ] `.env.example`, `infra/AGENTS.md`, docs/VPS.md updated in the same change set.
- [ ] Root gates still pass (no app code touched).
