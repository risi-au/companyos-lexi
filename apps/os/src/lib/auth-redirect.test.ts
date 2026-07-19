import { describe, expect, it } from "vitest";
import { getPostAuthDestination } from "./auth-redirect";

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
