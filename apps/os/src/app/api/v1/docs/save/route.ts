/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { saveDoc, AccessDeniedError, ScopeNotFoundError } from "@companyos/api";
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
    const slug = body?.slug as string | undefined;
    const title = body?.title as string;
    const bodyMd = body?.body_md ?? body?.bodyMd ?? "";

    if (!scopePath || !title) {
      return jsonError("Invalid body: require { scope, title, body_md?, slug? }");
    }

    const doc = await saveDoc(db, { scopePath, slug, title, bodyMd }, principalId);
    return Response.json({ ok: true, id: doc.id, slug: doc.slug, title: doc.title });
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
