# FEAT-connect-oauth: Seamless MCP connect — OAuth provider, wizard, live status

status: done (2026-07-15; staging OAuth smoke = last open checkbox, owner)
type: feature
issue: #53
module: multi (kernel-adjacent auth + connect + attention)
branch: task/FEAT-connect-oauth-pr1 (PR 1; PR 2/3 branch later)
size: heavy
triage: orchestrate

> TRIP plan. No production code in this file -- design and checklists only.
> Owner approval: Rishi, 2026-07-15 (architecture: better-auth OAuth provider in-process;
> model: mid lane gpt-5.6-terra/high + mandatory adversarial security review; 3 sequential PRs).

## Overview

Users connect any AI platform (Claude Code/Desktop/web, Cursor, VS Code, Codex, ChatGPT,
Gemini CLI) to CompanyOS MCP without ever seeing a raw token: CompanyOS itself becomes an
MCP-spec OAuth 2.1 authorization server (better-auth `@better-auth/oauth-provider` plugin),
platforms self-register and open a browser consent screen, and the existing `cos_` static
tokens remain a fallback lane for headless workers and unsupported platforms. A connect
wizard replaces the snippet wall, and token/connection health becomes visible (derived
status + expiry notifications).

## Problem Statement

1. The post-mint snippet wall is vague and error-prone; installing the token into Codex on
   Windows fails intermittently (documented upstream bugs: openai/codex#4180, #24362, #6465 —
   env vars stripped from launched processes; CLI config not seen by IDE extension).
2. ChatGPT connectors **cannot** send custom bearer headers at all, and claude.ai / Claude
   Desktop per-user connectors have no bearer field — the current design can never reach
   those surfaces. OAuth per the MCP authorization spec is the only universal path.
3. Raw tokens are displayed on screen even when the platform could authenticate without one.
4. An expired token still shows "Active" in the token table; expiry/disconnection raises no
   notification (original #53 ask).

## Research base (2026-07-15, web-verified with sources in issue #53 thread)

- Current MCP spec revision **2025-11-25**: server MUST serve RFC 9728 protected-resource
  metadata, SHOULD send `WWW-Authenticate` on 401; AS must be OAuth 2.1, PKCE S256 only,
  SHOULD support DCR (RFC 7591); CIMD is the new recommended registration mechanism.
- All target clients support MCP OAuth; ChatGPT and claude.ai/Desktop **require** it.
- `@better-auth/oauth-provider@1.6.23` (MIT, same vendor as our auth) exists for exactly our
  installed better-auth version: DCR incl. unauthenticated public-client registration for
  MCP agents, JWT access tokens via `jwt()` plugin + JWKS, consent-page hooks, and an MCP
  route-protection helper. In-process — no new service. better-auth 1.7 (RC) will rename
  tables (`oauthApplication` → `oauthClient`); we accept a later mechanical migration.
- Gateways (MetaMCP, IBM ContextForge, Keycloak, Ory Hydra) all mean a second deployment —
  rejected (lean ladder rung 4: use the installed dependency's ecosystem).
- Spec permits dual-mode: same `Authorization: Bearer` header can carry either an OAuth JWT
  or a legacy `cos_` token; clients configured with static headers never see the 401.
- Live verification is nearly free: token auth already bumps `lastUsedAt` per request.

## Solution Architecture (3 PRs)

### PR 1 — OAuth foundation (this plan's file-level detail; brief: FEAT-connect-oauth-pr1-brief.md)

- better-auth gains `oauthProvider` (+ `jwt`) plugins → CompanyOS serves AS metadata, DCR,
  authorize/token endpoints, consent page at a first-party route.
- `/api/mcp` accepts OAuth access tokens (JWT, audience-checked for the MCP resource) OR
  legacy `cos_` tokens; missing/invalid auth → 401 + `WWW-Authenticate: Bearer
  resource_metadata="…"` so OAuth-capable clients auto-discover.
- RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource` (+
  `/api/mcp`-suffixed variant Claude probes first), CORS-enabled.
- Principal mapping: OAuth `sub` = better-auth user id → `principals.authUserId` → existing
  human principal + its grants. No new god-keys; agents minted via tokens stay scoped agent
  principals. (Assumption flagged to owner: an OAuth connection acts as the authorizing
  user, with that user's grants.)
- Consent approval emits a kernel event (`connection.authorized`) — every write emits an event.
- Env-var naming consistency: canonicalize on `COMPANYOS_TOKEN` (provisioning already uses
  it); fix the divergent `COS_TOKEN` copy in packages/mcp error text.

### PR 2 — Connect wizard (detailed 2026-07-15 after PR 1 merge; brief: FEAT-connect-oauth-pr2-brief.md)

- ConnectPanel restructured: a "Connect a platform" wizard card on top (3-step shared
  `Stepper`: **Platform → Set up → Verify**), the existing worker-tokens table below
  (table unchanged in PR 2; truthful status is PR 3).
- Platform catalog (7 entries, `platforms.ts`, pure + unit-testable): Claude Code,
  Claude Desktop / claude.ai web, Cursor, VS Code, Codex, ChatGPT, Gemini CLI. Each:
  label, ordered OAuth setup steps, one-click deeplink builder where the platform has one
  (Cursor `install-mcp` link, `vscode:mcp/install`), copyable one-liners elsewhere
  (`claude mcp add`, `codex mcp add`, `gemini mcp add`, connector-UI steps for
  ChatGPT/Claude web), plus a token-lane variant of the same instructions.
- **OAuth-first**: default lane never mints or shows a token — just the MCP URL +
  deeplink/command; the browser consent flow (PR 1) does the auth. The raw-token lane
  appears only behind an explicit "Use a worker token instead" action and reuses the
  existing mint form + snippet builders.
- **Live verify — OAuth lane needs a first-call signal that does not exist yet**: OAuth
  JWT verification is local (JWKS); `oauth_access_token` rows prove issuance, not use.
  New module-owned table `oauth_connections` (connect module — NOT a hand-edit of
  better-auth plugin tables, which 1.7 renames): unique `(oauth_client_id, principal_id)`,
  `first_used_at`, `last_used_at`. `agent-auth.ts` touches it (upsert) after each
  successful OAuth MCP authentication, non-fatal on failure. Insert emits
  `connection.first_used`; subsequent `last_used_at` bumps are bookkeeping (same
  precedent as kernel `tokens.last_used_at` — no event).
- Wizard verify step polls a server action (interval ≥3s, stops on unmount/step change,
  ~2 min soft timeout with troubleshooting hints):
  - OAuth lane: `oauth_connections` row for the signed-in principal with
    `first_used_at >=` wizard start → "Connected ✓" + client name.
  - Token lane: minted `tokenId` in `listConnectionTokens` gets non-null `lastUsedAt`.

### PR 3 — Status + notifications (original #53 core; detailed 2026-07-15; brief: FEAT-connect-oauth-pr3-brief.md)

Branch stacks on `task/FEAT-connect-oauth-pr2` (shares ConnectPanel + connect service +
a linear migration chain); PR opens with that base and retargets `main` when PR 2 merges.
Closes #53.

- **Truthful derived status** in `listConnectionTokens`: server-side `status` field with
  precedence `revoked` > `expired` (`expiresAt < now`) > `never_used` (`lastUsedAt` null)
  > `active`. UI: `labelForConnectionStatus` takes the derived status; ConnectPanel
  status cell renders it (tokens only — muted for never-used, destructive for
  expired/revoked).
- **New attention kind `connection_expiry`** (enum value add migration; payload
  `{ tokenId, name, scopePath, state: "expiring" | "expired", expiresAt }`).
- **Sweep, no cron infra**: internal connect-module service
  `ensureConnectionExpiryAttention(db)` — for each non-revoked connection token expired
  or expiring within 7 days, ensure exactly one open `connection_expiry` item on the
  token's scope (dedupe on open item + `payload.tokenId`). `created_by` = the token's
  `minted_by` principal via an internal attention insert that skips grant checks but
  still emits `attention.created`. State transition expiring→expired = dismiss old +
  create new (existing event types only). Trigger: bell's
  `refreshNotificationsAction` calls the sweep behind an in-process ≥5-min throttle
  (bell already polls every 60s per active user; idempotent so multi-caller safe).
- **Auto-clean**: `revokeConnectionToken` dismisses that token's open
  `connection_expiry` items (note "token revoked").
- **Bell + card**: `NotificationBell` adds the kind label and deep-links
  `connection_expiry` items to `/s/<scopePath>?tab=connect` (other kinds keep
  `?tab=overview`); `AttentionCard` renders the kind with a Dismiss affordance
  (admin/owner), no approve/reject.

## Files to modify (PR 1)

| Path | Change |
|---|---|
| `apps/os/package.json` | add `@better-auth/oauth-provider` (orchestrator pre-installs) |
| `apps/os/src/lib/auth.ts` | oauthProvider + jwt plugin config, login/consent page paths, env-driven baseURL/trustedOrigins |
| `packages/db/src/schema/*` (auth schema) | plugin tables (read exact shape from installed plugin), drizzle migration via generate |
| `apps/os/src/app/.well-known/...` | AS metadata + protected-resource metadata routes, CORS |
| `apps/os/src/app/(app or auth)/oauth/consent/...` | minimal consent page using existing UI primitives |
| `apps/os/src/lib/agent-auth.ts` | dual-mode bearer auth (cos_ → legacy path; else OAuth JWT verify + audience + principal map) |
| `packages/mcp/src/http.ts` | 401 responses carry `WWW-Authenticate` with resource metadata URL (additive; MCP tool contract untouched) |
| `packages/api` (connect or kernel) | consent → kernel event emission; principal lookup helper reuse |
| tests near code + `packages/api` | dual-mode auth, PRM route shape, principal mapping, audience rejection |
| module `AGENTS.md`s (apps/os, packages/mcp, connect) | contract updates in same change set |

## Files to modify (PR 2)

| Path | Change |
|---|---|
| `packages/db/src/schema/connect.ts` | `oauth_connections` table + row type |
| `packages/db/drizzle/*` | generated migration (`pnpm --filter @companyos/db db:generate`; meta chain clean from 0028) |
| `packages/api/src/modules/connect/service.ts` | `touchOAuthConnection` (upsert + first-use event), `listOAuthConnections` (self view) |
| `packages/api/src/modules/connect/connect.test.ts` | upsert idempotency, event-emitted-once, self-visibility tests |
| `packages/api/src/index.ts` (exports) | re-export new services |
| `packages/api/src/modules/connect/AGENTS.md` | OAuth-connection tracking contract |
| `apps/os/src/lib/agent-auth.ts` | touch oauth connection on successful OAuth MCP auth (non-fatal) |
| `apps/os/src/modules/connect/platforms.ts` (+ `platforms.test.ts`) | platform catalog + deeplink/snippet builders (pure functions) |
| `apps/os/src/modules/connect/ConnectWizard.tsx` | wizard client component (shared `Stepper`) |
| `apps/os/src/modules/connect/ConnectPanel.tsx` | compose wizard + keep tokens table/mint/revoke |
| `apps/os/src/modules/connect/actions.ts` | `getOAuthConnectionStatusAction` poll action |
| `apps/os/src/modules/connect/AGENTS.md`, `apps/os/AGENTS.md` | contract updates |

## Files to modify (PR 3)

| Path | Change |
|---|---|
| `packages/db/src/schema/attention.ts` | `connection_expiry` enum value + type unions |
| `packages/db/drizzle/*` | generated enum-add migration (linear after PR 2's) |
| `packages/api/src/modules/connect/service.ts` | derived `status` in `listConnectionTokens`; `ensureConnectionExpiryAttention`; revoke auto-dismiss |
| `packages/api/src/modules/attention/service.ts` | internal no-actor insert/dismiss helpers (events still emitted) |
| `packages/api/src/modules/{connect,attention}/*.test.ts` | status matrix, sweep idempotency + transition, revoke cleanup |
| `packages/api/src/modules/{connect,attention}/AGENTS.md` | contract updates |
| `apps/os/src/lib/labels.ts` | `labelForConnectionStatus(status)` for 4 states |
| `apps/os/src/modules/connect/ConnectPanel.tsx` | status cell uses derived status |
| `apps/os/src/app/(app)/_components/notification-actions.ts` | throttled sweep call |
| `apps/os/src/app/(app)/_components/NotificationBell.tsx` | kind label + connect-tab deep-link |
| `apps/os/src/modules/attention/AttentionCard.tsx` (+ `AGENTS.md`) | render + dismiss for the new kind |

## Test impact

- New: dual-mode auth unit tests (legacy token ok; OAuth JWT ok; wrong audience 401; no
  header → 401 with WWW-Authenticate), PRM metadata route test, consent event emission test.
- Gate: `pnpm typecheck && pnpm lint && pnpm test` from repo root.

## Don't

- Touch: USER DATA/, legacy/, .env*, vps-login.txt
- Drive-by refactors outside this plan; no changes to existing MCP tool signatures
- Hand-edit drizzle/meta/_journal.json
- Ship OAuth without audience validation or with PKCE plain allowed

## Phased to-dos

- [x] PR 1: OAuth foundation (brief dispatched to codex gpt-5.6-terra/high)
- [x] PR 1: gates green, adversarial security review (fresh session), owner merged (#55)
- [ ] Staging smoke: connect Claude Code + ChatGPT connector via OAuth end-to-end (owner)
- [x] PR 2: wizard plan + brief + dispatch — merged (#59), security review fixes in
- [x] PR 3: status/notifications plan + brief + dispatch — merged (#62; re-landed after
      #60 hit the stacked base branch, see ORCHESTRATION §7)
- [x] Module AGENTS.md updated each PR

## Acceptance criteria (feature-level)

- [x] A user can connect Claude Code, Cursor, VS Code, Codex, ChatGPT, claude.ai to the
      CompanyOS MCP server without ever copying a raw token (OAuth consent flow).
      Verified in dev end-to-end; staging smoke against real clients is the owner's
      remaining checkbox.
- [x] Legacy `cos_` tokens keep working unchanged (headless workers, unsupported platforms).
- [x] Wizard guides platform-specific setup and ends with a live "Connected" confirmation
      (browser-verified: OAuth poll flips to Connected on first authenticated call).
- [x] Token/connection lists show truthful derived status; expiry raises a bell notification
      (browser-verified against the dev DB with a demo Expired token).

## Finish report (filled 2026-07-15)

- Files changed: per the three per-PR tables above — PR1 #55 (OAuth AS + dual-mode auth +
  well-known routes + consent), PR2 #59 (platforms.ts catalog, ConnectWizard, ConnectPanel
  restructure, oauth_connections + migration 0029, touchOAuthConnection), PR3 #62
  (derived status, connection_expiry kind + migration 0030, sweep + throttle, bell
  deep-link, AttentionCard render, labelForConnectionStatus). Session handoff:
  docs/HANDOFF-2026-07-15-connect-oauth-prs.md.
- Deviations from plan:
  - 0028_snapshot.json prevId repaired in the PR2 branch (owner-approved) after
    db:generate proved hard-broken by it; migration 0029 trimmed of re-emitted applied
    objects + snapshot prevId hand-linearized (timestamp-snapshot ordering root cause —
    see packages/db/AGENTS.md landmine note and issue #56).
  - PR3 landed as #62: original #60 was merged into the stacked base branch before
    branch deletion, re-landed via cherry-pick; rule captured in docs/ORCHESTRATION.md §7.
  - Security-review fixes folded in: transactional first-use event, fire-and-forget
    connection touch, bounded wizard polling, auth-check-before-sweep, advisory-locked
    sweep, bulk-revoke attention dismissal.
- Left undone: staging OAuth smoke via real Claude Code + ChatGPT clients (owner);
  connected-apps list UI + per-app OAuth revoke (M11-01 remaining scope, decision 12).
- Gate: typecheck/lint/test green on every PR; Playwright browser verification of
  wizard + status + bell against the real Docker dev DB; staging deploy green with
  live-verified PRM/AS metadata + 401 contract.
