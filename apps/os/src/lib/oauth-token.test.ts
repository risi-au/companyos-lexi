import { describe, expect, it } from "vitest";
import type { Principal } from "@companyos/db";
import { mapOAuthPayloadToPrincipal } from "./oauth-token";

const principal: Principal = {
  id: "principal-1",
  kind: "human",
  name: "OAuth User",
  email: "oauth@example.test",
  authUserId: "auth-user-1",
  status: "active",
  createdAt: new Date(),
};

describe("OAuth access-token principal mapping", () => {
  it("rejects a JWT payload for a different MCP audience", async () => {
    const result = await mapOAuthPayloadToPrincipal(
      { sub: "auth-user-1", aud: "https://other.example/api/mcp", azp: "mcp-client-1" },
      "https://companyos.example/api/mcp",
      async () => principal,
    );
    expect(result).toBeNull();
  });

  it("rejects a generic session JWT (correct audience but no azp/client claim)", async () => {
    const result = await mapOAuthPayloadToPrincipal(
      { sub: "auth-user-1", aud: "https://companyos.example/api/mcp" },
      "https://companyos.example/api/mcp",
      async () => principal,
    );
    expect(result).toBeNull();
  });

  it("maps a valid OAuth subject to its linked kernel principal", async () => {
    const result = await mapOAuthPayloadToPrincipal(
      { sub: "auth-user-1", aud: "https://companyos.example/api/mcp", azp: "mcp-client-1" },
      "https://companyos.example/api/mcp",
      async (authUserId) => authUserId === principal.authUserId ? principal : null,
    );
    expect(result).toMatchObject({
      principalId: "principal-1",
      oauthClientId: "mcp-client-1",
      principal,
    });
  });
});
