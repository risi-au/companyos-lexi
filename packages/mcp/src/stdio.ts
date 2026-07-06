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
import { authenticateToken, PlaneClient } from "@companyos/api";
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

  let planeClient: PlaneClient | null = null;
  const planeBase = process.env.PLANE_BASE_URL;
  const planeToken = process.env.PLANE_API_TOKEN;
  const planeWs = process.env.PLANE_WORKSPACE_SLUG;
  if (planeBase && planeToken && planeWs) {
    try {
      planeClient = new PlaneClient({ baseUrl: planeBase, apiToken: planeToken, workspaceSlug: planeWs });
      console.error("[mcp] Plane client configured");
    } catch (e) {
      console.error("[mcp] Plane client init failed (continuing without):", (e as Error).message);
    }
  } else {
    console.error("[mcp] Plane not configured (PLANE_* missing); task tools will return clear error.");
  }

  const server = createServer({ db, principalId, planeClient, mcpPublicUrl: process.env.MCP_PUBLIC_URL || null });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdio transport keeps process alive
}

main().catch((err) => {
  console.error("Fatal MCP error:", err);
  process.exit(1);
});
