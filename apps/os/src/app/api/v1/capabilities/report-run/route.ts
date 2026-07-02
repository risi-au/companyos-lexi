/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { reportCapabilityRun, AccessDeniedError } from "@companyos/api";
import {
  authenticateAgentRequest,
  unauthorized,
  jsonError,
  db,
} from "@/lib/agent-auth";

export async function POST(req: Request) {
  try {
    const { principalId } = await authenticateAgentRequest(req);
    const body = await req.json().catch(() => ({}));
    // scope optional for stub; capability required
    const input = {
      scopePath: (body?.scope ?? body?.scopePath) as string | undefined,
      capability: (body?.capability ?? body?.name ?? "unknown") as string,
      status: body?.status,
      summary: body?.summary,
      runId: body?.runId ?? body?.id,
      durationMs: body?.durationMs,
      ...body, // pass through extra for payload
    };
    if (!input.capability) {
      return jsonError("capability (or name) is required");
    }
    await reportCapabilityRun(db, input, principalId);
    return Response.json({ ok: true, reported: input.capability });
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
