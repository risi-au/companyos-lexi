/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and, desc, inArray, not, isNull, like, or } from "drizzle-orm";
import { docLinks, documents, documentRevisions, scopes } from "@companyos/db";
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
import { enqueueEmbeddingForEntity } from "../../lib/embeddings";

const MAX_REVISIONS = 50;
const SLUG_REGEX = /^[a-z0-9-]+$/;
const WIKILINK_REGEX = /\[\[([^\]\n]+)\]\]/g;

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

function subtreeCondition(scopePath: string) {
  return scopePath === "root"
    ? like(scopes.path, "%")
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

function parseWikilinks(bodyMd: string): Array<{ scopePath: string | null; slug: string }> {
  const links = new Map<string, { scopePath: string | null; slug: string }>();
  for (const match of bodyMd.matchAll(WIKILINK_REGEX)) {
    const raw = (match[1] || "").trim();
    if (!raw) continue;
    const target = raw.split("|", 1)[0] ?? "";
    if (!target) continue;
    const colon = target.lastIndexOf(":");
    const scopePath = colon > 0 ? target.slice(0, colon).trim() : null;
    const slug = (colon > 0 ? target.slice(colon + 1) : target).trim();
    if (!slug || !SLUG_REGEX.test(slug)) continue;
    const key = `${scopePath ?? ""}:${slug}`;
    links.set(key, { scopePath: scopePath || null, slug });
  }
  return Array.from(links.values());
}

async function resolveInboundLinksForDocument(db: DB, doc: Document): Promise<void> {
  await db
    .update(docLinks)
    .set({ toDocumentId: doc.id })
    .where(and(eq(docLinks.toScopeId, doc.scopeId), eq(docLinks.toSlug, doc.slug)));
}

export async function extractLinksForDocument(
  db: DB,
  documentId: string,
  actorPrincipalId?: string | null
): Promise<void> {
  const [doc] = (await db
    .select({
      id: documents.id,
      scopeId: documents.scopeId,
      slug: documents.slug,
      title: documents.title,
      bodyMd: documents.bodyMd,
      position: documents.position,
      createdBy: documents.createdBy,
      updatedBy: documents.updatedBy,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      archivedAt: documents.archivedAt,
      scopePath: scopes.path,
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(eq(documents.id, documentId))
    .limit(1)) as Array<Document & { scopePath: string }>;
  if (!doc) return;

  const parsed = parseWikilinks(doc.bodyMd || "");
  const targetScopePaths = Array.from(new Set(parsed.map((link) => link.scopePath ?? doc.scopePath)));
  const targetScopes = targetScopePaths.length > 0
    ? (await db
      .select({ id: scopes.id, path: scopes.path })
      .from(scopes)
      .where(inArray(scopes.path, targetScopePaths))) as Array<{ id: string; path: string }>
    : [];
  const scopeIdByPath = new Map(targetScopes.map((scope) => [scope.path, scope.id]));

  const rows: Array<{ fromDocumentId: string; toScopeId: string; toSlug: string; toDocumentId: string | null }> = [];
  for (const link of parsed) {
    const targetPath = link.scopePath ?? doc.scopePath;
    const toScopeId = scopeIdByPath.get(targetPath);
    if (!toScopeId) continue;
    const [targetDoc] = (await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.scopeId, toScopeId), eq(documents.slug, link.slug)))
      .limit(1)) as Array<{ id: string }>;
    rows.push({
      fromDocumentId: doc.id,
      toScopeId,
      toSlug: link.slug,
      toDocumentId: targetDoc?.id ?? null,
    });
  }

  await db.delete(docLinks).where(eq(docLinks.fromDocumentId, doc.id));
  if (rows.length > 0) {
    await db.insert(docLinks).values(rows).onConflictDoNothing();
  }

  await resolveInboundLinksForDocument(db, doc);
  await emitEvent(db, {
    type: "doc.links_extracted",
    scopePath: doc.scopePath,
    principalId: actorPrincipalId ?? null,
    payload: { documentId: doc.id, slug: doc.slug, linkCount: rows.length },
  });
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
  await extractLinksForDocument(db, saved.id, actorPrincipalId);

  await emitEvent(db, {
    type: "doc.saved",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug: saved.slug, title: saved.title, documentId: saved.id },
  });

  enqueueEmbeddingForEntity(db, { entityType: "doc", entityId: saved.id, principalId: actorPrincipalId });

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

export interface Backlink {
  fromDocumentId: string;
  fromScopePath: string;
  fromSlug: string;
  fromTitle: string;
  toSlug: string;
  resolved: boolean;
}

export async function getBacklinks(
  db: DB,
  input: { scopePath: string; slug: string },
  actorPrincipalId: string
): Promise<Backlink[]> {
  const scopePath = input.scopePath.trim();
  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }
  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const rows = (await db
    .select({
      fromDocumentId: documents.id,
      fromScopePath: scopes.path,
      fromSlug: documents.slug,
      fromTitle: documents.title,
      toSlug: docLinks.toSlug,
      toDocumentId: docLinks.toDocumentId,
    })
    .from(docLinks)
    .innerJoin(documents, eq(docLinks.fromDocumentId, documents.id))
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(eq(docLinks.toScopeId, scope.id), eq(docLinks.toSlug, input.slug)))
    .orderBy(scopes.path, documents.slug)) as Array<{
      fromDocumentId: string;
      fromScopePath: string;
      fromSlug: string;
      fromTitle: string;
      toSlug: string;
      toDocumentId: string | null;
    }>;

  return rows.map((row) => ({
    fromDocumentId: row.fromDocumentId,
    fromScopePath: row.fromScopePath,
    fromSlug: row.fromSlug,
    fromTitle: row.fromTitle,
    toSlug: row.toSlug,
    resolved: row.toDocumentId !== null,
  }));
}

export interface LinkGraphNode {
  id: string;
  scopePath: string;
  slug: string;
  title: string;
  unresolved?: boolean;
}

export interface LinkGraphEdge {
  from: string;
  to: string;
  toScopePath: string;
  toSlug: string;
  resolved: boolean;
}

export interface LinkGraph {
  nodes: LinkGraphNode[];
  edges: LinkGraphEdge[];
}

export async function getLinkGraph(
  db: DB,
  input: { scopePath: string },
  actorPrincipalId: string
): Promise<LinkGraph> {
  const scopePath = input.scopePath.trim();
  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }
  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const docRows = (await db
    .select({
      id: documents.id,
      scopePath: scopes.path,
      slug: documents.slug,
      title: documents.title,
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(subtreeCondition(scopePath), isNull(documents.archivedAt)))
    .orderBy(scopes.path, documents.slug)) as Array<{ id: string; scopePath: string; slug: string; title: string }>;

  const docIds = docRows.map((doc) => doc.id);
  const nodesById = new Map<string, LinkGraphNode>();
  for (const doc of docRows) {
    nodesById.set(doc.id, { id: doc.id, scopePath: doc.scopePath, slug: doc.slug, title: doc.title });
  }
  if (docIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  const linkRows = (await db
    .select({
      fromDocumentId: docLinks.fromDocumentId,
      toScopePath: scopes.path,
      toSlug: docLinks.toSlug,
      toDocumentId: docLinks.toDocumentId,
    })
    .from(docLinks)
    .innerJoin(scopes, eq(docLinks.toScopeId, scopes.id))
    .where(inArray(docLinks.fromDocumentId, docIds))
    .orderBy(docLinks.fromDocumentId, scopes.path, docLinks.toSlug)) as Array<{
      fromDocumentId: string;
      toScopePath: string;
      toSlug: string;
      toDocumentId: string | null;
    }>;

  const edges: LinkGraphEdge[] = [];
  for (const link of linkRows) {
    const unresolvedId = `unresolved:${link.toScopePath}:${link.toSlug}`;
    const to = link.toDocumentId ?? unresolvedId;
    if (link.toDocumentId && !nodesById.has(link.toDocumentId)) {
      const [target] = (await db
        .select({ id: documents.id, scopePath: scopes.path, slug: documents.slug, title: documents.title })
        .from(documents)
        .innerJoin(scopes, eq(documents.scopeId, scopes.id))
        .where(eq(documents.id, link.toDocumentId))
        .limit(1)) as Array<{ id: string; scopePath: string; slug: string; title: string }>;
      if (target) nodesById.set(target.id, target);
    }
    if (!link.toDocumentId && !nodesById.has(unresolvedId)) {
      nodesById.set(unresolvedId, {
        id: unresolvedId,
        scopePath: link.toScopePath,
        slug: link.toSlug,
        title: link.toSlug,
        unresolved: true,
      });
    }
    edges.push({
      from: link.fromDocumentId,
      to,
      toScopePath: link.toScopePath,
      toSlug: link.toSlug,
      resolved: link.toDocumentId !== null,
    });
  }

  return {
    nodes: Array.from(nodesById.values()).sort((a, b) => a.scopePath.localeCompare(b.scopePath) || a.slug.localeCompare(b.slug)),
    edges,
  };
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

  await resolveInboundLinksForDocument(db, updated);

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
  await extractLinksForDocument(db, updated.id, actorPrincipalId);

  await emitEvent(db, {
    type: "doc.reverted",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug, documentId: doc.id, fromRevisionId: revisionId },
  });

  enqueueEmbeddingForEntity(db, { entityType: "doc", entityId: updated.id, principalId: actorPrincipalId });

  return updated;
}
