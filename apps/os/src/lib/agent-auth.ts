import "server-only";
import { createDb } from "@companyos/db";
import { authenticateToken } from "@companyos/api";
import type { Principal } from "@companyos/db";

const db = createDb();

export { db }; // for thin route handlers (agent token paths)

export interface AgentPrincipal {
  principalId: string;
  principal: Principal;
}

/**
 * Authenticates a bearer token from Authorization: Bearer cos_...
 * Returns principal or throws with status 401.
 */
export async function authenticateAgentRequest(req: Request): Promise<AgentPrincipal> {
  const authz = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authz || !authz.toLowerCase().startsWith("bearer ")) {
    const e = new Error("Missing or invalid Authorization header. Use: Authorization: Bearer cos_...") as Error & { status?: number };
    e.status = 401;
    throw e;
  }
  const token = authz.slice(7).trim();
  const principal = await authenticateToken(db, token);
  if (!principal) {
    const e = new Error("Invalid or expired token") as Error & { status?: number };
    e.status = 401;
    throw e;
  }
  return { principalId: principal.id, principal };
}

export function jsonError(error: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error, ...(extra || {}) }, { status });
}

export function unauthorized(extra?: { requires?: string }) {
  return jsonError("Unauthorized", 401, extra);
}

export function forbidden(extra?: { requires?: string }) {
  return jsonError("Forbidden", 403, extra);
}
