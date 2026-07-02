/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and, desc, isNull } from "drizzle-orm";
import { canvases } from "@companyos/db";
import type { Canvas } from "@companyos/db";
import {
  emitEvent,
  type DB,
} from "../../kernel/events";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import {
  ScopeNotFoundError,
  CanvasNotFoundError,
  CanvasSizeError,
} from "../../errors";

const MAX_SCENE_BYTES = 2 * 1024 * 1024; // 2MB cap per brief
const SLUG_REGEX = /^[a-z0-9-]+$/;

function slugify(input: string): string {
  const s = (input || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return s || "untitled";
}

function getSceneSize(scene: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(scene ?? {})).length;
  } catch {
    return JSON.stringify(scene ?? {}).length;
  }
}

export interface SaveCanvasInput {
  scopePath: string;
  slug?: string;
  name: string;
  scene?: unknown;
}

export async function saveCanvas(
  db: DB,
  input: SaveCanvasInput,
  actorPrincipalId: string
): Promise<Canvas> {
  const { scopePath, name, scene = {} } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  // size cap check
  const size = getSceneSize(scene);
  if (size > MAX_SCENE_BYTES) {
    throw new CanvasSizeError(size, MAX_SCENE_BYTES);
  }

  // compute slug: provided or slugify(name)
  let slug = (input.slug || "").trim();
  const isAutoSlug = !slug;
  if (isAutoSlug) {
    slug = slugify(name);
  }
  if (!SLUG_REGEX.test(slug)) {
    slug = slugify(slug);
  }
  if (!slug) slug = "untitled";

  if (isAutoSlug) {
    const base = slug;
    let candidate = base;
    let attempt = 0;
    while (true) {
      const [found] = (await db
        .select({ id: canvases.id })
        .from(canvases)
        .where(and(eq(canvases.scopeId, scope.id), eq(canvases.slug, candidate)))
        .limit(1)) as { id: string }[];
      if (!found) {
        slug = candidate;
        break;
      }
      attempt++;
      if (attempt === 1) {
        candidate = `${base}-2`;
      } else {
        candidate = `${base}-${attempt + 1}`;
      }
      if (attempt > 50) {
        slug = candidate;
        break;
      }
    }
  }

  // upsert by (scope_id, slug)
  const [existing] = (await db
    .select()
    .from(canvases)
    .where(and(eq(canvases.scopeId, scope.id), eq(canvases.slug, slug)))
    .limit(1)) as Canvas[];

  const now = new Date();
  let saved: Canvas;

  if (existing) {
    const [updated] = (await db
      .update(canvases)
      .set({
        name,
        scene: scene as any,
        updatedBy: actorPrincipalId,
        updatedAt: now,
        // leave archivedAt as-is
      })
      .where(eq(canvases.id, existing.id))
      .returning()) as Canvas[];
    if (!updated) {
      throw new Error("Failed to update canvas");
    }
    saved = updated;
  } else {
    const [created] = (await db
      .insert(canvases)
      .values({
        scopeId: scope.id,
        slug,
        name,
        scene: scene as any,
        updatedBy: actorPrincipalId,
      })
      .returning()) as Canvas[];
    if (!created) {
      throw new Error("Failed to create canvas");
    }
    saved = created;
  }

  await emitEvent(db, {
    type: "canvas.saved",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug: saved.slug, name: saved.name, canvasId: saved.id },
  });

  return saved;
}

export interface GetCanvasInput {
  scopePath: string;
  slug: string;
}

export async function getCanvas(
  db: DB,
  input: GetCanvasInput,
  actorPrincipalId: string
): Promise<Canvas | null> {
  const { scopePath, slug } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return null;
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const [cv] = (await db
    .select()
    .from(canvases)
    .where(and(eq(canvases.scopeId, scope.id), eq(canvases.slug, slug)))
    .limit(1)) as Canvas[];

  return cv ?? null;
}

export interface ListCanvasesInput {
  scopePath: string;
  includeArchived?: boolean;
}

export async function listCanvases(
  db: DB,
  input: ListCanvasesInput,
  actorPrincipalId: string
): Promise<Array<{ id: string; slug: string; name: string; updatedAt: Date }>> {
  const { scopePath, includeArchived = false } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const conditions: any[] = [eq(canvases.scopeId, scope.id)];
  if (!includeArchived) {
    conditions.push(isNull(canvases.archivedAt));
  }

  const rows = (await db
    .select({
      id: canvases.id,
      slug: canvases.slug,
      name: canvases.name,
      updatedAt: canvases.updatedAt,
    })
    .from(canvases)
    .where(and(...conditions))
    .orderBy(desc(canvases.updatedAt))) as Array<{ id: string; slug: string; name: string; updatedAt: Date }>;

  return rows;
}

export interface ArchiveCanvasInput {
  scopePath: string;
  slug: string;
}

export async function archiveCanvas(
  db: DB,
  input: ArchiveCanvasInput,
  actorPrincipalId: string
): Promise<Canvas> {
  const { scopePath, slug } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const [existing] = (await db
    .select()
    .from(canvases)
    .where(and(eq(canvases.scopeId, scope.id), eq(canvases.slug, slug)))
    .limit(1)) as Canvas[];

  if (!existing) {
    throw new CanvasNotFoundError(scopePath, slug);
  }

  const now = new Date();
  const [updated] = (await db
    .update(canvases)
    .set({
      archivedAt: now,
      updatedAt: now,
      updatedBy: actorPrincipalId,
    })
    .where(eq(canvases.id, existing.id))
    .returning()) as Canvas[];

  if (!updated) {
    throw new CanvasNotFoundError(scopePath, slug);
  }

  await emitEvent(db, {
    type: "canvas.archived",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug, name: updated.name, canvasId: updated.id },
  });

  return updated;
}
