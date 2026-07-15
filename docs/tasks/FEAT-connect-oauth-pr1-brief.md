# FEAT-connect-oauth-pr1: OAuth 2.1 provider for MCP + dual-mode bearer auth

status: todo
module: multi (apps/os auth + packages/mcp transport + packages/db schema)
branch: task/FEAT-connect-oauth-pr1
issue: #53
plan: docs/tasks/FEAT-connect-oauth.plan.md

## Goal

CompanyOS becomes a spec-compliant OAuth 2.1 authorization server for its own MCP endpoint
using better-auth's OAuth provider plugin, so MCP clients (Claude, Cursor, VS Code, Codex,
ChatGPT, Gemini) can connect via browser consent instead of pasted tokens. `/api/mcp`
accepts EITHER an OAuth access token OR a legacy `cos_` static token on the same
`Authorization: Bearer` header. Unauthenticated requests get 401 with a `WWW-Authenticate`
header pointing at RFC 9728 protected-resource metadata.

## Context (read these, nothing else)

- Plan: `docs/tasks/FEAT-connect-oauth.plan.md`
- `docs/CONSTITUTION.md` (hard rules; esp. every-write-emits-event, lean ladder)
- `apps/os/src/lib/auth.ts` — better-auth config (email/password, drizzleAdapter over
  `authSchema` from `@companyos/db`, nextCookies plugin)
- `apps/os/src/lib/agent-auth.ts` — current bearer auth for `/api/mcp` (cos_ hash lookup via
  `authenticateTokenWithMetadata`)
- `apps/os/src/app/api/mcp/route.ts` — thin handler wiring `createHttpHandler` from
  `@companyos/mcp` with `authenticateRequest: authenticateAgentRequest`
- `packages/mcp/src/http.ts` — HTTP transport; `defaultAuthenticateRequest` (line ~153) and
  the 401 error path
- `packages/db/src/schema/kernel.ts` — `principals.authUserId` links better-auth user ids to
  kernel principals (line ~43)
- `packages/db/AGENTS.md` — migration workflow (drizzle generate; NEVER hand-edit
  `drizzle/meta/_journal.json`)
- `apps/os/AGENTS.md`, `packages/mcp/AGENTS.md`, `packages/api/src/modules/connect/AGENTS.md`
- **The plugin itself**: `node_modules/@better-auth/oauth-provider` (PRE-INSTALLED — read its
  README/dist types for the exact option names, endpoint paths, schema tables, and route
  helpers). You have NO network access; the installed package is your source of truth.
  If a name below differs from what the package actually exports, FOLLOW THE PACKAGE and
  note the deviation in your report.

## Key facts from research (verified 2026-07-15; trust installed package over these names)

- Plugin `@better-auth/oauth-provider@1.6.23` (peer better-auth ^1.6.23, our exact version):
  OAuth 2.1 AS with authorize/token/introspect/revoke endpoints, RFC 7591 dynamic client
  registration INCLUDING unauthenticated public-client registration for MCP agents, JWT
  access tokens (pair with better-auth `jwt()` plugin / JWKS), consent-page integration, and
  an MCP helper (`mcpHandler(jwksUrl, verifyOptions, handler)` or similar) plus older-docs
  patterns `withMcpAuth` / `auth.api.getMcpSession()`.
- MCP spec (2025-11-25) server requirements:
  - `GET /.well-known/oauth-protected-resource` AND the path-suffixed variant
    `/.well-known/oauth-protected-resource/api/mcp` (Claude probes suffixed first). Body:
    `resource` (exact public URL of the MCP endpoint incl. path) and `authorization_servers`
    (array; first entry is what Claude uses). CORS: allow GET from any origin.
  - AS metadata at `/.well-known/oauth-authorization-server` (plugin provides the data; a
    manual route re-exposing it with CORS may be needed — check plugin docs/README).
  - 401 responses from `/api/mcp` include
    `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp"`.
  - PKCE S256 only; token endpoint accepts form-urlencoded; access tokens audience-bound to
    the MCP resource — the server MUST reject tokens whose audience is not the MCP endpoint.
  - Redirect URIs arrive via DCR — do not hard-allowlist; loopback redirects
    (`http://localhost:*/…`, `http://127.0.0.1:*/…`) must match port-agnostically if the
    plugin exposes such an option.

## Do

1. **Wire plugins** in `apps/os/src/lib/auth.ts`: add the OAuth provider plugin (+ `jwt()`
   plugin if the provider requires it for JWT access tokens). Configure: login page
   `/sign-in` (existing), consent page path (new route below), DCR enabled for public
   clients, sensible TTLs (access ~1h, refresh ~30d), and the MCP resource identifier
   (public origin + `/api/mcp`). Base URL / origin must come from env
   (`BETTER_AUTH_URL` or existing pattern — check how the app resolves its public origin;
   `getConnectConfigAction` in `apps/os/src/modules/connect/actions.ts` already resolves the
   MCP URL — reuse that logic, do not invent a second origin source). Do NOT edit `.env*`;
   document any new env var in `apps/os/AGENTS.md`.
2. **Schema + migration**: add the plugin's required tables to the better-auth schema in
   `packages/db` (find where `authSchema` lives; mirror the plugin's schema definition from
   `node_modules`). Generate the drizzle migration per `packages/db/AGENTS.md`. Plain ASCII,
   no BOM.
3. **Well-known routes** in `apps/os/src/app/.well-known/`:
   - `oauth-protected-resource/route.ts` and `oauth-protected-resource/api/mcp/route.ts`
     (RFC 9728 body per above, CORS headers, `runtime = "nodejs"`).
   - AS metadata route if the plugin does not already serve it on the app's route tree with
     CORS (verify by reading the plugin's endpoint registration).
4. **Consent page**: minimal page (existing UI primitives from `packages/ui` only, design
   tokens only) showing requesting client name + requested scopes with Approve / Deny,
   calling the plugin's consent accept/reject API. Unauthenticated users hit the existing
   sign-in and return. Keep it small — one page, no settings UI.
5. **Dual-mode auth** in `apps/os/src/lib/agent-auth.ts`:
   - Bearer value starts with `cos_` → existing `authenticateTokenWithMetadata` path,
     unchanged behavior.
   - Otherwise → verify as OAuth access token via the plugin's verification helper (JWKS,
     local verify; NO network fetch to itself if avoidable — check for an in-process
     verification API). Enforce audience = MCP resource. Extract better-auth user id from
     `sub`, look up the kernel principal via `principals.authUserId`, and return the same
     `AgentPrincipal` shape (`tokenId` stays undefined for OAuth callers unless the plugin
     exposes a stable token/client id — if it does, thread `oauthClientId` through as a new
     optional field rather than overloading `tokenId`).
   - Missing header or failed verification → throw with `status = 401` AND attach the
     `WWW-Authenticate` value (see next item).
6. **401 header plumbing** in `packages/mcp/src/http.ts`: when the auth callback throws a
   401, the HTTP response must include the `WWW-Authenticate` header. Additive change:
   e.g. read an optional `wwwAuthenticate` property off the thrown error, or accept a
   config option on `createHttpHandler`; pick the smallest mechanism consistent with the
   file's existing error handling. Do not change MCP tool signatures.
7. **Event emission**: on consent approval, emit a kernel event (`connection.authorized`,
   payload: clientId, clientName, userId, principalId, scopes) via `emitEvent` from
   `packages/api` kernel — hook the plugin's consent-success callback if available,
   otherwise emit from the consent page's server action. Every write emits an event.
8. **Env-var copy fix**: `packages/mcp/src/server.ts` (~line 240) references `COS_TOKEN`;
   provisioning uses `COMPANYOS_TOKEN` (`packages/api/src/modules/provisioning/service.ts`
   ~line 317). Canonicalize the mcp error text to `COMPANYOS_TOKEN`.
9. **Tests** (PGlite, near the code / `packages/api` style):
   - legacy `cos_` token still authenticates (regression)
   - request with no Authorization → 401 and `WWW-Authenticate` header present with
     `resource_metadata`
   - OAuth JWT with wrong audience → 401
   - valid OAuth JWT maps to the principal whose `authUserId` matches `sub` (fabricate a
     signed JWT via the plugin/jwt plugin test utilities if exposed; otherwise structure the
     verify step so the mapping function is unit-testable without a live AS)
   - protected-resource metadata route returns correct `resource` and
     `authorization_servers`
10. **AGENTS.md updates** in the same change set: `apps/os/AGENTS.md` (auth modes, new env
    var), `packages/mcp/AGENTS.md` (401/WWW-Authenticate contract), connect module AGENTS.md
    (OAuth lane exists; cos_ tokens = fallback).

## Don't

- Commit (orchestrator commits after review)
- Touch USER DATA/, legacy/, `.env*`, vps-login.txt
- Drive-by refactors; no changes to existing MCP tool signatures or existing token semantics
- Hand-edit `drizzle/meta/_journal.json`
- Allow PKCE `plain`, skip audience validation, or log/echo token values
- Non-ASCII characters or BOMs in source files
- Add UI beyond the single consent page (wizard is PR 2)

## Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from repo root
- [ ] All tests in Do#9 exist and pass
- [ ] `/api/mcp` with a legacy token behaves byte-for-byte as before
- [ ] Unauthenticated `/api/mcp` returns 401 + spec-correct `WWW-Authenticate`
- [ ] Well-known routes serve spec-correct JSON with CORS
- [ ] Consent approval emits `connection.authorized` event
- [ ] AGENTS.md files updated; report every file changed + any deviation from the names in
      "Key facts" with what the installed package actually exports

On usage limits print `LIMIT-ALERT:` and stop.
