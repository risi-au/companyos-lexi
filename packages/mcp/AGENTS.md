# packages/mcp - AGENTS.md

MCP server: the stdio and remote HTTP front door for agents (Claude Code, Grok, Cursor, etc.) to read scoped context and write records. Thin client of `@companyos/api` services only.

## Purpose (M1-05 + M2-01 + M2-02 + M6-01)
Provides tools over MCP:
- stdio transport for local development and workbench agents
- streamable HTTP transport for remote clients at `${MCP_PUBLIC_URL}` (default convention: `${COMPANYOS_URL}/api/mcp`)

Stdio auth uses `COS_TOKEN` env. HTTP auth uses `Authorization: Bearer cos_...` on every request. Every protected call is principal-scoped via kernel grants. No business logic here: delegate to api services and format results.

## Tools
- `ping` - no auth, returns "pong". Connectivity only.
- `whoami` - read-only; returns `{ principal: { id, name, kind }, grants: [{ scopePath, role }] }` for the authenticated principal.
- `get_context({scope})` - markdown context bundle for a scope. Viewer. Includes a Workbench section when the scope or nearest ancestor has one, with repo, folder, and MCP URL when configured.
- `verify_workbench({cwd, scope?})` - read-only warning helper; checks whether client cwd matches the expected workbench folder. Viewer when scope is explicit; otherwise uses the principal's single direct grant.
- `get_tree({scope?})` - indented subtree paths. Viewer.
- `log_change({scope, title, body_md, data?})` - create changelog. Editor/agent.
- `log_decision({scope, title, body_md, data?})` - create decision. Editor/agent.
- `save_report({scope, title, body_md, data?})` - create report. Editor/agent.
- `save_note({scope, title, body_md})` - create note. Editor/agent.
- `list_records({scope, kind?, since?, limit?})` - compact records list. Viewer.
- `get_record({id})` - full record. Viewer.
- `create_task({scope, title, description?, priority?, due_date?})` - create Plane-backed task. Editor/agent.
- `complete_task({scope, issue_id, note?})` - complete task; optional changelog note. Editor/agent.
- `update_task({scope, issue_id, title?, description?, state?, priority?, due_date?})` - partial task update. Editor/agent.
- `list_tasks({scope, state?, limit?})` - compact task list. Viewer.
- `write_metrics({scope, points})` - batch write/upsert metrics, max 1000. Editor/agent.
- `query_metrics({scope, metrics, from, to, groupBy?, filters?, agg?})` - query metric series. Viewer.
- `list_metric_names({scope})` - distinct metric names. Viewer.
- `register_capability({scopePath, name, engine, ...})` - register/update capability. Admin.
- `report_run({scopePath, name, status, ...})` - persist capability run, optional alert. Editor/agent.
- `list_alerts({scope, severity?, since?, limit?})` - alert events. Viewer.
- `list_capabilities({scope})` - scoped capabilities with latest run. Viewer.
- `list_capability_runs({scope, name, since?, limit?})` - runs for one capability. Viewer.
- `sync_skills({})` - refresh cached skills from GitHub. Root admin.
- `list_skills({scope, domain?})` - matching cached skills, no body. Viewer.
- `get_skill({name})` - one cached skill with body. Any valid principal.
- `save_dashboard({scope, name?, spec})`, `get_dashboard`, `list_dashboards`, `list_widget_types`, `revert_dashboard` - dashboard spec authoring. `list_widget_types` is public discovery; writes require editor/agent.
- `save_doc`, `get_doc`, `list_docs`, `list_doc_revisions`, `revert_doc` - KB markdown documents. Writes require editor/agent.
- `save_canvas`, `get_canvas`, `list_canvases` - Excalidraw scene JSON. Writes require editor/agent.

All protected tools: unauthenticated calls return a clear error. AccessDenied is surfaced as `Access denied: requires <role> on <path>`.

## Auth Model
- Stdio: token from `COS_TOKEN` at process start. Missing/bad/expired/revoked token still starts the server; protected tools return an auth error. `ping` remains unauthenticated.
- HTTP: mounted by `apps/os` at `/api/mcp`. Tokens are accepted only from the `Authorization` header. Query-string tokens are ignored. Missing/invalid/expired/revoked tokens return JSON 401 before MCP handshake.
- HTTP re-authenticates per request with kernel `authenticateToken`, so revocation affects the next request and `last_used_at` bumps on each accepted auth.
- Reads/writes are checked by api `requireAccess` (viewer read; editor/agent write). Subtree grants use the kernel ancestor walk.
- HTTP origin validation is configured by `MCP_ALLOWED_ORIGINS` (comma-separated) or derived from `MCP_PUBLIC_URL` / `COMPANYOS_URL`.
- HTTP body/rate guardrails: `MCP_MAX_BODY_BYTES`, `MCP_RATE_LIMIT_WINDOW_MS`, `MCP_RATE_LIMIT_MAX`.
- The v1 HTTP rate limiter is in-memory per process and keyed by token fingerprint; it is a guardrail, not distributed quota.

## Files
- `src/server.ts` - `createServer({db, principalId, mcpPublicUrl?})`, all tool registration with zod schemas + thin handlers. `get_context` delegates formatting to `@companyos/api`.
- `src/http.ts` - `createHttpHandler({db})`, standard Request/Response streamable HTTP wrapper with per-request bearer auth, origin/body/rate guardrails.
- `src/index.ts` - reexports `createServer`, `createHttpHandler`, and `ping`.
- `src/stdio.ts` - executable entry: reads `DATABASE_URL` + `COS_TOKEN`, auths, wires `StdioServerTransport`.
- `src/ping.test.ts` - in-memory and HTTP roundtrips with PGlite; tools, auth matrix, grants, revocation, `last_used_at`, token leak paths.
- `tsconfig.build.json` - emits to `dist/` (excludes tests).
- `package.json` - bin: `companyos-mcp` -> `dist/stdio.js`; workspace deps on api/db/sdk/zod.

## How To Run
1. Build: `pnpm --filter @companyos/mcp build` (or root `pnpm build`).
2. Stdio: `COS_TOKEN=cos_xxx DATABASE_URL=... companyos-mcp`, or root `pnpm mcp` after build.
3. Remote HTTP: configure an MCP client for `MCP_PUBLIC_URL` (normally `https://<domain>/api/mcp`) with `Authorization: Bearer cos_...`. Client machines do not need `DATABASE_URL`.

## How To Test
- `pnpm --filter @companyos/mcp test`
- Full: `pnpm test`
- Type/lint: `pnpm typecheck && pnpm lint`
- Roundtrips use SDK transports + PGlite (same migrate pattern as api).

Acceptance coverage:
- MCP tool roundtrips, including metrics, capabilities, skills, dashboards, docs, canvas, and `whoami`.
- Auth cases: agent write ok in subtree, denied out of subtree, viewer denied writes, null principal auth error.
- HTTP auth matrix: valid / invalid / revoked / expired / absent.
- HTTP revocation on next request, `last_used_at` bump, full `whoami -> get_context -> save_report` roundtrip.
- HTTP guardrails: header-only tokens, origin validation, request body cap, in-memory rate limiting, no token leak in error/log paths.

## Do Not
- No direct db writes or business logic.
- Never modify kernel schema or other modules' schemas.
- Do not change existing MCP tool signatures; additive tools only.
- Do not change stdio behavior except additive tool availability.
- Update this AGENTS.md on behavior change.

## Usage Notes For Agents
Use `get_context` at session start for scoped memory. Use `log_*` / `save_*` at end of work to persist. Always use full paths for scope. Prefer structured data in optional `data` for machine consumption alongside markdown bodies.
