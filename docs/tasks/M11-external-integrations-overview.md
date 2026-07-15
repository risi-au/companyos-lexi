# M11: Universal MCP + External Integrations (milestone overview)

status: design ratified 2026-07-09, revised same day (owner + architect): the primary
deliverable is ONE portable MCP surface that arms any MCP-capable client in-band;
per-platform "integrations" are thin recipes + conformance tests, never bespoke builds.
Claude (Max) is the reference integration; Hermes Agent is the second, proving
tool-agnosticism. Queued after M10.
**Amended 2026-07-16 after the #53 arc (PRs #55/#59/#62, all merged + staging-deployed):
M11-01's headline server-side auth build shipped early — OAuth 2.1 AS (DCR + PKCE +
JWKS + consent) dual-mode with `cos_` bearer on `/api/mcp`, an in-product connect
wizard for 7 platforms (OAuth-first, token lane behind an explicit action), truthful
token status, `oauth_connections` first/last-use tracking, and expiry bell
notifications. Decisions 2/4/12 and the brief breakdown below carry per-item DONE /
remaining annotations; unannotated scope is untouched.**
depends on: M10-01 (attention/approval primitive), M10-02 (personal wikis),
M10-03 (citations/wrap-up contract). Serves the assistants direction
(`C:\dev\Feature Requests\2026-07-08-META-ADS-AUTOMATION-AND-ASSISTANTS-SESSION-RECORD.md`).
Brainstorm record: `2026-07-09-WIKI-FEATURE-BRAINSTORM.md` (Hermes/Claude discussion).

## Vision

The OS never ships its own daily driver. Users live in external tools — claude.ai,
Claude Code, Hermes, Codex, ChatGPT — and the OS arms and debriefs them over MCP.
Owner's insight driving this revision: *building separate integrations per platform is
a never-ending maintenance headache.* So the integration IS the MCP server. MCP's own
primitives make per-tool arming unnecessary:

- **Server instructions** (initialize handshake): the ritual ships from the server —
  "call `get_context` + `recall_memory` first; join the open session for the scope or
  register one; wrap up at end; OS wikis are authoritative, tool memory is cache."
  Every client that connects is armed in-band, no context-file recipe required.
- **MCP prompts**: `start_task` / `wrap_up` exposed as server prompts, discoverable on
  any client that supports the prompts capability.
- **Self-describing instance:** `cos-*` wiki pages (M10-05) + `get_context` answer
  "how do I use this?" through the same retrieval path — onboarding is in-band too.

What remains per-platform: a one-page connect recipe ("add a custom connector in tool
X"), a row in the conformance matrix, and optional platform-native delivery wiring.
Documentation and tests, not code.

The target scenario (acceptance, unchanged): load the NW context in the daily driver →
OS greets with context + attention banner → briefed session → hop to Claude Code in
the project folder, which **joins the same session by id**, works, logs updates →
return, read the session spine, finish, wrap up → brain ingests overnight → next
morning any tool greets with "questions about yesterday." Neither tool knows the other
exists; the OS session is the only shared state.

## Ratified decisions

1. **One MCP surface, any platform.** No kernel code, endpoints, or tool variants per
   client. If a platform "integration" needs server-side special-casing, the design is
   broken — fix the shared surface instead.
2. **Auth meets every client where it is:** static bearer `cos_` tokens AND OAuth 2.1
   with dynamic client registration + PKCE. Both paths mint the same principal/grant
   semantics. Streamable HTTP transport. **DONE 2026-07-15 (#55, issue #53 PR1)** —
   this was "the main new server-side build in M11" and it exists: AS metadata + DCR +
   authorize/token/consent + JWKS in-process via better-auth `@better-auth/oauth-provider`,
   dual-mode bearer on `/api/mcp`, RFC 9728 protected-resource metadata, spec-correct
   401 `WWW-Authenticate`. One wording update: Claude Code is now an OAuth client too
   (`claude mcp add` + `claude mcp login`); static bearer remains the lane for
   Hermes, n8n, and headless workers only.
3. **The ritual is a server property** (server instructions + prompts, decision above).
   Per-tool context files (Claude Project instructions, Hermes profile context,
   CLAUDE.md) become thin reinforcement — one pointer line — not the carrier.
4. **Claude (Max) is the reference daily driver.** claude.ai Project per CoS project
   (custom instructions = reinforcement line), project-partitioned memory is a
   well-behaved cache, connectors on web/desktop/mobile/Claude Code under one sub,
   frontier models flat-rate. **Identity model updated 2026-07-16 (supersedes the
   "account-level personal token" language, which predated the OAuth provider):**
   hosted clients connect once per account via OAuth — the connection authenticates as
   the human principal with that user's grants; **no personal token is minted at all**
   (grants span the user's projects; scope resolves server-side per session). Personal
   `cos_` tokens for humans are no longer part of any recipe.
5. **Hermes Agent is the second integration** (profile-per-project, per-profile scoped
   bearer tokens, self-hosted on the owner's VPS). Its job in M11 is proving the
   surface is tool-agnostic: two very different clients, zero server difference.
6. **No in-OS daily-driver chat.** Ask OS stays scoped to OS Q&A. (Unchanged.)
7. **Tools join the human's session.** One OS session per human task; subsequent tools
   join by session id (surfaced via `get_context` open-session listing). Lock as
   convention in sessions docs; work-log rollup is the safety net. (Unchanged.)
8. **Memory subordination doctrine.** Tool-local memory (Claude memory, Hermes
   MEMORY.md/USER.md, any provider plugin) is a disposable cache. Authoritative
   knowledge is the OS (personal + scope wikis via `recall_memory`). One-way valve:
   durable facts graduate via wrap-ups and wiki proposals; the OS never imports a
   tool's memory store. Hermes: built-in memory only at first; Mnemosyne optional
   later (bank-per-project, sync OFF, never cross-tool); hosted memory providers
   rejected for daily-driver profiles. (Unchanged.)
9. **Attention delivery is driver-independent: n8n poller** (already in the deploy)
   polls the attention queue → Telegram/email/push; user taps through and answers in
   whatever MCP client they open (mobile claude.ai works natively). Hermes's cron +
   messaging gateway remains an optional per-user variant, not the mechanism. The OS
   still builds no push infrastructure.
10. **`companyos` memory plugin for Hermes** (recall inject + proposal write-back)
    survives as an optional, deprioritized item — valuable for pluggable tools, but
    the universal surface must never depend on any client being pluggable.
11. **Integration health is observable:** per-tool last-seen (usage_events + session
    registry) on the ops panel; a client that stopped reporting wrap-ups is a visible
    regression, not silent drift. Conformance matrix re-run on server changes.
12. **Connected-apps panel (user-facing).** One credential per app: OAuth clients get
    their own identity automatically via DCR; bearer clients get one labelled token
    each ("hermes-vps", "cursor-laptop", "claude-code"), minted in the Connect panel —
    never one token shared across apps. The Connect panel lists every connected app
    (label, auth kind, last seen, sessions started, per-app revoke). Same MCP URL for
    all apps; the credential is what distinguishes them. Terminal agents launched via
    a multiplexer (e.g. Orca) inherit the host tool's token and are told apart by
    session, not credential.
    **Substrate DONE 2026-07-15 (#59/#62):** `oauth_connections` records per-app
    first/last authenticated use per (oauth client, principal); `listOAuthConnections`
    exposes a self-view; worker tokens show truthful derived status
    (Active/Expired/Revoked/Never used) + last-used. **Remaining:** the unified
    connected-apps list UI (OAuth apps alongside tokens), per-app OAuth revoke
    (refresh-token/consent revocation), and sessions-started counts.

## Brief breakdown

- **M11-01 universal MCP surface** *(re-scoped 2026-07-16 — the auth half shipped via
  issue #53)*:
  - **DONE:** OAuth 2.1 + DCR + PKCE alongside static bearer, same principal semantics
    (#55). Connect-panel legibility largely fixed by the wizard (#59): (a) humans
    default to OAuth — no token minted or shown; (c) worker tokens are an explicit
    "Use a worker token instead" lane for non-human principals. Remaining sliver:
    (b) platform/vault credentials still live in the separate Credentials tab, not
    unified into the connect surface.
  - **REMAINING:** streamable HTTP hardening; server instructions carrying the ritual;
    `start_task`/`wrap_up` MCP prompts; tool-surface audit (names, counts,
    descriptions written for any model — some clients degrade with large tool lists);
    **conformance matrix**: claude.ai (web/desktop/mobile), Claude Code, Hermes, Codex,
    Cursor — connect, list tools, run the ritual, join a session, answer an attention
    item. First checkpoint (gates everything): verify the staging endpoint from
    claude.ai's custom-connector flow and Claude Code via the wizard — the last open
    #53 checkbox (owner smoke).
- **M11-02 reference integrations:** Claude Max recipe (Projects, OAuth connect,
  memory posture) and Hermes recipe (profiles, VPS install, memory posture) as
  skills-repo content. Both encode **scope pinning**: each workspace container
  (claude.ai Project / Hermes profile) carries one line pinning its default scope
  path — humans hold one credential per app spanning their grants (scope is a per-call
  parameter, session-anchored after kickoff); per-scope tokens are for non-human
  principals only. Sessions-doc update (decision 7);
  end-to-end acceptance scenario run on a real project scope through BOTH drivers.
  **Scope note 2026-07-16:** connect *steps* now live in-product — the wizard
  (`apps/os/src/modules/connect/platforms.ts`) carries verified per-platform setup for
  all 7 platforms. Recipes must NOT duplicate them (two sources of connect truth will
  drift); a recipe is the non-connect half only — memory posture, scope pinning,
  Project/profile setup — plus a pointer at the wizard.
- **M11-03 attention delivery:** n8n workflow polling attention MCP tools → messaging;
  round-trip verified from phone (notification → mobile client → answer over MCP).
  Needs M10-01. Hermes-gateway variant documented, optional.
- **M11-04 recipe library + extras:** remaining tool recipes (Codex, ChatGPT,
  claude.ai Team contexts) following the M11-02 template — same scope note as M11-02:
  connect steps are the wizard's job now, recipes carry only the non-connect half;
  integration-health surfacing (decision 11); optional `companyos` Hermes memory
  plugin (decision 10, needs M10-02).

Dependencies: M11-01 first (everything rides the surface); M10-01 → M11-03;
M11-02 needs M11-01 + a stable wrap-up contract (M10-03; session registry suffices
for a first pass). Suggested order: 01 → 02 → 03 → 04.

## Don't (milestone-wide)

- No per-platform kernel code, endpoints, or tool variants — the surface is one.
- No tool-to-tool coupling: tools never share state directly (including via a shared
  Mnemosyne store); the OS session is the only bridge.
- No in-OS chat client, no push infrastructure, no scraping-dependent hooks.
- No importing tool memory stores into the wiki; graduation is per-fact via proposals.
- Don't let recipes grow logic: a recipe that needs more than connect steps + one
  reinforcement line means the server instructions are failing — fix them.
- Secrets doctrine unchanged: recipes and context files carry credential *names* and
  the MCP URL, never values; tokens live in each tool's own secret storage.
