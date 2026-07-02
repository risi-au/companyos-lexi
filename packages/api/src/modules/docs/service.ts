/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and, desc, inArray, not, isNull } from "drizzle-orm";
import { documents, documentRevisions } from "@companyos/db";
import type { Document, DocumentRevision } from "@companyos/db";
import {
  emitEvent,
  type DB,
} from "../../kernel/events";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import {
  ScopeNotFoundError,
  DocumentNotFoundError,
} from "../../errors";

const MAX_REVISIONS = 50;
const SLUG_REGEX = /^[a-z0-9-]+$/;

function slugify(input: string): string {
  const s = (input || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return s || "untitled";
}

async function pruneOldRevisions(db: DB, documentId: string): Promise<void> {
  const revs = (await db
    .select({ id: documentRevisions.id })
    .from(documentRevisions)
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.createdAt))
    .limit(MAX_REVISIONS + 1)) as { id: string }[];

  if (revs.length > MAX_REVISIONS) {
    const keepIds = revs.slice(0, MAX_REVISIONS).map((r) => r.id);
    await db
      .delete(documentRevisions)
      .where(
        and(
          eq(documentRevisions.documentId, documentId),
          not(inArray(documentRevisions.id, keepIds))
        )
      );
  }
}

async function appendRevision(db: DB, documentId: string, title: string, bodyMd: string, savedBy: string): Promise<void> {
  await db.insert(documentRevisions).values({
    documentId,
    title,
    bodyMd,
    savedBy,
  });
  await pruneOldRevisions(db, documentId);
}

export interface SaveDocInput {
  scopePath: string;
  slug?: string;
  title: string;
  bodyMd?: string;
}

export async function saveDoc(
  db: DB,
  input: SaveDocInput,
  actorPrincipalId: string
): Promise<Document> {
  const { scopePath, title, bodyMd = "" } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  // compute effective slug: use provided or slugify(title); auto-slug gets collision suffix -2 etc.
  let slug = (input.slug || "").trim();
  const isAutoSlug = !slug;
  if (isAutoSlug) {
    slug = slugify(title);
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
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, candidate)))
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
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, slug)))
    .limit(1)) as Document[];

  const now = new Date();
  let saved: Document;

  if (existing) {
    const [updated] = (await db
      .update(documents)
      .set({
        title,
        bodyMd,
        updatedBy: actorPrincipalId,
        updatedAt: now,
        // leave archivedAt as-is (save does not auto-unarchive)
      })
      .where(eq(documents.id, existing.id))
      .returning()) as Document[];
    if (!updated) {
      throw new Error("Failed to update document");
    }
    saved = updated;
  } else {
    const [created] = (await db
      .insert(documents)
      .values({
        scopeId: scope.id,
        slug,
        title,
        bodyMd,
        position: 0,
        createdBy: actorPrincipalId,
        updatedBy: actorPrincipalId,
      })
      .returning()) as Document[];
    if (!created) {
      throw new Error("Failed to create document");
    }
    saved = created;
  }

  await appendRevision(db, saved.id, title, bodyMd, actorPrincipalId);

  await emitEvent(db, {
    type: "doc.saved",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug: saved.slug, title: saved.title, documentId: saved.id },
  });

  return saved;
}

export interface GetDocInput {
  scopePath: string;
  slug: string;
}

export async function getDoc(
  db: DB,
  input: GetDocInput,
  actorPrincipalId: string
): Promise<Document | null> {
  const { scopePath, slug } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return null;
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const [doc] = (await db
    .select()
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, slug)))
    .limit(1)) as Document[];

  return doc ?? null;
}

export interface ListDocsInput {
  scopePath: string;
  includeArchived?: boolean;
}

export async function listDocs(
  db: DB,
  input: ListDocsInput,
  actorPrincipalId: string
): Promise<Array<{ id: string; slug: string; title: string; updatedAt: Date }>> {
  const { scopePath, includeArchived = false } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const conditions: any[] = [eq(documents.scopeId, scope.id)];
  if (!includeArchived) {
    conditions.push(isNull(documents.archivedAt));
  }

  const rows = (await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(documents.position, documents.title)) as Array<{ id: string; slug: string; title: string; updatedAt: Date }>;

  return rows;
}

export interface RenameDocInput {
  scopePath: string;
  slug: string;
  newTitle?: string;
  newSlug?: string;
}

export async function renameDoc(
  db: DB,
  input: RenameDocInput,
  actorPrincipalId: string
): Promise<Document> {
  const { scopePath, slug, newTitle, newSlug } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const [existing] = (await db
    .select()
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, slug)))
    .limit(1)) as Document[];

  if (!existing) {
    throw new DocumentNotFoundError(scopePath, slug);
  }

  const updates: any = {
    updatedAt: new Date(),
    updatedBy: actorPrincipalId,
  };

  let finalSlug = slug;
  if (newSlug !== undefined && newSlug !== null) {
    let ns = String(newSlug).trim();
    if (!SLUG_REGEX.test(ns)) {
      ns = slugify(ns);
    }
    if (!ns) ns = slug;
    if (ns !== slug) {
      const [collide] = (await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, ns)))
        .limit(1)) as { id: string }[];
      if (collide) {
        throw new Error(`Slug already in use: ${ns}`);
      }
    }
    finalSlug = ns;
    updates.slug = finalSlug;
  }

  if (newTitle !== undefined && newTitle !== null) {
    updates.title = String(newTitle);
  }

  const [updated] = (await db
    .update(documents)
    .set(updates)
    .where(eq(documents.id, existing.id))
    .returning()) as Document[];

  if (!updated) {
    throw new DocumentNotFoundError(scopePath, slug);
  }

  await emitEvent(db, {
    type: "doc.renamed",
    scopePath,
    principalId: actorPrincipalId,
    payload: { oldSlug: slug, newSlug: updated.slug, title: updated.title, documentId: updated.id },
  });

  return updated;
}

export interface ArchiveDocInput {
  scopePath: string;
  slug: string;
}

export async function archiveDoc(
  db: DB,
  input: ArchiveDocInput,
  actorPrincipalId: string
): Promise<Document> {
  const { scopePath, slug } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const [existing] = (await db
    .select()
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, slug)))
    .limit(1)) as Document[];

  if (!existing) {
    throw new DocumentNotFoundError(scopePath, slug);
  }

  const now = new Date();
  const [updated] = (await db
    .update(documents)
    .set({
      archivedAt: now,
      updatedAt: now,
      updatedBy: actorPrincipalId,
    })
    .where(eq(documents.id, existing.id))
    .returning()) as Document[];

  if (!updated) {
    throw new DocumentNotFoundError(scopePath, slug);
  }

  await emitEvent(db, {
    type: "doc.archived",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug, title: updated.title, documentId: updated.id },
  });

  return updated;
}

export interface ListDocRevisionsInput {
  scopePath: string;
  slug: string;
  limit?: number;
}

export async function listDocRevisions(
  db: DB,
  input: ListDocRevisionsInput,
  actorPrincipalId: string
): Promise<DocumentRevision[]> {
  const { scopePath, slug, limit = 50 } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const [doc] = (await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, slug)))
    .limit(1)) as { id: string }[];

  if (!doc) {
    return [];
  }

  const effectiveLimit = Math.min(Math.max(1, limit), 200);
  const revs = (await db
    .select()
    .from(documentRevisions)
    .where(eq(documentRevisions.documentId, doc.id))
    .orderBy(desc(documentRevisions.createdAt))
    .limit(effectiveLimit)) as DocumentRevision[];

  return revs;
}

export interface RevertDocInput {
  scopePath: string;
  slug: string;
  revisionId: string;
}

export async function revertDoc(
  db: DB,
  input: RevertDocInput,
  actorPrincipalId: string
): Promise<Document> {
  const { scopePath, slug, revisionId } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const [doc] = (await db
    .select()
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, slug)))
    .limit(1)) as Document[];

  if (!doc) {
    throw new DocumentNotFoundError(scopePath, slug);
  }

  const [rev] = (await db
    .select()
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.id, revisionId),
        eq(documentRevisions.documentId, doc.id)
      )
    )
    .limit(1)) as DocumentRevision[];

  if (!rev) {
    throw new Error(`Revision not found: ${revisionId}`);
  }

  const now = new Date();
  const [updated] = (await db
    .update(documents)
    .set({
      title: rev.title,
      bodyMd: rev.bodyMd,
      updatedBy: actorPrincipalId,
      updatedAt: now,
    })
    .where(eq(documents.id, doc.id))
    .returning()) as Document[];

  if (!updated) {
    throw new Error("Failed to revert document");
  }

  await appendRevision(db, doc.id, rev.title, rev.bodyMd, actorPrincipalId);

  await emitEvent(db, {
    type: "doc.reverted",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug, documentId: doc.id, fromRevisionId: revisionId },
  });

  return updated;
}
