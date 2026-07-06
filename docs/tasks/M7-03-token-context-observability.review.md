# M7-03 review — passed with one architect-applied fix

Reviewer: architect. Codex's implementation accepted after review; no fix cycle needed.

## Reviewed and accepted

- **Kernel touch** (`packages/api/src/kernel/tokens.ts`): additive
  `authenticateTokenWithMetadata` returning `{ principal, tokenId }`;
  `authenticateToken` now delegates to it, behavior unchanged. Approved as a minimal
  kernel interface addition — usage rows need `token_id` and the alternative (re-hashing
  the bearer token in callers) would be worse.
- **Migration 0017** hand-written (matches the 0014–0016 no-snapshot pattern):
  `usage_events` + `context_profiles`, set-null FKs so usage survives token/principal
  deletion, composite indexes on (scope|principal|token|session|connection|operation,
  created_at).
- **Privacy**: metadata stores argument *keys* only; `sanitizeUsageMetadata` redacts
  `cos_`/Bearer-shaped values; no raw prompts/responses/queries stored. Verified in
  service + test.
- **Gating**: `queryUsage` / `getContextProfile` / `setContextProfile` all
  `requireAccess(..., "admin")`; MCP tools delegate to the same services.
- **Context profiles**: lean/standard/deep presets, jsonb config, `usage.profile_updated`
  emitted in-transaction; test proves lean reduces `getContextBundle` output.
- **SSE concern checked**: transport uses `enableJsonResponse: true`, so the
  response-clone read in the logger cannot hang on a stream.
- Scaled-down v1 per the analysis gate (deferred LiteLLM cost reconciliation, digests,
  stdio logging) is the right call.

## Architect fix applied during review

`packages/mcp/src/http.ts`: `logMcpToolCalls` was awaited inside the same `try` as
`transport.handleRequest` — a throw anywhere in the logging path (outside
`logUsageEventSafely`'s own guard, e.g. body decode) would discard the computed response
and return a 500, violating "logging failure must never fail the MCP call". Wrapped the
logging call in its own try/catch.

## Notes for later

- Usage logging is awaited per-request (adds one insert of latency to remote MCP calls).
  Fine at current volume; if it shows up in its own dashboard, batch or queue it.
- `USAGE_LOG_MCP_HTTP=0` disables, `USAGE_SAMPLE_RATE` (0..1) samples — document in VPS
  env when staging picks this up.
