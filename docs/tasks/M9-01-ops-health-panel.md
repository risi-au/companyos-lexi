# M9-01: Ops health panel — credential expiry, job liveness, error surfacing, alerts

status: done (PR #7 merged 2026-07-07, deployed to staging, migration 0023 applied)
module: apps/os admin surface + packages/api (health service) + alerts
branch: task/M9-01

## Goal

A root-admin `/admin/health` panel plus proactive alerting so the instance's unattended
machinery can't die silently. Born from the M8 activation pass (2026-07-07): staging now
depends on several credentials and background jobs that fail quietly — a 90-day
brain-engine token, a 90-day GitHub PAT for skills sync, LiteLLM virtual keys, cron
sidecars, webhook deliveries. Nobody will remember these in 90 days; the OS must.

## Known fragile inventory (seed the checks with these)

- `BRAIN_ENGINE_TOKEN` (root-admin cos_ token, expires ~2026-10-05) — brain-cron ingest/
  lint stop silently when it dies.
- `GITHUB_TOKEN` fine-grained PAT for companyos-skills (expires ~2026-10-05) — skills
  sync + wizard template editor break.
- `LITELLM_EMBED_KEY` / `BRAIN_LITELLM_API_KEY` virtual keys — semantic search and brain
  runs fail-open (features degrade without errors surfacing anywhere).
- brain-cron sidecar (opt-in compose profile) — no heartbeat today.
- GitHub org webhook deliveries (`GITHUB_WEBHOOK_SECRET`) — delivery failures only
  visible on the GitHub settings page.
- Plane webhook + API token; staging deploy migrate results; M5-03 backups when built.

## Do

1. **Health service** (packages/api): registry of checks with status
   (`ok | warning | error | unknown`), last-checked timestamp, and detail. Checks:
   token expiries from the `tokens` table (warn at 14 days, error when expired);
   capability last-run recency vs expected cadence (brain-engine reports runs already
   via report_run — flag when overdue); LLM key liveness (cheap litellm probe);
   webhook delivery recency; skills sync recency + last error.
2. **`/admin/health` page** (root-admin): one table — component, status, last activity,
   expiry/next-expected, latest error message; drill-down to the relevant run/report
   records. Reuse the alert pattern (M4-07) rather than inventing a new feed.
3. **Run log surface**: recent capability runs (brain ingest/lint, skills sync,
   provisioning) with status + token spend, filterable — the "is it alive" view.
4. **Email alert mechanism**: on transition into `warning`/`error`, send email to
   root admins (SMTP env config, fail-open when unset); daily digest option; alert
   records emitted through kernel emitEvent so the brain sees ops history too.
5. **Expiry registration**: when the Connect UI mints a token it already stores
   `expires_at`; surface upcoming expiries including external ones registered manually
   (e.g. the GitHub PAT — a small `external_credentials` registry: name, owner note,
   expires_at, where-it-lives).
6. **Tests**: check evaluation matrix, expiry threshold boundaries, alert emission +
   dedup (no email storms), page permissions (root-admin only).

## Don't

- No auto-rotation of credentials (surface + alert only; rotation stays a human act).
- No new scheduler — piggyback on existing cron/capability report_run flows.
- Don't page on staging noise by default — email only, severity-gated.

## Acceptance criteria

- [ ] /admin/health shows every seed-inventory item with live status
- [ ] A token within 14 days of expiry shows warning and triggers one email
- [ ] Brain-cron overdue (no run in >36h with profile enabled) shows error
- [ ] Run log lists recent brain/skills/provisioning runs with errors readable
- [ ] External credential registry holds the GitHub PAT with its expiry
- [ ] All alerts emitted via kernel events; email fail-open without SMTP config
