import type { Principal } from "@companyos/db";

export interface OAuthAccessTokenPayload {
  sub?: unknown;
  aud?: unknown;
  azp?: unknown;
  scope?: unknown;
}

export function hasOAuthAudience(audience: unknown, expectedAudience: string): boolean {
  return typeof audience === "string"
    ? audience === expectedAudience
    : Array.isArray(audience) && audience.includes(expectedAudience);
}

export async function mapOAuthPayloadToPrincipal(
  payload: OAuthAccessTokenPayload,
  expectedAudience: string,
  findPrincipal: (authUserId: string) => Promise<Principal | null>,
): Promise<{ principalId: string; principal: Principal; oauthClientId?: string } | null> {
  // Require OAuth-provider-only claims (azp = granting client id, present on
  // access tokens minted through consent but never on a plain jwt-plugin session
  // JWT), plus the MCP audience. This blocks a session JWT from /api/auth/token
  // being replayed as an MCP access token without going through consent.
  if (typeof payload.sub !== "string") return null;
  if (typeof payload.azp !== "string" || payload.azp.length === 0) return null;
  if (!hasOAuthAudience(payload.aud, expectedAudience)) return null;
  const principal = await findPrincipal(payload.sub);
  if (!principal) return null;
  return {
    principalId: principal.id,
    principal,
    oauthClientId: payload.azp,
  };
}
