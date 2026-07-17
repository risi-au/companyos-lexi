export interface OAuthConsentCall {
  headers: Headers;
  request: Request;
  asResponse: false;
  body: { accept: boolean; scope: string | undefined; oauth_query: string };
}

/**
 * Build the options for a programmatic `auth.api.oauth2Consent(...)` call from a
 * Next.js server action.
 *
 * better-auth's `oauth2Consent` re-enters its `authorizeEndpoint`, which hard-requires
 * a real `ctx.request` and otherwise throws `UNAUTHORIZED "request not found"`. A direct
 * `auth.api.*` call does NOT populate `ctx.request` unless a `request` is passed, so a
 * server action (which only has `headers()`) 401s on Approve. We forward a synthetic
 * Request carrying the caller's cookies to satisfy that guard.
 *
 * `asResponse: false` is required because better-auth defaults `asResponse` to
 * `isRequestLike(request)` — passing a Request would otherwise flip the return type to a
 * `Response`, breaking the `{ url }` the action consumes (and it re-throws the APIError
 * on failure, as the caller expects). See docs/tasks/DIAG-mcp-oauth-invalid-redirect.md (#95).
 */
export function buildOAuthConsentCall(params: {
  headers: Headers;
  baseUrl: string;
  accept: boolean;
  scope: string;
  oauthQuery: string;
}): OAuthConsentCall {
  return {
    headers: params.headers,
    request: new Request(`${params.baseUrl}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: params.headers,
    }),
    asResponse: false,
    body: {
      accept: params.accept,
      scope: params.scope || undefined,
      oauth_query: params.oauthQuery,
    },
  };
}
