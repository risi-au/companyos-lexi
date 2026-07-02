# packages/api/src/modules/metrics — AGENTS.md

Metrics module: generic time-series store (scope, metric, date, value, jsonb dims). Supports write (upsert), query (with group/agg/filter), list names + ranges. Writes are batched under one event. Used for vendor pulls (meta/ga4/woo) and synthetic demo data.

## Purpose
Time-series metrics per scope for dashboards, agents, and reporting. Idempotent upserts (same scope+metric+date+dims → replace value). One batched `metrics.written` event per write call (count + metric names). Access: viewer read, editor/agent write. Kernel-scoped.

## Tables (in packages/db)
- `metrics` (new in this module):
  - id (uuid pk)
  - scope_id (fk scopes, cascade)
  - metric (text not null, e.g. "meta.spend")
  - date (date not null, YYYY-MM-DD)
  - value (numeric(18,4) not null)
  - dims (jsonb not null default {})
  - dims_hash (text not null) — sha256 of canonical sorted JSON dims
  - created_at, updated_at (timestamptz)
  - Unique: metrics_scope_metric_date_dims_hash_unique on (scope_id, metric, date, dims_hash)
  - Index: metrics_scope_metric_date_idx on (scope_id, metric, date)

Exports from `@companyos/db`: metrics table, Metric interface, NewMetric type.

## Contract / Functions
All functions take injected `db: DB` first (no globals). Re-exported from `@companyos/api`.

- `writeMetrics(db, {scopePath, points: [{metric, date, value, dims?}]}, actorPrincipalId)`: editor/agent; canonicalize dims (sorted keys) → dims_hash; batch upsert (onConflictDoUpdate value+updatedAt); max 1000 points; emits ONE `metrics.written` (payload: {count, metrics: string[]}); returns {written, metrics}.
- `queryMetrics(db, {scopePath, metrics: string[], from, to, groupBy?: "date"|"metric"|dimKey, filters?: Record<string,string>, agg?: "sum"|"avg"|"min"|"max" (default "sum")}, actor)`: viewer; returns MetricSeries[] = [{metric, dim?, points: [[date, value]] }]; date range inclusive; filters do exact match on dims jsonb keys; groupBy="date" collapses dims per metric/date; groupBy dimKey produces per (metric, dimVal) series; agg applied.
- `listMetricNames(db, {scopePath}, actor)`: viewer; returns [{metric, firstDate, lastDate}] distinct metrics with min/max date observed in scope.

Uses `requireAccess`, `emitEvent`, `getScope` from kernel. No cross-module imports.

## Files
- `src/modules/metrics/service.ts` — writeMetrics, queryMetrics, listMetricNames.
- `src/modules/metrics/AGENTS.md` — this file.
- `src/modules/metrics/metrics.test.ts` — PGlite tests covering upsert idempotency, queries, groupBy, filters, agg, access, events, caps.
- Updated: `packages/db/src/schema/metrics.ts`, `packages/db/src/schema/index.ts`, new migration in db/drizzle, `packages/api/src/index.ts`, `packages/db/package.json` (script), root `package.json` (db:seed-demo), `packages/mcp/src/server.ts`, `packages/mcp/AGENTS.md`, `packages/db/src/scripts/seed-demo-metrics.ts`.

## How to test
From repo root:
- `pnpm --filter @companyos/api test`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm db:seed-demo` (after real DB up; uses service + seed principal)

Tests use PGlite + migrations.

## Key behaviors
- Upsert: re-write same (scope,metric,date,dims) keeps 1 row, latest value, bumps updated_at.
- Event: exactly one per writeMetrics call (even for N points); payload has count + sorted metric names.
- Access: viewer for query/list; editor+agent for write. Subtree inheritance via kernel.
- Dims: canonical hash ignores key order; filters exact string match on jsonb ->>.
- Dates: strings YYYY-MM-DD; ranges inclusive.
- groupBy date: per-metric series with per-date aggregated values.
- groupBy <dim>: per-metric-per-dim series.
- query returns points sorted by date.
- Max 1000 per write enforced.
- listMetricNames returns ordered by metric name.
- No delete; values numeric(18,4) precision.

## Do not
- No UI, dashboards, n8n, or other module code.
- Never touch kernel schema or other modules' schemas/migrations.
- Do not change MCP tool signatures without updating briefs/AGENTS.
- Update this AGENTS.md on behavior change.

## Usage
```ts
import { writeMetrics, queryMetrics, listMetricNames } from "@companyos/api";
await writeMetrics(db, { scopePath: "airbuddy", points: [
  { metric: "meta.spend", date: "2026-06-01", value: 123.45, dims: {campaign: "prospecting", country: "AU"} }
]}, principalId);
const series = await queryMetrics(db, { scopePath: "airbuddy", metrics: ["meta.spend"], from: "2026-05-01", to: "2026-07-01", groupBy: "country", agg: "sum" }, principalId);
const names = await listMetricNames(db, { scopePath: "airbuddy" }, principalId);
```
