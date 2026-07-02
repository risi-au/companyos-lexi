/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { getDoc, listDocs, AccessDeniedError, ScopeNotFoundError } from "@companyos/api";
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
    const slug = url.searchParams.get("slug") || undefined;
    const includeArchived = url.searchParams.get("includeArchived") === "1" || url.searchParams.get("include_archived") === "1";

    if (!scopePath) {
      return jsonError("Missing ?scope= query param");
    }

    if (slug) {
      const doc = await getDoc(db, { scopePath, slug }, principalId);
      if (!doc) {
        return jsonError(`Document not found: ${slug}`, 404);
      }
      return Response.json({
        ok: true,
        document: {
          id: doc.id,
          slug: doc.slug,
          title: doc.title,
          body_md: doc.bodyMd,
          updated_at: doc.updatedAt,
          archived_at: doc.archivedAt,
        },
      });
    }

    const list = await listDocs(db, { scopePath, includeArchived }, principalId);
    return Response.json({ ok: true, documents: list });
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
