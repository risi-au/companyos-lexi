# M1-05: MCP server v1 (context + records tools)
status: todo
module: mcp
branch: task/M1-05

## Goal
A running MCP server any agent (Claude Code, Grok, Cursor) can connect to over stdio, authenticate with a `cos_` token, and use to read scoped context and write records. This is the OS's front door, v1.

## Context
- `docs/DESIGN.md` §6 (MCP contract). Only the Context and Records tool groups in this task — tasks/docs/dashboards/metrics tools come with their modules.
- `packages/mcp` has a stub `createServer()` with a ping tool; `@modelcontextprotocol/sdk` is installed.
- Kernel services (auth, access, scopes, events) and records services are merged. The MCP layer must be THIN: parse args → call `packages/api` services → format result (CONSTITUTION §2). No business logic in tool handlers.
- Auth: the connecting process supplies a token via `COS_TOKEN` env var (stdio transport). On startup, authenticate it (kernel `authenticateToken`) → principal; every tool call runs as that principal. Unauthenticated → server starts but every tool returns an auth error.
- DB: postgres-js via `DATABASE_URL`. For tests, inject PGlite (createServer accepts a db handle).

## Do
1. Rework `packages/mcp/src/server.ts`: `createServer({db, principalId})` registering tools (zod schemas, clear descriptions written FOR agent consumers):
   - `get_context({scope})` → markdown-formatted bundle: scope name/path/type/status, its module list, children paths, last 10 changelog/decision records (title + first 200 chars + date), pointer text "use list_records / get_record for more". Requires viewer.
   - `get_tree({scope?})` → subtree as indented text with paths (default root). Viewer.
   - `log_change({scope, title, body_md, data?})` → creates changelog record; returns id + confirmation. Editor/agent.
   - `log_decision({scope, title, body_md, data?})` → decision record. Editor/agent.
   - `save_report({scope, title, body_md, data?})` → report record. Editor/agent.
   - `save_note({scope, title, body_md})` → note record. Editor/agent.
   - `list_records({scope, kind?, since?, limit?})` → compact list (id, kind, title, date). Viewer.
   - `get_record({id})` → full record with body. Viewer.
   - Keep `ping` (no auth) for connectivity checks.
2. Access errors from kernel surface as clear tool errors ("Access denied: requires editor on airbuddy/meta-ads"), never crashes.
3. Executable entry `packages/mcp/src/stdio.ts` (built to `dist/stdio.js`): connects postgres-js using `DATABASE_URL`, authenticates `COS_TOKEN`, serves stdio transport. Add `bin` field (`companyos-mcp`) and a root convenience script `pnpm mcp`.
4. Tests using the MCP SDK's in-memory client/server transport + PGlite: full round-trip for every tool (seed scope tree + principals + records first); auth: agent token can log_change in its subtree, denied outside; viewer token cannot write; bad/expired token → auth error on tool call; get_context contains expected sections.
5. Update `packages/mcp/AGENTS.md` (module doc: tools, auth model, how to run + test).

## Don't
- No HTTP transport yet (needs deployment context — later task). No tasks/docs/dashboards/metrics tools. No provisioning tools.
- No business logic in handlers — anything nontrivial belongs in `packages/api`.
- Don't touch apps/, kernel schema, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] In-memory MCP round-trip tests cover all 9 tools incl. auth-denied cases
- [ ] `get_context` output includes scope identity, modules, children, recent records (verified by assertion)
- [ ] Tool handlers contain no business logic beyond arg parsing + service calls + formatting
- [ ] `packages/mcp` builds an executable stdio entry with bin field; README-level run instructions in module AGENTS.md
