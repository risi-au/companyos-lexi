import { describe, expect, it } from "vitest";
import { tokenRequestWithDefaultResource } from "./oauth-resource";

const MCP = "https://cos-staging.risi.au/api/mcp";

describe("tokenRequestWithDefaultResource", () => {
  it("defaults an absent resource for authorization_code", () => {
    expect(tokenRequestWithDefaultResource({ grant_type: "authorization_code" }, MCP)).toEqual({
      grant_type: "authorization_code",
      resource: MCP,
    });
  });

  it("defaults an absent resource for refresh_token (else the refreshed token goes opaque)", () => {
    expect(tokenRequestWithDefaultResource({ grant_type: "refresh_token" }, MCP)).toEqual({
      grant_type: "refresh_token",
      resource: MCP,
    });
  });

  it("preserves all other token-request fields when defaulting", () => {
    const body = {
      grant_type: "authorization_code",
      code: "abc",
      code_verifier: "verifier",
      client_id: "client",
      redirect_uri: "http://127.0.0.1:5000/cb",
    };
    expect(tokenRequestWithDefaultResource(body, MCP)).toEqual({ ...body, resource: MCP });
  });

  it("does not touch client_credentials (separate audience policy)", () => {
    expect(
      tokenRequestWithDefaultResource({ grant_type: "client_credentials" }, MCP),
    ).toBeUndefined();
  });

  it("does not touch an unknown/missing grant_type", () => {
    expect(tokenRequestWithDefaultResource({ code: "abc" }, MCP)).toBeUndefined();
  });

  it("leaves a client-supplied string resource untouched", () => {
    expect(
      tokenRequestWithDefaultResource(
        { grant_type: "authorization_code", resource: "https://other.example/api" },
        MCP,
      ),
    ).toBeUndefined();
  });

  it("leaves malformed supplied resources untouched (null / empty / array) for better-auth to reject", () => {
    expect(
      tokenRequestWithDefaultResource({ grant_type: "authorization_code", resource: null }, MCP),
    ).toBeUndefined();
    expect(
      tokenRequestWithDefaultResource({ grant_type: "authorization_code", resource: "" }, MCP),
    ).toBeUndefined();
    expect(
      tokenRequestWithDefaultResource(
        { grant_type: "authorization_code", resource: ["a", "b"] },
        MCP,
      ),
    ).toBeUndefined();
  });

  it("does not modify a missing or non-object body", () => {
    expect(tokenRequestWithDefaultResource(undefined, MCP)).toBeUndefined();
    expect(tokenRequestWithDefaultResource(null, MCP)).toBeUndefined();
    expect(tokenRequestWithDefaultResource("grant_type=authorization_code", MCP)).toBeUndefined();
  });

  it("returns a new object, not the same reference (no in-place mutation)", () => {
    const body = { grant_type: "authorization_code" };
    const result = tokenRequestWithDefaultResource(body, MCP);
    expect(result).not.toBe(body);
    expect(body).not.toHaveProperty("resource");
  });
});
