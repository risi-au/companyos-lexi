/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { getContextBundle, AccessDeniedError, ScopeNotFoundError } from "@companyos/api";
import {
  authenticateAgentRequest,
  unauthorized,
  forbidden,
  jsonError,
  db,
} from "@/lib/agent-auth";

export async function GET(req: Request) {
  try {
    const { principalId } = await authenticateAgentRequest(req);
    const url = new URL(req.url);
    const scopePath = url.searchParams.get("scope") || url.searchParams.get("scopePath");
    if (!scopePath) {
      return jsonError("Missing ?scope= query param");
    }
    const md = await getContextBundle(db, scopePath, principalId);
    return Response.json({ context: md });
  } catch (e: any) {
    if (e instanceof AccessDeniedError) {
      return forbidden({ requires: `${e.requiredRole} on ${e.scopePath}` });
    }
    if (e instanceof ScopeNotFoundError) {
      return jsonError(e.message, 404);
    }
    if (e?.status === 401) {
      return unauthorized();
    }
    return jsonError(e?.message || "Bad request", e?.status || 400);
  }
}
