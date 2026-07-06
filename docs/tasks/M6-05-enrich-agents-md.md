# M6-05: Enrich managed AGENTS.md template (operational playbook)

status: done — implemented 2026-07-06 by codex. renderManagedSection gains all
seven playbook elements (MCP connection incl. MCP_PUBLIC_URL, session-start
checklist, session-end handover, worktree convention, folder guard degrading
gracefully pre-M6-06, verbatim memory-precedence block) while staying fully
deterministic (existing no-op re-provision test still passes).
module: packages/api/src/modules/provisioning (agents-md.ts)
branch: task/M6-05

## Goal

Every provisioned/synced workbench AGENTS.md carries an operational playbook — connection
info, session-start checklist, session-end ritual, worktree convention, folder guard — not
just the scope path. This is where agent behavior policy lives (NOT in tokens; M6-00
mental model).

## Context

- `agents-md.ts` (verified): `renderManagedSection` renders between
  `<!-- companyos:managed:start/end -->` markers; marker-preserving updater keeps human
  content byte-for-byte (existing test). Line 27 currently prints
  `CompanyOS MCP endpoint: ${baseUrl}/api/mcp` from `COMPANYOS_URL` — after M6-01 this URL
  is REAL; switch it to `MCP_PUBLIC_URL` (which defaults to the same value) for
  consistency with the rest of M6.
- M6-00 decisions 7 (no auto wrap-up — the ritual is instructions), 8 (folder guard
  policy), 9 (repo layout), 10 (token lives in env after first mint).
- M6-06 will add the `verify_workbench` tool the checklist references — write the
  checklist text so it degrades gracefully if the tool doesn't exist yet ("if available").

## Do

Expand `renderManagedSection` (managed block only) to include:

1. **MCP connection**: `MCP_PUBLIC_URL` value; the token env var convention (e.g.
   `COS_TOKEN` or per-scope variant — pick one convention and document it); "if missing or
   expired, mint at Connect to MCP on this scope's page in the OS".
2. **Session start checklist**: `whoami` → `get_context(<scope>)` → if MCP unreachable or
   auth fails: STOP and tell the user — never proceed on assumed OS state.
3. **Session end / handover**: `log_change` incrementally during work; on wrap-up
   `complete_task` + `log_decision` where applicable; **if the work changed standing
   truth, update the affected wiki topic page via `save_doc`** (rules in
   docs/patterns/WIKI.md — update in place, cite record ids). Durable state lives in the
   OS, not the chat transcript.
4. **Git worktree convention**: one worktree per parallel agent on the same sub-project,
   named `<scope-slug>/<session-slug>`; merge via PR to main.
5. **Folder guard**: "your cwd must be under `<workbench.path>`; if it isn't, stop and ask
   the user. Call `verify_workbench` (if available) after get_context when doing file work."
6. Endpoint line switched to `MCP_PUBLIC_URL` per Context.
7. **Memory precedence** (verbatim block — this is what stops vendor-tool memory from
   overriding OS truth when working across many clients in Claude/ChatGPT/etc.):
   ```
   ## Memory precedence
   - CompanyOS (get_context, list_records, tasks, docs) = authoritative for all
     client/scope facts.
   - Vendor memory (Claude/OpenAI) = personal preferences only.
   - On conflict: follow CompanyOS; log_decision if the OS record should be updated.
   - Never assume vendor memory knows the current scope — always call get_context at
     session start.
   ```

Re-render happens through the existing provisioning sync path — no new sync mechanism.

## Don't

- Don't touch content outside the managed markers (existing preservation test must pass
  unchanged).
- Don't implement verify_workbench here (M6-06); don't change provisioning orchestration.
- Don't put tokens or secrets in the rendered markdown — env var NAMES only.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] Fresh provision renders the enriched managed block (all seven elements asserted,
      including the memory-precedence block verbatim)
- [x] Re-provision updates ONLY the managed section; human content preserved
      byte-for-byte (existing test still green)
- [x] No secret values in output — env var names only (tested)
- [x] Endpoint line uses MCP_PUBLIC_URL
- [x] provisioning AGENTS.md updated in the same change set
