# capabilities module - AGENTS.md

Registry and run history for agents/automations built in external engines such as n8n, Flowise, Hermes, or custom code.

## Purpose
Capabilities are first-class objects on a scope. The OS can list which automations belong to a scope, link back to their engine-side definition, and inspect persisted run history.

## Contract
- Service functions live in `service.ts` and are exported from `@companyos/api`.
- Tables live in `@companyos/db`: `capabilities` and `capability_runs`.
- Engines are open-ended text, not enums. `engineRef` is opaque: URL, engine-side id, or null.
- Every mutation emits an event.

## Tables
- `capabilities`: `id`, `scope_id`, `name`, `engine`, `engine_ref`, `token_id`, `status`, `description`, `created_at`, `updated_at`; unique by `(scope_id, name)`.
- `capability_runs`: `id`, `capability_id`, `run_ref`, `status`, `started_at`, `finished_at`, `duration_ms`, `summary`, `payload`, `created_at`; indexed by `(capability_id, started_at)`.
- `capability_runs` has a partial unique index on `(capability_id, run_ref)` where `run_ref is not null`.

## Gating
- `registerCapability` requires `admin` on the scope.
- `reportRun` requires `editor` on the scope.
- This is intentional: `agent` ranks with `editor` in `kernel/grants.ts`, and each capability reports runs using its own scoped agent token. Admin-gating run reports would prevent the intended scoped automation model.
- `listCapabilities` and `listCapabilityRuns` require `viewer`.

## Behaviors
- `registerCapability` is idempotent by `(scope, name)`. A second registration updates the existing row and returns `created: false`.
- `reportRun` is idempotent by `(capability_id, run_ref)` when `runRef` is provided. Re-reporting the same engine run updates status, terminal fields, summary, duration, and payload in place.
- Terminal statuses are `success` and `error`; if `finishedAt` is omitted for a terminal report, it defaults to now.
- Unknown capability reports throw `CapabilityNotFoundError`.
- `reportRun` accepts an optional top-level `alert` object: `{ severity: "info" | "warning" | "critical", message, metric?, value?, threshold? }`. Severity and non-empty message are validated with `AlertValidationError` before any write.
- Alert reports store the alert under `payload.alert`. If both `payload.alert` and top-level `alert` are provided, the top-level alert wins.
- Re-reporting the same `runRef` with an alert emits another `alert.fired`; deduplication is owned by the capability author.
- `listAlerts` reads `alert.fired` events for the exact scope only, requires viewer, supports severity/since/limit, defaults to 20, and caps at 100. It does not roll up descendant scopes in v1.
- The legacy HTTP path falls back to `reportCapabilityRun` for unknown capabilities, scope-less reporters, and statuses outside the run enum (e.g. legacy `"ok"`). That fallback emits only `capability.run_reported`, does not create a run row, and ignores `alert`; alerting requires a registered capability.

## Events
- `capability.registered`: payload `{ name, engine, created }`
- `capability.run_reported`: payload `{ name, status, runRef, summary, durationMs }`
- `alert.fired`: payload `{ capability, severity, message, metric?, value?, threshold?, runRef?, runId }`

## Tests
- `capabilities.test.ts` covers registration idempotency, access gates, agent run reporting, runRef updates, alert validation/storage/events, `listAlerts` gating/filtering/ordering/limits, unknown capability errors, listing, since filtering, and limit caps.
- MCP coverage for `register_capability`, `report_run`, `list_alerts`, `list_capabilities`, and `list_capability_runs` lives in `packages/mcp/src/ping.test.ts`.
