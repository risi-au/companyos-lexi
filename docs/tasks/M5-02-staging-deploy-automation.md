# M5-02: Staging deploy automation (tag → GHCR → SSH deploy → smoke check)

status: todo (blocked on: v0.5.1 manual staging deploy verified — architect will unblock)
module: infra + .github
branch: task/M5-02

## Goal

Pushing a `v*` tag ends with the new release RUNNING on staging without human hands: after
`release.yml` publishes images, a deploy job SSHes to the staging VPS user, updates
`COMPANYOS_TAG` in `~/app/.env`, runs `docker compose pull && up -d`, waits for the one-shot
migrate service to succeed, and curl-smoke-tests the app through the tunnel. Promotion to
live stays MANUAL by design (staging sign-off is a human gate per docs/VPS.md).

## Context

- docs/VPS.md (environments, promotion process, smoke checklist), docs/DEPLOYMENT.md.
- `.github/workflows/release.yml` (M5-01) — gates + build/push both images on `v*` tags.
- Staging: VPS user `aios@159.13.38.87`, rootless Docker, app at `~/app`
  (compose + `.env` already in place from the manual v0.5.1 deploy), public URL
  https://cos.risi.au via Cloudflare tunnel.
- Rootless docker on that host: confirm the compose binary is `docker compose` for the aios
  user (it is — verified during the manual deploy; see docs/VPS.md).

## Architect decisions (do not relitigate)

1. **Deploy = a second job in `release.yml`** (`needs: release`), not a separate workflow —
   one tag, one pipeline, deploy only after images exist. Job name `deploy-staging`.
2. **Secrets via GitHub Actions secrets** (repo settings, added by owner):
   `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY` (private key, ed25519,
   dedicated deploy key — NOT the architect's personal key). The workflow must fail with a
   clear message naming any missing secret.
3. **The deploy step is a single idempotent remote script** executed over SSH (heredoc or
   `appleboy/ssh-action` — prefer plain `ssh` via `webfactory/ssh-agent` or manual
   `ssh-agent` setup to keep the dependency surface small):
   - `cd ~/app`
   - update or append `COMPANYOS_TAG=<tag>` in `.env` (sed in place; keep a `.env.bak`)
   - `docker compose --env-file .env -f docker-compose.prod.yml pull`
   - `docker compose --env-file .env -f docker-compose.prod.yml up -d`
   - wait for `migrate` container to exit 0 (`docker compose ps`/`wait`; fail the job if it
     exits non-zero, printing its logs)
   - `curl -fsS --max-time 10 http://127.0.0.1:3000/` (in-VPS check; a 2xx/3xx passes)
4. **External smoke**: after the SSH step, the workflow curls `https://cos.risi.au` from the
   runner and fails on non-2xx/3xx.
5. **No auto-deploy to live.** Nothing in this task touches a live environment.
6. **Concurrency guard**: `concurrency: staging-deploy` on the job so overlapping tags queue.

## Do

1. Extend `.github/workflows/release.yml` with the `deploy-staging` job per decisions 1–6.
2. Generate nothing into the repo that contains secrets; document the three required GitHub
   secrets in `infra/README.md` (new "Staging auto-deploy" subsection) and in docs/VPS.md
   (one line pointing at the README section).
3. Add a `deploy` marker output: job summary (`$GITHUB_STEP_SUMMARY`) with tag, image
   digests, migrate result, and smoke status.
4. Update `infra/AGENTS.md` (release pipeline now includes staging deploy).

## Don't

- Don't create the dedicated deploy keypair or add GitHub secrets — the OWNER does that
  (the brief's checklist tells him what to add); fail loudly if absent.
- Don't deploy anywhere but the staging user; don't add a live deploy path.
- Don't modify the build/push steps from M5-01, the compose file, or the app.
- Don't store hostnames/keys in the repo beyond the secret NAMES.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [ ] `release.yml` has a `deploy-staging` job gated on successful image publish, using only
      the three named secrets; missing secrets fail with a clear message.
- [ ] Remote script is idempotent (re-running the same tag is a no-op pull + up -d) and
      fails the job when migrate fails, with migrate logs printed.
- [ ] External curl of https://cos.risi.au gates the job result.
- [ ] `infra/README.md` + `infra/AGENTS.md` + docs/VPS.md updated in the same change set.
- [ ] workflow YAML validates (actionlint or `gh workflow view` parse); root gates still pass
      (no app code touched).
- [ ] Verified live by the architect on the next tag after merge.
