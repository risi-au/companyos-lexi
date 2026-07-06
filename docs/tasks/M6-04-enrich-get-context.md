# M6-04: Enrich get_context (workbench location + MCP URL)

status: done — implemented 2026-07-06 by codex. get_context now shares one
getContextBundle formatter (server.ts's inline duplicate was refactored away),
gains a Workbench section (nearest-ancestor walk, sub-path aware) and threads
mcpPublicUrl through http.ts/stdio.ts boundaries (env read only at the boundary,
per constitution).
module: packages/api (context bundle) + packages/mcp (formatting only)
branch: task/M6-04

## Goal

An agent's session start has everything needed to orient: OS context PLUS where the work
lives on disk (workbench repo + folder) PLUS the MCP URL it is connected through. Removes
the "which repo/folder am I supposed to be in?" gap for terminal-first daily use.

## Context

- `getContextBundle` lives in `packages/api/src/agent.ts` (verified); MCP `get_context`
  formats the same bundle. Currently: identity, modules, children, skills, recent records.
  It does NOT include workbench info (verified — no workbench reference in agent.ts).
- `workbenches` table (provisioning module, verified): `scope_id` (unique), `repo`, `path`.
- `MCP_PUBLIC_URL` env from M6-01.
- M6-00 decision 8 half of the guard story: context tells the agent where it SHOULD be;
  M6-06 verifies where it IS.

## Do

1. Extend `getContextBundle` to include, when a workbench row exists for the scope (or the
   nearest ancestor with one — walk up, since sub-projects are folders inside the
   top-level repo):
   - `workbench.repo` (GitHub slug), `workbench.path` (folder within repo)
   - `mcp.publicUrl` (from env, injected by boundary per constitution — no process.env
     reads inside the service; follow the existing llmConfig injection pattern)
2. MCP `get_context` markdown gains a short "Workbench" section:
   "Repo: <org/repo> · Folder: <path> · Clone the repo and work inside this folder."
   plus the MCP URL line.
3. Keep the bundle token-budgeted — this adds ~3 lines, no new heavy queries (single
   workbench lookup with ancestor walk).

## Don't

- No changes to other get_context sections or their ordering (downstream consumers parse
  the markdown loosely — keep additive).
- No filesystem awareness here (that's M6-06 verify_workbench).
- No provisioning changes; read `workbenches` via its exported service/query only — no
  cross-module schema reach-ins beyond what constitution allows for reads via services.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] get_context for a scope with a workbench includes repo + path (tested)
- [x] Sub-scope without its own workbench row inherits the ancestor's repo with the
      correct sub-path (tested)
- [x] Scope with no workbench anywhere: section omitted cleanly (tested)
- [x] MCP roundtrip test asserts the new markdown section
- [x] agent module tests (system-prompt prefetch of get_context) still pass unchanged
