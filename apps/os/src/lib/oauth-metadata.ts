/**
 * RFC 9207 (`authorization_response_iss_parameter_supported`) advertisement policy for the
 * OAuth Authorization Server metadata.
 *
 * We always SEND the `iss` authorization-response parameter. Advertising the flag, however,
 * tells clients to REQUIRE the callback issuer: the rmcp/oauth2 stack (Codex, VS Code) sets
 * `require_issuer=true` from it. Codex's callback handler drops `iss` before its local
 * authorization-response validation, so the required-issuer check then fails with
 * "missing required issuer" (#100). Setting the flag to `false` stops affected clients from
 * requiring the callback issuer, letting the flow complete. Default OFF for client
 * compatibility; set `OAUTH_ADVERTISE_ISS_PARAM=true` to restore advertisement.
 *
 * Tradeoff (not free): turning the flag off temporarily weakens metadata-driven RFC 9207
 * mix-up enforcement for clients that key off it. We still send `iss`, so a client that
 * independently inspects it can still validate — but clients that decide based on the flag will
 * not. Mix-up risk depends on whether a CLIENT talks to multiple authorization servers (an MCP
 * client may have several configured), not on how many this service runs. Prefer re-enabling
 * once target clients handle the callback `iss` correctly.
 */
export function shouldAdvertiseIssParam(): boolean {
  return process.env.OAUTH_ADVERTISE_ISS_PARAM === "true";
}

/**
 * Returns metadata with `authorization_response_iss_parameter_supported` downgraded to `false`
 * when advertising is disabled. Returns the SAME object reference when no change is needed, so
 * callers can cheaply detect a no-op.
 */
export function applyIssParamAdvertisement<T extends Record<string, unknown>>(
  metadata: T,
  advertise: boolean,
): T {
  if (advertise) return metadata;
  if (metadata.authorization_response_iss_parameter_supported !== true) return metadata;
  return { ...metadata, authorization_response_iss_parameter_supported: false };
}
