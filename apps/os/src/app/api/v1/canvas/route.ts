/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { saveCanvas, getCanvas, listCanvases, AccessDeniedError, ScopeNotFoundError, CanvasNotFoundError, CanvasSizeError } from "@companyos/api";
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
      const cv = await getCanvas(db, { scopePath, slug }, principalId);
      if (!cv) {
        return jsonError(`Canvas not found: ${slug}`, 404);
      }
      return Response.json({
        ok: true,
        canvas: {
          id: cv.id,
          slug: cv.slug,
          name: cv.name,
          scene: cv.scene,
          updated_at: cv.updatedAt,
          archived_at: cv.archivedAt,
        },
      });
    }

    const list = await listCanvases(db, { scopePath, includeArchived }, principalId);
    return Response.json({ ok: true, canvases: list });
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

export async function POST(req: Request) {
  try {
    const { principalId } = await authenticateAgentRequest(req);
    const body = await req.json().catch(() => ({}));
    const { scope, scopePath, slug, name, scene } = body;
    const sp = scope || scopePath;
    if (!sp || !name) {
      return jsonError("Missing scope or name in body", 400);
    }
    const saved = await saveCanvas(db, { scopePath: sp, slug, name, scene }, principalId);
    return Response.json({
      ok: true,
      canvas: {
        id: saved.id,
        slug: saved.slug,
        name: saved.name,
        updated_at: saved.updatedAt,
      },
    });
  } catch (e: any) {
    if (e instanceof AccessDeniedError) {
      return forbidden({ requires: `${e.requiredRole} on ${e.scopePath}` });
    }
    if (e instanceof ScopeNotFoundError) {
      return jsonError(e.message, 404);
    }
    if (e instanceof CanvasNotFoundError) {
      return jsonError(e.message, 404);
    }
    if (e instanceof CanvasSizeError) {
      return jsonError(e.message, 413);
    }
    if (e?.status === 401) {
      return unauthorized();
    }
    return jsonError(e?.message || "Bad request", e?.status || 400);
  }
}
