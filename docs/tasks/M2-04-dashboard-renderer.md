# M2-04: Dashboard renderer
status: todo
module: web (apps/os)
branch: task/M2-04

## Goal
Scope pages render their saved dashboard spec as a live, token-styled widget grid — the agent-authored "AirBuddy Overview" (already in the DB) displays real charts over the seeded metrics. The centerpiece of M2.

## Context
- Spec contract: `packages/api/src/modules/dashboards/spec.ts` (zod, 7 widget types, 12-col grid) — consume it, never fork it. A saved dashboard for `airbuddy` (name "main") exists with metric-cards, timeseries, bar, tasks, records widgets over seeded metrics.
- `docs/DESIGN-SYSTEM.md`: chart palette tokens `--chart-1…6` (add them to `packages/ui` tokens if not yet present — they're specified in the doc), tabular-nums for numbers, JetBrains Mono for metric values, skeletons not spinners, legends/tooltips mandatory, colorblind-safe ordering.
- Charts: **Recharts** (shadcn-style chart components) styled exclusively with chart tokens.
- Data path (CONSTITUTION §2): server components / route handlers call `packages/api` services (`queryMetrics`, `listTasks`, `listRecords`, `getDashboard`) with the session principal. No client-side direct service imports; widgets get data via server rendering (fine to re-render whole page on range change via searchParams — no client data fetching layer needed yet).
- Range: spec `range.default` (7d/30d/90d) resolved to [from,to] server-side; a range picker (segmented control) updates a `?range=` searchParam. `compare: prev_period` = same-length window immediately before.

## Do
1. Add a **Dashboard** tab to the scope page (first tab, default when a dashboard exists for the scope; Overview/Activity remain). Route: `/s/[...path]?tab=dashboard&range=30d`.
2. `apps/os/src/modules/dashboards/` UI components:
   - `DashboardGrid` — CSS grid, 12 cols, gap per spacing tokens; widgets positioned by grid {x,y,w,h}; responsive collapse to single column <768px.
   - `MetricCard` — big value (mono, tabular-nums), title, delta badge vs prev period when `compare` set (green/red per status tokens, arrow icon, % change; "—" when no prior data).
   - `TimeseriesWidget` — Recharts line/area, one series per metric or per dim group, chart tokens, legend, tooltip (mono values, formatted dates), no y-axis title clutter.
   - `BarWidget` — grouped by the groupBy key (e.g. campaign), chart tokens.
   - `TableWidget` — compact token-styled table of the query result (metric × date or dim), right-aligned mono numbers.
   - `TasksWidget` — open tasks list (reuse/extract the Overview card), link out to Plane URL.
   - `RecordsWidget` — recent records (kind badge, title, date).
   - `TextWidget` — markdown rendered (simple, safe: use `react-markdown` or equivalent; no raw HTML).
   - Every widget: title bar, loading skeleton, empty state ("No data in range"), error state (message, never crash the grid).
3. Value formatting util: k/M abbreviations, currency-ish 2dp for spend/revenue metrics (metric name heuristic: contains `spend`|`revenue` → $), thousands separators. Dates as "26 Jun".
4. Range picker in the dashboard tab header (7d/30d/90d segmented control → searchParam; server resolves windows).
5. Empty state for scopes with no dashboard: card with "No dashboard yet — an agent can create one with save_dashboard" + copyable scope key.
6. If chart tokens are missing from `packages/ui` tokens file, add them per DESIGN-SYSTEM.md (light+dark values).
7. Tests: unit-test the range resolver (7d/30d/90d + prev_period windows, date math UTC) and the value formatter in packages/api or a web utils file with vitest. UI verified by architect in browser.

## Don't
- No dashboard EDITING UI (agents edit via MCP; human editing UI comes later if ever).
- No client-side data fetching framework (no react-query/SWR) — server components + searchParams only.
- No new widget types. Don't modify the spec schema, other modules, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] `/s/airbuddy` defaults to the Dashboard tab rendering the saved spec: 2 metric cards with deltas, spend-vs-revenue timeseries, spend-by-campaign bars, open tasks, recent activity — all real data (architect browser-verifies)
- [ ] Range picker switches 7d/30d/90d and charts update
- [ ] All chart colors/text from tokens (no raw hex); numbers tabular mono; skeleton/empty/error states present
- [ ] Range resolver + formatter unit tests pass
