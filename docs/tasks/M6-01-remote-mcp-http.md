# M6-01: Remote MCP HTTP transport + whoami

status: in-progress (implemented + verified locally 2026-07-06; pending architect live-verify on staging — gates M6-02/03)
module: packages/mcp + apps/os (thin route mount)
branch: task/M6-01

## Goal

Any MCP client on any machine connects to the VPS with `https://<domain>/api/mcp` +
`Authorization: Bearer cos_...` and operates under that token's grants. No `DATABASE_URL`
on client machines. stdio entry remains unchanged for local dev. New read-only `whoami`
tool lets a freshly connected agent self-discover its principal and grants.

## Context

- DESIGN.md §component map: "packages/mcp — MCP server on the official TypeScript SDK
  (stdio + HTTP transports)". M1-05 deferred HTTP ("needs deployment context — later
  task"); the VPS is now live, so this task is due.
- `packages/mcp/src/server.ts` — `createServer({db, principalId})` is transport-agnostic;
  reuse unchanged. `src/stdio.ts` is the existing entry.
- Kernel (verified): `issueToken` (accepts `expiresAt`), `authenticateToken` (validates
  expiry/revocation, bumps `last_used_at`), `revokeToken`, `listGrants` in
  `packages/api/src/kernel/`. Tokens table has `expires_at`, `last_used_at`, `revoked_at`.
- HTTP precedent: `apps/os/src/app/api/v1/*` route handlers + `apps/os/src/lib/agent-auth.ts`
  (bearer → principal | 401) from M2-05. Same auth pattern, no new scheme.
- **Ratified with owner (2026-07-06): the HTTP transport mounts INSIDE apps/os at
  `/api/mcp`** — prod compose has no Caddy and staging is a Cloudflare tunnel straight to
  the app, so a Next route handler reuses the existing domain, tunnel, and TLS with zero
  new infra. `packages/mcp` exports the transport wiring; the route handler is thin glue.
- Bonus alignment: provisioning's managed AGENTS.md already prints
  `${COMPANYOS_URL}/api/mcp` as the MCP endpoint (`agents-md.ts`) — this task makes that
  URL real.

## Architect decisions (do not relitigate)

1. **Streamable HTTP, stateless mode** (official TS SDK `StreamableHTTPServerTransport` or
   current spec equivalent). Stateless per-request handling fits Next route handlers and
   makes per-request auth natural. If the SDK requires session mode for SSE streaming,
   sessions must still re-authenticate every request (decision 3, M6-00).
2. **Per-request auth**: parse `Authorization: Bearer cos_...` → `authenticateToken` →
   build/dispatch with that `principalId`. 401 with JSON error before any MCP handshake on
   missing/invalid/revoked/expired. Never cache a principal across requests without re-auth
   — revocation must bite on the very next call.
3. **`MCP_PUBLIC_URL` env** (12-factor): defaults to `${COMPANYOS_URL}/api/mcp`; consumed
   by M6-02 snippets, M6-04 context, M6-05 template. Add to `.env.example` files.

## Do

1. In `packages/mcp`: export an HTTP handler factory (e.g. `createHttpHandler({db})`) that
   wraps `createServer` with the streamable HTTP transport and per-request bearer auth.
   Keep it framework-agnostic (standard Request/Response) so the Next route is one line-ish.
2. In `apps/os`: `src/app/api/mcp/route.ts` mounting that handler (GET/POST/DELETE per
   streamable HTTP spec). Reuse/extend `agent-auth.ts` error shapes for the 401 path.
3. New MCP tool `whoami` in `server.ts` (additive): read-only; returns
   `{ principal: { id, name, kind }, grants: [{ scopePath, role }] }` via kernel
   `listGrants`. No scope argument, no writes.
4. `ping` remains the only unauthenticated tool.
5. Security hardening in the handler:
   - Tokens accepted ONLY from the Authorization header — never query string; never log
     token values.
   - Origin header validation per MCP streamable-HTTP spec (DNS-rebinding protection);
     allowed origins env-configurable.
   - Request body size cap; sensible per-token rate limiting at the handler (simple
     in-memory bucket is acceptable for v1 — document the limitation).
   - Correct `Mcp-Session-Id` lifecycle if session mode ends up used.
6. Update `packages/mcp/AGENTS.md`: remove the "No HTTP transport" prohibition, document
   both entries + auth model + `MCP_PUBLIC_URL`. Update `apps/os/AGENTS.md` (new route).

## Don't

- No changes to existing MCP tool signatures (whoami is additive only).
- No kernel schema changes; no business logic in the transport layer.
- No new container, domain, or tunnel config — the route rides the existing app.
- Don't touch stdio entry behavior or its tests beyond additive whoami coverage.
- Don't attempt to commit — leave completed work in the tree.

## Acceptance criteria

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] HTTP auth matrix tested: valid / invalid / revoked / expired / absent → 401 vs 200
- [ ] In-subtree tool call succeeds over HTTP; out-of-subtree denied (same token)
- [ ] Revoking a token → its very next HTTP request 401s (live session dies)
- [ ] `whoami` returns correct principal + grants for a scoped agent token (stdio + HTTP)
- [ ] Full roundtrip over HTTP: `whoami` → `get_context` → `save_report`
- [ ] Tokens never appear in logs or URLs (test the handler's error paths)
- [ ] stdio transport tests pass unchanged
- [ ] `last_used_at` visibly bumps on HTTP auth (feeds M6-03)
- [ ] Architect live-verifies on staging: real MCP client (Claude Code `--transport http`
      or curl) against `https://cos.risi.au/api/mcp` — this sign-off gates M6-02/03
