# health module - AGENTS.md

Root-admin operational health checks for unattended CompanyOS machinery.

## Purpose
- Evaluate credential expiry, capability run liveness, LLM key probe state, webhook recency, skills sync health, and the last 14 days of wiki save/verify event volume.
- Surface recent root capability runs for "is it alive" inspection.
- Emit deduplicated alert events and optional email notifications when checks transition into warning/error.

## Contract
- Service functions live in `service.ts` and are exported from `@companyos/api`. `getOpsHealth` returns `wikiContributions` as 14 UTC date rows with doc save/verify counts.
- Root-admin only: every public service requires `admin` on the `root` scope.
- Tables live in `@companyos/db`: `external_credentials` and `ops_alert_state`.
- External credential rows store metadata only; never store secret values.
- Alert surfacing reuses the M4-07 event pattern by emitting `alert.fired` with `capability: "ops-health"`.

## Tables
- `external_credentials`: name, component, owner note, where-it-lives note, optional expiry, status, metadata.
- `ops_alert_state`: last check status/message plus last alert/digest timestamps for deduplication.

## Events
- `external_credential.registered`: root-admin metadata registry writes.
- `alert.fired`: health transition alert payload `{ capability: "ops-health", severity, message, metric, value, threshold, checkKey }`.
- `ops.health_email_failed`: emitted when an injected mailer fails; health checks remain fail-open.

## Tests
- `health.test.ts` covers expiry threshold boundaries, brain-cron overdue detection, root-admin gating, and alert/email dedup.
