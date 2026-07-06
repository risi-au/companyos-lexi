# M6-06: verify_workbench MCP tool (wrong-folder guard)

status: done — implemented 2026-07-07 by codex. verifyWorkbench lives in
packages/api/src/agent.ts alongside findNearestWorkbench (now exported, no
duplicated ancestor-walk); segment-exact suffix matching (not naive substring)
handles Windows/POSIX cwd separators and drive letters. New MCP tool is
additive, read-only, never blocks other tool calls.
module: packages/api (`connect` or context — architect's call at dispatch) + packages/mcp
branch: task/M6-06

## Goal

A cheap hard(ish) guard against the "meta-ads token, google-ads folder" mistake: an agent
passes its cwd and the tool says whether the filesystem location matches the token's
scope workbench. Warn-level by design — policy enforcement lives in AGENTS.md
instructions, not in blocking valid MCP calls.

## Context

- M6-04 put expected workbench (repo + path, ancestor-walked) into the context bundle —
  reuse that resolution logic; do not duplicate it.
- M6-05 put "call verify_workbench after get_context when doing file work" into the
  managed AGENTS.md.
- MCP cannot detect client cwd itself — the agent must pass it (Claude Code exposes
  CLAUDE_PROJECT_DIR; other tools have equivalents; the AGENTS.md checklist tells agents
  to pass it).
- M6-00 decision 8; architect ratified: **warn in tool result, hard policy in AGENTS.md**
  — the tool never blocks other MCP calls.

## Do

1. Service function (reuses M6-04's workbench resolution): given `{ cwd, scopePath? }`
   (scopePath defaults to... the principal's single granted scope when unambiguous —
   Connect-minted principals have exactly one grant; error asking for explicit scopePath
   if ambiguous):
   - Resolve expected `{ repo, path }` for the scope.
   - Normalize + compare: does `cwd` end with (or contain as a suffix segment-wise) the
     expected `path`? Handle Windows and POSIX separators — daily driver is Windows.
   - Return `{ ok: true }` or
     `{ ok: false, expectedRepo, expectedPath, message: "<actionable one-liner>" }`.
   - No workbench configured for the scope → `{ ok: true, note: "no workbench registered" }`
     (absence of config is not a violation).
2. MCP tool `verify_workbench({ cwd, scope? })` (additive): thin wrapper, viewer-level
   (any valid principal — it reads nothing sensitive beyond workbench mapping).
3. Read-only: no events (constitution requires events on WRITES; this writes nothing).

## Don't

- Don't block or gate any other MCP tool on verification state.
- Don't try to auto-detect cwd server-side; the client supplies it.
- Don't duplicate M6-04's ancestor-walk logic — extract/share within the owning module.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [x] Mismatch detected: google-ads cwd + meta-ads scope → ok:false with expected
      repo/path (tested)
- [x] Match passes, including Windows-style path separators (tested both separators)
- [x] Single-grant principal needs no explicit scope arg; multi-grant principal without
      scope arg gets a clear error (tested)
- [x] Scope without workbench → ok:true with note (tested)
- [x] MCP roundtrip test for the tool; other tools unaffected by ok:false
- [x] packages/mcp AGENTS.md tool list updated
