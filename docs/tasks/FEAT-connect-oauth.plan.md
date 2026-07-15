# FEAT-connect-oauth: Seamless MCP connect — OAuth provider, wizard, live status

status: in-progress
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

### PR 2 — Connect wizard (plan to be detailed after PR 1 merges)

- Replace snippet wall in ConnectPanel: platform picker → per-platform guided steps.
  OAuth-first (paste URL / one-click deeplinks: Cursor `install-mcp` link, `vscode:mcp/install`,
  `claude mcp add` / `codex mcp add` one-liners); manual-token path only on explicit request.
- Final step: live verification — poll connection list until first authenticated call bumps
  `lastUsedAt` → "Connected ✓".

### PR 3 — Status + notifications (original #53 core; plan after PR 2)

- Derived status in token/connection lists: Active / Expired / Revoked / Never used.
- Attention items (new kind, migration) for expired / expiring-soon connections; bell
  deep-links to the connect tab.

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

- [ ] PR 1: OAuth foundation (brief dispatched to codex gpt-5.6-terra/high)
- [ ] PR 1: gates green, adversarial security review (fresh session), owner merges
- [ ] Staging smoke: connect Claude Code + ChatGPT connector via OAuth end-to-end
- [ ] PR 2: wizard plan + brief + dispatch
- [ ] PR 3: status/notifications plan + brief + dispatch
- [ ] Module AGENTS.md updated each PR

## Acceptance criteria (feature-level)

- [ ] A user can connect Claude Code, Cursor, VS Code, Codex, ChatGPT, claude.ai to the
      CompanyOS MCP server without ever copying a raw token (OAuth consent flow).
- [ ] Legacy `cos_` tokens keep working unchanged (headless workers, unsupported platforms).
- [ ] Wizard guides platform-specific setup and ends with a live "Connected" confirmation.
- [ ] Token/connection lists show truthful derived status; expiry raises a bell notification.

## Finish report (fill when done)

- Files changed:
- Deviations from plan:
- Left undone:
- Gate:
