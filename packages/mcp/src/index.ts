import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function ping(): string {
  return "pong";
}

export function createServer() {
  const server = new McpServer({
    name: "companyos",
    version: "0.0.0",
  });

  server.tool("ping", "Health check", {}, async () => ({
    content: [{ type: "text", text: ping() }],
  }));

  return server;
}