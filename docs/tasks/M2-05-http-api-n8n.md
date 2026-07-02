# M2-05: HTTP agent API + n8n + Plane webhook ingestion
status: done
module: web (apps/os) + infra
branch: task/M2-05

## Goal
Automation engines get an HTTP door: token-authenticated REST endpoints for metrics/records, Plane webhooks flow into the event stream, and n8n runs in the dev stack with a committed demo workflow that writes metrics on schedule. Closes M2.

## Context
- MCP (stdio) serves interactive agents; engines like n8n need plain HTTP. Same front-door rules: token → principal → grants; thin route handlers calling `packages/api` services (CONSTITUTION §2); every write emits events.
- Auth: `Authorization: Bearer cos_...` → kernel `authenticateToken`. Reuse exactly; no new auth scheme.
- Plane webhooks: Plane can POST issue events; ingesting them means tasks closed in Plane's UI appear in our events/changelog (the missing reverse direction).
- n8n licence note: internal use is fine (Sustainable Use); flagged for review before external tenants — no action needed here.

## Do
1. REST route handlers in `apps/os/src/app/api/v1/` (all bearer-token authed, JSON):
   - `POST /api/v1/metrics/write` → writeMetrics ({scope, points})
   - `POST /api/v1/records/log` → createRecord ({scope, kind, title, body_md, data?})
   - `GET  /api/v1/context?scope=` → same bundle as MCP get_context
   - `POST /api/v1/capabilities/report-run` → stub OK for now: validates token + writes a `capability.run_reported` event with payload (capabilities registry module lands in M4; the endpoint contract starts now)
   - Shared helper `apps/os/src/lib/agent-auth.ts`: bearer → principal | 401. Consistent error JSON {error, requires?}.
2. Plane webhook: `POST /api/v1/webhooks/plane` — verify via shared secret (`PLANE_WEBHOOK_SECRET` env — Plane signs with HMAC per its docs; verify current mechanism via web). On issue state→completed: emit `task.completed_external` event on the mapped scope (reverse-lookup task_links by project id; label → exact scope when present). On other issue events: emit `task.updated_external`. Never 500 on unknown payloads — log event `webhook.unhandled` and 200.
3. n8n in `infra/docker-compose.dev.yml`: pinned `n8nio/n8n` image, port 5678, own volume, basic auth via env (N8N_BASIC_AUTH_*), NOT sharing our Postgres (default sqlite fine for dev). Add env placeholders to .env.example.
4. Committed demo workflow `infra/n8n/demo-metrics-pull.json` (importable): Schedule trigger (daily 06:00) → HTTP Request node → generates/pulls demo values (Code node producing 1 day of plausible `demo.pull.value` points) → POST to `http://host.docker.internal:3000/api/v1/metrics/write` with bearer token from n8n credential. Include `infra/n8n/README.md`: how to import, set the credential, and activate.
5. Tests: route handlers via direct invocation (Next route handlers are functions — test with Request objects + PGlite-injected services if wiring permits, else test the underlying auth helper + a thin integration through the service layer): auth 401/403 paths, metrics write round-trip, records log, webhook signature verify + completed-event emission with mocked payload (use a real Plane webhook payload shape from docs).
6. Update apps/os AGENTS.md (API surface) and infra/AGENTS.md (n8n).

## Don't
- No n8n workflows beyond the demo. No capability registry tables (M4). No MCP changes.
- Don't touch other modules' schemas, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] curl with a valid cos_ token can write metrics and log a record; invalid token → 401; viewer-role token writing → 403 (tested)
- [ ] Plane webhook with valid signature + completed transition emits the mapped event (tested with fixture payload)
- [ ] `pnpm infra:up` brings up n8n; demo workflow JSON + README committed
- [ ] Architect live-verifies: import workflow, manual-execute it, metrics land in the store and appear on a dashboard widget
