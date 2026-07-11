import { and, eq } from "drizzle-orm";
import { docFollows, documents, principals, type DocFollow, type Document, type Principal } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { DocumentNotFoundError, ScopeNotFoundError } from "../../errors";

export interface DocRefInput {
  scopePath: string;
  slug: string;
}

export interface DocFollower {
  principalId: string;
  principalName: string;
}

async function resolveDoc(db: DB, input: DocRefInput, actorPrincipalId: string): Promise<Document & { scopePath: string }> {
  const scope = await getScope(db, input.scopePath);
  if (!scope) throw new ScopeNotFoundError(input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");

  const [doc] = (await db
    .select()
    .from(documents)
    .where(and(eq(documents.scopeId, scope.id), eq(documents.slug, input.slug)))
    .limit(1)) as Document[];

  if (!doc) throw new DocumentNotFoundError(input.scopePath, input.slug);
  return { ...doc, scopePath: input.scopePath };
}

async function followRow(db: DB, documentId: string, principalId: string): Promise<DocFollow | null> {
  const [row] = (await db
    .select()
    .from(docFollows)
    .where(and(eq(docFollows.documentId, documentId), eq(docFollows.principalId, principalId)))
    .limit(1)) as DocFollow[];
  return row ?? null;
}

async function insertFollowIfMissing(db: DB, documentId: string, principalId: string): Promise<DocFollow | null> {
  const existing = await followRow(db, documentId, principalId);
  if (existing) return null;
  const [created] = (await db
    .insert(docFollows)
    .values({ documentId, principalId })
    .returning()) as DocFollow[];
  return created ?? null;
}

async function emitFollowEvent(
  db: DB,
  type: "doc.followed" | "doc.unfollowed",
  scopePath: string,
  slug: string,
  documentId: string,
  principalId: string
): Promise<void> {
  await emitEvent(db, {
    type,
    scopePath,
    principalId,
    payload: { slug, documentId, principalId },
  });
}

export async function followDoc(db: DB, input: DocRefInput, actorPrincipalId: string): Promise<DocFollow> {
  const doc = await resolveDoc(db, input, actorPrincipalId);
  const created = await insertFollowIfMissing(db, doc.id, actorPrincipalId);
  if (created) {
    await emitFollowEvent(db, "doc.followed", input.scopePath, doc.slug, doc.id, actorPrincipalId);
    return created;
  }

  const existing = await followRow(db, doc.id, actorPrincipalId);
  if (!existing) throw new Error("Failed to follow document");
  return existing;
}

export async function unfollowDoc(db: DB, input: DocRefInput, actorPrincipalId: string): Promise<void> {
  const doc = await resolveDoc(db, input, actorPrincipalId);
  const existing = await followRow(db, doc.id, actorPrincipalId);
  if (!existing) return;

  await db
    .delete(docFollows)
    .where(and(eq(docFollows.documentId, doc.id), eq(docFollows.principalId, actorPrincipalId)));
  await emitFollowEvent(db, "doc.unfollowed", input.scopePath, doc.slug, doc.id, actorPrincipalId);
}

export async function isFollowing(db: DB, input: DocRefInput, actorPrincipalId: string): Promise<boolean> {
  const doc = await resolveDoc(db, input, actorPrincipalId);
  return (await followRow(db, doc.id, actorPrincipalId)) !== null;
}

export async function listFollowers(db: DB, documentId: string): Promise<DocFollower[]> {
  const rows = (await db
    .select({
      principalId: docFollows.principalId,
      principalName: principals.name,
    })
    .from(docFollows)
    .innerJoin(principals, eq(docFollows.principalId, principals.id))
    .where(eq(docFollows.documentId, documentId))) as DocFollower[];
  return rows;
}

export async function autoFollowDocForHuman(
  db: DB,
  input: { documentId: string; scopePath: string; slug: string },
  actorPrincipalId: string
): Promise<void> {
  const [principal] = (await db
    .select({ id: principals.id, kind: principals.kind })
    .from(principals)
    .where(eq(principals.id, actorPrincipalId))
    .limit(1)) as Array<Pick<Principal, "id" | "kind">>;

  if (principal?.kind !== "human") return;
  const created = await insertFollowIfMissing(db, input.documentId, actorPrincipalId);
  if (created) {
    await emitFollowEvent(db, "doc.followed", input.scopePath, input.slug, input.documentId, actorPrincipalId);
  }
}