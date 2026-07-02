# packages/mcp — AGENTS.md

MCP server: the stdio front door for agents (Claude Code, Grok, Cursor, etc.) to read scoped context and write records. Thin client of `@companyos/api` services only.

## Purpose (M1-05 + M2-01 + M2-02)
Provides tools over MCP (stdio transport). Auth via `COS_TOKEN` env (cos_ prefix). Every call is principal-scoped via kernel grants. No business logic here — delegates to api services, formats results (esp. markdown for context). Dashboards added in M2-02 for spec authoring via agents.

## Tools (Context + Records + Tasks + Metrics)
- `ping` — no auth, returns "pong". For connectivity.
- `get_context({scope})` — markdown: identity (name/path/type/status), modules list, children paths, last 10 changelog+decision (title+preview+date). Viewer.
- `get_tree({scope?})` — indented paths of subtree (default root). Viewer.
- `log_change({scope, title, body_md, data?})` — create changelog. Editor/agent.
- `log_decision({scope, title, body_md, data?})` — create decision. Editor/agent.
- `save_report({scope, title, body_md, data?})` — create report. Editor/agent.
- `save_note({scope, title, body_md})` — create note. Editor/agent.
- `list_records({scope, kind?, since?, limit?})` — tab-delimited compact list (id,kind,title,date). Viewer.
- `get_record({id})` — full record (incl body_md + json data). Viewer.
- `create_task({scope, title, description?, priority?, due_date?})` — create Plane-backed task. Editor/agent.
- `complete_task({scope, issue_id, note?})` — transition to completed state; optional changelog note. Editor/agent.
- `update_task({scope, issue_id, title?, description?, state?, priority?, due_date?})` — partial update. Editor/agent.
- `list_tasks({scope, state?("open"|"completed"|"all"), limit?})` — compact list filtered by scope label. Viewer.
- `write_metrics({scope, points: [{metric, date, value, dims?}]})` — batch write/upsert metrics (max 1000). Editor/agent. Returns summary.
- `query_metrics({scope, metrics, from, to, groupBy?, filters?, agg?})` — query series with optional grouping (date/metric/dim), filters, agg. Viewer.
- `list_metric_names({scope})` — list distinct metric names + observed first/last dates for scope. Viewer.
- `save_dashboard({scope, name?, spec})` — save/upsert validated dashboard spec (v1 contract). Editor/agent. Emits saved, creates revision.
- `get_dashboard({scope, name?})` — fetch current spec. Viewer.
- `list_dashboards({scope})` — list dashboards for scope. Viewer.
- `list_widget_types()` — full widget vocabulary (types + examples + constraints) for agents to author specs. Public discovery.
- `revert_dashboard({scope, name?, revision_id})` — restore a prior revision as head. Editor/agent. Emits reverted.
- `save_doc({scope, slug?, title, body_md})` — save/upsert KB document (markdown canonical). Auto-slug + -2 collision suffix. Editor/agent. Emits saved + revision.
- `get_doc({scope, slug})` — fetch full doc (title + body_md). Viewer.
- `list_docs({scope, include_archived?})` — tab-delimited list id/slug/title/updated (excludes archived default). Viewer.
- `list_doc_revisions({scope, slug, limit?})` — list prior revisions for doc. Viewer.
- `revert_doc({scope, slug, revision_id})` — restore prior revision. Editor/agent. Emits reverted.
- `save_canvas({scope, slug?, name, scene})` — save/upsert Excalidraw scene JSON. Auto-slug from name + collision suffix. 2MB cap enforced. Editor/agent. Emits canvas.saved.
- `get_canvas({scope, slug})` — fetch name + full scene JSON. Viewer.
- `list_canvases({scope, include_archived?})` — tab-delimited list id/slug/name/updated (excludes archived default). Viewer.

All protected tools: unauth → clear error. AccessDenied surfaced as "Access denied: requires editor on <path>".

## Auth model
- Stdio only (v1). Token from `COS_TOKEN` env at process start.
- `authenticateToken` (kernel) on startup → principalId injected into createServer.
- All reads/writes checked by api `requireAccess` (viewer read; editor/agent write). Subtree grants via ancestor walk.
- No token → server runs, tools error with auth message. Bad/expired/revoked same.
- Principals (human|agent) + grants live in kernel.

## Files
- `src/server.ts` — createServer({db, principalId}), all tool registration with zod schemas + handlers (thin).
- `src/index.ts` — reexports createServer + ping (compat).
- `src/stdio.ts` — executable entry: reads DATABASE_URL + COS_TOKEN, auths, wires StdioServerTransport.
- `src/ping.test.ts` — full in-memory roundtrips + PGlite, all tools + auth matrix + get_context assertions. (metrics + dashboards tools covered in roundtrips too; canvas added M3-03)
- `tsconfig.build.json` — emits to dist/ (excludes tests).
- `package.json` — bin: companyos-mcp → dist/stdio.js ; workspace deps on api+db+zod.

## How to run
1. Build: pnpm --filter @companyos/mcp build   (or root pnpm build)
2. With token: `COS_TOKEN=cos_xxx DATABASE_URL=... companyos-mcp`
   - Or via root: pnpm mcp  (after build; set env)
3. Connect from agent (Claude Code / etc): configure stdio MCP server pointing at the bin + env vars.

## How to test
- `pnpm --filter @companyos/mcp test`
- Full: `pnpm test`
- Type/lint: `pnpm typecheck && pnpm lint`
- Roundtrips use SDK InMemoryTransport + PGlite (same migrate pattern as api).

Acceptance (M1-05 + M2-01 + M2-02):
- typecheck + lint + test pass
- write_metrics / query_metrics / list_metric_names covered in MCP roundtrips; groupBy date and dim key roundtrip via MCP asserted
- save_dashboard / get_dashboard / list_dashboards / list_widget_types / revert_dashboard roundtrips and validation errors in MCP tests
- auth cases (agent write ok in subtree / denied out; viewer no write; null principal auth error)
- Handlers: pure arg parse + service call + format (no logic)
- bin + pnpm mcp convenience

## Do not (per brief + constitution)
- No HTTP transport.
- No direct db writes or business logic.
- Never modify kernel schema or other modules' schemas.
- Update this AGENTS.md on behavior change.

## Usage notes for agents
Use get_context at session start for scoped memory. Use log_* / save_* at end of work to persist. Always use full paths for scope. Prefer structured data in the optional `data` for machine consumption alongside markdown bodies.
