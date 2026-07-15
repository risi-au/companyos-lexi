# FEAT-connect-oauth-pr2: Connect wizard — platform picker, OAuth-first setup, live verify

status: todo
module: multi (connect UI in apps/os + connect service in packages/api + one table in packages/db)
branch: task/FEAT-connect-oauth-pr2
issue: #53
plan: docs/tasks/FEAT-connect-oauth.plan.md (section "PR 2 — Connect wizard")

## Goal

Replace the post-mint snippet wall in the scope Connect tab with a guided 3-step wizard
(Platform -> Set up -> Verify). OAuth-first: the default lane never mints or displays a
token — the user picks their platform, gets a one-click install link or a copyable
one-liner pointing at our MCP URL, authenticates through the PR-1 browser consent flow,
and the wizard ends with a live "Connected" check that turns green when the platform's
FIRST authenticated MCP call lands. A raw worker token is only shown when the user
explicitly chooses "Use a worker token instead".

## Context (read these, nothing else)

- Plan: `docs/tasks/FEAT-connect-oauth.plan.md` (PR 2 section + Files to modify (PR 2))
- `docs/CONSTITUTION.md` (hard rules: every write emits an event, lean ladder, design tokens only)
- `apps/os/src/modules/connect/ConnectPanel.tsx` — current panel (mint form, snippet wall, tokens table)
- `apps/os/src/modules/connect/actions.ts` — server actions; `getConnectConfigAction` resolves the MCP URL
- `apps/os/src/lib/agent-auth.ts` — dual-mode bearer auth; OAuth success path is where the touch hook goes
- `packages/api/src/modules/connect/service.ts` + `connect.test.ts` + `AGENTS.md` — service style, event emission, test patterns
- `packages/db/src/schema/connect.ts` — module schema (add the new table here)
- `packages/db/AGENTS.md` — migration workflow (`pnpm --filter @companyos/db db:generate`; NEVER hand-edit `drizzle/meta/_journal.json`; do NOT run migrations against the dev DB)
- `apps/os/src/app/oauth/consent/actions.ts` — PR-1 event-emission precedent (`emitEvent` with `type`/`principalId`/`payload`)
- `packages/ui/src/components/stepper.tsx` — shared `Stepper` used by the intake flow
- `apps/os/src/modules/connect/AGENTS.md`, `apps/os/AGENTS.md` — update both in this change set

## Key facts

- The MCP URL comes from `getConnectConfigAction()` (`getMcpPublicUrl()`); build all
  deeplinks/snippets from it client-side or in pure helpers. Never hardcode a domain.
- OAuth connections act as the signed-in human principal (PR 1: `sub` ->
  `principals.auth_user_id`). They have NO row in `connections` and nothing bumps on MCP
  calls today: JWT verification is local against JWKS, and `oauth_access_token` rows prove
  token issuance, not use. That is why this PR adds first/last-call tracking.
- Platform install formats (web-verified against official docs 2026-07-15; if a format
  is wrong at implementation time, prefer the copyable-command fallback and note the
  deviation):
  - **Claude Code**: `claude mcp add --transport http companyos <MCP_URL>` then
    `claude mcp login companyos` (or `/mcp` -> Authenticate inside Claude Code) for the
    OAuth browser flow.
  - **Claude Desktop / claude.ai web**: claude.ai -> Customize -> Connectors -> Add
    custom connector -> paste `<MCP_URL>` (name: CompanyOS) -> Connect -> browser OAuth.
    No deeplink; numbered steps. Include a note: remote connectors are brokered through
    Anthropic's cloud, so the MCP URL must be publicly reachable (a localhost dev URL
    will not work for this platform).
  - **Cursor**: web link `https://cursor.com/install-mcp?name=companyos&config=<BASE64_CONFIG>`
    (renders best from a browser; `cursor://anysphere.cursor-deeplink/mcp/install?...`
    is the same params) where BASE64_CONFIG is base64 of exactly `{"url":"<MCP_URL>"}`
    (JSON.stringify, base64, NOT url-encoded). Render as a button + the equivalent
    copyable `~/.cursor/mcp.json` entry.
  - **VS Code**: link `vscode:mcp/install?<URLENCODED_JSON>` where the JSON is
    `{"name":"companyos","type":"http","url":"<MCP_URL>"}` (JSON.stringify ->
    encodeURIComponent, NOT base64); also show
    `code --add-mcp '{"name":"companyos","type":"http","url":"<MCP_URL>"}'` as the copy
    fallback. OAuth browser flow opens on first connect.
  - **Codex**: `codex mcp add companyos --url <MCP_URL>` then `codex mcp login companyos`
    (login is a separate explicit step, not automatic on add).
  - **ChatGPT**: numbered steps — workspace Settings -> Apps -> enable Developer mode
    (Business/Enterprise admin; Pro is read-only MCP) -> Create app -> paste `<MCP_URL>`,
    auth = OAuth -> Scan Tools (OAuth prompt happens during the scan) -> Create. Note
    plan restrictions briefly; URL must be publicly reachable.
  - **Gemini CLI**: `gemini mcp add --transport http companyos <MCP_URL>`; OAuth triggers
    automatically on the first 401 or manually via `/mcp auth companyos`.
- Token-lane snippets: reuse the existing per-platform snippet builders currently in
  `ConnectPanel.tsx` (claude / mcpJson / codex toml / claudeDesktop / chatgpt) — move them
  into `platforms.ts` rather than duplicating.

## Do

1. **Schema**: add `oauth_connections` to `packages/db/src/schema/connect.ts`:
   `id` uuid pk default random, `oauth_client_id` text not null, `principal_id` uuid not
   null fk -> `principals.id` on delete cascade, `first_used_at` timestamptz not null
   default now, `last_used_at` timestamptz not null default now, unique index on
   `(oauth_client_id, principal_id)`. Export a typed row interface. Generate the
   migration with `pnpm --filter @companyos/db db:generate` (drizzle-kit is installed; if
   pnpm is unavailable in your sandbox, run the package's local
   `node_modules/.bin/drizzle-kit` equivalent and say so in your report). Plain ASCII, no BOM.
2. **Service** in `packages/api/src/modules/connect/service.ts`:
   - `touchOAuthConnection(db, { oauthClientId, principalId })`: single upsert on the
     unique pair — insert sets both timestamps, conflict updates `last_used_at` only.
     Emit `connection.first_used` (payload: `oauthClientId`, `principalId`) ONLY when the
     row was newly inserted (mirror `connection.authorized` emission style; no scope
     needed). No plaintext tokens/JWTs anywhere near this table or event.
   - `listOAuthConnections(db, { principalId, since? }, actor)`: rows for exactly that
     principal, `since` filters `first_used_at >= since`; join `oauth_client` to include
     the client name. Actor must BE that principal (self view) — no cross-principal reads.
   - Re-export both from the package index alongside the existing connect exports.
3. **Auth hook** in `apps/os/src/lib/agent-auth.ts`: after a successful OAuth
   authentication (non-null principal from `authenticateOAuthAccessToken`), call
   `touchOAuthConnection` with the payload's `azp` client id. Wrap in try/catch: a
   bookkeeping failure must never fail or slow authentication visibly (log via
   `console.error` and continue). Do not touch the cos_ path.
4. **Platform catalog** `apps/os/src/modules/connect/platforms.ts`: pure module, no React.
   For each of the 7 platforms (claude-code, claude-desktop-web, cursor, vscode, codex,
   chatgpt, gemini-cli): `id`, `label`, `oauth` steps (ordered strings + optional
   `deeplink(mcpUrl)` + optional `command(mcpUrl)`), and `token` variant
   (`steps`/`snippet(mcpUrl, token)`) reusing the moved snippet builders. Unit-test the
   builders in `platforms.test.ts`: exact deeplink encoding (base64/URL-encode), commands
   contain the URL, token snippets contain the token, no builder ever embeds a token in
   the OAuth lane.
5. **Wizard** `apps/os/src/modules/connect/ConnectWizard.tsx` (client component):
   - Step 1 Platform: grid of the 7 platforms (buttons, design tokens only).
   - Step 2 Set up: OAuth lane by default — MCP URL with copy button, deeplink button
     and/or copyable command, numbered steps. A quiet text action "Use a worker token
     instead" switches the step to the token lane: the existing mint form (name/role/
     expiry — reuse the current form, extracted if needed) then the platform's token
     snippet with the shown-once warning kept.
   - Step 3 Verify: starts polling when entered. OAuth lane: call
     `getOAuthConnectionStatusAction({ since })` (since = wizard-start ISO captured when
     the wizard mounts) every 3-5s until a row appears -> render "Connected" success state
     with the client name. Token lane: poll `listConnectionTokensAction(scopePath)` until
     the minted `tokenId` has non-null `lastUsedAt`. Stop polling on unmount, on leaving
     the step, and after ~2 minutes — then show a "still waiting" state with 2-3
     troubleshooting hints (check the URL was pasted exactly; restart the client;
     ChatGPT/Claude web need the consent screen approved) and a "Keep waiting" retry.
   - Use the shared `Stepper`; allow going back; state is local (no persistence).
6. **Compose** in `ConnectPanel.tsx`: wizard card on top, existing worker-tokens table
   below unchanged (same refresh/revoke behavior). The old always-visible snippet wall is
   removed — token snippets now live only inside the wizard's token lane. Keep the
   existing post-mint list refresh.
7. **Poll action** in `apps/os/src/modules/connect/actions.ts`:
   `getOAuthConnectionStatusAction(input: { since: string })` — resolves the current
   actor principal (same pattern as the other actions) and calls `listOAuthConnections`
   with `since`. Never expose other principals' rows.
8. **Tests**: `connect.test.ts` additions — touch inserts once + emits
   `connection.first_used` exactly once for repeated touches; `last_used_at` advances on
   subsequent touch; `listOAuthConnections` returns only the actor's rows and respects
   `since`. `platforms.test.ts` per Do#4. Keep every existing test green.
9. **AGENTS.md updates** in the same change set: connect service AGENTS.md (new table,
   functions, event, no-token rule), `apps/os/src/modules/connect/AGENTS.md` if present
   (wizard contract, bounded polling), `apps/os/AGENTS.md` (OAuth first-call tracking
   note under the PR-1 OAuth section).

## Don't

- Commit (orchestrator commits after review)
- Touch USER DATA/, legacy/, `.env*`, vps-login.txt
- Touch better-auth plugin tables (`oauth_client`, `oauth_access_token`, ...) — the new
  table is module-owned in the connect schema
- Change existing mint/list/revoke service signatures or the tokens table
- Hand-edit `drizzle/meta/_journal.json`; run migrations against the dev DB
- Unbounded or background polling (poll only while the Verify step is mounted)
- Show a token, or embed one in any snippet, unless the user explicitly took the
  token lane
- Log or persist JWT/token values in the new code paths
- Non-ASCII characters or BOMs in source files; no new colors/spacing outside design tokens

## Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from repo root
- [ ] Connect tab shows the wizard; picking any platform shows OAuth-first instructions
      with working deeplink/command built from the real MCP URL; no token visible anywhere
      in that flow
- [ ] "Use a worker token instead" is the only path that mints/shows a token, and it
      reuses the existing mint semantics (role/expiry, shown-once warning)
- [ ] First authenticated OAuth MCP call creates exactly one `oauth_connections` row per
      (client, principal), emits `connection.first_used` once, and subsequent calls only
      bump `last_used_at`
- [ ] Verify step flips to "Connected" from live polling on both lanes; polling is
      bounded and stops on unmount
- [ ] All tests in Do#8 exist and pass; AGENTS.md files updated
- [ ] Report every file changed + any deviation (including platform-format corrections)

On usage limits print `LIMIT-ALERT:` and stop.
