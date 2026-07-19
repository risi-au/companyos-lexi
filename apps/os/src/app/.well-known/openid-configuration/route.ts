import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";
import { applyIssParamAdvertisement, shouldAdvertiseIssParam } from "@/lib/oauth-metadata";

export const runtime = "nodejs";

const baseHandler = oauthProviderOpenIdConfigMetadata(auth, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
  },
});

// Keep OIDC discovery aligned with the authorization-server metadata route: better-auth
// advertises RFC 9207 issuer-response support by default, but Codex/rmcp cannot consume it.
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
