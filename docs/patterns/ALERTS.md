# Alert Pattern

Alerting in CompanyOS is a pattern on top of registered capabilities. It is not a separate module and it does not have its own table.

An alert capability is:

- a registered capability on a scope
- a scoped agent token with editor access to that scope
- a schedule in any engine, such as n8n, Flowise, Hermes, cron, or custom code
- a loop that queries metrics, evaluates a threshold, and reports a run with an `alert` object when the threshold fires

## Loop

1. Query the relevant metric through the HTTP API or MCP metrics tools.
2. Evaluate the threshold in the capability engine.
3. Call `report_run` for the registered capability.
4. Include `alert` only when the condition fired.

The service stores the alert under `capability_runs.payload.alert` and emits an `alert.fired` event on the capability scope. The normal `capability.run_reported` event is still emitted for the same report.

## Report Shape

`report_run` accepts:

```json
{
  "alert": {
    "severity": "warning",
    "message": "Daily Meta spend exceeded threshold",
    "metric": "meta.spend",
    "value": 125.4,
    "threshold": 100
  }
}
```

`severity` must be `info`, `warning`, or `critical`. `message` must be non-empty. `metric`, `value`, and `threshold` are optional.

If a caller sends both `payload.alert` and the top-level `alert`, the top-level `alert` wins. Only the top-level `alert` causes `alert.fired`.

Re-reporting the same `runRef` with an alert emits `alert.fired` again. Deduplication belongs in the capability workflow because different alert authors may want different repeat and suppression rules.

## Event Contract

`alert.fired` payload:

```json
{
  "capability": "meta-spend-watch",
  "severity": "warning",
  "message": "Daily Meta spend exceeded threshold",
  "metric": "meta.spend",
  "value": 125.4,
  "threshold": 100,
  "runRef": "n8n-exec-123",
  "runId": "capability-run-uuid"
}
```

Undefined optional fields are omitted. The event is emitted on the exact scope where the capability is registered.

## Reading Alerts

Use MCP `list_alerts({ scope, severity?, since?, limit? })` to read `alert.fired` events for one exact scope. Results are newest first, default to 20, and cap at 100.

There is no descendant-scope rollup in v1. Query each scope explicitly.

## n8n-Shaped HTTP Example

For a registered capability named `meta-spend-watch` on scope `airbuddy/marketing`, an n8n HTTP Request node can post:

```json
{
  "scope": "airbuddy/marketing",
  "capability": "meta-spend-watch",
  "status": "error",
  "runId": "={{ $execution.id }}",
  "summary": "Spend threshold crossed",
  "durationMs": 842,
  "payload": {
    "window": "today",
    "source": "n8n"
  },
  "alert": {
    "severity": "warning",
    "message": "Meta spend is above the daily guardrail",
    "metric": "meta.spend",
    "value": 125.4,
    "threshold": 100
  }
}
```

The event-only HTTP fallback for unregistered capabilities, missing scopes, or legacy statuses ignores `alert`. Alerting requires a registered capability.

## Deferred

- Notification dispatch, including Discord and email, is a future capability that consumes `alert.fired`.
- Alert acknowledgement and resolution lifecycle are out of scope.
- Descendant-scope rollup is out of scope.
- Scheduled evaluation is owned by the capability engine, not platform code.
