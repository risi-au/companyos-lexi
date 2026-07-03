# M4-07: Alert pattern (alert-carrying run reports + alert.fired events + list_alerts)

status: done
module: capabilities (packages/api) + mcp + http route
branch: task/M4-07

## Goal

Alerting becomes a first-class *pattern* on top of the capabilities registry — not a new
platform module. A capability run report may carry an `alert` object; the service validates it,
stores it in the run payload, and emits an `alert.fired` event on the capability's scope. A new
viewer-gated `list_alerts` MCP tool answers "what alerts fired in this scope?" from the events
table. A pattern doc explains how to build alert capabilities (metrics query → threshold →
report_run with alert) in any engine. This completes M4 (DESIGN §7: "alert pattern").

## Context

- DESIGN.md §2.9: "Alerting/monitoring = just another registered capability." §2.7: "Dashboards
  and alert agents query it [the metrics store]." §3: Discord = "optional notification target
  for alert capabilities" — notification dispatch is NOT this task.
- No `alerts` table exists in DESIGN §5 and none is added here. Alerts live in two existing
  places: the `capability_runs.payload` jsonb (under `payload.alert`) and the `events` table
  (`alert.fired`). `listEvents(db, { scopePath, type, since, limit })` in
  `packages/api/src/kernel/events.ts` already filters by scope + type.
- Capability run reporting: `reportRun` in `packages/api/src/modules/capabilities/service.ts`
  (M4-05), editor-gated (agent tokens rank with editor — do not change gating). MCP `report_run`
  tool in `packages/mcp/src/server.ts`. HTTP path:
  `apps/os/src/app/api/v1/capabilities/report-run/logic.ts` (`mapCapabilityReportBody` +
  `recordCapabilityReport`; the whole body already flows into the run payload).
- Module conventions: typed errors in `packages/api/src/errors.ts`, one event per mutation,
  colocated Vitest + PGlite tests (`capabilities.test.ts` pattern), module `AGENTS.md` updated
  in the same change set.

## Architect decisions (do not relitigate)

1. **No new tables, no migration.** An alert is (a) `payload.alert` on the run row and (b) an
   `alert.fired` event. If a future task needs alert lifecycle (ack/resolve), it gets its own
   brief.
2. **`reportRun` input gains an optional `alert` field** — this is an architect-authorized
   *additive* extension of the `report_run` MCP tool input (the "never modify MCP tool
   signatures" rule forbids breaking changes; adding an optional field with unchanged behavior
   when absent is approved here). Shape:
   `{ severity: "info" | "warning" | "critical", message: string, metric?: string,
   value?: number, threshold?: number }`.
   Validation (typed `AlertValidationError` in errors.ts): severity must be one of the three;
   message non-empty. Invalid alert → throw; nothing written.
3. **Semantics when `alert` is present:** merge it into the run payload as `payload.alert`
   (explicit `alert` param wins over any `payload.alert` the caller also sent), then AFTER the
   run row is written emit ONE `alert.fired` event on the capability's scope with payload
   `{ capability: <name>, severity, message, metric, value, threshold, runRef, runId }`
   (omit undefined optionals). `capability.run_reported` is still emitted as today — an
   alert-carrying report emits both events. Re-reporting the same `runRef` with an alert emits
   `alert.fired` again (each report that carries an alert fires; dedup is the capability
   author's job — document this).
4. **`listAlerts` reads events, exact scope only (v1).** `listAlerts(db, { scopePath,
   severity?, since?, limit? }, actorPrincipalId)` — viewer on the scope; reads `alert.fired`
   events for that scope via `listEvents`, optional severity filter applied in code, newest
   first, default limit 20, cap 100. Returns `{ firedAt, capability, severity, message, metric?,
   value?, threshold?, runRef? }[]`. No descendant-scope rollup in v1 — document the limitation.
5. **HTTP path:** a valid `alert` in the request body rides through `mapCapabilityReportBody`
   into `reportRun`. On the event-only fallback path (unregistered capability / legacy status),
   `alert` is IGNORED — alerting requires a registered capability; document this. An invalid
   alert shape on the run path surfaces as a 400 (existing error mapping) — there are no legacy
   alert senders to stay lenient for.
6. **Notification dispatch is out of scope.** Consuming `alert.fired` (Discord, email, etc.) is
   a future capability, not platform code. Say so in the pattern doc.

## Do

1. **Errors** — `packages/api/src/errors.ts`: add `AlertValidationError` (message describing
   which field failed) following existing error classes.
2. **Service** — `packages/api/src/modules/capabilities/service.ts`:
   - Add `CapabilityAlertInput` type per decision 2 and an optional `alert?: CapabilityAlertInput`
     on `reportRun`'s input. Validate per decision 2; merge + emit per decision 3.
   - Add `listAlerts` per decision 4 (export input/result types).
   - Export new fns/types from `@companyos/api`'s index the same way existing capability fns are.
3. **MCP** — `packages/mcp/src/server.ts`:
   - Extend `report_run`'s zod input with the optional `alert` object (zod enum for severity).
   - New `list_alerts` tool: `{ scope, severity?, since?, limit? }` → JSON list; thin handler,
     `ensurePrincipal`, try/catch → `formatError`; add `AlertValidationError` to `formatError`.
4. **HTTP** — `apps/os/src/app/api/v1/capabilities/report-run/logic.ts`: map `body.alert`
   through to `reportRun` (decision 5). Do not forward `alert` on the event-only fallback.
5. **Pattern doc** — new `docs/patterns/ALERTS.md`: what an alert capability is (registered
   capability + scoped agent token + schedule in any engine), the loop (query metrics via HTTP
   API or MCP → evaluate threshold → `report_run` with `alert`), event contract
   (`alert.fired` payload), how to read alerts (`list_alerts`), dedup responsibility, and
   deferrals (notification dispatch, descendant rollup, ack/resolve lifecycle). Include one
   concrete n8n-shaped example request body for the HTTP route.
6. **Tests**:
   - `capabilities.test.ts` additions: alert-carrying report stores `payload.alert` and emits
     `alert.fired` on the capability's scope with the full payload; report without alert emits
     no `alert.fired`; invalid severity / empty message → `AlertValidationError`, no run row
     written for a fresh runRef; explicit `alert` param beats `payload.alert`; `listAlerts`
     viewer gating (outsider denied), severity filter, ordering, limit cap, `since`.
   - MCP roundtrip: `report_run` with alert then `list_alerts` returns it
     (`packages/mcp/src/ping.test.ts` style).
   - HTTP logic test (`apps/os/src/app/api/v1/capabilities/report-run/logic.test.ts` exists):
     alert passes through on the run path; event-only fallback ignores alert.
7. **Docs** — update `packages/api/src/modules/capabilities/AGENTS.md` (alert field semantics,
   `alert.fired` event, `listAlerts`, decisions 3–5 rationale) and `packages/mcp/AGENTS.md`
   tool list.

## Don't

- Don't create tables, migrations, or touch `packages/db` at all.
- Don't modify `docs/DESIGN.md`, `docs/CONSTITUTION.md`, or any existing MCP tool signature
  beyond the architect-authorized additive `report_run.alert` field.
- Don't change `reportRun`/`register_capability` gating or the event-only HTTP fallback's
  leniency for legacy reporters.
- Don't build notification dispatch, alert ack/resolve lifecycle, descendant-scope rollup,
  scheduled evaluation, or any UI.
- Don't touch skills, metrics, provisioning, records, docs, canvas, or tasks modules.
- Don't attempt to commit — the sandbox blocks `.git`; leave completed work in the tree.

## Acceptance criteria

- [ ] `report_run` (service, MCP, HTTP) accepts a valid `alert`, stores it under
      `payload.alert`, and emits exactly one `alert.fired` event per alert-carrying report,
      alongside the usual `capability.run_reported`.
- [ ] Invalid alert (bad severity / empty message) → `AlertValidationError`; surfaces through
      `formatError` (MCP) and as 400 (HTTP); no run row written for a fresh runRef.
- [ ] Reports without `alert` behave byte-for-byte as before (no `alert.fired`, existing tests
      untouched and green).
- [ ] `list_alerts` is viewer-gated, newest first, supports severity/since/limit (cap 100),
      and returns the documented shape.
- [ ] Event-only HTTP fallback ignores `alert` (asserted).
- [ ] `docs/patterns/ALERTS.md` exists per Do #5; both AGENTS.md files updated in the same
      change set.
- [ ] Root `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (in-sandbox: `tsc -b`, `eslint`,
      `vitest` directly; the orchestrator re-runs the real gate).
