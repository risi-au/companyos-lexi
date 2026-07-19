/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and, desc, inArray, not, isNull, like, or } from "drizzle-orm";
import {
  attentionItems,
  docLinks,
  documents,
  documentRevisions,
  isReservedOperationalWikiReportSlug,
  notReservedOperationalWikiReportSlug,
  principals,
  scopes,
} from "@companyos/db";
import type { AttentionItem, Document, DocumentRevision } from "@companyos/db";
import {
  emitEvent,
  type DB,
} from "../../kernel/events";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import {
  ScopeNotFoundError,
  DocumentNotFoundError,
  AccessDeniedError,
} from "../../errors";
import { enqueueEmbeddingForEntity } from "../../lib/embeddings";
import { autoFollowDocForHuman, listFollowers } from "./follows";

const MAX_REVISIONS = 50;
const SLUG_REGEX = /^[a-z0-9-]+$/;
const WIKILINK_REGEX = /\[\[([^\]\n]+)\]\]/g;

type PrincipalKind = "human" | "agent" | "system";
export type PageCategory = "current-work" | "decisions-policies" | "guides-processes" | "reference";
export type DocDisplayCategory =
  | "Start here"
  | "Current work"
  | "Decisions and policies"
  | "Guides and processes"
  | "Reference"
  | "Other pages";

const PAGE_CATEGORY_LABELS: Record<PageCategory, DocDisplayCategory> = {
  "current-work": "Current work",
  "decisions-policies": "Decisions and policies",
  "guides-processes": "Guides and processes",
  "reference": "Reference",
};

interface ParsedFrontmatter {
  body: string;
  metadata: Record<string, string>;
  raw: string | null;
}

function slugify(input: string): string {
  const s = (input || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return s || "untitled";
}

function normalizeLinkTarget(input: string): string {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { body: markdown, metadata: {}, raw: null };

  const metadata: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i]!.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!pair) continue;
    const key = pair[1]!;
    const rawValue = pair[2]!;
    if (!rawValue) {
      const items: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j]!.match(/^\s*-\s+(.+?)\s*$/);
        if (!item) break;
        items.push(stripQuotes(item[1]!));
        i = j;
      }
      if (items.length > 0) metadata[key] = items.join(", ");
      continue;
    }
    const value = stripQuotes(rawValue);
    if (value) metadata[key] = value;
  }

  return { body: normalized.slice(match[0].length), metadata, raw: match[0] };
}

function splitFrontmatterContent(raw: string): string {
  return raw
    .replace(/^---\r?\n/, "")
    .replace(/\r?\n---(?:\r?\n|$)/, "");
}

function parseAliasList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return unwrapped
    .split(",")
    .map((part) => stripQuotes(part))
    .map((part) => part.trim())
    .filter(Boolean);
}

function frontmatterAliases(markdown: string): string[] {
  const parsed = parseFrontmatter(markdown);
  if (!parsed.raw) return [];
  const lines = splitFrontmatterContent(parsed.raw).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i]!.match(/^aliases:\s*(.*?)\s*$/);
    if (!pair) continue;
    if (pair[1]) return parseAliasList(pair[1]);
    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j]!.match(/^\s*-\s+(.+?)\s*$/);
      if (!item) break;
      items.push(stripQuotes(item[1]!));
    }
    return items;
  }
  return [];
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9 _./:-]+$/.test(value) ? value : JSON.stringify(value);
}

function removeFrontmatterKey(lines: string[], key: string): string[] {
  const next: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i]!.match(/^([A-Za-z0-9_-]+):/);
    if (pair?.[1] !== key) {
      next.push(lines[i]!);
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s+/.test(lines[j]!)) {
        i = j;
        continue;
      }
      break;
    }
  }
  return next;
}

function setFrontmatterKeys(markdown: string, updates: Record<string, string | null>): string {
  const parsed = parseFrontmatter(markdown);
  let lines = parsed.raw ? splitFrontmatterContent(parsed.raw).split(/\r?\n/) : [];
  for (const key of Object.keys(updates)) {
    lines = removeFrontmatterKey(lines, key);
  }
  lines = lines.filter((line, index, all) => {
    if (line.trim()) return true;
    return index > 0 && index < all.length - 1;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) continue;
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  if (lines.length === 0) return parsed.body;
  return `---\n${lines.join("\n")}\n---\n${parsed.body}`;
}

function frontmatterDate(metadata: Record<string, string>, key: string): number | null {
  const value = metadata[key];
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePageCategory(markdown: string): PageCategory | null {
  const value = parseFrontmatter(markdown).metadata.category;
  return value === "current-work"
    || value === "decisions-policies"
    || value === "guides-processes"
    || value === "reference"
    ? value
    : null;
}

export function pageDisplayCategory(input: { scopePath: string; slug: string; bodyMd: string }): DocDisplayCategory {
  const slug = input.slug.trim().toLowerCase();
  if (slug === "wiki" || slug === "overview") return "Start here";
  if (input.scopePath === "root" && (slug === "critical-facts" || slug === "scope-map")) return "Start here";
  if (input.scopePath === "root" && slug.startsWith("pattern-")) return "Guides and processes";
  const category = parsePageCategory(input.bodyMd || "");
  return category ? PAGE_CATEGORY_LABELS[category] : "Other pages";
}

function isUnreviewedBody(bodyMd: string, latestAuthorKind: PrincipalKind | null): boolean {
  if (latestAuthorKind !== "agent") return false;
  const metadata = parseFrontmatter(bodyMd).metadata;
  const verifiedAt = frontmatterDate(metadata, "verified_at");
  if (!verifiedAt) return true;
  const learnedAt = frontmatterDate(metadata, "learned_at");
  return learnedAt !== null && verifiedAt < learnedAt;
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
    const pipe = raw.lastIndexOf("|");
    const target = pipe > -1 ? raw.slice(pipe + 1).trim() : raw;
    if (!target) continue;
    const colon = target.lastIndexOf(":");
    const scopePath = colon > 0 ? target.slice(0, colon).trim() : null;
    const slug = normalizeLinkTarget(colon > 0 ? target.slice(colon + 1) : target);
    if (!slug || !SLUG_REGEX.test(slug)) continue;
    const key = `${scopePath ?? ""}:${slug}`;
    links.set(key, { scopePath: scopePath || null, slug });
  }
  return Array.from(links.values());
}

async function resolveInboundLinksForDocument(db: DB, doc: Document): Promise<void> {
  const aliases = frontmatterAliases(doc.bodyMd || "").map(normalizeLinkTarget).filter(Boolean);
  const slugs = Array.from(new Set([doc.slug, ...aliases]));
  if (slugs.length === 0) return;
  await db
    .update(docLinks)
    .set({ toDocumentId: doc.id })
    .where(and(eq(docLinks.toScopeId, doc.scopeId), inArray(docLinks.toSlug, slugs)));
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
  const targetScopeIds = targetScopes.map((scope) => scope.id);
  const candidateDocs = targetScopeIds.length > 0
    ? (await db
      .select({
        id: documents.id,
        scopeId: documents.scopeId,
        slug: documents.slug,
        bodyMd: documents.bodyMd,
      })
      .from(documents)
      .where(and(inArray(documents.scopeId, targetScopeIds), isNull(documents.archivedAt)))) as Array<{
        id: string;
        scopeId: string;
        slug: string;
        bodyMd: string;
      }>
    : [];
  const exactDocByScopeSlug = new Map<string, { id: string; scopeId: string; slug: string }>();
  const aliasDocByScopeSlug = new Map<string, { id: string; scopeId: string; slug: string }>();
  for (const candidate of candidateDocs) {
    exactDocByScopeSlug.set(`${candidate.scopeId}:${candidate.slug}`, candidate);
    for (const alias of frontmatterAliases(candidate.bodyMd || "").map(normalizeLinkTarget).filter(Boolean)) {
      if (!aliasDocByScopeSlug.has(`${candidate.scopeId}:${alias}`)) {
        aliasDocByScopeSlug.set(`${candidate.scopeId}:${alias}`, candidate);
      }
    }
  }

  const rows: Array<{ fromDocumentId: string; toScopeId: string; toSlug: string; toDocumentId: string | null }> = [];
  for (const link of parsed) {
    const targetPath = link.scopePath ?? doc.scopePath;
    const toScopeId = scopeIdByPath.get(targetPath);
    if (!toScopeId) continue;
    const targetDoc = exactDocByScopeSlug.get(`${toScopeId}:${link.slug}`)
      ?? aliasDocByScopeSlug.get(`${toScopeId}:${link.slug}`);
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


interface NotifyFollowersInput {
  documentId: string;
  scopeId: string;
  scopePath: string;
  slug: string;
  title: string;
  eventType: string;
  actor: string;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function actorName(db: DB, actorPrincipalId: string): Promise<string | null> {
  const [actor] = (await db
    .select({ name: principals.name })
    .from(principals)
    .where(eq(principals.id, actorPrincipalId))
    .limit(1)) as Array<{ name: string }>;
  return actor?.name ?? null;
}

async function notifyFollowers(db: DB, input: NotifyFollowersInput): Promise<void> {
  try {
    await notifyFollowersUnsafe(db, input);
  } catch (error) {
    console.error("[docs.notifyFollowers] failed", error);
  }
}

async function notifyFollowersUnsafe(db: DB, input: NotifyFollowersInput): Promise<void> {
  const followers = (await listFollowers(db, input.documentId))
    .filter((follower) => follower.principalId !== input.actor);
  if (followers.length === 0) return;

  const displayName = await actorName(db, input.actor);
  const { createAttentionItem } = await import("../attention/service");

  for (const follower of followers) {
    const openItems = (await db
      .select()
      .from(attentionItems)
      .where(and(
        eq(attentionItems.kind, "page_update"),
        eq(attentionItems.status, "open"),
        eq(attentionItems.targetPrincipalId, follower.principalId)
      ))
      .limit(100)) as AttentionItem[];
    const existing = openItems.find((item) => String(payloadRecord(item.payload).documentId ?? "") === input.documentId);

    if (existing) {
      const currentPayload = payloadRecord(existing.payload);
      const changeCount = Number(currentPayload.changeCount ?? 0);
      const nextPayload = {
        ...currentPayload,
        documentId: input.documentId,
        slug: input.slug,
        scopePath: input.scopePath,
        title: input.title,
        lastEventType: input.eventType,
        lastActorId: input.actor,
        ...(displayName ? { lastActorName: displayName } : {}),
        changeCount: Number.isFinite(changeCount) ? changeCount + 1 : 1,
      };
      const now = new Date();
      await db
        .update(attentionItems)
        .set({ payload: nextPayload, updatedAt: now })
        .where(eq(attentionItems.id, existing.id));
      await emitEvent(db, {
        type: "attention.updated",
        scopePath: input.scopePath,
        principalId: input.actor,
        payload: { attentionItemId: existing.id, kind: "page_update", documentId: input.documentId, targetPrincipalId: follower.principalId },
      });
      continue;
    }

    await createAttentionItem(db, {
      scopePath: input.scopePath,
      kind: "page_update",
      targetPrincipalId: follower.principalId,
      title: `"${input.title}" changed`,
      payload: {
        documentId: input.documentId,
        slug: input.slug,
        scopePath: input.scopePath,
        title: input.title,
        lastEventType: input.eventType,
        lastActorId: input.actor,
        ...(displayName ? { lastActorName: displayName } : {}),
        changeCount: 1,
      },
    }, input.actor);
  }
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
  let createdNewDocument = false;

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
    createdNewDocument = true;
  }

  if (createdNewDocument) {
    await autoFollowDocForHuman(db, { documentId: saved.id, scopePath, slug: saved.slug }, actorPrincipalId);
  }

  await appendRevision(db, saved.id, title, bodyMd, actorPrincipalId);
  await extractLinksForDocument(db, saved.id, actorPrincipalId);

  await emitEvent(db, {
    type: "doc.saved",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug: saved.slug, title: saved.title, documentId: saved.id },
  });

  await notifyFollowers(db, {
    documentId: saved.id,
    scopeId: saved.scopeId,
    scopePath,
    slug: saved.slug,
    title: saved.title,
    eventType: "doc.saved",
    actor: actorPrincipalId,
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

export interface VerifyDocInput {
  scopePath: string;
  slug: string;
  nextReviewAt?: string | Date | null;
}

export function parseFutureReviewDate(value: string | Date, now = new Date()): Date {
  let reviewDate: Date;
  if (value instanceof Date) {
    reviewDate = new Date(value.getTime());
  } else {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      reviewDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
      if (reviewDate.getUTCFullYear() !== year || reviewDate.getUTCMonth() !== month - 1 || reviewDate.getUTCDate() !== day) {
        throw new Error("nextReviewAt must be a future date.");
      }
    } else {
      reviewDate = new Date(value);
    }
  }
  if (!Number.isFinite(reviewDate.getTime()) || reviewDate.getTime() <= now.getTime()) {
    throw new Error("nextReviewAt must be a future date.");
  }
  return reviewDate;
}

export async function verifyDoc(
  db: DB,
  input: VerifyDocInput,
  actorPrincipalId: string
): Promise<Document> {
  const { scopePath, slug } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const [principal] = (await db
    .select({ id: principals.id, kind: principals.kind, name: principals.name })
    .from(principals)
    .where(eq(principals.id, actorPrincipalId))
    .limit(1)) as Array<{ id: string; kind: PrincipalKind; name: string }>;

  if (!principal || principal.kind !== "human") {
    throw new AccessDeniedError(actorPrincipalId, scopePath, "human", "Only human editors can verify wiki pages.");
  }

  const [doc] = (await db
    .select()
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, slug)))
    .limit(1)) as Document[];

  if (!doc) {
    throw new DocumentNotFoundError(scopePath, slug);
  }

  const verifiedAt = new Date().toISOString();
  const updates: Record<string, string | null> = {
    verified_at: verifiedAt,
    verified_by: principal.name,
  };
  if (input.nextReviewAt !== undefined && input.nextReviewAt !== null) {
    const reviewDate = parseFutureReviewDate(input.nextReviewAt);
    updates.stale_after = reviewDate.toISOString();
  }
  const bodyMd = setFrontmatterKeys(doc.bodyMd || "", updates);

  const [updated] = (await db
    .update(documents)
    .set({
      bodyMd,
      updatedBy: actorPrincipalId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, doc.id))
    .returning()) as Document[];

  if (!updated) {
    throw new DocumentNotFoundError(scopePath, slug);
  }

  await appendRevision(db, updated.id, updated.title, updated.bodyMd, actorPrincipalId);
  await autoFollowDocForHuman(db, { documentId: updated.id, scopePath, slug: updated.slug }, actorPrincipalId);

  await emitEvent(db, {
    type: "doc.verified",
    scopePath,
    principalId: actorPrincipalId,
    payload: { slug: updated.slug, title: updated.title, documentId: updated.id, verifiedAt },
  });

  await notifyFollowers(db, {
    documentId: updated.id,
    scopeId: updated.scopeId,
    scopePath,
    slug: updated.slug,
    title: updated.title,
    eventType: "doc.verified",
    actor: actorPrincipalId,
  });

  return updated;
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

  const [targetDoc] = (await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, input.slug)))
    .limit(1)) as Array<{ id: string }>;
  const backlinkTarget = targetDoc
    ? or(eq(docLinks.toSlug, input.slug), eq(docLinks.toDocumentId, targetDoc.id))
    : eq(docLinks.toSlug, input.slug);

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
    .where(and(eq(docLinks.toScopeId, scope.id), backlinkTarget, notReservedOperationalWikiReportSlug(documents.slug)))
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
    .where(and(subtreeCondition(scopePath), isNull(documents.archivedAt), notReservedOperationalWikiReportSlug(documents.slug)))
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
    if (isReservedOperationalWikiReportSlug(link.toSlug)) continue;
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
  includeDescendants?: boolean;
}

export interface ListDocRow {
  id: string;
  slug: string;
  title: string;
  updatedAt: Date;
  createdByKind: PrincipalKind | null;
    scopePath: string;
    unreviewed: boolean;
    displayCategory: DocDisplayCategory;
}

export async function listDocs(
  db: DB,
  input: ListDocsInput,
  actorPrincipalId: string
): Promise<ListDocRow[]> {
  const { scopePath, includeArchived = false, includeDescendants = false } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const conditions: any[] = [includeDescendants ? subtreeCondition(scopePath) : eq(documents.scopeId, scope.id)];
  if (!includeArchived) {
    conditions.push(isNull(documents.archivedAt));
  }
  conditions.push(notReservedOperationalWikiReportSlug(documents.slug));

  const rows = (await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      updatedAt: documents.updatedAt,
      bodyMd: documents.bodyMd,
      createdByKind: principals.kind,
      scopePath: scopes.path,
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .leftJoin(principals, eq(documents.createdBy, principals.id))
    .where(and(...conditions))
    .orderBy(scopes.path, documents.position, documents.title)) as Array<{
      id: string;
      slug: string;
      title: string;
      updatedAt: Date;
      bodyMd: string;
      createdByKind: PrincipalKind | null;
      scopePath: string;
    }>;

  const docIds = rows.map((row) => row.id);
  const latestKinds = new Map<string, PrincipalKind | null>();
  if (docIds.length > 0) {
    const revisionRows = (await db
      .select({
        documentId: documentRevisions.documentId,
        savedByKind: principals.kind,
        createdAt: documentRevisions.createdAt,
      })
      .from(documentRevisions)
      .leftJoin(principals, eq(documentRevisions.savedBy, principals.id))
      .where(inArray(documentRevisions.documentId, docIds))
      .orderBy(documentRevisions.documentId, desc(documentRevisions.createdAt))) as Array<{
        documentId: string;
        savedByKind: PrincipalKind | null;
        createdAt: Date;
      }>;

    for (const revision of revisionRows) {
      if (!latestKinds.has(revision.documentId)) {
        latestKinds.set(revision.documentId, revision.savedByKind);
      }
    }
  }

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    updatedAt: row.updatedAt,
    createdByKind: row.createdByKind,
    scopePath: row.scopePath,
    unreviewed: isUnreviewedBody(row.bodyMd, latestKinds.get(row.id) ?? null),
    displayCategory: pageDisplayCategory({ scopePath: row.scopePath, slug: row.slug, bodyMd: row.bodyMd }),
  }));
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

  await notifyFollowers(db, {
    documentId: updated.id,
    scopeId: updated.scopeId,
    scopePath,
    slug: updated.slug,
    title: updated.title,
    eventType: "doc.renamed",
    actor: actorPrincipalId,
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

  await notifyFollowers(db, {
    documentId: updated.id,
    scopeId: updated.scopeId,
    scopePath,
    slug: updated.slug,
    title: updated.title,
    eventType: "doc.archived",
    actor: actorPrincipalId,
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

  await notifyFollowers(db, {
    documentId: updated.id,
    scopeId: updated.scopeId,
    scopePath,
    slug: updated.slug,
    title: updated.title,
    eventType: "doc.reverted",
    actor: actorPrincipalId,
  });

  enqueueEmbeddingForEntity(db, { entityType: "doc", entityId: updated.id, principalId: actorPrincipalId });

  return updated;
}
