/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { writeMetrics, AccessDeniedError, ScopeNotFoundError } from "@companyos/api";
import {
  authenticateAgentRequest,
  unauthorized,
  forbidden,
  jsonError,
  db,
} from "@/lib/agent-auth";

export async function POST(req: Request) {
  try {
    const { principalId } = await authenticateAgentRequest(req);
    const body = await req.json().catch(() => ({}));
    const scopePath = (body?.scope ?? body?.scopePath) as string;
    const points = body?.points;

    if (!scopePath || !Array.isArray(points)) {
      return jsonError("Invalid body: require { scope: string, points: MetricPointInput[] }");
    }

    const result = await writeMetrics(db, { scopePath, points }, principalId);
    return Response.json({ ok: true, written: result.written, metrics: result.metrics });
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
