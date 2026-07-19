/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "crypto";
import { and, count, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { attentionItems, documents, principals, scopes, type AttentionItem } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope, getVisibleTree } from "../../kernel/scopes";
import { AccessDeniedError, DocumentNotFoundError, ScopeNotFoundError } from "../../errors";
import { parseFutureReviewDate, saveDoc, verifyDoc } from "../docs/service";
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

export interface WikiQuestionClaim {
  slug: string;
  title: string;
  quote: string;
  normalizedValue: string;
}

export interface WikiQuestionRepair {
  slug: string;
  title: string;
  currentMd: string;
  proposedMd: string;
}

export interface WikiConflictPayloadV2 {
  version: 2;
  type: "contradiction";
  relation: "scalar-mismatch" | "opposite-boolean" | "exclusive-status";
  subject: { entity: string; property: string; timeframe: string };
  explanation: string;
  claims: [WikiQuestionClaim, WikiQuestionClaim];
  choices: [
    { id: "first"; label: string; repair: WikiQuestionRepair },
    { id: "second"; label: string; repair: WikiQuestionRepair },
  ];
  scopePath: string;
}

export interface WikiStalePayloadV2 {
  version: 2;
  type: "stale";
  slug: string;
  title: string;
  currentMd: string;
  reviewDueAt: string;
}

export type ParsedWikiQuestionPayload =
  | { state: "v2-contradiction"; payload: WikiConflictPayloadV2 }
  | { state: "v2-stale"; payload: WikiStalePayloadV2 }
  | { state: "legacy"; type: "contradiction" | "stale" | "unknown"; slugs: Array<{ slug: string; title?: string }> };

export type ResolveWikiQuestionAction =
  | { type: "choose"; choiceId: "first" | "second"; note?: string | null }
  | { type: "not-a-conflict"; note?: string | null }
  | { type: "mark-current"; nextReviewAt: string | Date; note?: string | null }
  | { type: "close-unclear"; note?: string | null };

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

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseClaim(value: unknown): WikiQuestionClaim | null {
  if (!isRecord(value)) return null;
  const slug = nonEmptyString(value.slug);
  const title = nonEmptyString(value.title);
  const quote = nonEmptyString(value.quote);
  const normalizedValue = nonEmptyString(value.normalizedValue);
  if (!slug || !title || !quote || !normalizedValue) return null;
  return { slug, title, quote, normalizedValue };
}

function parseRepair(value: unknown): WikiQuestionRepair | null {
  if (!isRecord(value)) return null;
  const slug = nonEmptyString(value.slug);
  const title = nonEmptyString(value.title);
  if (!slug || !title || typeof value.currentMd !== "string" || typeof value.proposedMd !== "string") return null;
  if (value.currentMd === value.proposedMd) return null;
  return { slug, title, currentMd: value.currentMd, proposedMd: value.proposedMd };
}

export function parseWikiQuestionPayload(value: unknown): ParsedWikiQuestionPayload {
  const legacy = (type: "contradiction" | "stale" | "unknown" = "unknown"): ParsedWikiQuestionPayload => {
    const slugs: Array<{ slug: string; title?: string }> = [];
    if (isRecord(value)) {
      const rawSlugs = Array.isArray(value.slugs) ? value.slugs : [];
      for (const slug of rawSlugs) {
        if (typeof slug === "string" && slug.trim()) slugs.push({ slug: slug.trim() });
      }
      const rawSlug = nonEmptyString(value.slug);
      const title = nonEmptyString(value.title) ?? undefined;
      if (rawSlug && !slugs.some((entry) => entry.slug === rawSlug)) slugs.push({ slug: rawSlug, title });
    }
    return { state: "legacy", type, slugs };
  };

  if (!isRecord(value)) return legacy();
  const type = value.type === "contradiction" || value.type === "stale" ? value.type : "unknown";
  if (value.version !== 2) return legacy(type);

  if (type === "contradiction") {
    const relation = value.relation;
    if (relation !== "scalar-mismatch" && relation !== "opposite-boolean" && relation !== "exclusive-status") return legacy("contradiction");
    if (!isRecord(value.subject)) return legacy("contradiction");
    const entity = nonEmptyString(value.subject.entity);
    const property = nonEmptyString(value.subject.property);
    const timeframe = nonEmptyString(value.subject.timeframe);
    const explanation = nonEmptyString(value.explanation);
    const rawClaims = Array.isArray(value.claims) ? value.claims : [];
    const claims = rawClaims.map(parseClaim).filter(Boolean) as WikiQuestionClaim[];
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const first = choices.find((choice) => isRecord(choice) && choice.id === "first");
    const second = choices.find((choice) => isRecord(choice) && choice.id === "second");
    const firstRepair = isRecord(first) ? parseRepair(first.repair) : null;
    const secondRepair = isRecord(second) ? parseRepair(second.repair) : null;
    const firstLabel = isRecord(first) ? nonEmptyString(first.label) : null;
    const secondLabel = isRecord(second) ? nonEmptyString(second.label) : null;
    const scopePath = nonEmptyString(value.scopePath);
    const exactChoices = choices.length === 2
      && choices.every((choice) => isRecord(choice))
      && new Set(choices.map((choice) => (choice as Record<string, unknown>).id)).size === 2;
    const repairsMatchClaims = claims.length === 2
      && !!firstRepair
      && firstRepair.slug === claims[1]?.slug
      && firstRepair.title === claims[1]?.title
      && !!secondRepair
      && secondRepair.slug === claims[0]?.slug
      && secondRepair.title === claims[0]?.title;
    if (!entity || !property || !timeframe || !explanation || rawClaims.length !== 2 || claims.length !== 2 || !exactChoices || !first || !second || !firstRepair || !secondRepair || !firstLabel || !secondLabel || !repairsMatchClaims || !scopePath) {
      return legacy("contradiction");
    }
    return {
      state: "v2-contradiction",
      payload: {
        version: 2,
        type: "contradiction",
        relation,
        subject: { entity, property, timeframe },
        explanation,
        claims: [claims[0]!, claims[1]!],
        choices: [
          { id: "first", label: firstLabel, repair: firstRepair },
          { id: "second", label: secondLabel, repair: secondRepair },
        ],
        scopePath,
      },
    };
  }

  if (type === "stale") {
    const slug = nonEmptyString(value.slug);
    const title = nonEmptyString(value.title);
    const reviewDueAt = nonEmptyString(value.reviewDueAt);
    if (!slug || !title || typeof value.currentMd !== "string" || !reviewDueAt || !Number.isFinite(new Date(reviewDueAt).getTime())) {
      return legacy("stale");
    }
    return { state: "v2-stale", payload: { version: 2, type: "stale", slug, title, currentMd: value.currentMd, reviewDueAt } };
  }

  return legacy();
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function requireHumanAdmin(db: DB, actorPrincipalId: string, scopePath: string): Promise<void> {
  await requireAccess(db, actorPrincipalId, scopePath, "admin");
  const [principal] = (await db
    .select({ id: principals.id, kind: principals.kind })
    .from(principals)
    .where(eq(principals.id, actorPrincipalId))
    .limit(1)) as Array<{ id: string; kind: "human" | "agent" }>;
  if (!principal || principal.kind !== "human") {
    throw new AccessDeniedError(actorPrincipalId, scopePath, "admin", "Only human administrators can resolve wiki questions.");
  }
}

async function getCurrentDocForWikiQuestion(db: DB, scopePath: string, scopeId: string, slug: string) {
  const [doc] = (await db
    .select()
    .from(documents)
    .where(and(eq(documents.scopeId, scopeId), eq(documents.slug, slug)))
    .limit(1)
    .for("update")) as Array<{ id: string; slug: string; title: string; bodyMd: string }>;
  if (!doc) throw new DocumentNotFoundError(scopePath, slug);
  return doc;
}

function assertCurrentBody(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new AttentionStateError("The wiki page changed since this question was prepared. Review the latest page and try again.");
  }
}

function assertQuoteStillPresent(docTitle: string, bodyMd: string, quote: string): void {
  if (!bodyMd.includes(quote)) {
    throw new AttentionStateError(`The quoted text from "${docTitle}" changed. Review the latest pages and try again.`);
  }
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

async function getAttentionRow(db: DB, id: string, lock = false): Promise<AttentionItemView> {
  const query = db
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
    .limit(1);
  const [row] = (await (lock ? query.for("update", { of: attentionItems }) : query)) as Array<AttentionItem & { scopePath: string }>;

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

export async function getAttentionItem(
  db: DB,
  input: { id: string },
  actorPrincipalId: string
): Promise<AttentionItemView | null> {
  let row: AttentionItemView;
  try {
    row = await getAttentionRow(db, input.id);
  } catch (error) {
    if (error instanceof AttentionNotFoundError) return null;
    throw error;
  }

  const visibleIds = await visibleScopeIds(db, actorPrincipalId);
  if (!visibleIds.includes(row.scopeId)) return null;
  if (row.targetPrincipalId && row.targetPrincipalId !== actorPrincipalId) return null;
  return row;
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
  if (item.kind === "wiki_proposal" && wiki) {
    return [
      resolution === "approved" ? "Outcome: Applied the suggested wiki update." : "Outcome: Kept the current wiki page.",
      `Wiki page: [[${wiki.title}|${wiki.slug}]]`,
      note ? `Note: ${note}` : "",
    ].filter(Boolean).join("\n");
  }
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

function wikiDecisionBody(lines: string[], audit: Record<string, unknown>): string {
  return [
    "Wiki question resolved",
    "",
    ...lines,
    "",
    "<!-- companyos-wiki-question-audit",
    JSON.stringify(audit, null, 2),
    "-->",
  ].join("\n");
}

async function updateResolvedItem(
  db: DB,
  item: AttentionItemView,
  actorPrincipalId: string,
  status: AttentionResolution,
  note: string | null,
  audit: Record<string, unknown>
): Promise<AttentionItemView> {
  const now = new Date();
  const currentPayload = isRecord(item.payload) ? item.payload : {};
  const [updated] = (await db
    .update(attentionItems)
    .set({
      status,
      resolvedBy: actorPrincipalId,
      resolvedAt: now,
      resolutionNote: note,
      payload: { ...currentPayload, resolution: audit },
      updatedAt: now,
    })
    .where(and(eq(attentionItems.id, item.id), eq(attentionItems.status, "open")))
    .returning()) as AttentionItem[];
  if (!updated) {
    throw new AttentionStateError("This wiki question was already resolved. Refresh and review the latest state.");
  }
  return getAttentionRow(db, item.id);
}

async function emitWikiResolutionTrail(
  db: DB,
  item: AttentionItemView,
  actorPrincipalId: string,
  status: AttentionResolution,
  note: string | null,
  audit: Record<string, unknown>,
  bodyLines: string[]
): Promise<void> {
  await emitEvent(db, {
    type: "attention.resolved",
    scopePath: item.scopePath,
    principalId: actorPrincipalId,
    payload: { attentionItemId: item.id, kind: item.kind, resolution: status, targetPrincipalId: item.targetPrincipalId, wikiQuestion: audit },
  });
  await createRecord(
    db,
    {
      scopePath: item.scopePath,
      kind: "decision",
      title: "Wiki question resolved",
      bodyMd: wikiDecisionBody(bodyLines, audit),
      data: { attentionItemId: item.id, kind: item.kind, resolution: status, wikiQuestion: audit, note },
    },
    actorPrincipalId
  );
}

export async function resolveWikiQuestionAttentionItem(
  db: DB,
  input: { id: string; action: ResolveWikiQuestionAction },
  actorPrincipalId: string,
  testHooks?: { failAfterDocWrite?: boolean }
): Promise<AttentionItemView> {
  const initial = await getAttentionRow(db, input.id);
  if (initial.targetPrincipalId && initial.targetPrincipalId !== actorPrincipalId) {
    throw new AttentionNotFoundError(input.id);
  }
  if (initial.kind !== "lint_finding") {
    throw new AttentionStateError("Dedicated wiki-question resolution only supports wiki health questions.");
  }
  await requireHumanAdmin(db, actorPrincipalId, initial.scopePath);
  if (initial.status !== "open") {
    throw new AttentionStateError(`This wiki question is ${initial.status}; only open questions can be resolved.`);
  }

  const note = input.action.note?.trim() || null;
  return db.transaction(async (tx: DB) => {
    const action = input.action;
    const item = await getAttentionRow(tx, input.id, true);
    if (item.targetPrincipalId && item.targetPrincipalId !== actorPrincipalId) {
      throw new AttentionNotFoundError(input.id);
    }
    if (item.kind !== "lint_finding" || item.scopePath !== initial.scopePath) {
      throw new AttentionStateError("This wiki question changed. Refresh and try again.");
    }
    if (item.status !== "open") {
      throw new AttentionStateError(`This wiki question is ${item.status}; only open questions can be resolved.`);
    }
    const parsed = parseWikiQuestionPayload(item.payload);

    if (action.type === "close-unclear") {
      if (parsed.state !== "legacy") {
        throw new AttentionStateError("Current wiki questions must use a specific outcome action.");
      }
      const audit = { action: "close-unclear", legacyType: parsed.type, sourcePages: parsed.slugs };
      const resolved = await updateResolvedItem(tx, item, actorPrincipalId, "dismissed", note, audit);
      await emitWikiResolutionTrail(tx, resolved, actorPrincipalId, "dismissed", note, audit, [
        "Outcome: Closed as unclear.",
        "This older check did not include enough evidence to change a wiki page.",
      ]);
      return resolved;
    }

    if (action.type === "choose") {
      if (parsed.state !== "v2-contradiction") {
        throw new AttentionStateError("Only a current two-page disagreement can apply a correction.");
      }
      const payload = parsed.payload;
      if (payload.scopePath !== item.scopePath) {
        throw new AttentionStateError("This wiki question no longer matches its wiki area. Refresh and try again.");
      }
      const choice = payload.choices.find((candidate) => candidate.id === action.choiceId);
      if (!choice) throw new AttentionStateError("Invalid wiki question choice.");
      const scope = await getScope(tx, item.scopePath);
      if (!scope) throw new ScopeNotFoundError(item.scopePath);
      const docsBySlug = new Map<string, Awaited<ReturnType<typeof getCurrentDocForWikiQuestion>>>();
      for (const claim of [...payload.claims].sort((left, right) => left.slug.localeCompare(right.slug))) {
        docsBySlug.set(claim.slug, await getCurrentDocForWikiQuestion(tx, item.scopePath, scope.id, claim.slug));
      }
      const docs = payload.claims.map((claim) => docsBySlug.get(claim.slug)!);
      payload.claims.forEach((claim, index) => {
        if (docs[index]!.title !== claim.title) {
          throw new AttentionStateError("A cited wiki page title changed. Review the latest pages and try again.");
        }
        assertQuoteStillPresent(claim.title, docs[index]!.bodyMd, claim.quote);
      });
      const target = docs.find((doc) => doc.slug === choice.repair.slug);
      if (!target || target.title !== choice.repair.title) {
        throw new AttentionStateError("The selected correction no longer matches a current wiki page.");
      }
      assertCurrentBody(target.bodyMd, choice.repair.currentMd);

      const beforeHash = contentHash(target.bodyMd);
      const afterHash = contentHash(choice.repair.proposedMd);
      const audit = {
        action: "choose",
        selectedChoiceId: choice.id,
        selectedLabel: choice.label,
        selectedValue: payload.claims[choice.id === "first" ? 0 : 1].normalizedValue,
        sourceClaims: payload.claims,
        changedSlug: choice.repair.slug,
        beforeContentHash: beforeHash,
        afterContentHash: afterHash,
      };
      await saveDoc(tx, { scopePath: item.scopePath, slug: choice.repair.slug, title: choice.repair.title, bodyMd: choice.repair.proposedMd }, actorPrincipalId);
      if (testHooks?.failAfterDocWrite) throw new Error("Injected wiki question transaction failure");
      const resolved = await updateResolvedItem(tx, item, actorPrincipalId, "approved", note, audit);
      await emitWikiResolutionTrail(tx, resolved, actorPrincipalId, "approved", note, audit, [
        `Outcome: Applied "${choice.label}".`,
        `Changed page: [[${choice.repair.title}|${choice.repair.slug}]]`,
      ]);
      return resolved;
    }

    if (action.type === "not-a-conflict") {
      if (parsed.state !== "v2-contradiction") {
        throw new AttentionStateError("Only a current two-page disagreement can be marked not a conflict.");
      }
      if (!note || note.length < 3) {
        throw new AttentionStateError("Briefly explain why these statements do not conflict.");
      }
      const audit = {
        action: "not-a-conflict",
        sourceClaims: parsed.payload.claims,
        changedSlug: null,
        beforeContentHash: null,
        afterContentHash: null,
      };
      const resolved = await updateResolvedItem(tx, item, actorPrincipalId, "dismissed", note, audit);
      await emitWikiResolutionTrail(tx, resolved, actorPrincipalId, "dismissed", note, audit, [
        "Outcome: Not a conflict.",
        "No wiki page was changed.",
      ]);
      return resolved;
    }

    if (action.type === "mark-current") {
      if (parsed.state !== "v2-stale") {
        throw new AttentionStateError("Only a current out-of-date page check can be marked current.");
      }
      let nextReviewDate: Date;
      try {
        nextReviewDate = parseFutureReviewDate(action.nextReviewAt);
      } catch {
        throw new AttentionStateError("Choose a future next-review date.");
      }
      const scope = await getScope(tx, item.scopePath);
      if (!scope) throw new ScopeNotFoundError(item.scopePath);
      const current = await getCurrentDocForWikiQuestion(tx, item.scopePath, scope.id, parsed.payload.slug);
      if (current.title !== parsed.payload.title) {
        throw new AttentionStateError("The wiki page title changed. Review the latest page and try again.");
      }
      assertCurrentBody(current.bodyMd, parsed.payload.currentMd);
      const beforeHash = contentHash(current.bodyMd);
      const updated = await verifyDoc(tx, { scopePath: item.scopePath, slug: parsed.payload.slug, nextReviewAt: nextReviewDate }, actorPrincipalId);
      if (testHooks?.failAfterDocWrite) throw new Error("Injected wiki question transaction failure");
      const audit = {
        action: "mark-current",
        page: { slug: parsed.payload.slug, title: parsed.payload.title },
        reviewDueAt: parsed.payload.reviewDueAt,
        nextReviewAt: nextReviewDate.toISOString(),
        changedSlug: parsed.payload.slug,
        beforeContentHash: beforeHash,
        afterContentHash: contentHash(updated.bodyMd),
      };
      const resolved = await updateResolvedItem(tx, item, actorPrincipalId, "approved", note, audit);
      await emitWikiResolutionTrail(tx, resolved, actorPrincipalId, "approved", note, audit, [
        "Outcome: Marked the page as current.",
        `Changed page: [[${parsed.payload.title}|${parsed.payload.slug}]]`,
      ]);
      return resolved;
    }

    throw new AttentionStateError("Unsupported wiki question action.");
  });
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
  } else if (item.kind === "lint_finding") {
    await requireAccess(db, actorPrincipalId, item.scopePath, "admin");
    throw new AttentionStateError("Wiki questions require a specific outcome action.");
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
