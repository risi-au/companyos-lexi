/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, count, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { attentionItems, scopes, type AttentionItem } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope, getVisibleTree } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";
import { saveDoc } from "../docs/service";
import { createRecord } from "../records/service";

export type AttentionKind = AttentionItem["kind"];
export type AttentionStatus = AttentionItem["status"];
export type AttentionResolution = Exclude<AttentionStatus, "open">;

export interface AttentionItemView extends AttentionItem {
  scopePath: string;
}

export interface WikiProposalPayload {
  slug: string;
  title: string;
  proposedMd: string;
  baseRevisionId?: string;
  currentMd?: string;
}

export interface GraduationPayload {
  direction: "personal-to-scope" | "scope-to-personal";
  fromScopePath: string;
  fromSlug: string;
  proposal: WikiProposalPayload;
}

export interface OpenQuestionPayload {
  question: string;
  tag: "decision" | "unknown" | null;
  source: "intake";
  intakeId: string;
  ordinal: number;
}

export class AttentionNotFoundError extends Error {
  constructor(id: string) {
    super(`Attention item not found: ${id}`);
    this.name = "AttentionNotFoundError";
  }
}

export class AttentionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttentionStateError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function wikiProposalPayload(value: unknown): WikiProposalPayload {
  if (!isRecord(value)) throw new Error("wiki_proposal payload must be an object");
  const slug = String(value.slug ?? "").trim();
  const title = String(value.title ?? "").trim();
  if (!slug) throw new Error("wiki_proposal payload requires slug");
  if (!title) throw new Error("wiki_proposal payload requires title");
  if (typeof value.proposedMd !== "string") throw new Error("wiki_proposal payload requires proposedMd");
  return {
    slug,
    title,
    proposedMd: value.proposedMd,
    ...(typeof value.baseRevisionId === "string" ? { baseRevisionId: value.baseRevisionId } : {}),
    ...(typeof value.currentMd === "string" ? { currentMd: value.currentMd } : {}),
  };
}

function graduationPayload(value: unknown): GraduationPayload {
  if (!isRecord(value)) throw new Error("graduation payload must be an object");
  const direction = value.direction;
  if (direction !== "personal-to-scope" && direction !== "scope-to-personal") {
    throw new Error("graduation payload requires direction");
  }
  const fromScopePath = String(value.fromScopePath ?? "").trim();
  const fromSlug = String(value.fromSlug ?? "").trim();
  if (!fromScopePath) throw new Error("graduation payload requires fromScopePath");
  if (!fromSlug) throw new Error("graduation payload requires fromSlug");
  return {
    direction,
    fromScopePath,
    fromSlug,
    proposal: wikiProposalPayload(value.proposal),
  };
}

function openQuestionPayload(value: unknown): OpenQuestionPayload {
  if (!isRecord(value)) throw new Error("open_question payload must be an object");
  const question = String(value.question ?? "").trim();
  const intakeId = String(value.intakeId ?? "").trim();
  const ordinal = value.ordinal;
  if (!question) throw new Error("open_question payload requires question");
  if (value.source !== "intake") throw new Error("open_question payload requires source intake");
  if (!intakeId) throw new Error("open_question payload requires intakeId");
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 0) {
    throw new Error("open_question payload requires a non-negative integer ordinal");
  }
  return {
    question,
    tag: value.tag === "decision" || value.tag === "unknown" ? value.tag : null,
    source: "intake",
    intakeId,
    ordinal,
  };
}

function targetPrincipalCondition(actorPrincipalId: string) {
  return or(isNull(attentionItems.targetPrincipalId), eq(attentionItems.targetPrincipalId, actorPrincipalId));
}

function subtreeCondition(scopePath: string) {
  return scopePath === "root"
    ? like(scopes.path, "%")
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

async function visibleScopeIds(db: DB, actorPrincipalId: string): Promise<string[]> {
  return (await getVisibleTree(db, actorPrincipalId)).map((scope) => scope.id);
}

function toView(row: AttentionItem & { scopePath: string }): AttentionItemView {
  return row;
}

async function getAttentionRow(db: DB, id: string): Promise<AttentionItemView> {
  const [row] = (await db
    .select({
      id: attentionItems.id,
      scopeId: attentionItems.scopeId,
      kind: attentionItems.kind,
      status: attentionItems.status,
      title: attentionItems.title,
      summary: attentionItems.summary,
      payload: attentionItems.payload,
      createdBy: attentionItems.createdBy,
      targetPrincipalId: attentionItems.targetPrincipalId,
      resolvedBy: attentionItems.resolvedBy,
      resolvedAt: attentionItems.resolvedAt,
      resolutionNote: attentionItems.resolutionNote,
      createdAt: attentionItems.createdAt,
      updatedAt: attentionItems.updatedAt,
      scopePath: scopes.path,
    })
    .from(attentionItems)
    .innerJoin(scopes, eq(attentionItems.scopeId, scopes.id))
    .where(eq(attentionItems.id, id))
    .limit(1)) as Array<AttentionItem & { scopePath: string }>;

  if (!row) throw new AttentionNotFoundError(id);
  return toView(row);
}

export interface CreateAttentionItemInput {
  scopePath: string;
  kind: AttentionKind;
  title: string;
  summary?: string | null;
  targetPrincipalId?: string | null;
  payload: Record<string, unknown>;
}

export async function createAttentionItem(
  db: DB,
  input: CreateAttentionItemInput,
  actorPrincipalId: string
): Promise<AttentionItemView> {
  const scope = await getScope(db, input.scopePath);
  if (!scope) throw new ScopeNotFoundError(input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "editor");

  const payload = input.kind === "open_question" ? openQuestionPayload(input.payload) : input.payload;

  const [created] = (await db
    .insert(attentionItems)
    .values({
      scopeId: scope.id,
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? null,
      payload,
      createdBy: actorPrincipalId,
      targetPrincipalId: input.targetPrincipalId ?? null,
    })
    .returning()) as AttentionItem[];
  if (!created) throw new Error("Failed to create attention item");

  await emitEvent(db, {
    type: "attention.created",
    scopePath: input.scopePath,
    principalId: actorPrincipalId,
    payload: { attentionItemId: created.id, kind: created.kind, title: created.title, targetPrincipalId: created.targetPrincipalId },
  });

  return getAttentionRow(db, created.id);
}

export interface CreateSystemAttentionItemInput {
  scopeId: string;
  kind: AttentionKind;
  title: string;
  summary?: string | null;
  payload: Record<string, unknown>;
  createdBy: string;
}

export async function createSystemAttentionItem(
  db: DB,
  input: CreateSystemAttentionItemInput
): Promise<AttentionItemView> {
  const [scope] = (await db
    .select({ id: scopes.id, path: scopes.path })
    .from(scopes)
    .where(eq(scopes.id, input.scopeId))
    .limit(1)) as Array<{ id: string; path: string }>;
  if (!scope) throw new ScopeNotFoundError(input.scopeId);

  const [created] = (await db
    .insert(attentionItems)
    .values({
      scopeId: input.scopeId,
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? null,
      payload: input.payload,
      createdBy: input.createdBy,
      targetPrincipalId: null,
    })
    .returning()) as AttentionItem[];
  if (!created) throw new Error("Failed to create attention item");

  await emitEvent(db, {
    type: "attention.created",
    scopePath: scope.path,
    principalId: input.createdBy,
    payload: { attentionItemId: created.id, kind: created.kind, title: created.title, targetPrincipalId: created.targetPrincipalId },
  });

  return getAttentionRow(db, created.id);
}

export async function dismissAttentionItemsInternal(
  db: DB,
  input: { kind: AttentionKind; payloadTokenId: string; note?: string | null }
): Promise<number> {
  const rows = (await db
    .select({
      id: attentionItems.id,
      kind: attentionItems.kind,
      createdBy: attentionItems.createdBy,
      targetPrincipalId: attentionItems.targetPrincipalId,
      scopePath: scopes.path,
    })
    .from(attentionItems)
    .innerJoin(scopes, eq(attentionItems.scopeId, scopes.id))
    .where(and(
      eq(attentionItems.kind, input.kind),
      eq(attentionItems.status, "open"),
      sql`${attentionItems.payload}->>'tokenId' = ${input.payloadTokenId}`
    ))) as Array<{ id: string; kind: AttentionKind; createdBy: string; targetPrincipalId: string | null; scopePath: string }>;

  const note = input.note?.trim() || null;
  let dismissed = 0;
  for (const row of rows) {
    const now = new Date();
    const [updated] = (await db
      .update(attentionItems)
      .set({
        status: "dismissed",
        resolvedBy: row.createdBy,
        resolvedAt: now,
        resolutionNote: note,
        updatedAt: now,
      })
      .where(and(eq(attentionItems.id, row.id), eq(attentionItems.status, "open")))
      .returning()) as AttentionItem[];
    if (!updated) continue;
    dismissed += 1;
    await emitEvent(db, {
      type: "attention.resolved",
      scopePath: row.scopePath,
      principalId: row.createdBy,
      payload: { attentionItemId: row.id, kind: row.kind, resolution: "dismissed", targetPrincipalId: row.targetPrincipalId },
    });
  }

  return dismissed;
}

export interface ListAttentionItemsInput {
  scopePath?: string | null;
  status?: AttentionStatus;
  kind?: AttentionKind;
  includeDescendants?: boolean;
  limit?: number;
}

export async function listAttentionItems(
  db: DB,
  input: ListAttentionItemsInput,
  actorPrincipalId: string
): Promise<AttentionItemView[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
  const conditions: any[] = [targetPrincipalCondition(actorPrincipalId)];
  if (input.status) conditions.push(eq(attentionItems.status, input.status));
  if (input.kind) conditions.push(eq(attentionItems.kind, input.kind));

  if (!input.scopePath || (input.scopePath === "root" && input.includeDescendants)) {
    const ids = await visibleScopeIds(db, actorPrincipalId);
    if (!ids.length) return [];
    conditions.push(inArray(attentionItems.scopeId, ids));
  } else {
    const scope = await getScope(db, input.scopePath);
    if (!scope) return [];
    await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");
    conditions.push(input.includeDescendants ? subtreeCondition(input.scopePath) : eq(attentionItems.scopeId, scope.id));
  }

  const rows = (await db
    .select({
      id: attentionItems.id,
      scopeId: attentionItems.scopeId,
      kind: attentionItems.kind,
      status: attentionItems.status,
      title: attentionItems.title,
      summary: attentionItems.summary,
      payload: attentionItems.payload,
      createdBy: attentionItems.createdBy,
      targetPrincipalId: attentionItems.targetPrincipalId,
      resolvedBy: attentionItems.resolvedBy,
      resolvedAt: attentionItems.resolvedAt,
      resolutionNote: attentionItems.resolutionNote,
      createdAt: attentionItems.createdAt,
      updatedAt: attentionItems.updatedAt,
      scopePath: scopes.path,
    })
    .from(attentionItems)
    .innerJoin(scopes, eq(attentionItems.scopeId, scopes.id))
    .where(and(...conditions))
    .orderBy(desc(attentionItems.createdAt))
    .limit(limit)) as Array<AttentionItem & { scopePath: string }>;

  return rows.map(toView);
}

export async function countOpenAttentionItems(
  db: DB,
  input: { scopePath: string; includeDescendants?: boolean },
  actorPrincipalId: string
): Promise<number> {
  const conditions: any[] = [eq(attentionItems.status, "open"), targetPrincipalCondition(actorPrincipalId)];
  if (input.scopePath === "root" && input.includeDescendants) {
    const ids = await visibleScopeIds(db, actorPrincipalId);
    if (!ids.length) return 0;
    conditions.push(inArray(attentionItems.scopeId, ids));
  } else {
    const scope = await getScope(db, input.scopePath);
    if (!scope) return 0;
    await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");
    conditions.push(input.includeDescendants ? subtreeCondition(input.scopePath) : eq(attentionItems.scopeId, scope.id));
  }

  const [row] = (await db
    .select({ value: count() })
    .from(attentionItems)
    .innerJoin(scopes, eq(attentionItems.scopeId, scopes.id))
    .where(and(...conditions))) as Array<{ value: number }>;
  return Number(row?.value ?? 0);
}

function decisionBody(item: AttentionItemView, resolution: AttentionResolution, note?: string | null): string {
  const wiki = item.kind === "wiki_proposal"
    ? wikiProposalPayload(item.payload)
    : item.kind === "graduation"
      ? graduationPayload(item.payload).proposal
      : null;
  const graduation = item.kind === "graduation" ? graduationPayload(item.payload) : null;
  const openQuestion = item.kind === "open_question" ? openQuestionPayload(item.payload) : null;
  const lines = [
    `Resolution: ${resolution}`,
    "",
    item.summary ? `Summary: ${item.summary}` : "",
    note ? `Note: ${note}` : "",
    openQuestion ? `Question: ${openQuestion.question}` : "",
    openQuestion && resolution === "approved" && note ? `Answer: ${note}` : "",
    graduation ? `Graduation: ${graduation.direction} from ${graduation.fromScopePath}:${graduation.fromSlug}` : "",
    wiki ? `Wiki page: [[${wiki.slug}]]` : "",
    "",
    `Attention item: ${item.id}`,
  ].filter(Boolean);
  return lines.join("\n");
}

async function applyWikiProposal(
  db: DB,
  scopePath: string,
  payload: WikiProposalPayload,
  actorPrincipalId: string
): Promise<void> {
  await saveDoc(
    db,
    { scopePath, slug: payload.slug, title: payload.title, bodyMd: payload.proposedMd },
    actorPrincipalId
  );
}

export async function resolveAttentionItem(
  db: DB,
  input: { id: string; resolution: AttentionResolution; note?: string | null },
  actorPrincipalId: string
): Promise<AttentionItemView> {
  const item = await getAttentionRow(db, input.id);
  if (item.targetPrincipalId && item.targetPrincipalId !== actorPrincipalId) {
    throw new AttentionNotFoundError(input.id);
  }
  if (item.kind === "page_update") {
    if (item.targetPrincipalId !== actorPrincipalId) {
      throw new AttentionNotFoundError(input.id);
    }
    if (input.resolution !== "dismissed") {
      throw new AttentionStateError("page_update attention items can only be dismissed");
    }
    await requireAccess(db, actorPrincipalId, item.scopePath, "viewer");
  } else if (item.kind === "connection_expiry") {
    if (input.resolution !== "dismissed") {
      throw new AttentionStateError("connection_expiry attention items can only be dismissed");
    }
    await requireAccess(db, actorPrincipalId, item.scopePath, "admin");
  } else {
    await requireAccess(db, actorPrincipalId, item.scopePath, "admin");
  }
  if (item.status !== "open") {
    throw new AttentionStateError(`Attention item ${item.id} is ${item.status}; only open items can be resolved`);
  }

  const note = input.note?.trim() || null;
  if (item.kind === "open_question" && input.resolution === "approved" && !note) {
    throw new AttentionStateError("open_question approval requires a resolution note containing the answer");
  }

  if (input.resolution === "approved") {
    if (item.kind === "wiki_proposal") {
      await applyWikiProposal(db, item.scopePath, wikiProposalPayload(item.payload), actorPrincipalId);
    } else if (item.kind === "graduation") {
      await applyWikiProposal(db, item.scopePath, graduationPayload(item.payload).proposal, actorPrincipalId);
    }
  }

  const now = new Date();
  // status guard in the WHERE clause so two concurrent resolves can't both win
  const updated = (await db
    .update(attentionItems)
    .set({
      status: input.resolution,
      resolvedBy: actorPrincipalId,
      resolvedAt: now,
      resolutionNote: note,
      updatedAt: now,
    })
    .where(and(eq(attentionItems.id, item.id), eq(attentionItems.status, "open")))
    .returning()) as AttentionItem[];
  if (!updated.length) {
    throw new AttentionStateError(`Attention item ${item.id} was already resolved`);
  }

  const resolved = await getAttentionRow(db, item.id);

  await emitEvent(db, {
    type: "attention.resolved",
    scopePath: resolved.scopePath,
    principalId: actorPrincipalId,
    payload: { attentionItemId: resolved.id, kind: resolved.kind, resolution: input.resolution, targetPrincipalId: resolved.targetPrincipalId },
  });

  if (resolved.kind !== "page_update" && resolved.kind !== "connection_expiry") {
    await createRecord(
      db,
      {
        scopePath: resolved.scopePath,
        kind: "decision",
        title: `Resolved: ${resolved.title}`,
        bodyMd: decisionBody(resolved, input.resolution, note),
        data: { attentionItemId: resolved.id, kind: resolved.kind, resolution: input.resolution },
      },
      actorPrincipalId
    );
  }

  return resolved;
}
