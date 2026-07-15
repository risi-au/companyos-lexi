import "server-only";
import { createDb } from "@companyos/db";
import { authenticateTokenWithMetadata, getPrincipalForAuthUser } from "@companyos/api";
import type { Principal } from "@companyos/db";
import { verifyAccessToken } from "better-auth/oauth2";
import { getCompanyOsPublicUrl, getJwksUrl, getMcpProtectedResourceMetadataUrl, getMcpPublicUrl } from "@/lib/mcp-public-url";
import { mapOAuthPayloadToPrincipal } from "@/lib/oauth-token";

const db = createDb();

export { db };

export interface AgentPrincipal {
  principalId: string;
  principal: Principal;
  tokenId?: string;
  oauthClientId?: string;
}

type UnauthorizedError = Error & { status?: number; wwwAuthenticate?: string };

function unauthorizedError(message: string): UnauthorizedError {
  const error = new Error(message) as UnauthorizedError;
  error.status = 401;
  error.wwwAuthenticate = `Bearer resource_metadata="${getMcpProtectedResourceMetadataUrl()}"`;
  return error;
}

export async function getOAuthPrincipalForPayload(payload: { sub?: unknown; aud?: unknown; azp?: unknown; scope?: unknown }): Promise<AgentPrincipal | null> {
  return mapOAuthPayloadToPrincipal(payload, getMcpPublicUrl(), (authUserId) => getPrincipalForAuthUser(db, authUserId));
}

async function authenticateOAuthAccessToken(token: string): Promise<AgentPrincipal | null> {
  // Verify through the OAuth provider's access-token verifier, NOT the generic
  // jwt-plugin verifier. This enforces the MCP endpoint as the required audience
  // and the CompanyOS issuer, so a session JWT minted at /api/auth/token (whose
  // audience is the app origin, not the MCP URL) is rejected before principal
  // mapping. Signature is checked locally against the published JWKS.
  const payload = await verifyAccessToken(token, {
    verifyOptions: {
      audience: getMcpPublicUrl(),
      issuer: getCompanyOsPublicUrl(),
    },
    jwksUrl: getJwksUrl(),
  });
  return getOAuthPrincipalForPayload(payload);
}

export async function authenticateAgentRequest(req: Request): Promise<AgentPrincipal> {
  const authz = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authz || !authz.toLowerCase().startsWith("bearer ")) {
    throw unauthorizedError("Missing or invalid Authorization header");
  }
  const token = authz.slice(7).trim();
  if (token.startsWith("cos_")) {
    const authenticated = await authenticateTokenWithMetadata(db, token);
    if (!authenticated) throw unauthorizedError("Invalid or expired token");
    return { principalId: authenticated.principal.id, principal: authenticated.principal, tokenId: authenticated.tokenId };
  }

  try {
    const authenticated = await authenticateOAuthAccessToken(token);
    if (authenticated) return authenticated;
  } catch {
    // Authentication failures must have one indistinguishable response shape.
  }
  throw unauthorizedError("Invalid or expired access token");
}

export function jsonError(error: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error, ...(extra || {}) }, { status });
}

export function unauthorized(extra?: { requires?: string }) {
  return jsonError("Unauthorized", 401, extra);
}

export function forbidden(extra?: { requires?: string }) {
  return jsonError("Forbidden", 403, extra);
}
