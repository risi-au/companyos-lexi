/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { createRecord, AccessDeniedError, ScopeNotFoundError } from "@companyos/api";
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
    const kind = body?.kind as any;
    const title = body?.title as string;
    const bodyMd = body?.body_md ?? body?.bodyMd ?? "";
    const data = body?.data ?? {};

    if (!scopePath || !kind || !title) {
      return jsonError("Invalid body: require { scope, kind, title, body_md?, data? }");
    }

    const rec = await createRecord(db, { scopePath, kind, title, bodyMd, data }, principalId);
    return Response.json({ ok: true, id: rec.id, kind: rec.kind, title: rec.title });
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
