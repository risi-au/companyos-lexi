# PROD-SETUP — mandatory manual steps for a live environment

Ordered, executable checklist of every step that CANNOT be done by the deploy pipeline
and MUST be repeated (with prod-specific values) when standing up live. Compiled
2026-07-10 from everything staging needed by hand across M5–M9. Companion docs:
docs/VPS.md (environments + promotion), infra/README.md (pipeline + backup),
infra/RESTORE.md (restore drill), docs/tasks/M14-prod-readiness-overview.md (the
process milestone that gates live).

**Rules of engagement (stricter than staging):**
- Secrets never transit chat, briefs, or logs — the owner places values directly on the
  host (or via the vault); agents/architect reference secret NAMES only.
- Prod shares ZERO credentials with staging: own R2 bucket + token, own encryption
  keys, own PAT, own tunnel, own deploy keypair.
- Every step below that changes prod state needs the owner's plain-chat authorization
  naming the command if an agent executes it.
- When a future change adds a new manual step on staging, add it to this file in the
  same PR (M14 §1 makes this a review requirement).

## 1. Host + platform

- [ ] VPS user for live (pattern: like staging `aios`, rootless Docker enabled;
      verify `docker compose` works for the user).
- [ ] Cloudflare tunnel for the live hostname → host port 3000.
- [ ] `~/app/` directory; do NOT hand-place compose/config — the repo is source of
      truth (deploy syncs `infra/docker-compose.prod.yml`, `postgres-init.sql`,
      `litellm.config.yaml`, `infra/backup/`). For a first bring-up before any pipeline
      run, scp those same files from the repo at the release tag.

## 2. `.env` on the host (from `.env.example`)

Copy `.env.example` → `~/app/.env`, then set (generate ON the host):

- [ ] `COMPANYOS_TAG=` the promoted `v*` tag (staging uses rolling `main`; live is
      tag-only).
- [ ] `COMPANYOS_URL` / `MCP_PUBLIC_URL` / allowed origins → live hostname.
- [ ] Postgres passwords (fresh).
- [ ] Better-auth secret (fresh).
- [ ] `COS_VAULT_KEY` — `openssl rand -base64 32` on the host. Without it the
      credential vault is silently dormant.
- [ ] LiteLLM: master key; then AFTER first bring-up mint `LITELLM_EMBED_KEY` and
      `BRAIN_LITELLM_API_KEY` in the LiteLLM UI and add them here.
- [ ] `OPENAI_API_KEY` (embeddings).
- [ ] Skills repo trio: `GITHUB_ORG` / `SKILLS_REPO` / `GITHUB_TOKEN` = fine-grained
      PAT scoped to the skills repo (contents:read). **Note expiry** (90d default) —
      it must appear in /admin/health external credentials.
- [ ] `GITHUB_WEBHOOK_SECRET` (fresh) + configure the webhook on the skills repo →
      live URL.
- [ ] `COMPOSE_PROFILES=brain,backup` (compose reads it from the env-file).
- [ ] Backup block: `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` (**verify exact bucket
      name — staging lost 2 days to a trailing-'s' mismatch**) / `BACKUP_S3_ACCESS_KEY_ID`
      / `BACKUP_S3_SECRET_ACCESS_KEY` (R2 token: Object Read & Write, bucket-scoped) /
      `BACKUP_ENCRYPTION_KEY` (fresh, escrow a copy offline — an encrypted backup with
      a lost key is no backup) / `BACKUP_DATABASES` (decide whether live includes
      plane).
- [ ] `BACKUP_REPORT_TOKEN` — minted in step 4; leave empty until then.

## 3. First bring-up

- [ ] `docker compose --env-file .env -f docker-compose.prod.yml pull && up -d`;
      wait for the one-shot `migrate` service to exit 0 (programmatic migrator;
      migrations must be plain SQL — no `DO $$`).
- [ ] Create the root-admin user (sign-up flow), verify sign-in.
- [ ] In-VPS smoke `curl -fsS http://127.0.0.1:3000/` + external smoke on the live URL.

## 4. In-app activation (root admin, live UI)

- [ ] Mint `brain-engine` token (Connect panel, root scope, 90d). Connect UI mints
      agent-role only — elevation to root admin is currently a documented SQL UPDATE
      on grants (see M14 §2: make this a product feature or keep the exact SQL here
      when executed). Put it in `.env` as `BRAIN_ENGINE_TOKEN`.
- [ ] Mint `backup-reporter` token (Connect panel, root scope, **agent, 90d** — agent
      reaches `get_credential`, so never non-expiring). Owner pastes it into `.env` as
      `BACKUP_REPORT_TOKEN` directly on the host. Recreate the backup container.
- [ ] Register the `db-backup` capability on root (MCP `register_capability`, admin
      token — without it, backup reports degrade to event-only and failure alerts
      don't persist):
      `{"scopePath":"root","name":"db-backup","engine":"custom"}` via POST `/api/mcp`.
- [ ] Skills: seed/verify the skills repo content, run `sync_skills` once manually,
      then push a trivial change to verify the webhook auto-sync path.
- [ ] LiteLLM: mint the two keys (step 2), set default budgets (US$25/mo pattern from
      M5-04), recreate affected services.

## 5. Verification (bring-up is not done until these pass)

- [ ] Backup: `docker exec <backup-container> /bin/bash /backup/backup.sh run-once` —
      upload succeeds, retention prune clean, **report POST succeeds** (no
      `WARN BACKUP_REPORT_TOKEN is unset`), run visible in /admin/automations.
- [ ] **Restore drill per infra/RESTORE.md** — non-negotiable before live traffic.
- [ ] /admin/health green: token + PAT expiries listed, uptime checks passing.
- [ ] Vault end-to-end: write a credential in the UI, `get_credential` over MCP with
      an agent token, `credential.accessed` audit row exists.
- [ ] MCP external: `tools/call` `get_context` from outside with a minted token.
- [ ] Full smoke checklist in docs/VPS.md.
- [ ] Calendarize: token/PAT rotations (90d), quarterly restore drill.

## Staging-vs-live status snapshot (2026-07-10)

Everything above is DONE and verified on staging except the vault e2e verification
(key set + container verified; UI walkthrough pending). Backup reporting closed
2026-07-10 (success run persisted in capability_runs); restore drill PASSED 2026-07-10
(shared-host variant — see the drill log in infra/RESTORE.md). Update this line when
the vault walkthrough closes.
