# M4-05: Capabilities registry + run reporting
status: todo
module: capabilities (packages/api) + schema (packages/db)
branch: task/M4-05

## Goal
Capabilities (agents/automations built in any engine — n8n, Flowise, custom) are first-class registered objects per scope, with a persisted run history. `capabilities` + `capability_runs` tables exist; `register_capability` and `report_run` are real MCP tools; the existing event-only HTTP stub (`/api/v1/capabilities/report-run`) writes real run rows for registered capabilities and degrades gracefully for unregistered ones. The OS can answer "what automations run in this scope, and did they work last night?" from the database.

## Context
- DESIGN.md §2.9 (capabilities registry principle: registered per scope with their own scoped token; OS shows status + run history, deep-links to the engine), §5 (`capabilities` + `capability_runs` — scope, name, engine, engine_ref, token_id; runs: status, timestamps, summary), §6 (`register_capability`, `report_run` in the admin-gated group).
- **Architect decision on gating (do not "fix" this):** `register_capability` requires `admin` on the scope. `report_run` requires only `editor` — the `agent` role ranks with editor (kernel/grants.ts ROLE_RANK), and per DESIGN §2.9 each capability reports runs using its own scoped agent token; admin-gating report_run would defeat that. Record this rationale in the module AGENTS.md.
- Existing stub to formalize: `reportCapabilityRun` in packages/api/src/agent.ts (event-only, emits `capability.run_reported`) and the HTTP route apps/os/src/app/api/v1/capabilities/report-run/route.ts. Keep the event emission; add persistence.
- Patterns to follow: schema style — packages/db/src/schema/metrics.ts and workbenches.ts; service style — packages/api/src/modules/metrics/service.ts (getScope → requireAccess → write → emitEvent); MCP tool style — `provision_scope` block in packages/mcp/src/server.ts; typed errors — packages/api/src/errors.ts.
- Latest migration is 0011. Generate 0012 with `pnpm --filter @companyos/db db:generate` normally; do NOT hand-edit `drizzle/meta/_journal.json` (root cause fixed, commit 0bb9849).

## Do

1. **Schema (packages/db/src/schema/capabilities.ts, exported from src/schema/index.ts):**
   - `capabilities`: `id` uuid pk default random; `scopeId` uuid not null → scopes.id (cascade); `name` text not null; `engine` text not null (free text: "n8n" | "flowise" | "custom" | ... — engines are open-ended by design, no enum); `engineRef` text nullable (deep-link URL or engine-side id); `tokenId` uuid nullable → tokens.id (onDelete: set null); `status` text not null default `"active"` ("active" | "disabled"); `description` text nullable; `createdAt`/`updatedAt` timestamptz defaults. Unique index on (`scopeId`, `name`).
   - `capability_runs`: `id` uuid pk default random; `capabilityId` uuid not null → capabilities.id (cascade); `runRef` text nullable (engine-side run id, e.g. n8n execution id); `status` text not null ("running" | "success" | "error"); `startedAt` timestamptz not null default now; `finishedAt` timestamptz nullable; `durationMs` integer nullable; `summary` text nullable; `payload` jsonb not null default `{}`; `createdAt` timestamptz default now. Index on (`capabilityId`, `startedAt`); unique index on (`capabilityId`, `runRef`) **where runRef is not null** (partial — drizzle `uniqueIndex(...).on(...).where(...)`) for idempotent upsert by engine run id.
   - Hand-written interface types alongside, matching the file's existing convention (see Workbench/Metric).
   - Generate migration 0012 via drizzle-kit.
2. **Errors (packages/api/src/errors.ts):** add `CapabilityNotFoundError { scopePath, name }` following the existing error classes.
3. **Service (packages/api/src/modules/capabilities/service.ts):**
   - `registerCapability(db, input, actorPrincipalId)` — input `{ scopePath, name, engine, engineRef?, tokenId?, description?, status? }`. `requireAccess(..., "admin")`. Upsert by (scope, name): create if missing, else update the provided fields (idempotent re-registration; second identical call changes nothing but `updatedAt`). If `tokenId` is provided, verify the token row exists (throw plain Error if not). Emit `capability.registered` with `{ name, engine, created: boolean }`. Return the capability row + `created` flag.
   - `reportRun(db, input, actorPrincipalId)` — input `{ scopePath, name, status ("running"|"success"|"error"), runRef?, summary?, startedAt?, finishedAt?, durationMs?, payload? }`. `requireAccess(..., "editor")`. Look up the capability by scope + name; throw `CapabilityNotFoundError` if absent. If `runRef` given and a run with that (capabilityId, runRef) exists → **update** it (status, finishedAt, durationMs, summary, payload); else insert. If status is terminal ("success"|"error") and `finishedAt` absent, default it to now. Emit `capability.run_reported` (keep the existing event type; payload: name, status, runRef, summary, durationMs). Return the run row + `created` flag.
   - `listCapabilities(db, { scopePath }, actorPrincipalId)` — viewer. Returns capabilities on that scope, each with `lastRun: { status, startedAt, finishedAt, summary } | null` (latest run by startedAt).
   - `listCapabilityRuns(db, { scopePath, name, since?, limit? }, actorPrincipalId)` — viewer. Newest first, default limit 50, cap 200. `CapabilityNotFoundError` if the capability doesn't exist.
   - Export everything (service fns, input/result types, error) from packages/api index.
4. **HTTP route upgrade (apps/os/src/app/api/v1/capabilities/report-run/route.ts):** keep `authenticateAgentRequest` and the request shape. Map body → `reportRun`; on `CapabilityNotFoundError` fall back to the legacy event-only `reportCapabilityRun` so unregistered reporters keep working. Response gains `recorded: "run" | "event-only"`. Do not change agent.ts's `reportCapabilityRun` behavior (still event-only; it is now explicitly the fallback path — update its doc comment only).
5. **MCP tools (packages/mcp/src/server.ts), following the provision_scope pattern:**
   - `register_capability` — input mirrors registerCapability's input (zod); returns the JSON result.
   - `report_run` — input mirrors reportRun's input; returns the JSON result.
   - `list_capabilities` — `{ scope }`; returns JSON list with lastRun.
   - `list_capability_runs` — `{ scope, name, since?, limit? }`; returns JSON list.
   - Add `CapabilityNotFoundError` to `formatError`.
6. **Docs:** new `packages/api/src/modules/capabilities/AGENTS.md` (module contract: table shapes, gating rationale from Context, runRef idempotency semantics, HTTP fallback behavior). Update packages/api/AGENTS.md line about `reportCapabilityRun` (now the event-only fallback behind the capabilities module). Update packages/mcp AGENTS.md tool list if one exists. Same commit.
7. **Tests (packages/api/src/modules/capabilities/capabilities.test.ts + MCP coverage):**
   - register fresh → `created: true`; identical re-register → `created: false`, no duplicate row; changed engineRef → updated in place
   - non-admin actor rejected on register; agent-role principal CAN report_run on its scope; viewer-role principal CANNOT
   - report_run for registered capability inserts a run; terminal status defaults finishedAt; same `runRef` reported twice ("running" then "success") → **one** row, updated in place
   - report_run for unknown capability → `CapabilityNotFoundError`
   - listCapabilities returns lastRun correctly (null when no runs; latest when several)
   - listCapabilityRuns ordering, `since`, and limit cap
   - MCP: register_capability + report_run + list_capabilities happy path in ping.test.ts style (or a focused test) with real service against the test DB pattern used by existing MCP tests
   - HTTP fallback path: reportRun throwing CapabilityNotFoundError → event-only fallback (unit-test the route handler or the decision logic if route testing is impractical — say so in the commit body if skipped)

## Don't
- No UI (capabilities panel/status page is a later task). No alerting/alert pattern (later M4 task). No skills integration (M4-06). No n8n/Flowise API adapters — `engineRef` is an opaque string; the OS never calls into engines in this task.
- Don't touch kernel schema/tables; don't modify provisioning, tasks, or metrics behavior.
- Don't remove or repurpose the `capability.run_reported` event type — dashboards/telemetry may consume it.
- Don't hand-edit `drizzle/meta/_journal.json`.
- Don't gate report_run at admin (see Context — architect decision).

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root; migration 0012 applies via `pnpm --filter @companyos/db db:migrate` with no journal edits
- [ ] Registering the same capability twice yields one row (asserted); reporting the same runRef twice yields one run row (asserted)
- [ ] An agent-role principal can report_run; only admin can register_capability (both asserted)
- [ ] `register_capability`, `report_run`, `list_capabilities`, `list_capability_runs` MCP tools work end-to-end in tests
- [ ] HTTP `/api/v1/capabilities/report-run` writes a real run row for registered capabilities and falls back to event-only for unregistered ones
