import "server-only";
import { createHttpHandler } from "@companyos/mcp";
import { authenticateAgentRequest, db } from "@/lib/agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createHttpHandler({
  db,
  authenticateRequest: authenticateAgentRequest,
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
