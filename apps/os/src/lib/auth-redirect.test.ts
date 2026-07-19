import { describe, expect, it } from "vitest";
import {
  getPostAuthDestination,
  getPostAuthScopePath,
  shouldLinkGoogleAfterPassword,
} from "./auth-redirect";

const ORIGIN = "https://companyos.test";

describe("getPostAuthDestination", () => {
  it("preserves a safe normal redirect path", () => {
    expect(
      getPostAuthDestination(new URLSearchParams({ redirect: "/s/acme?tab=docs" }), ORIGIN),
    ).toBe("/s/acme?tab=docs");
  });

  it("resumes an MCP OAuth authorization request before normal navigation", () => {
    const searchParams = new URLSearchParams({
      client_id: "mcp-client",
      redirect_uri: "http://127.0.0.1:8765/callback",
      response_type: "code",
      scope: "openid",
      state: "opaque-state",
    });

    expect(getPostAuthDestination(searchParams, ORIGIN)).toBe(
      "/api/auth/oauth2/authorize?" + searchParams.toString(),
    );
  });

  it("removes sign-in-only state when resuming MCP OAuth after Google linking", () => {
    const searchParams = new URLSearchParams({
      client_id: "mcp-client",
      redirect_uri: "http://127.0.0.1:8765/callback",
      response_type: "code",
      state: "opaque-state",
      google_link: "1",
      error: "account_not_linked",
      error_description: "link required",
    });

    expect(getPostAuthDestination(searchParams, ORIGIN)).toBe(
      "/api/auth/oauth2/authorize?client_id=mcp-client"
      + "&redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcallback"
      + "&response_type=code&state=opaque-state",
    );
  });

  it.each([
    "//attacker.example/path",
    "/\\attacker.example/path",
    "https://attacker.example/path",
    "not a path",
    "/%5Cattacker.example/path",
    "/%",
  ])("falls back to root for an unsafe redirect: %s", (redirect) => {
    expect(getPostAuthDestination(new URLSearchParams({ redirect }), ORIGIN)).toBe("/s/root");
  });
});

describe("getPostAuthScopePath", () => {
  it("keeps the first visible project as the preferred landing scope", () => {
    expect(getPostAuthScopePath([
      { type: "personal", path: "personal-user-1" },
      { type: "project", path: "acme" },
      { type: "project", path: "beta" },
    ])).toBe("/s/acme");
  });

  it("falls back to the visible personal scope when no project is available", () => {
    expect(getPostAuthScopePath([
      { type: "personal", path: "personal-user-1" },
    ])).toBe("/s/personal-user-1");
  });

  it("returns null when there is no accessible landing scope", () => {
    expect(getPostAuthScopePath([])).toBeNull();
  });
});

describe("shouldLinkGoogleAfterPassword", () => {
  it.each(["account_not_linked", "unable_to_link_account"])(
    "continues an explicit Google link after %s",
    (error) => {
      expect(shouldLinkGoogleAfterPassword(new URLSearchParams({
        google_link: "1",
        error,
      }))).toBe(true);
    },
  );

  it("does not link after an unrelated Google error", () => {
    expect(shouldLinkGoogleAfterPassword(new URLSearchParams({
      google_link: "1",
      error: "access_denied",
    }))).toBe(false);
  });

  it("does not link without a marked Google attempt", () => {
    expect(shouldLinkGoogleAfterPassword(new URLSearchParams({
      error: "account_not_linked",
    }))).toBe(false);
  });
});
