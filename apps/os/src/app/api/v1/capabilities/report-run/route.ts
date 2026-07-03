/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { AccessDeniedError } from "@companyos/api";
import {
  authenticateAgentRequest,
  unauthorized,
  jsonError,
  db,
} from "@/lib/agent-auth";
import { mapCapabilityReportBody, recordCapabilityReport } from "./logic";

export async function POST(req: Request) {
  try {
    const { principalId } = await authenticateAgentRequest(req);
    const body = await req.json().catch(() => ({}));
    const result = await recordCapabilityReport(db, mapCapabilityReportBody(body), principalId);
    return Response.json(result);
  } catch (e: any) {
    if (e instanceof AccessDeniedError) {
      return jsonError("Forbidden", 403, { requires: `${e.requiredRole} on ${e.scopePath}` });
    }
    if (e?.status === 401) {
      return unauthorized();
    }
    return jsonError(e?.message || "Bad request", e?.status || 400);
  }
}
