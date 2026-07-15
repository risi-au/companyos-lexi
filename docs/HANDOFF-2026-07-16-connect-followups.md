# Handoff 2026-07-16: connect follow-ups (next session)

From: architect session that closed the #53/#56 arc and amended M11/M14 (#65).
State: main @ 97ea8d7, staging deployed and green through the #53 arc. Issue #53
CLOSED; issue #56 OPEN (relabeled — now tracks only the deferred remainder below).

Read first: ONBOARDING.md, docs/TRIP.md, docs/tasks/M11-external-integrations-overview.md
(the 2026-07-16 amendment banner + decision 12), docs/HANDOFF-2026-07-15-connect-oauth-prs.md
(how the arc landed + landmines).

## Pending owner items (not yours — do not start these)

- Staging OAuth smoke: connect Claude Code + ChatGPT via the wizard against staging.
  Last open checkbox in docs/tasks/FEAT-connect-oauth.plan.md and the "first
  checkpoint" gating M11. When the owner confirms it passed, tick that checkbox in a
  drive-by with your next PR.
- Three worktree husk directories in C:\dev (companyos-FEAT-connect-oauth-pr2/-pr3,
  companyos-FIX-drizzle-meta-guardrail) are held open by dead codex plugin app-server
  process trees; owner will kill + delete.

## Task 1 (small, UI-only): Connected-apps list in ConnectPanel

Finishes the user-visible half of M11 decision 12. The data layer is DONE and tested —
this is rendering, no schema or service changes.

- `listOAuthConnections` in `packages/api/src/modules/connect/service.ts` already
  returns the signed-in principal's OAuth connections (client name via oauthClient
  join, `firstUsedAt`, `lastUsedAt`, optional `since` filter; self-only, throws
  AccessDeniedError otherwise). Re-exported from `packages/api`.
- Add a "Connected apps" section to `apps/os/src/modules/connect/ConnectPanel.tsx`
  between the wizard card and the worker-tokens table: client name, first used, last
  used ("last seen"). Empty state: one muted line, not a card.
- Match the tokens table's visual conventions; date formatting helpers already exist
  in the panel. Server component fetch like the tokens list (see how ConnectPanel
  gets its data today).
- OUT of scope: per-app OAuth revoke (needs real refresh-token/consent revocation —
  separate task), sessions-started counts.
- Gate: `pnpm typecheck && pnpm lint && pnpm test` + Playwright browser check against
  the Docker dev DB (dev DB has OAuth connection rows from the wizard verification;
  verify-bot login recipe in docs/SUBAGENTS.md).
- TRIP size: small. Lane: codex gpt-5.5/medium is fine; self-implement also defensible.

## Task 2 (standard, coordinated): rename the timestamp migration (#56 remainder)

Kills the drizzle generate corruption at the source. Root cause (confirmed, documented
in packages/db/AGENTS.md + FIX-drizzle-meta-guardrail.plan.md addendum): drizzle-kit
sorts the timestamp-named `20260710083235_attention_items` snapshot above every `00NN`
prefix and uses it as the diff base, so every `pnpm db:generate` re-emits applied
objects and writes colliding prevIds; until renamed, every generate needs a manual
trim + prevId linearization.

Coordinated change set (one PR, but the DB row updates need owner approval per env):

1. Rename `packages/db/drizzle/20260710083235_attention_items.sql` to the next-free
   `00NN_attention_items` style prefix is WRONG — it must keep its journal position
   (idx between 0020 and 0021). Rename to a prefix that sorts there: check the journal;
   the tag is positional metadata, the filename prefix is what drizzle-kit sorts by.
   Safest: `0020a` is not valid — use the pattern drizzle expects (4-digit numeric).
   PLAN THIS CAREFULLY: options are (a) renumber it 0021 and shift 0021..0028 up by
   one, or (b) rename only the snapshot/journal tag keeping SQL applied-hash intact.
   `drizzle.__drizzle_migrations` stores hash + created_at, keyed by hash of SQL text —
   verify what the migrator actually compares (read
   node_modules/drizzle-orm/migrator source) BEFORE choosing. Do NOT trust this
   handoff's guess; verify against the installed drizzle-kit version.
2. Update `drizzle/meta/_journal.json` tag + `20260710083235_snapshot.json` filename
   and interior prevId links (0021's parent, the walk jump in
   `packages/db/src/meta-chain.test.ts` HISTORICAL_WALK_JUMPS keyed by that tag).
3. Update the `drizzle.__drizzle_migrations` rows on dev + staging DBs (owner-approved
   SQL, same approval pattern as the 0029/0030 applies this session).
4. Prove the fix: `pnpm --filter @companyos/db db:generate` with a trivial schema
   change produces a clean minimal diff with correct prevId, then revert the probe.
5. Trim the meta-chain test walk jump if the rename eliminates it.
6. Optionally then: historical snapshot rebuild for the 12 allowlisted missing
   snapshots (issue #56 checkbox 2) — separate PR, introspect/pull reconstruction;
   defer again if it balloons.

Landmines: packages/db/AGENTS.md (generate procedure), classifier blocks hand-edits
under drizzle/meta and dev-DB DDL — use AskUserQuestion for owner approval, precedent
exists from 2026-07-15. Every migration file must stay plain SQL, no DO $$.

## Process reminders

- TRIP: plan doc + brief per task, docs/tasks/. One PR per task, reference the issue
  (Task 1: reference #53 arc follow-up / M11; Task 2: closes nothing — tick the first
  #56 checkbox, leave the rebuild checkbox).
- Implementer lanes: codex/grok only (docs/SUBAGENTS.md); orchestrator commits.
  Stacked PRs: docs/ORCHESTRATION.md section 7 (merge bottom-up, base auto-delete).
- Gates green before review; fresh-session adversarial review for anything touching
  auth or migrations (Task 2 qualifies).
