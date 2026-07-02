# M2-02: Dashboard module (spec storage, validation, MCP tools)
status: todo
module: dashboards
branch: task/M2-02

## Goal
Dashboards exist as validated, versioned, agent-authorable specs per scope. Agents can discover the widget vocabulary, write/update specs via MCP, and bad edits revert. (Rendering is M2-04 — this task is the contract + storage.)

## Context
- `docs/DESIGN.md` §2 item 3, §5 (dashboards + revisions), §6 (dashboard tool group).
- Module pattern as records/metrics. Access: writes editor/agent, reads viewer. Events on mutations.
- **The spec format is THE contract** — agents will generate it, the renderer will consume it, revisions preserve it. Implement exactly as specified below; do not invent extra widget types or fields.

## The spec format (v1) — zod-validated on every save
```ts
{
  version: 1,
  title: string,                          // e.g. "AirBuddy Overview"
  range: { default: "7d"|"30d"|"90d" },   // renderer provides picker; queries resolve relative to it
  widgets: Widget[]                       // max 24
}
Widget = {
  id: string,                             // unique within spec, slug-like
  type: "metric-card"|"timeseries"|"bar"|"table"|"tasks"|"records"|"text",
  title?: string,
  grid: { x: 0-11, y: number>=0, w: 1-12, h: 1-8 },   // 12-column grid, no overlap validation needed (renderer handles)
  // for data widgets (metric-card, timeseries, bar, table):
  query?: {
    metrics: string[],                    // e.g. ["meta.spend"]
    agg?: "sum"|"avg"|"min"|"max",        // default sum
    groupBy?: "date"|"metric"|string,     // string = a dims key like "campaign"
    filters?: Record<string,string>,      // dims filters
    compare?: "prev_period"               // metric-card only: show delta vs previous window
  },
  // for tasks widget: { state?: "open"|"completed"|"all", limit?: number }
  // for records widget: { kinds?: ("changelog"|"decision"|"report"|"note")[], limit?: number }
  // for text widget: { markdown: string }
  options?: Record<string, unknown>
}
```

## Do
1. Schema `packages/db/src/schema/dashboards.ts`: `dashboards`: id, scope_id FK cascade, name text (default "main"), spec jsonb, updated_by FK principals, created_at, updated_at; unique(scope_id, name). `dashboard_revisions`: id, dashboard_id FK cascade, spec jsonb, saved_by, created_at. Migration.
2. Zod schema for the spec format above in `packages/api/src/modules/dashboards/spec.ts` — exported so MCP and (later) the renderer share it. Reject: >24 widgets, duplicate widget ids, unknown types, missing query on data widgets, missing markdown on text widgets.
3. Service `packages/api/src/modules/dashboards/service.ts`:
   - `saveDashboard(db, {scopePath, name?, spec}, actor)` — editor/agent; validate spec (typed error listing problems); upsert dashboard; append revision (keep last 50, prune older); emit `dashboard.saved`.
   - `getDashboard(db, {scopePath, name?}, actor)` — viewer.
   - `listDashboards(db, {scopePath}, actor)` — viewer.
   - `listRevisions(db, {scopePath, name?, limit?}, actor)` / `revertDashboard(db, {scopePath, name?, revisionId}, actor)` — editor/agent; revert = save revision's spec as new head (emits `dashboard.reverted`).
   - `getWidgetVocabulary()` — static: widget types, their fields, constraints, and 3 tiny example widgets — formatted for agent consumption (this is what an agent reads before authoring a spec).
4. MCP tools: `save_dashboard`, `get_dashboard`, `list_dashboards`, `list_widget_types` (returns vocabulary), `revert_dashboard`. Update mcp AGENTS.md.
5. Tests: valid spec round-trip; each rejection case (bad type, dup ids, >24, missing query/markdown); revision append + prune at 50; revert restores; access control; events.

## Don't
- No rendering/UI. No changes to other modules. No docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Spec zod schema exported and enforced on save with helpful error messages (tested)
- [ ] Revisions: 51st save prunes to 50; revert works (tested)
- [ ] All 5 MCP tools round-trip in tests; list_widget_types returns the vocabulary with examples
- [ ] Access control + events on every mutation
