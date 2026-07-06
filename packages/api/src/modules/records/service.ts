/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and, gte, desc, or, like } from "drizzle-orm";
import { records, scopes } from "@companyos/db";
import type { Record as DbRecord } from "@companyos/db";
import {
  emitEvent,
  type DB,
} from "../../kernel/events";
import { getScope } from "../../kernel/scopes";
import { requireAccess } from "../../kernel/grants";
import {
  ScopeNotFoundError,
  RecordNotFoundError,
} from "../../errors";

export interface CreateRecordInput {
  scopePath: string;
  kind: DbRecord["kind"];
  title: string;
  bodyMd?: string;
  data?: { [key: string]: unknown };
}

async function insertRecord(
  db: DB,
  input: CreateRecordInput,
  actorPrincipalId: string
): Promise<DbRecord> {
  const { scopePath, kind, title, bodyMd = "", data = {} } = input;

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  const [created] = (await db
    .insert(records)
    .values({
      scopeId: scope.id,
      kind,
      title,
      bodyMd,
      data,
      authorId: actorPrincipalId,
    })
    .returning()) as DbRecord[];

  if (!created) {
    throw new Error("Failed to create record");
  }

  await emitEvent(db, {
    type: "record.created",
    scopePath,
    principalId: actorPrincipalId,
    payload: { kind, title, recordId: created.id },
  });

  return created;
}

export async function createRecord(
  db: DB,
  input: CreateRecordInput,
  actorPrincipalId: string
): Promise<DbRecord> {
  const scope = await getScope(db, input.scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(input.scopePath);
  }
  await requireAccess(db, actorPrincipalId, input.scopePath, "editor");
  return insertRecord(db, input, actorPrincipalId);
}

// Internal system writers such as signed webhook ingestion act under a system/agent
// principal and intentionally skip grant checks, while sharing record validation and
// event emission with ordinary user/agent record creation.
export async function createSystemRecord(
  db: DB,
  input: CreateRecordInput,
  systemPrincipalId: string
): Promise<DbRecord> {
  return insertRecord(db, input, systemPrincipalId);
}

export async function getRecord(
  db: DB,
  id: string,
  actorPrincipalId: string
): Promise<DbRecord | null> {
  const [rec] = (await db
    .select()
    .from(records)
    .where(eq(records.id, id))
    .limit(1)) as DbRecord[];

  if (!rec) {
    return null;
  }

  // resolve scope path for access check (without leaking existence beyond uuid)
  const [scopeRow] = (await db
    .select({ path: scopes.path })
    .from(scopes)
    .where(eq(scopes.id, rec.scopeId))
    .limit(1)) as { path: string | null }[];

  const scopePath = scopeRow?.path;
  if (!scopePath) {
    return null;
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  return rec;
}

export interface ListRecordsInput {
  scopePath: string;
  kind?: DbRecord["kind"];
  since?: Date;
  limit?: number;
  includeDescendants?: boolean;
}

export type ListedRecord = DbRecord & { scopePath?: string };

export async function listRecords(
  db: DB,
  input: ListRecordsInput,
  actorPrincipalId: string
): Promise<ListedRecord[]> {
  const { scopePath, kind, since, limit = 50, includeDescendants = false } = input;
  const effectiveLimit = Math.min(Math.max(1, limit ?? 50), 200);

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const scope = await getScope(db, scopePath);
  if (!scope) {
    return [];
  }

  const conditions: any[] = includeDescendants
    ? scopePath === "root"
      ? [like(scopes.path, "%")]
      : [or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`))]
    : [eq(records.scopeId, scope.id)];
  if (kind) {
    conditions.push(eq(records.kind, kind));
  }
  if (since) {
    conditions.push(gte(records.createdAt, since));
  }

  if (includeDescendants) {
    const q = db
      .select({
        id: records.id,
        scopeId: records.scopeId,
        kind: records.kind,
        title: records.title,
        bodyMd: records.bodyMd,
        data: records.data,
        authorId: records.authorId,
        createdAt: records.createdAt,
        updatedAt: records.updatedAt,
        scopePath: scopes.path,
      })
      .from(records)
      .innerJoin(scopes, eq(records.scopeId, scopes.id))
      .where(and(...conditions))
      .orderBy(desc(records.createdAt))
      .limit(effectiveLimit);

    return (await q) as ListedRecord[];
  }

  const q = db
    .select()
    .from(records)
    .where(and(...conditions))
    .orderBy(desc(records.createdAt))
    .limit(effectiveLimit);

  return (await q) as DbRecord[];
}

export interface UpdateRecordInput {
  title?: string;
  bodyMd?: string;
  data?: { [key: string]: unknown };
}

export async function updateRecord(
  db: DB,
  id: string,
  input: UpdateRecordInput,
  actorPrincipalId: string
): Promise<DbRecord> {
  const { title, bodyMd, data } = input;

  const [existing] = (await db
    .select()
    .from(records)
    .where(eq(records.id, id))
    .limit(1)) as DbRecord[];

  if (!existing) {
    throw new RecordNotFoundError(id);
  }

  const [scopeRow] = (await db
    .select({ path: scopes.path })
    .from(scopes)
    .where(eq(scopes.id, existing.scopeId))
    .limit(1)) as { path: string }[];

  const scopePath = scopeRow?.path;
  if (!scopePath) {
    throw new RecordNotFoundError(id);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const updates: Partial<DbRecord> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (title !== undefined) (updates as any).title = title;
  if (bodyMd !== undefined) (updates as any).bodyMd = bodyMd;
  if (data !== undefined) (updates as any).data = data;

  const [updated] = (await db
    .update(records)
    .set(updates)
    .where(eq(records.id, id))
    .returning()) as DbRecord[];

  if (!updated) {
    throw new RecordNotFoundError(id);
  }

  await emitEvent(db, {
    type: "record.updated",
    scopePath,
    principalId: actorPrincipalId,
    payload: { recordId: id, title: updated.title },
  });

  return updated;
}
