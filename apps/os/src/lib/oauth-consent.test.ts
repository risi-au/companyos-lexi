import { describe, expect, it } from "vitest";
import { buildOAuthConsentCall } from "./oauth-consent";

const base = {
  headers: new Headers({ cookie: "better-auth.session_token=abc" }),
  baseUrl: "https://companyos.example",
  accept: true,
  scope: "openid profile",
  oauthQuery: "client_id=c1&response_type=code&sig=deadbeef",
};

describe("buildOAuthConsentCall", () => {
  // Regression for #95: the consent server action 401'd ("request not found")
  // because it invoked auth.api.oauth2Consent without a request. better-auth's
  // re-entered authorizeEndpoint requires ctx.request to be a real Request.
  it("passes a real Request so authorizeEndpoint's ctx.request guard is satisfied", () => {
    const call = buildOAuthConsentCall(base);
    expect(call.request).toBeInstanceOf(Request);
    expect(call.request.url).toBe("https://companyos.example/api/auth/oauth2/consent");
    expect(call.request.headers.get("cookie")).toBe("better-auth.session_token=abc");
  });

  // Passing a Request flips better-auth's asResponse default to true (would return
  // a Response instead of the { url } the action consumes) unless we pin it false.
  it("pins asResponse to false to keep the { url } return shape", () => {
    expect(buildOAuthConsentCall(base).asResponse).toBe(false);
  });

  it("forwards accept and the signed oauth_query verbatim", () => {
    const call = buildOAuthConsentCall({ ...base, accept: false });
    expect(call.body.accept).toBe(false);
    expect(call.body.oauth_query).toBe(base.oauthQuery);
    expect(call.body.scope).toBe("openid profile");
  });

  it("sends scope as undefined when empty (better-auth then falls back to the client's scopes)", () => {
    expect(buildOAuthConsentCall({ ...base, scope: "" }).body.scope).toBeUndefined();
  });
});
