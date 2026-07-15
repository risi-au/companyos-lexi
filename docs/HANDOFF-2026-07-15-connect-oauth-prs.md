# Handoff 2026-07-15 (evening): FEAT-connect-oauth PR2+PR3 + drizzle guardrail

## Session outcome (all delivered, owner merges)

| PR | What | State |
|---|---|---|
| #58 | FIX-drizzle-meta-guardrail: meta chain-consistency test + AGENTS rule (issue #56; rebuild deferred) | open, gates green |
| #59 | FEAT-connect-oauth PR2: connect wizard (platform picker, OAuth-first, live verify) | open, gates green, security-reviewed, browser-verified |
| #60 | FEAT-connect-oauth PR3: truthful token status + expiry bell items — **closes #53** | open (base = PR2 branch), gates green, reviewed, browser-verified |

Merge order: #59 -> #60 (stacked; GitHub retargets #60 to main when the PR2 branch is
deleted on merge). #58 independent. After #60 merges, #58's now-stale
`HISTORICAL_DUPLICATE_PARENTS` allowance + `0028` walk jump can be trimmed in a follow-up
(harmless if left).

## Key discoveries (documented in these PRs)

- **Drizzle rot root cause** (issue #56 comment): `drizzle-kit generate` diffs against the
  timestamp-named `20260710083235` snapshot (sorts above `00NN`), re-emitting applied
  objects + colliding prevIds on EVERY generate. Procedure until renamed: trim the .sql,
  linearize the new snapshot's prevId (packages/db/AGENTS.md in #58).
- **0028 prevId repaired** (owner-approved, in #59) — `db:generate` was hard-broken before it.
- Sandbox/dispatch learnings -> docs/SUBAGENTS.md + scripts/dispatch-codex.ps1 in this branch.

## Loose ends

- Dev DB (local Docker) has migrations 0029+0030 applied (owner-approved) and one
  leftover demo token "root MCP" in root scope showing Expired (harmless demo data;
  its expiry attention item was dismissed during verification).
- Feature-level acceptance still pending after merges: staging smoke — connect Claude
  Code + ChatGPT via OAuth end-to-end (plan checkbox).
- verify-bot dev password currently matches the recipe run of this session.

## Worktrees

- C:/dev/companyos-FIX-drizzle-meta-guardrail (task/FIX-drizzle-meta-guardrail, pushed)
- C:/dev/companyos-FEAT-connect-oauth-pr2 (task/FEAT-connect-oauth-pr2, pushed)
- C:/dev/companyos-FEAT-connect-oauth-pr3 (task/FEAT-connect-oauth-pr3, pushed)
- C:/dev/companyos-docs-retro (this branch)
- C:/dev/companyos-FEAT-connect-oauth-pr1 can be removed (PR1 merged)
