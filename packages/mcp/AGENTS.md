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
- `get_context({scope})` - markdown context bundle for a scope. Viewer. Includes a Workbench section when the scope or nearest ancestor has one, with repo, folder, and MCP URL when configured. Includes a Knowledge section (nearest ancestor wiki's doc index + owning scope path) when a `wiki` doc exists anywhere in the ancestor chain.
- `get_context({scope})` also includes root `critical-facts` in every context profile, capped by the API service.
- `recall_memory({query, scope?, limit?})` - query distilled wiki memory before external research or record trawling. Returns raw wiki/page snippets for the effective scope subtree plus root `critical-facts`/`pattern-*` pages only. No LLM synthesis and no grant widening.
- `search({scope, query, kinds?, limit?, mode?})` - keyword/semantic/hybrid search over records + docs in the scope subtree. Viewer. `mode` defaults to `hybrid`; semantic/hybrid fall back to keyword when embeddings are unavailable. Compact tab-delimited output with snippets.
- `verify_workbench({cwd, scope?})` - read-only warning helper; checks whether client cwd matches the expected workbench folder. Viewer when scope is explicit; otherwise uses the principal's single direct grant.
- `register_session({scope, title, engine, model?, token_id?, worktree_ref?, brief?})` - register a cooperative scoped work session; now accepts optional `brief` (goal, contextRefs, kickoffArtifactRef, expectedReturn). Editor/agent.
- `update_session({session_id, status?, title?, worktree_ref?})` - heartbeat or update a session. Bare calls bump heartbeat only. Editor/agent on the session scope.
- `get_session({session_id})` - retrieve a single session by ID (full record including brief, structured return, citations). Viewer on the session scope.
- `complete_session({session_id, summary?, citations?, structured_return?})` - mark a session completed, store wrap-up summary/citations/structured return, and emit wrap-up event; now accepts optional `structured_return` (outcome, artifacts, recordsLogged, humanInterventions, friction, followUps). External tools should cite wiki pages that informed the session. Editor/agent on the session scope.
- `list_sessions({scope, status?, include_descendants?, idle_window_ms?, limit?})` - list scoped sessions with read-time stale flags. Viewer.
- `query_usage({scope?, since?, group_by?, operation?, session_id?, principal_id?, token_id?, connection_id?, limit?})` - admin-gated usage summaries for estimated CompanyOS MCP/context overhead. Returns grouped rows and recent redacted events.
- `get_context_profile({scope})` - admin-gated effective context profile for a scope.
- `set_context_profile({scope, name, preset?, config?, is_default?})` - admin-gated context profile create/update. Presets: lean, standard, deep. Emits `usage.profile_updated` in the API service.
- `list_credentials({scope})` - credential metadata only: names, descriptions, set/updated timestamps, last-accessed timestamps. Viewer.
- `get_credential({scope, name})` - returns one vault value to agent/editor/admin/owner principals and emits `credential.accessed`. Never use it to store or echo values into records, docs, tasks, logs, or usage metadata.
- `get_tree({scope?})` - indented active subtree paths; archived scopes are omitted from normal navigation output. Viewer.
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
- `submit_intake_packet({intake_id?, scope?, paste_text?, packet?})` - external intake return path for existing scopes/intakes. Editor/agent on scope; validates paste-back JSON or accepts markdown-only.
- `list_intake_packets`, `get_intake_packet`, `update_intake_packet` - intake queue and pre-approval edits. Viewer for reads; editor/agent for update.
- `approve_intake_packet`, `provision_from_intake_packet` - admin-gated and explicitly described as requiring human instruction; approval does not provision, provisioning calls the API `provisionFromIntakePacket` path.
- `save_dashboard({scope, name?, spec})`, `get_dashboard`, `list_dashboards`, `list_widget_types`, `revert_dashboard` - dashboard spec authoring. `list_widget_types` is public discovery; writes require editor/agent.
- `save_doc`, `get_doc`, `list_docs`, `list_doc_revisions`, `revert_doc` - KB markdown documents. Writes require editor/agent.
- `rename_doc`, `archive_doc`, `get_backlinks`, `get_link_graph` - wiki gardening tools for agents. Rename/archive require editor/agent; backlinks/link graph require viewer. They delegate to docs services and rely on existing doc link/event upkeep.
- `save_canvas`, `get_canvas`, `list_canvases` - Excalidraw scene JSON. Writes require editor/agent.

`list_attention_items` returns additive plain-language labels and a structured summary
for wiki questions. `resolve_attention_item` requires a non-empty `note` when approving
an `open_question`; the note is the answer and is written into the resulting decision
record. It cannot resolve any `lint_finding` item. Use `resolve_wiki_question` for wiki
questions: `choose` with `choice_id` first/second, `not-a-conflict` with an explanatory
`note`, `mark-current` with
a future `next_review_at`, or `close-unclear` for older/malformed checks only. Other
attention kinds keep their existing optional-note behavior.

All protected tools: unauthenticated calls return a clear error. AccessDenied is surfaced as `Access denied: requires <role> on <path>`.

## Auth Model
- Stdio: token from `COS_TOKEN` at process start. Missing/bad/expired/revoked token still starts the server; protected tools return an auth error. `ping` remains unauthenticated.
- HTTP: mounted by `apps/os` at `/api/mcp`. Tokens are accepted only from the `Authorization` header. Query-string tokens are ignored. Missing/invalid/expired/revoked tokens return JSON 401 before MCP handshake.
- HTTP re-authenticates per request with kernel `authenticateToken`, so revocation affects the next request and `last_used_at` bumps on each accepted auth.
- Reads/writes are checked by api `requireAccess` (viewer read; editor/agent write). Subtree grants use the kernel ancestor walk.
- HTTP origin validation is configured by `MCP_ALLOWED_ORIGINS` (comma-separated) or derived from `MCP_PUBLIC_URL` / `COMPANYOS_URL`.
- HTTP body/rate guardrails: `MCP_MAX_BODY_BYTES`, `MCP_RATE_LIMIT_WINDOW_MS`, `MCP_RATE_LIMIT_MAX`.
- The v1 HTTP rate limiter is in-memory per process and keyed by token fingerprint; it is a guardrail, not distributed quota.
- Remote HTTP tool calls log redacted usage events by default. `USAGE_LOG_MCP_HTTP=0` disables HTTP usage logging and `USAGE_SAMPLE_RATE` can sample noisy environments. Logging is fail-open and never stores raw request/response bodies or bearer tokens.

## Files
- `src/server.ts` - `createServer({db, principalId, mcpPublicUrl?})`, all tool registration with zod schemas + thin handlers. `get_context` delegates formatting to `@companyos/api`; session tools delegate to the sessions module.
- `src/http.ts` - `createHttpHandler({db})`, standard Request/Response streamable HTTP wrapper with per-request bearer auth, origin/body/rate guardrails, and redacted fail-open usage logging.
- `src/index.ts` - reexports `createServer`, `createHttpHandler`, and `ping`.
- `src/stdio.ts` - executable entry: reads `DATABASE_URL` + `COS_TOKEN`, auths, wires `StdioServerTransport`.
- `src/ping.test.ts` - in-memory and HTTP roundtrips with PGlite; tools, auth matrix, grants, revocation, credential tool access, `last_used_at`, token leak paths.
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
- MCP tool roundtrips, including metrics, capabilities, skills, dashboards, docs, canvas, credentials, and `whoami`.
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
Use `get_context` at session start for scoped context, then `recall_memory` before external research or broad record trawling. Use `log_*` / `save_*` at end of work to persist. Always use full paths for scope. Prefer structured data in optional `data` for machine consumption alongside markdown bodies.


M10-04B: list_attention_items, esolve_attention_item, and get_context rely on the attention service target-principal filter. page_update attention items are visible only to their target principal and are dismiss-only over MCP; no follow/unfollow MCP tools are exposed.


## OAuth HTTP auth (FEAT-connect-oauth-pr1)
- The mounted /api/mcp handler accepts either the existing cos_ token lane or an OAuth access-token lane supplied by apps/os; MCP tool signatures remain unchanged.
- Auth callbacks may attach wwwAuthenticate to a 401 error. The HTTP wrapper forwards it as WWW-Authenticate, enabling RFC 9728 protected-resource discovery without changing JSON error bodies.
- Stdio continues to use COS_TOKEN; user-facing MCP configuration errors use COMPANYOS_TOKEN as the canonical provisioning variable.


## Arming ritual (M11-01)
- The server advertises `instructions` on the MCP `initialize` handshake (the exported
  `SERVER_INSTRUCTIONS` in `src/server.ts`): the start→work→wrap ritual plus the
  memory-subordination doctrine. Every connecting client is armed in-band.
- Two MCP prompts (additive): `start_task({scope, goal?})` renders the arming sequence,
  and `wrap_up({session_id})` renders the debrief sequence. Prompt args are string-typed
  per the MCP prompt contract; the callbacks return static guidance text (no db, no auth).
- Full tool inventory + per-client conformance matrix: `docs/tasks/M11-01-tool-surface-audit.md`.
