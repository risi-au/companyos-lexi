# M6 — Remote MCP, Connect, Manager & Companions (overview)

status: done (all child tasks complete)
module: milestone overview — not dispatchable; see M6-01..M6-07

## Milestone goal

Any authorized user, on any machine, connects any MCP-capable agent (Claude Code, Codex,
Cursor, VS Code agents, Claude Desktop, …) to the live CompanyOS VPS with **one URL + one
scoped token**, works under the correct scope grants, and admins can see/revoke connections
without touching kernel schema. Closes the loop: any tool, any device, OS as the center.

## Mental model (non-negotiable)

- **One MCP URL for the whole instance**: `${COMPANYOS_URL}/api/mcp` (streamable HTTP inside
  apps/os — ratified with owner 2026-07-06; prod has no Caddy, staging fronted by Cloudflare
  tunnel, so the transport mounts as a Next route handler like the existing `/api/v1/*`).
- **Scope is carried by the token, not the URL**: token → principal → grant → subtree.
- **Mint freely, expire aggressively (default 7d), revoke granularly** (per token or subtree).
- Repo paths, worktree rules, wrap-up rituals do NOT live in the token — they live in
  `get_context`, managed AGENTS.md, and skills.

## Ratified design decisions

1. **No privilege escalation on mint**: minter's role on target scope ≥ minted role; minter
   must hold a grant covering the target scope. Employee with 5 clients mints only for those
   5 — no admin approval, other clients invisible.
2. **Dedicated agent principal per mint**: each Connect mint creates `principal(kind=agent)`
   + single grant on the target scope only + `issueToken`. Never mint on the human's
   principal (too wide when they hold multiple client grants).
3. **Per-request auth on HTTP**: `authenticateToken` on every MCP request; revocation/expiry
   effective on the next call. stdio keeps startup auth for local dev only.
4. **Active connections** = `tokens.last_used_at` (baseline) + optional live session
   tracking (nice-to-have in M6-01, surfaced in M6-03).
5. **Subtree revoke**: revoking scope X revokes all tokens whose connection principal has a
   grant on X or any descendant. Sibling scopes untouched.
6. **MCP Manager edits nothing about grants**: view + revoke tokens only. Grant editing is
   M5-04 Tenant Admin. Manager may display grants read-only.
7. **No auto wrap-up on terminal close** in M6. Incremental logging via enriched AGENTS.md /
   skills; session lifecycle visibility via M6-07.
8. **Wrong-folder guard**: `verify_workbench` companion tool + enriched context; agents must
   STOP on MCP/get_context failure (policy lives in managed AGENTS.md).
9. **GitHub layout unchanged**: one repo per top-level project; nested scopes = folders;
   AGENTS.md per level via provisioning. Local mirror = plain `git clone`.
10. **Terminal-first daily use**: OS mint is first-time/renewal only; thereafter the token
    lives in client config / workbench env — `cd` in and start the agent, no re-mint.
11. **Connect permission matrix = the existing kernel grant role on the scope** (owner
    ratified 2026-07-06). No separate "mint permission" control exists or is added — when a
    user is created (M5-04) and granted a role on a scope, that role drives Connect/Manager
    behavior everywhere:
    - **viewer** → sees the scope's connections (read-only panel); cannot mint or revoke.
    - **editor** → mints tokens (≤ own role) and revokes ONLY tokens they minted.
    - **admin** → all of the above plus revokes ANY token on the scope/subtree (M6-03
      bulk + single).
    Enforcing "own tokens" requires knowing the minter: kernel `principals`/`tokens` have
    no minted_by (verified) — M6-02 adds a small connect-module-owned `connections` table
    (token_id → minted_by, scope_id). Module table, NOT a kernel change.

## Sequence (strict)

```
M5 queue completes
    ↓
M6-01  Remote MCP HTTP + whoami            [BLOCKING — gates everything]
    ↓ architect verifies on staging
M6-02  Connect to MCP (per-scope panel)    [needs 01 URL live]
    ↓
M6-03  MCP Manager (admin)                 [needs 01 per-request auth]
M6-04  Enrich get_context                  [after 01; parallel with 02/03]
M6-05  Enrich managed AGENTS.md            [after 01–02]
M6-06  verify_workbench tool               [after 04–05]
M6-07  Sessions registry                   [after 02–03]
M6-08  Work Log rollup                     [independent — any time after M5]
M6-09  search + wiki surfacing             [after 04 + 08]
```

Gate: M6-02/03 PRs blocked until architect signs off M6-01 on staging.

Knowledge layer: docs/patterns/WIKI.md defines the wiki convention (one wiki per
top-level scope, ancestor-walk resolution, update-in-place topic pages). M6-09 implements
its surfacing + retrieval; the gardener capability (scheduled distiller of records →
wiki) is **M7-01-wiki-gardener.md** — an n8n workflow + wiki-maintenance skill, piloted
on one client after M6-05 + M6-09 ship.

Memory precedence: the M6-05 managed AGENTS.md template carries a verbatim block making
CompanyOS authoritative over vendor-tool memory (Claude/OpenAI) for all client/scope
facts — vendor memory is personal preferences only; conflicts resolve toward the OS.

## Explicitly out of scope for M6

| Item                                                  | Where               |
|-------------------------------------------------------|---------------------|
| OAuth "Sign in with CompanyOS" from external clients  | Future (needed for claude.ai / ChatGPT web connectors) |
| ChatGPT-native scope picker                           | Future              |
| Auto git commit/push on session end                   | Agent + git policy  |
| Auto OS backfill if terminal killed without wrap-up   | M6-07 alerts only   |
| Grant invite/edit UI                                  | M5-04 Tenant Admin  |
| Hermes / subscription proxy                           | Never               |
| Kernel schema changes                                 | Not needed — verified: `issueToken` (accepts expiresAt), `authenticateToken` (bumps last_used_at), `revokeToken`, `grantRole`, `revokeGrant`, `listGrants` all exist; tokens carry expires_at / last_used_at / revoked_at |
| QR code for mobile mint                               | Later nice-to-have  |

## Daily-user acceptance scenarios (architect verifies at milestone close)

1. Provision `airbuddy/digital-marketing/meta-ads` → GitHub repo `airbuddy` with folder
   `digital-marketing/meta-ads/AGENTS.md`.
2. Local: `git clone` → `cd` into the folder → terminal-first with saved token.
3. Connect: OS scope page → mint 7d agent token → paste into two different agent tools
   (different tokens, same scope).
4. Parallel: two agents on meta + one on google — three tokens, two worktrees on meta per
   AGENTS.md convention.
5. Wrong folder: `verify_workbench` flags google-ads cwd with meta-ads token.
6. Revoke: MCP Manager subtree revoke on `airbuddy/digital-marketing` kills meta connections,
   not the sibling client's.
7. Employee: grants on 5 clients → Connect visible/mintable on exactly those 5.
8. VPS down: agent with enriched AGENTS.md stops after get_context failure (no hallucinated
   OS state).

## Dispatch notes

- One brief per branch per docs/ORCHESTRATION.md (implementer per current practice; codex
  for the harder briefs — M6-01 and M6-07 qualify).
- Coordinate copy with M5-04: "edit team access" links to Tenant Admin; MCP Manager is
  connections only. If M5-04 has not shipped when M6-03 starts, M6-03 creates the minimal
  `/admin` shell (root-scope admin gated) that M5-04 later extends.
- Constitution: logic in packages/api; MCP layer thin; every write emits an event; module
  AGENTS.md updated in the same commit.
