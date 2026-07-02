#!/usr/bin/env node
/**
 * CompanyOS MCP stdio entrypoint.
 * Usage: COS_TOKEN=cos_xxx DATABASE_URL=postgres://... companyos-mcp
 *
 * Authenticates on startup via kernel authenticateToken.
 * Unauthenticated principals cause all protected tools to return auth error (server still runs).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDb } from "@companyos/db";
import { authenticateToken } from "@companyos/api";
import { createServer } from "./server.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(databaseUrl);
  const token = process.env.COS_TOKEN || "";
  let principalId: string | null = null;

  try {
    const principal = await authenticateToken(db, token);
    principalId = principal?.id ?? null;
    if (!principalId) {
      console.error("[mcp] Warning: unauthenticated (invalid/expired/missing COS_TOKEN). Tools will return auth errors.");
    } else {
      console.error(`[mcp] Authenticated as principal ${principalId}`);
    }
  } catch (e) {
    console.error("[mcp] Auth error on startup:", (e as Error).message);
    // continue unauth
  }

  const server = createServer({ db, principalId });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdio transport keeps process alive
}

main().catch((err) => {
  console.error("Fatal MCP error:", err);
  process.exit(1);
});
