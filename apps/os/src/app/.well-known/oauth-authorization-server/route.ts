import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";
import { applyIssParamAdvertisement, shouldAdvertiseIssParam } from "@/lib/oauth-metadata";

export const runtime = "nodejs";

const baseHandler = oauthProviderAuthServerMetadata(auth, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
  },
});

// better-auth hardcodes `authorization_response_iss_parameter_supported: true` in the AS
// metadata (oauth-provider index.mjs). We DO send `iss` in authorization responses, but
// advertising the flag tells clients to REQUIRE the callback issuer (rmcp/oauth2 — Codex,
// VS Code — set require_issuer from it). Codex drops `iss` before its local validation, so the
// check fails "missing required issuer" (see DIAG + #100). Unless advertising is explicitly
// enabled, downgrade the flag to false so those clients complete. Tradeoff documented in
// lib/oauth-metadata.ts: this weakens metadata-driven RFC 9207 enforcement for clients that
// key off the flag; we still emit `iss` for clients that inspect it independently.
export async function GET(request: Request): Promise<Response> {
  const response = await baseHandler(request);
  if (shouldAdvertiseIssParam() || !response.ok) return response;

  let metadata: Record<string, unknown>;
  try {
    metadata = (await response.clone().json()) as Record<string, unknown>;
  } catch {
    return response;
  }
  const adjusted = applyIssParamAdvertisement(metadata, false);
  if (adjusted === metadata) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(adjusted), { status: response.status, headers });
}
