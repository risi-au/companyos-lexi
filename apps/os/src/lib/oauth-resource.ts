/**
 * RFC 8707 resource defaulting for OAuth token requests.
 *
 * better-auth only mints a JWT access token (bound to `aud=<resource>`) when the token request
 * carries a `resource`. When it's absent, better-auth issues an OPAQUE access token with no
 * audience — which our `/api/mcp` JWT verifier rejects, so clients that omit `resource` (e.g.
 * Claude Desktop) fail with "the integration rejected the credentials it just issued". Codex
 * sends `resource` already, so defaulting is a no-op for it.
 *
 * We default the resource to the MCP endpoint so every access token is a JWT bound to the MCP
 * audience and the resource server keeps enforcing that audience.
 *
 * Scope of the defaulting (deliberately narrow):
 * - Only the grants an MCP user-client uses: `authorization_code` and `refresh_token`.
 *   Both re-derive the access-token audience from the *request* body's `resource`
 *   (`createUserTokens` -> `checkResource`), so the refresh grant needs the same default or the
 *   refreshed token would go opaque and 401 after the initial token expires. `client_credentials`
 *   (and any other grant) is left untouched — its audience policy is a separate decision.
 * - Only when `resource` is *entirely absent* (`undefined`). A supplied-but-malformed value
 *   (null, empty string, array, …) is left in place so better-auth validates and rejects it —
 *   we don't paper over a client error, and we stay fail-closed.
 * - The token grant does not cross-check `resource` against the authorization request, so
 *   setting it at the token endpoint is sufficient. See docs/tasks/DIAG-mcp-oauth-invalid-redirect.md.
 */
const RESOURCE_DEFAULTING_GRANTS = new Set(["authorization_code", "refresh_token"]);

/**
 * Returns a field-preserving copy of the token-request body with `resource` defaulted to
 * `mcpUrl`, or `undefined` (no change) when defaulting does not apply — a non-object body, a
 * non-defaulting grant, or a body that already carries any `resource` value.
 */
export function tokenRequestWithDefaultResource(
  body: unknown,
  mcpUrl: string,
): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (!RESOURCE_DEFAULTING_GRANTS.has(record.grant_type as string)) return undefined;
  if (record.resource !== undefined) return undefined;
  return { ...record, resource: mcpUrl };
}
