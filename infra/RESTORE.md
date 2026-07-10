# Restore Runbook

This restores an encrypted CompanyOS backup into a clean compose stack. Use it for a real DR event and for the quarterly staging drill.

## Inputs

- A VPS/user with `infra/docker-compose.prod.yml`, `infra/backup/`, `infra/postgres-init.sql`, `infra/litellm.config.yaml`, and an environment `.env`.
- The offsite object key, for example `companyos/daily/db-backup-2026-07-08T030000Z.tar.gz.enc`.
- `BACKUP_ENCRYPTION_KEY` and the `BACKUP_S3_*` values in `.env`.

The artifact contains the source instance `.env` as `.env`, plus `dumps/<db>.dump` files and `manifest.txt`. It is encrypted before upload.

## 1. Download And Decrypt

Run from the app directory that contains `docker-compose.prod.yml` and `.env`:

```bash
export OBJECT_KEY='companyos/daily/db-backup-YYYY-MM-DDTHHMMSSZ.tar.gz.enc'
mkdir -p restore

docker compose --env-file .env -f docker-compose.prod.yml --profile backup run --rm --no-deps \
  -v "$PWD/restore:/restore" \
  --entrypoint bash backup -lc '
set -euo pipefail
curl --fail --silent --show-error \
  --aws-sigv4 "aws:amz:${BACKUP_S3_REGION:-auto}:s3" \
  --user "${BACKUP_S3_ACCESS_KEY_ID}:${BACKUP_S3_SECRET_ACCESS_KEY}" \
  --output /restore/backup.tar.gz.enc \
  "${BACKUP_S3_ENDPOINT%/}/${BACKUP_S3_BUCKET}/${OBJECT_KEY}"
openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 \
  -in /restore/backup.tar.gz.enc \
  -out /restore/backup.tar.gz \
  -pass env:BACKUP_ENCRYPTION_KEY
mkdir -p /restore/extracted
tar -C /restore/extracted -xzf /restore/backup.tar.gz
'
```

Inspect the manifest:

```bash
cat restore/extracted/manifest.txt
ls -la restore/extracted/dumps
```

For a true VPS-loss restore, copy `restore/extracted/.env` into place as `.env` after reviewing host-specific values such as `COMPANYOS_TAG`, public URLs, and ports. The restored `COS_VAULT_KEY` must be preserved or vault credentials will be unreadable.

## 2. Start A Clean Postgres

On a dedicated restore target, this destroys the target compose volumes. Do not run it against an environment whose current data you still need.

```bash
docker compose --env-file .env -f docker-compose.prod.yml down -v
docker compose --env-file .env -f docker-compose.prod.yml up -d postgres
```

Wait until Postgres is healthy:

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps postgres
```

## 3. Restore Each Dump

Set the same database list used by the backup, then restore each custom-format dump:

```bash
export BACKUP_DATABASES="${BACKUP_DATABASES:-companyos,litellm}"

for db in ${BACKUP_DATABASES//,/ }; do
  docker compose --env-file .env -f docker-compose.prod.yml exec -T postgres \
    bash -lc "dropdb -U \"\$POSTGRES_USER\" --if-exists '$db' && createdb -U \"\$POSTGRES_USER\" '$db'"

  docker compose --env-file .env -f docker-compose.prod.yml exec -T postgres \
    bash -lc "pg_restore -U \"\$POSTGRES_USER\" -d '$db' --no-owner --no-privileges" < "restore/extracted/dumps/${db}.dump"
done
```

If a listed dump is missing, stop. Either the wrong artifact was selected or `BACKUP_DATABASES` does not match the source instance.

## 4. Start The Stack

```bash
docker compose --env-file .env -f docker-compose.prod.yml pull
docker compose --env-file .env -f docker-compose.prod.yml up -d
docker compose --env-file .env -f docker-compose.prod.yml logs migrate
docker compose --env-file .env -f docker-compose.prod.yml ps
```

Run the smoke checklist in `docs/VPS.md`: app loads, login works, migrations completed, the changed release path works, and `os` logs show no error spam.

## Quarterly Drill

Once per quarter, restore the latest staging backup into a disposable clean stack or replacement staging VPS, run the smoke checklist, and record:

- backup object key restored
- restore start/end time
- databases restored
- smoke result
- any runbook edits needed

Do not automate restore as part of the backup sidecar; restore remains a deliberate manual DR action.

### Shared-host drill variant

When drilling on the SAME host that runs the live stack (the usual staging case), do
NOT run step 2's `down -v` — it destroys the live volumes. Instead:

1. Run step 1's download/decrypt/extract inside the running backup container (it already
   holds `BACKUP_S3_*` and `BACKUP_ENCRYPTION_KEY`), writing to `/tmp` there.
2. Start a disposable scratch postgres: `docker run -d --name restore-drill-pg -e
   POSTGRES_USER=companyos -e POSTGRES_PASSWORD=<any> pgvector/pgvector:pg17`.
   Gotcha: the image auto-creates a DB named after `POSTGRES_USER`, so skip `createdb`
   for that one and `pg_restore` straight into it.
3. `docker cp` the dumps in, restore per step 3, then verify by diffing per-table row
   counts against the live DB (identical except rows written after the dump moment) and
   `select extversion from pg_extension where extname='vector'`.
4. Clean up: remove the scratch container and every temp copy of the dumps.

This exercises fetch → decrypt → extract → restore → data verification. It does NOT
boot the app against the restored DB — do a full disposable-stack restore (the main
runbook) when validating a release-critical migration or an actual DR event.

## Drill log

| date | object key | databases | duration | result |
|---|---|---|---|---|
| 2026-07-10 | companyos/daily/db-backup-2026-07-10T005231Z.tar.gz.enc | companyos, litellm | ~5 min (00:59–01:04 UTC) | PASS — shared-host variant; companyos: 34/34 tables, counts identical to live except post-dump capability_run+event; litellm: pg_restore exit 0; vector ext 0.8.5. Runbook edits: added this variant + POSTGRES_USER auto-DB gotcha. |
