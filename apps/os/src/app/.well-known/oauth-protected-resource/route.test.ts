import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const originalMcpPublicUrl = process.env.MCP_PUBLIC_URL;
const originalCompanyOsUrl = process.env.COMPANYOS_URL;

afterEach(() => {
  process.env.MCP_PUBLIC_URL = originalMcpPublicUrl;
  process.env.COMPANYOS_URL = originalCompanyOsUrl;
});

describe("OAuth protected-resource metadata", () => {
  it("returns the MCP resource and authorization server with CORS", async () => {
    process.env.MCP_PUBLIC_URL = "https://companyos.example/api/mcp";
    process.env.COMPANYOS_URL = "https://companyos.example";
    const response = await GET();

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({
      resource: "https://companyos.example/api/mcp",
      authorization_servers: ["https://companyos.example"],
    });
  });
});
