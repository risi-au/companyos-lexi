#!/usr/bin/env bash
set -euo pipefail

BACKUP_DATABASES="${BACKUP_DATABASES:-companyos,litellm}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-companyos}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-auto}"
BACKUP_SCHEDULE_UTC="${BACKUP_SCHEDULE_UTC:-03:00}"
BACKUP_REPORT_URL="${BACKUP_REPORT_URL:-http://os:3000/api/v1/capabilities/report-run}"
BACKUP_REPORT_SCOPE="${BACKUP_REPORT_SCOPE:-root}"
BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/tmp/companyos-backup}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/host-env/.env}"
BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
BACKUP_RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"

RUN_ID=""
RUN_STARTED_EPOCH=0
RUN_STARTED_AT=""
RUN_WORK_DIR=""
UPLOADED_KEYS=""
CURRENT_STEP="initializing"

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

json_escape() {
  local value=${1:-}
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}

trim() {
  local value=${1:-}
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

normalize_prefix() {
  local prefix=${1:-}
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  printf '%s' "$prefix"
}

require_env() {
  local missing=0
  local name
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      log "ERROR missing required env var: ${name}"
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
}

duration_ms() {
  local now
  now=$(date -u +%s)
  if [[ "$RUN_STARTED_EPOCH" -eq 0 ]]; then
    printf '0'
  else
    printf '%s' "$(((now - RUN_STARTED_EPOCH) * 1000))"
  fi
}

curl_s3() {
  curl --fail --silent --show-error \
    --aws-sigv4 "aws:amz:${BACKUP_S3_REGION}:s3" \
    --user "${BACKUP_S3_ACCESS_KEY_ID}:${BACKUP_S3_SECRET_ACCESS_KEY}" \
    "$@"
}

s3_base_url() {
  local endpoint=${BACKUP_S3_ENDPOINT%/}
  printf '%s/%s' "$endpoint" "$BACKUP_S3_BUCKET"
}

s3_object_url() {
  local key=$1
  printf '%s/%s' "$(s3_base_url)" "$key"
}

report_run() {
  local status=$1
  local summary=$2
  local alert=${3:-false}
  local escaped_summary escaped_run_id escaped_scope escaped_keys escaped_started body alert_json

  if [[ -z "${BACKUP_REPORT_TOKEN:-}" ]]; then
    log "WARN BACKUP_REPORT_TOKEN is unset; skipping report-run for ${status}"
    return 0
  fi

  escaped_summary=$(json_escape "$summary")
  escaped_run_id=$(json_escape "$RUN_ID")
  escaped_scope=$(json_escape "$BACKUP_REPORT_SCOPE")
  escaped_keys=$(json_escape "$UPLOADED_KEYS")
  escaped_started=$(json_escape "$RUN_STARTED_AT")
  alert_json=""

  if [[ "$alert" == "true" ]]; then
    alert_json=$(printf ',"alert":{"severity":"critical","message":"%s"}' "$escaped_summary")
  fi

  body=$(printf '{"scope":"%s","capability":"db-backup","status":"%s","runId":"%s","summary":"%s","durationMs":%s,"payload":{"startedAt":"%s","uploadedKeys":"%s","databases":"%s"}%s}' \
    "$escaped_scope" \
    "$status" \
    "$escaped_run_id" \
    "$escaped_summary" \
    "$(duration_ms)" \
    "$escaped_started" \
    "$escaped_keys" \
    "$(json_escape "$BACKUP_DATABASES")" \
    "$alert_json")

  if ! curl --fail --silent --show-error \
    --request POST \
    --header "Authorization: Bearer ${BACKUP_REPORT_TOKEN}" \
    --header "Content-Type: application/json" \
    --data "$body" \
    "$BACKUP_REPORT_URL" >/dev/null; then
    log "WARN report-run POST failed for ${status}"
  fi
}

cleanup() {
  if [[ -n "${RUN_WORK_DIR:-}" && -d "$RUN_WORK_DIR" ]]; then
    rm -rf "$RUN_WORK_DIR"
  fi
}

on_error() {
  local exit_code=$?
  local line_no=${1:-unknown}
  local summary="db-backup failed at line ${line_no}: ${CURRENT_STEP}"
  log "ERROR ${summary}"
  report_run "error" "$summary" "true" || true
  cleanup
  exit "$exit_code"
}

parse_databases() {
  local raw db
  IFS=',' read -r -a DB_LIST <<< "$BACKUP_DATABASES"
  PARSED_DATABASES=()
  for raw in "${DB_LIST[@]}"; do
    db=$(trim "$raw")
    if [[ -z "$db" ]]; then
      continue
    fi
    if [[ ! "$db" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]*$ ]]; then
      log "ERROR invalid database name in BACKUP_DATABASES: ${db}"
      return 1
    fi
    PARSED_DATABASES+=("$db")
  done
  if [[ "${#PARSED_DATABASES[@]}" -eq 0 ]]; then
    log "ERROR BACKUP_DATABASES did not contain any database names"
    return 1
  fi
}

upload_object() {
  local file_path=$1
  local key=$2
  local url
  url=$(s3_object_url "$key")

  CURRENT_STEP="uploading ${key}"
  curl_s3 --request PUT \
    --header "Content-Type: application/octet-stream" \
    --upload-file "$file_path" \
    "$url" >/dev/null

  CURRENT_STEP="verifying ${key}"
  curl_s3 --head "$url" >/dev/null
  if [[ -n "$UPLOADED_KEYS" ]]; then
    UPLOADED_KEYS="${UPLOADED_KEYS},${key}"
  else
    UPLOADED_KEYS="$key"
  fi
}

list_objects() {
  local prefix=$1
  curl_s3 --get \
    --data-urlencode "list-type=2" \
    --data-urlencode "prefix=${prefix}" \
    "$(s3_base_url)" \
    | tr '<' '\n' \
    | sed -n 's#^Key>##p'
}

delete_object() {
  local key=$1
  CURRENT_STEP="pruning ${key}"
  curl_s3 --request DELETE "$(s3_object_url "$key")" >/dev/null
  log "Pruned ${key}"
}

prune_prefix() {
  local prefix=$1
  local keep=$2
  local keys=()
  local i

  CURRENT_STEP="listing ${prefix} for retention pruning"
  mapfile -t keys < <(list_objects "$prefix" | sort -r)
  if [[ "${#keys[@]}" -le "$keep" ]]; then
    log "Retention ${prefix}: ${#keys[@]} object(s), nothing to prune"
    return 0
  fi

  for ((i = keep; i < ${#keys[@]}; i++)); do
    delete_object "${keys[$i]}"
  done
}

run_once() {
  trap 'on_error "$LINENO"' ERR
  trap cleanup EXIT

  RUN_STARTED_EPOCH=$(date -u +%s)
  RUN_STARTED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  RUN_ID="db-backup-${RUN_STARTED_AT//[:]/}"
  RUN_WORK_DIR="${BACKUP_WORK_DIR}/${RUN_ID}"
  local artifact_dir dump_dir tar_path enc_path prefix daily_key weekly_key db

  require_env \
    BACKUP_ENCRYPTION_KEY \
    BACKUP_S3_ENDPOINT \
    BACKUP_S3_BUCKET \
    BACKUP_S3_ACCESS_KEY_ID \
    BACKUP_S3_SECRET_ACCESS_KEY \
    PGHOST \
    PGUSER \
    PGPASSWORD

  if [[ ! -r "$BACKUP_ENV_FILE" ]]; then
    log "ERROR required host env file is not readable: ${BACKUP_ENV_FILE}"
    return 1
  fi

  parse_databases
  prefix=$(normalize_prefix "$BACKUP_S3_PREFIX")
  artifact_dir="${RUN_WORK_DIR}/artifact"
  dump_dir="${artifact_dir}/dumps"
  tar_path="${RUN_WORK_DIR}/${RUN_ID}.tar.gz"
  enc_path="${tar_path}.enc"
  mkdir -p "$dump_dir"

  CURRENT_STEP="writing manifest"
  {
    printf 'created_at=%s\n' "$RUN_STARTED_AT"
    printf 'run_id=%s\n' "$RUN_ID"
    printf 'databases=%s\n' "$BACKUP_DATABASES"
    printf 'postgres_client=%s\n' "$(pg_dump --version)"
    printf 's3_prefix=%s\n' "$prefix"
  } > "${artifact_dir}/manifest.txt"

  CURRENT_STEP="copying host .env into encrypted artifact"
  cp "$BACKUP_ENV_FILE" "${artifact_dir}/.env"

  for db in "${PARSED_DATABASES[@]}"; do
    CURRENT_STEP="dumping database ${db}"
    log "Dumping ${db}"
    pg_dump \
      --format=custom \
      --no-owner \
      --no-privileges \
      --dbname="$db" \
      --file="${dump_dir}/${db}.dump"
  done

  CURRENT_STEP="creating tar artifact"
  tar -C "$artifact_dir" -czf "$tar_path" .

  CURRENT_STEP="encrypting artifact"
  openssl enc -aes-256-cbc -pbkdf2 -md sha256 -salt \
    -in "$tar_path" \
    -out "$enc_path" \
    -pass env:BACKUP_ENCRYPTION_KEY

  daily_key="${prefix}/daily/${RUN_ID}.tar.gz.enc"
  upload_object "$enc_path" "$daily_key"

  if [[ "$(date -u +%u)" == "7" ]]; then
    weekly_key="${prefix}/weekly/${RUN_ID}.tar.gz.enc"
    upload_object "$enc_path" "$weekly_key"
  fi

  CURRENT_STEP="pruning retention"
  prune_prefix "${prefix}/daily/" "$BACKUP_RETENTION_DAILY"
  prune_prefix "${prefix}/weekly/" "$BACKUP_RETENTION_WEEKLY"

  CURRENT_STEP="reporting success"
  report_run "success" "db-backup completed: ${UPLOADED_KEYS}" "false"
  log "Backup complete: ${UPLOADED_KEYS}"
}

seconds_until_next_run() {
  local now target today
  now=$(date -u +%s)
  today=$(date -u +%Y-%m-%d)
  target=$(date -u -d "${today} ${BACKUP_SCHEDULE_UTC}:00 UTC" +%s)
  if [[ "$target" -le "$now" ]]; then
    target=$(date -u -d "tomorrow ${BACKUP_SCHEDULE_UTC}:00 UTC" +%s)
  fi
  printf '%s' "$((target - now))"
}

daemon() {
  local sleep_seconds status
  log "Starting backup scheduler; next runs are at ${BACKUP_SCHEDULE_UTC} UTC"
  while true; do
    sleep_seconds=$(seconds_until_next_run)
    log "Sleeping ${sleep_seconds}s until next backup"
    sleep "$sleep_seconds"
    if /bin/bash "$0" run-once; then
      log "Scheduled backup succeeded"
    else
      status=$?
      log "Scheduled backup failed with exit ${status}"
    fi
  done
}

case "${1:-run-once}" in
  daemon)
    daemon
    ;;
  run-once)
    run_once
    ;;
  *)
    printf 'Usage: %s [daemon|run-once]\n' "$0" >&2
    exit 2
    ;;
esac
