# packages/api/src/modules/workbench-events - AGENTS.md

GitHub webhook ingestion for provisioned workbenches. This is the safety net for work that lands in GitHub without an agent calling `log_change` or `complete_session`.

## Purpose
Map signed GitHub `push` and `pull_request` webhooks back to CompanyOS scopes through `workbenches`, emit scoped audit/activity events, and create low-noise changelog stubs only when no recent agent wrap-up references the same PR or commit range.

## Contract
- `verifyGitHubWebhookSignature(rawBody, signature, secret)` validates `X-Hub-Signature-256` with HMAC SHA-256 before payload parsing.
- `resolveWorkbenchScopes(db, { repoFullName, changedPaths })` matches repo first, then the deepest normalized `workbenches.path` prefix per changed path, returning one group per scope.
- Repo matching accepts either `owner/repo` or the repo short name. This assumes a single-org instance with owner-registered, HMAC-signed webhooks; revisit before supporting multiple GitHub orgs with overlapping repo names.
- `handleGitHubWebhook(db, { event, deliveryId, payload })` accepts `ping`, `push`, and `pull_request`; unsupported/noisy actions return `{ ok: true, ignored: true }`.
- GitHub delivery ids are idempotency keys. A delivery that already emitted an event is treated as duplicate and does not write more events or records.

## Events
Emits:
- `workbench.push`
- `workbench.pr_opened`
- `workbench.pr_updated`
- `workbench.pr_merged`

Payloads include repo, branch, PR number/url/title, commit SHAs/range, author login, changed path samples, resolved scope path, delivery id, and best-effort linked session ids.

## Records
PR merges create a `changelog` stub when no recent changelog/session completion references the same PR URL/number or commit SHAs. Default-branch pushes also create a stub when no PR/wrap-up is found; feature branch pushes remain event-only. GitHub-created records have `data.source = "github"` and include the `Needs human/agent summary` marker.

Stubs are written through the records module's `createSystemRecord` service, not by direct table insert. The `record.created` event keeps the records module's standard payload shape; GitHub-specific details live in `record.data` and `workbench.*` event payloads.

## Files
- `service.ts` - resolver, signature verification, ingestion, idempotency, stub policy.
- `workbench-events.test.ts` - PGlite coverage for path grouping, duplicate delivery ids, PR merge stubs, wrap-up suppression, and Work Log rollup.

## Setup
Configure the app route with `GITHUB_WEBHOOK_SECRET`. In GitHub, create a webhook pointing to `/api/webhooks/github`, select JSON payloads, and enable only `Pushes` and `Pull requests` for v1. `Ping` is accepted for setup verification.

## Operational Notes
- `hasProcessedDelivery` currently scans `events.payload->>'deliveryId'`. This is acceptable at webhook volume; add an index if M7-03 observability shows it as hot.

## Do Not
- Do not fetch or store GitHub secrets in this module.
- Do not scrape local working copies.
- Do not create records for every feature-branch commit.
- Do not attach unmatched or sibling paths to a resolved scope.
