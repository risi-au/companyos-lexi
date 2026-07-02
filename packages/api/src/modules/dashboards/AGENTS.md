# packages/api/src/modules/dashboards — AGENTS.md

Dashboards module: validated, versioned, agent-authorable dashboard specs per scope (name default "main"). Specs are jsonb, revisions keep immutable history (last 50). All writes emit kernel events. Access: viewer read, editor/agent write. Rendering is future (M2-04). MCP tools provided for agent authoring.

## Purpose
Store dashboard specs (the fixed contract in spec.ts) with full revision history. Agents discover widget vocabulary via MCP, write/update via save, revert mistakes. Every mutation audited.

## Tables (in packages/db)
- `dashboards` (new):
  - id (uuid pk)
  - scope_id (fk scopes, cascade)
  - name (text not null, default 'main')
  - spec (jsonb not null, default {})
  - updated_by (fk principals, not null)
  - created_at, updated_at (timestamptz)
  - unique index on (scope_id, name)

- `dashboard_revisions` (new):
  - id (uuid pk)
  - dashboard_id (fk dashboards, cascade)
  - spec (jsonb not null)
  - saved_by (fk principals, not null)
  - created_at (timestamptz)

Exports from `@companyos/db`: dashboards, dashboardRevisions, Dashboard, NewDashboard, DashboardRevision, NewDashboardRevision interfaces/types.

## Spec format (THE contract — verbatim)
See spec.ts for zod. Structure:
{
  version: 1,
  title: string,
  range: { default: "7d"|"30d"|"90d" },
  widgets: Widget[]  // max 24
}
Widget = {
  id: string (unique in spec),
  type: "metric-card"|"timeseries"|"bar"|"table"|"tasks"|"records"|"text",
  title?: string,
  grid: { x:0-11, y>=0, w:1-12, h:1-8 },
  query?: { metrics: string[], agg?, groupBy?, filters?, compare? }  // required for metric-card/timeseries/bar/table
  options?: Record  // text: {markdown: string (req)}, tasks/records use for state/kinds/limit
}
Validation on every save: rejects >24, dup ids, unknown types, missing query on data widgets, missing markdown on text.

## Contract / Functions
All take `db: DB` first. Re-exported from `@companyos/api`.

- `saveDashboard(db, {scopePath, name?, spec}, actor)`: editor/agent; validate via zod (throws DashboardValidationError with .errors[] listing problems); upsert by (scope,name); always append revision; prune to last 50; emits `dashboard.saved`.
- `getDashboard(db, {scopePath, name?}, actor)`: viewer; returns current Dashboard | null.
- `listDashboards(db, {scopePath}, actor)`: viewer; returns Dashboard[] for scope (newest updated first).
- `listRevisions(db, {scopePath, name?, limit?}, actor)`: viewer; returns DashboardRevision[] newest first.
- `revertDashboard(db, {scopePath, name?, revisionId}, actor)`: editor/agent; restores spec from revision as new head (appends rev, emits `dashboard.reverted`).
- `getWidgetVocabulary()`: static return of widget types, fields, constraints + 3 example widgets each (for agent discovery before authoring).

Uses kernel: getScope, requireAccess(editor/viewer), emitEvent. No cross module imports.

## Files
- `src/modules/dashboards/spec.ts` — zod schemas (DashboardSpecSchema etc), validateDashboardSpec, getWidgetVocabulary, types.
- `src/modules/dashboards/service.ts` — the 5 functions + prune/append helpers.
- `src/modules/dashboards/AGENTS.md` — this file.
- `src/modules/dashboards/dashboards.test.ts` — tests (PGlite) covering spec, service, revisions, access, events.
- Updated: `packages/db/src/schema/dashboards.ts`, `packages/db/src/schema/index.ts`, generated migration 0004_*, `packages/api/src/errors.ts` (DashboardValidationError), `packages/api/src/index.ts`, packages/mcp/* for tools + its AGENTS.md.

## How to test
From repo root:
- `pnpm --filter @companyos/api test`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

## Key behaviors
- Access: viewer for get/list/listRevs; editor/agent for save/revert.
- Validation errors are typed and list all problems with paths.
- 51st save prunes revisions back to 50 (oldest dropped).
- Revert restores exactly the chosen revision's spec, emits reverted, creates a new revision entry.
- name defaults to "main".
- Events always on save and revert.
- getWidgetVocabulary includes examples for all 7 types + constraints.

## MCP tools (see packages/mcp)
- save_dashboard, get_dashboard, list_dashboards, list_widget_types, revert_dashboard.

## Do not
- No UI/render (M2-04). No changes to other modules or kernel schema.
- Never modify docs/, legacy/, root files, or other modules' schema/migrations.
- Update this AGENTS.md in same commit as changes.

## Usage
```ts
import { saveDashboard, getDashboard, getWidgetVocabulary, listRevisions, revertDashboard } from "@companyos/api";
const vocab = getWidgetVocabulary();
const dash = await saveDashboard(db, { scopePath: "airbuddy", spec: { version:1, title:"Overview", range:{default:"7d"}, widgets: [...] } }, principalId);
const current = await getDashboard(db, {scopePath: "airbuddy"}, principalId);
const revs = await listRevisions(db, {scopePath:"airbuddy", limit:10}, p);
await revertDashboard(db, {scopePath:"airbuddy", revisionId: revs[1].id }, p);
```
