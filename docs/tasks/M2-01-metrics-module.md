# M2-01: Metrics module (store + MCP tools + synthetic seeder)
status: todo
module: metrics
branch: task/M2-01

## Goal
The generic time-series store from DESIGN §5: anything can write metrics per scope, dashboards and agents can query them, and a synthetic-data seeder produces a realistic AirBuddy-shaped dataset so M2 UI work has real-feeling data before client credentials exist.

## Context
- `docs/DESIGN.md` §2 item 7, §5 (metrics table), §6 (metrics tool group).
- Module pattern: copy `modules/records/` (schema+migration in packages/db, service in packages/api/src/modules/metrics/, AGENTS.md, PGlite tests). Kernel access: writes editor/agent, reads viewer. Events on writes (batched: one event per write_metrics call, payload = count + metric names, NOT one per point).
- Metric points are upserts: same (scope, metric, date, dims) → value replaced (re-running a daily pull must be idempotent).

## Do
1. Schema `packages/db/src/schema/metrics.ts`: `metrics`: id uuid pk, scope_id FK cascade, metric text (e.g. `meta.spend`, `woo.revenue`, `ga4.sessions`), date (date, not timestamp), value numeric(18,4), dims jsonb default {} (e.g. {campaign, country}), dims_hash text (deterministic hash of canonicalized dims, computed in service), created_at, updated_at. Unique index (scope_id, metric, date, dims_hash). Index (scope_id, metric, date). Migration committed.
2. Service `packages/api/src/modules/metrics/service.ts`:
   - `writeMetrics(db, {scopePath, points: [{metric, date, value, dims?}]}, actor)` — editor/agent; canonicalize dims (sorted keys) → sha256 dims_hash; upsert batch (onConflictDoUpdate); emits one `metrics.written` event; max 1000 points/call.
   - `queryMetrics(db, {scopePath, metrics: string[], from, to, groupBy?: "date"|"metric"|dimKey, filters?: Record<string,string>, agg?: "sum"|"avg"|"min"|"max" (default sum)}, actor)` — viewer; returns compact series: [{metric, dim?, points: [[date, value]]}]. Filters match dims jsonb keys.
   - `listMetricNames(db, {scopePath}, actor)` — viewer; distinct metric names + date ranges (for dashboard building UX).
3. MCP tools (thin): `write_metrics`, `query_metrics`, `list_metric_names` following existing patterns; add to packages/mcp AGENTS.md.
4. Synthetic seeder `packages/db/src/scripts/seed-demo-metrics.ts` (+ root script `pnpm db:seed-demo`): generates 90 days ending today for scope `airbuddy`: `meta.spend`, `meta.impressions`, `meta.clicks` (dims: campaign = "prospecting"|"retargeting", country = "AU"|"NZ"), `google.spend`, `ga4.sessions`, `woo.revenue`, `woo.orders` — plausible values with weekly seasonality + noise + a mild upward trend (deterministic PRNG seeded from scope so reruns are idempotent-ish; upserts make it safe regardless). Uses the service (not raw inserts) with the seed principal.
5. Tests (PGlite): upsert idempotency (rewrite same point → 1 row, updated value); query with date range + groupBy date and by dim key; filters; agg functions; access control; event emitted once per batch; 1000-point cap enforced.

## Don't
- No dashboard/UI code. No n8n. Don't touch other modules' schemas/migrations, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Upsert semantics proven by test (same point twice → one row, latest value)
- [ ] query_metrics groupBy date and by dim key both round-trip via MCP in tests
- [ ] `pnpm db:seed-demo` runs against DATABASE_URL and reports points written (dry-verified in tests via PGlite run of the generator function)
- [ ] Access control + single batched event per write tested
