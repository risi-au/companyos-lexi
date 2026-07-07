/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { documents, embeddings, intakePackets, scopes, skillsIndex, type IntakePacket } from "@companyos/db";
import {
  assembleExternalPack,
  bodyWithoutFrontmatter,
  parseFramingQuestions,
  parsePastedIntakePacket,
  parseWizardTemplateMarkdown,
  type IntakePacketPayload,
  type WizardTemplate,
} from "@companyos/wizard";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess, resolveAccess } from "../../kernel/grants";
import { getScope, getVisibleTree } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";
import { getContextBundle } from "../../agent";
import { createSystemRecord } from "../records/service";
import { saveDoc } from "../docs/service";
import { createTask } from "../tasks/service";
import type { PlaneClient } from "../tasks/plane-client";
import { provisionScope, type ProvisionDeps, type ProvisionResult, type ProvisionSpec } from "../provisioning/service";
import { getSkill, syncSkills } from "../skills/service";
import { search, type SearchHit } from "../search/service";
import { embedQuery, toVectorSql } from "../../lib/embeddings";
import type { GitHubClient } from "../../lib/github-client";

export type IntakeStatus = IntakePacket["status"];

export interface IntakePacketView extends IntakePacket {
  scopePath: string;
  scopeName: string;
  ageMs: number;
}

export interface RelatedHistorySelection {
  type: "record" | "doc";
  id: string;
  title: string;
  scopePath: string;
  snippet: string;
  kind?: string;
  slug?: string;
}

export class IntakeNotFoundError extends Error {
  constructor(id: string) {
    super(`Intake packet not found: ${id}`);
    this.name = "IntakeNotFoundError";
  }
}

export class IntakeStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeStateError";
  }
}

const PRE_APPROVAL_STATUSES: IntakeStatus[] = ["draft", "awaiting_external", "needs_review"];

function canReadRole(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "editor" || role === "agent" || role === "viewer";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toView(row: IntakePacket & { scopePath: string; scopeName: string }): IntakePacketView {
  return {
    ...row,
    ageMs: Date.now() - new Date(row.updatedAt).getTime(),
  };
}

function scrubNull<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

async function getRequiredScope(db: DB, scopePath: string) {
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  return scope;
}

async function getRootPath(db: DB): Promise<string> {
  const [root] = await db.select({ path: scopes.path }).from(scopes).where(eq(scopes.type, "root")).limit(1);
  return root?.path ?? "root";
}

async function requireRootAdmin(db: DB, actorPrincipalId: string): Promise<void> {
  await requireAccess(db, actorPrincipalId, await getRootPath(db), "admin");
}

async function getIntakeRow(db: DB, id: string): Promise<IntakePacketView> {
  const [row] = (await db
    .select({
      id: intakePackets.id,
      scopeId: intakePackets.scopeId,
      status: intakePackets.status,
      templateSlug: intakePackets.templateSlug,
      answers: intakePackets.answers,
      packetMd: intakePackets.packetMd,
      researchSources: intakePackets.researchSources,
      proposedProvisionSpec: intakePackets.proposedProvisionSpec,
      proposedDocs: intakePackets.proposedDocs,
      proposedTasks: intakePackets.proposedTasks,
      proposedWikiUpdates: intakePackets.proposedWikiUpdates,
      openQuestions: intakePackets.openQuestions,
      riskNotes: intakePackets.riskNotes,
      reusePatternSlug: intakePackets.reusePatternSlug,
      sourceEngine: intakePackets.sourceEngine,
      sourceModel: intakePackets.sourceModel,
      submittedBy: intakePackets.submittedBy,
      approvedBy: intakePackets.approvedBy,
      reportRecordId: intakePackets.reportRecordId,
      artifactLinks: intakePackets.artifactLinks,
      packSnapshot: intakePackets.packSnapshot,
      relatedHistorySelections: intakePackets.relatedHistorySelections,
      createdAt: intakePackets.createdAt,
      updatedAt: intakePackets.updatedAt,
      submittedAt: intakePackets.submittedAt,
      approvedAt: intakePackets.approvedAt,
      provisionedAt: intakePackets.provisionedAt,
      scopePath: scopes.path,
      scopeName: scopes.name,
    })
    .from(intakePackets)
    .innerJoin(scopes, eq(intakePackets.scopeId, scopes.id))
    .where(eq(intakePackets.id, id))
    .limit(1)) as Array<IntakePacket & { scopePath: string; scopeName: string }>;
  if (!row) throw new IntakeNotFoundError(id);
  return toView(row);
}

async function emitIntakeEvent(db: DB, type: string, intake: IntakePacketView, actorPrincipalId: string | null, payload: Record<string, unknown> = {}) {
  await emitEvent(db, {
    type,
    scopePath: intake.scopePath,
    principalId: actorPrincipalId,
    payload: {
      intakeId: intake.id,
      status: intake.status,
      templateSlug: intake.templateSlug,
      ...payload,
    },
  });
}

function ensurePreApproval(intake: IntakePacketView): void {
  if (!PRE_APPROVAL_STATUSES.includes(intake.status)) {
    throw new IntakeStateError(`Intake ${intake.id} is ${intake.status}; only pre-approval intakes can be edited`);
  }
}

function skeletonSpec(scopePath: string, answers: unknown): ProvisionSpec {
  const modules = ["docs"];
  if (isJsonObject(answers)) {
    if (answers.plane === true || answers.plane === "yes") modules.push("tasks");
    if (answers.workbench === true || answers.workbench === "yes") modules.push("workbench");
  }
  return { scopePath, modules: Array.from(new Set(modules)) };
}

export async function ensureDraftIntakeForScope(
  db: DB,
  input: { scopePath: string; templateSlug?: string; reason?: string },
  actorPrincipalId: string
): Promise<IntakePacketView> {
  const scope = await getRequiredScope(db, input.scopePath);
  await requireAccess(db, actorPrincipalId, scope.path, "editor");

  const [existing] = (await db
    .select({
      id: intakePackets.id,
    })
    .from(intakePackets)
    .where(eq(intakePackets.scopeId, scope.id))
    .orderBy(desc(intakePackets.createdAt))
    .limit(1)) as Array<{ id: string }>;
  if (existing) return getIntakePacket(db, existing.id, actorPrincipalId);

  const [created] = (await db
    .insert(intakePackets)
    .values({
      scopeId: scope.id,
      templateSlug: input.templateSlug ?? (scope.type === "project" ? "new-project" : "new-sub-scope"),
      answers: input.reason?.trim() ? { reason: input.reason.trim() } : {},
      proposedProvisionSpec: skeletonSpec(scope.path, input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      submittedBy: actorPrincipalId,
    })
    .returning({ id: intakePackets.id })) as Array<{ id: string }>;
  const intake = await getIntakeRow(db, created!.id);
  await emitIntakeEvent(db, "intake.updated", intake, actorPrincipalId, { action: "created_draft" });
  return intake;
}

export async function listIntakePackets(
  db: DB,
  input: { scopePath?: string | null; statuses?: IntakeStatus[]; includeDescendants?: boolean; limit?: number },
  actorPrincipalId: string
): Promise<IntakePacketView[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200);
  const conditions: any[] = [];
  if (input.statuses?.length) conditions.push(inArray(intakePackets.status, input.statuses));

  if (input.scopePath) {
    await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");
    if (input.includeDescendants) {
      conditions.push(input.scopePath === "root" ? like(scopes.path, "%") : or(eq(scopes.path, input.scopePath), like(scopes.path, `${input.scopePath}/%`)));
    } else {
      const scope = await getRequiredScope(db, input.scopePath);
      conditions.push(eq(intakePackets.scopeId, scope.id));
    }
  } else {
    await requireRootAdmin(db, actorPrincipalId);
  }

  const rows = (await db
    .select({
      id: intakePackets.id,
      scopeId: intakePackets.scopeId,
      status: intakePackets.status,
      templateSlug: intakePackets.templateSlug,
      answers: intakePackets.answers,
      packetMd: intakePackets.packetMd,
      researchSources: intakePackets.researchSources,
      proposedProvisionSpec: intakePackets.proposedProvisionSpec,
      proposedDocs: intakePackets.proposedDocs,
      proposedTasks: intakePackets.proposedTasks,
      proposedWikiUpdates: intakePackets.proposedWikiUpdates,
      openQuestions: intakePackets.openQuestions,
      riskNotes: intakePackets.riskNotes,
      reusePatternSlug: intakePackets.reusePatternSlug,
      sourceEngine: intakePackets.sourceEngine,
      sourceModel: intakePackets.sourceModel,
      submittedBy: intakePackets.submittedBy,
      approvedBy: intakePackets.approvedBy,
      reportRecordId: intakePackets.reportRecordId,
      artifactLinks: intakePackets.artifactLinks,
      packSnapshot: intakePackets.packSnapshot,
      relatedHistorySelections: intakePackets.relatedHistorySelections,
      createdAt: intakePackets.createdAt,
      updatedAt: intakePackets.updatedAt,
      submittedAt: intakePackets.submittedAt,
      approvedAt: intakePackets.approvedAt,
      provisionedAt: intakePackets.provisionedAt,
      scopePath: scopes.path,
      scopeName: scopes.name,
    })
    .from(intakePackets)
    .innerJoin(scopes, eq(intakePackets.scopeId, scopes.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(intakePackets.updatedAt))
    .limit(limit)) as Array<IntakePacket & { scopePath: string; scopeName: string }>;

  return rows.map(toView);
}

export async function getIntakePacket(db: DB, id: string, actorPrincipalId: string): Promise<IntakePacketView> {
  const intake = await getIntakeRow(db, id);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "viewer");
  return intake;
}

export interface UpdateIntakePacketInput {
  id: string;
  templateSlug?: string;
  answers?: unknown;
  packetMd?: string | null;
  researchSources?: unknown;
  proposedProvisionSpec?: unknown;
  proposedDocs?: unknown;
  proposedTasks?: unknown;
  proposedWikiUpdates?: unknown;
  openQuestions?: unknown;
  riskNotes?: unknown;
  reusePatternSlug?: string | null;
  packSnapshot?: string | null;
  relatedHistorySelections?: RelatedHistorySelection[];
  status?: "draft" | "awaiting_external" | "needs_review";
}

export async function updateIntakePacket(db: DB, input: UpdateIntakePacketInput, actorPrincipalId: string): Promise<IntakePacketView> {
  const intake = await getIntakePacket(db, input.id, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "editor");
  ensurePreApproval(intake);

  const nextAnswers = input.answers !== undefined ? input.answers : intake.answers;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.templateSlug !== undefined) updates.templateSlug = input.templateSlug;
  if (input.answers !== undefined) updates.answers = input.answers;
  if (input.packetMd !== undefined) updates.packetMd = input.packetMd;
  if (input.researchSources !== undefined) updates.researchSources = input.researchSources;
  if (input.proposedProvisionSpec !== undefined) updates.proposedProvisionSpec = input.proposedProvisionSpec;
  if (input.proposedDocs !== undefined) updates.proposedDocs = input.proposedDocs;
  if (input.proposedTasks !== undefined) updates.proposedTasks = input.proposedTasks;
  if (input.proposedWikiUpdates !== undefined) updates.proposedWikiUpdates = input.proposedWikiUpdates;
  if (input.openQuestions !== undefined) updates.openQuestions = input.openQuestions;
  if (input.riskNotes !== undefined) updates.riskNotes = input.riskNotes;
  if (input.reusePatternSlug !== undefined) updates.reusePatternSlug = input.reusePatternSlug;
  if (input.packSnapshot !== undefined) updates.packSnapshot = input.packSnapshot;
  if (input.relatedHistorySelections !== undefined) updates.relatedHistorySelections = input.relatedHistorySelections;
  if (input.status !== undefined) {
    updates.status = input.status;
    if (input.status === "awaiting_external") updates.submittedAt = new Date();
  }
  if (input.answers !== undefined && input.proposedProvisionSpec === undefined) {
    updates.proposedProvisionSpec = { ...skeletonSpec(intake.scopePath, nextAnswers), ...(isJsonObject(intake.proposedProvisionSpec) ? intake.proposedProvisionSpec : {}) };
  }

  await db.update(intakePackets).set(updates).where(eq(intakePackets.id, input.id));
  const updated = await getIntakeRow(db, input.id);
  await emitIntakeEvent(db, "intake.updated", updated, actorPrincipalId, { changed: Object.keys(updates).filter((key) => key !== "updatedAt") });
  return updated;
}

function packetToUpdates(packet: IntakePacketPayload): Partial<UpdateIntakePacketInput> {
  return {
    packetMd: packet.packet_md,
    researchSources: packet.research_sources,
    proposedProvisionSpec: packet.proposed_provision_spec,
    proposedDocs: packet.proposed_docs,
    proposedTasks: packet.proposed_tasks,
    proposedWikiUpdates: packet.proposed_wiki_updates,
    openQuestions: packet.open_questions,
    riskNotes: packet.risk_notes,
  };
}

export async function submitIntakePacket(
  db: DB,
  input: { id?: string; scopePath?: string; pasteText?: string; packet?: IntakePacketPayload; templateSlug?: string },
  actorPrincipalId: string
): Promise<{ intake: IntakePacketView; markdownOnly: boolean; errors?: string[] }> {
  let intake: IntakePacketView;
  if (input.id) {
    intake = await getIntakePacket(db, input.id, actorPrincipalId);
  } else if (input.scopePath) {
    intake = await ensureDraftIntakeForScope(db, { scopePath: input.scopePath, templateSlug: input.templateSlug }, actorPrincipalId);
  } else {
    throw new Error("submitIntakePacket requires id or scopePath");
  }
  await requireAccess(db, actorPrincipalId, intake.scopePath, "editor");
  ensurePreApproval(intake);

  let packet: IntakePacketPayload;
  let markdownOnly = false;
  if (input.packet) {
    packet = input.packet;
  } else {
    const parsed = parsePastedIntakePacket(input.pasteText ?? "");
    if (!parsed.ok) return { intake, markdownOnly: false, errors: parsed.errors };
    packet = parsed.packet;
    markdownOnly = parsed.markdownOnly;
  }

  await db.update(intakePackets).set({
    ...packetToUpdates(packet),
    sourceEngine: packet.source_engine ?? null,
    sourceModel: packet.source_model ?? null,
    status: "needs_review",
    submittedBy: actorPrincipalId,
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(intakePackets.id, intake.id));
  const updated = await getIntakeRow(db, intake.id);
  await emitIntakeEvent(db, "intake.submitted", updated, actorPrincipalId, { markdownOnly });
  return { intake: updated, markdownOnly };
}

function extractJsonBlock(body: string, name: string): unknown | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<!--\\s*companyos:${escaped}:start\\s*-->\\s*([\\s\\S]*?)\\s*<!--\\s*companyos:${escaped}:end\\s*-->`, "i");
  const match = regex.exec(body);
  if (!match) return null;
  try {
    return JSON.parse(match[1]!.trim());
  } catch {
    return null;
  }
}

function reasonFromAnswers(answers: unknown): string {
  return isJsonObject(answers) && typeof answers.reason === "string" ? answers.reason : "";
}

function normalizeRelatedHit(hit: SearchHit): RelatedHistorySelection {
  return {
    type: hit.type,
    id: hit.id,
    title: hit.title,
    scopePath: hit.scopePath,
    snippet: hit.snippet,
    ...(hit.kind ? { kind: hit.kind } : {}),
    ...(hit.slug ? { slug: hit.slug } : {}),
  };
}

function normalizeRelatedSelections(value: unknown): RelatedHistorySelection[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isJsonObject).map((item) => ({
    type: (item.type === "doc" ? "doc" : "record") as "doc" | "record",
    id: String(item.id ?? ""),
    title: String(item.title ?? ""),
    scopePath: String(item.scopePath ?? ""),
    snippet: String(item.snippet ?? ""),
    ...(typeof item.kind === "string" ? { kind: item.kind } : {}),
    ...(typeof item.slug === "string" ? { slug: item.slug } : {}),
  })).filter((item) => item.id && item.scopePath && item.title);
}

function relatedQuery(intake: IntakePacketView, override?: string | null): string {
  const reason = reasonFromAnswers(intake.answers);
  return [override, reason, intake.scopeName, intake.scopePath.split("/").pop()].filter(Boolean).join(" ");
}

export async function findRelatedHistory(
  db: DB,
  input: { intakeId: string; query?: string; limit?: number },
  actorPrincipalId: string
): Promise<RelatedHistorySelection[]> {
  const intake = await getIntakePacket(db, input.intakeId, actorPrincipalId);
  const query = relatedQuery(intake, input.query);
  if (!query.trim()) return [];
  const queryCandidates = Array.from(new Set([
    query,
    intake.scopeName,
    reasonFromAnswers(intake.answers),
  ].map((item) => item.trim()).filter(Boolean)));
  const limit = Math.min(Math.max(1, input.limit ?? 10), 20);
  const visible = await getVisibleTree(db, actorPrincipalId);
  const canSearchRoot = visible.some((scope) => scope.path === "root" || scope.type === "root");
  const roots = canSearchRoot
    ? ["root"]
    : visible
      .filter((scope) => scope.type === "project" && !scope.path.includes("/"))
      .map((scope) => scope.path);
  const dedup = new Map<string, RelatedHistorySelection>();
  for (const scopePath of roots) {
    for (const candidate of queryCandidates) {
      const hits = await search(db, { scopePath, query: candidate, limit, mode: "hybrid" }, actorPrincipalId);
      for (const hit of hits) {
        if (hit.scopePath === intake.scopePath) continue;
        const key = `${hit.type}:${hit.id}`;
        if (!dedup.has(key)) dedup.set(key, normalizeRelatedHit(hit));
        if (dedup.size >= limit) break;
      }
      if (dedup.size >= limit) break;
    }
    if (dedup.size >= limit) break;
  }
  return Array.from(dedup.values()).slice(0, limit);
}

async function semanticPatternScores(db: DB, query: string): Promise<Map<string, number>> {
  try {
    const vector = await embedQuery(query);
    if (!vector) return new Map();
    const queryVector = toVectorSql(vector);
    const rows = (await db
      .select({
        id: documents.id,
        rank: sql<number>`1 - (${embeddings.embedding} <=> ${queryVector})`.as("rank"),
      })
      .from(embeddings)
      .innerJoin(documents, eq(embeddings.entityId, documents.id))
      .innerJoin(scopes, eq(documents.scopeId, scopes.id))
      .where(and(eq(scopes.path, "root"), like(documents.slug, "pattern-%"), eq(embeddings.entityType, "doc"), isNull(documents.archivedAt)))
      .orderBy(sql`${embeddings.embedding} <=> ${queryVector}`)
      .limit(20)) as Array<{ id: string; rank: number }>;
    return new Map(rows.map((row) => [row.id, Number(row.rank) || 0]));
  } catch {
    return new Map();
  }
}

export async function findReusePatterns(
  db: DB,
  input: { scopePath: string; query: string; limit?: number },
  actorPrincipalId: string
): Promise<Array<{ slug: string; title: string; summary: string; reusable: boolean; sourceScopePath: string | null; sourceVisible: boolean }>> {
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");
  const query = input.query.trim().toLowerCase();
  const rows = (await db
    .select({ id: documents.id, slug: documents.slug, title: documents.title, bodyMd: documents.bodyMd })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(eq(scopes.path, "root"), like(documents.slug, "pattern-%"), isNull(documents.archivedAt)))
    .orderBy(desc(documents.updatedAt))
    .limit(Math.min(Math.max(1, input.limit ?? 5), 20))) as Array<{ id: string; slug: string; title: string; bodyMd: string }>;

  const terms = query.split(/[^a-z0-9]+/).filter((part) => part.length > 2);
  const semanticScores = await semanticPatternScores(db, query);
  const scored = rows
    .map((row) => {
      const hay = `${row.slug} ${row.title} ${row.bodyMd}`.toLowerCase();
      const lexical = terms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
      const semantic = semanticScores.get(row.id) ?? 0;
      const score = lexical + semantic;
      return { row, score };
    })
    .filter((item) => item.score > 0 || terms.length === 0 || semanticScores.size > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 5);

  const results = [];
  for (const item of scored) {
    const spec = extractJsonBlock(item.row.bodyMd, "provision_spec");
    const sourceScopePath = typeof extractJsonBlock(item.row.bodyMd, "source_scope_path") === "string"
      ? extractJsonBlock(item.row.bodyMd, "source_scope_path") as string
      : null;
    const role = sourceScopePath ? await resolveAccess(db, actorPrincipalId, sourceScopePath) : null;
    results.push({
      slug: item.row.slug,
      title: item.row.title,
      summary: item.row.bodyMd.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("---"))?.slice(0, 240) ?? "",
      reusable: isJsonObject(spec),
      sourceScopePath,
      sourceVisible: canReadRole(role),
    });
  }
  return results;
}

export async function acceptReusePattern(
  db: DB,
  input: { intakeId: string; patternSlug: string },
  actorPrincipalId: string
): Promise<IntakePacketView> {
  const intake = await getIntakePacket(db, input.intakeId, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "editor");
  ensurePreApproval(intake);

  const [pattern] = (await db
    .select({ bodyMd: documents.bodyMd })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(eq(scopes.path, "root"), eq(documents.slug, input.patternSlug), isNull(documents.archivedAt)))
    .limit(1)) as Array<{ bodyMd: string }>;
  if (!pattern) throw new Error(`Pattern not found: ${input.patternSlug}`);
  const spec = extractJsonBlock(pattern.bodyMd, "provision_spec");
  if (!isJsonObject(spec)) throw new Error(`Pattern ${input.patternSlug} does not contain a reusable provision spec`);
  const docs = scrubNull(extractJsonBlock(pattern.bodyMd, "doc_seeds"), []);
  const tasks = scrubNull(extractJsonBlock(pattern.bodyMd, "task_seeds"), []);
  const wiki = scrubNull(extractJsonBlock(pattern.bodyMd, "wiki_updates"), []);
  const nextSpec = { ...spec, scopePath: intake.scopePath };

  await db.update(intakePackets).set({
    reusePatternSlug: input.patternSlug,
    proposedProvisionSpec: nextSpec,
    proposedDocs: docs,
    proposedTasks: tasks,
    proposedWikiUpdates: wiki,
    status: "needs_review",
    updatedAt: new Date(),
  }).where(eq(intakePackets.id, intake.id));
  const updated = await getIntakeRow(db, intake.id);
  await emitIntakeEvent(db, "intake.updated", updated, actorPrincipalId, { action: "reuse_pattern_accepted", patternSlug: input.patternSlug });
  return updated;
}

function parentChain(scopePath: string): string[] {
  const parts = scopePath.split("/").filter(Boolean);
  const chain: string[] = [];
  for (let i = parts.length - 1; i > 0; i -= 1) {
    chain.push(parts.slice(0, i).join("/"));
  }
  return chain;
}

async function rootFallbackContext(db: DB): Promise<string> {
  const rows = (await db
    .select({ slug: documents.slug, title: documents.title, bodyMd: documents.bodyMd })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(eq(scopes.path, "root"), inArray(documents.slug, ["scope-map", "critical-facts"]), isNull(documents.archivedAt)))
    .orderBy(documents.slug)) as Array<{ slug: string; title: string; bodyMd: string }>;
  if (!rows.length) return "(root scope-map and critical-facts docs not found)";
  return rows.map((row) => `### ${row.title} (${row.slug})\n\n${row.bodyMd.trim()}`).join("\n\n");
}

async function structuralContextForIntake(db: DB, intake: IntakePacketView, actorPrincipalId: string): Promise<string> {
  const chain = parentChain(intake.scopePath);
  const lines = [
    `Scope path: ${intake.scopePath}`,
    `Parent chain: ${chain.length ? chain.join(" -> ") : "(top-level scope)"}`,
  ];
  if (chain[0]) {
    lines.push("", "### Parent get_context", "", await getContextBundle(db, chain[0], actorPrincipalId));
  } else {
    lines.push("", "### Root fallback context", "", await rootFallbackContext(db));
  }
  return lines.join("\n");
}

async function intakeSkillBriefing(db: DB, actorPrincipalId: string): Promise<string> {
  try {
    const skill = await getSkill(db, { name: "scope-intake" }, actorPrincipalId);
    return bodyWithoutFrontmatter(skill.body);
  } catch {
    return bodyWithoutFrontmatter(DEFAULT_SCOPE_INTAKE_SKILL);
  }
}

interface WizardTemplateSource {
  path: string;
  body: string;
  template: WizardTemplate;
}

function parseTemplateSource(path: string, body: string): WizardTemplateSource | null {
  const parsed = parseWizardTemplateMarkdown(body);
  if (!parsed.template) return null;
  return { path, body, template: parsed.template };
}

function defaultWizardTemplateSources(): WizardTemplateSource[] {
  return DEFAULT_TEMPLATE_FILES
    .map((fixture) => parseTemplateSource(fixture.path, fixture.body))
    .filter((source): source is WizardTemplateSource => !!source);
}

async function syncedWizardTemplateSources(db: DB): Promise<WizardTemplateSource[]> {
  const rows = (await db
    .select({ path: skillsIndex.path, body: skillsIndex.body })
    .from(skillsIndex)
    .where(like(skillsIndex.path, "%/templates/%.md"))
    .orderBy(skillsIndex.path)) as Array<{ path: string; body: string }>;
  return rows
    .map((row) => parseTemplateSource(row.path, row.body))
    .filter((source): source is WizardTemplateSource => !!source);
}

async function wizardTemplateSources(db: DB): Promise<WizardTemplateSource[]> {
  const merged = new Map<string, WizardTemplateSource>();
  for (const source of defaultWizardTemplateSources()) {
    merged.set(source.template.slug, source);
  }
  for (const source of await syncedWizardTemplateSources(db)) {
    merged.set(source.template.slug, source);
  }
  return Array.from(merged.values());
}

async function defaultInterviewTemplate(db: DB): Promise<string> {
  const synced = (await syncedWizardTemplateSources(db)).find((source) => source.template.kind === "interview");
  if (synced) return bodyWithoutFrontmatter(synced.body);
  const fallback = DEFAULT_TEMPLATE_FILES.find((file) => file.path.endsWith("/interview.md"))?.body;
  return fallback ? bodyWithoutFrontmatter(fallback) : DEFAULT_INTERVIEW_TEMPLATE;
}

export async function assembleIntakeExternalPack(
  db: DB,
  input: { intakeId: string; templateBody?: string },
  actorPrincipalId: string
): Promise<{ pasteBack: string; mcp: string }> {
  const intake = await getIntakePacket(db, input.intakeId, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "editor");
  const briefing = await intakeSkillBriefing(db, actorPrincipalId);
  const structuralContext = await structuralContextForIntake(db, intake, actorPrincipalId);
  const reusePatterns = await findReusePatterns(db, {
    scopePath: intake.scopePath,
    query: relatedQuery(intake),
    limit: 3,
  }, actorPrincipalId);
  const pack = assembleExternalPack({
    intakeId: intake.id,
    scopePath: intake.scopePath,
    scopeName: intake.scopeName,
    briefing,
    answers: intake.answers,
    reason: reasonFromAnswers(intake.answers),
    templateBody: input.templateBody ?? await defaultInterviewTemplate(db),
    structuralContext,
    relatedHistory: normalizeRelatedSelections(intake.relatedHistorySelections),
    reusePatterns,
    acceptedPattern: intake.reusePatternSlug,
  });
  await updateIntakePacket(db, { id: intake.id, status: "awaiting_external", packSnapshot: pack.pasteBack }, actorPrincipalId);
  return pack;
}

export async function approveIntakePacket(db: DB, input: { id: string }, actorPrincipalId: string): Promise<IntakePacketView> {
  const intake = await getIntakePacket(db, input.id, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "admin");
  if (intake.status !== "needs_review") throw new IntakeStateError(`Only needs_review intakes can be approved; got ${intake.status}`);
  await db.update(intakePackets).set({ status: "approved", approvedBy: actorPrincipalId, approvedAt: new Date(), updatedAt: new Date() }).where(eq(intakePackets.id, input.id));
  const updated = await getIntakeRow(db, input.id);
  await emitIntakeEvent(db, "intake.approved", updated, actorPrincipalId);
  return updated;
}

export async function rejectIntakePacket(db: DB, input: { id: string; reason?: string }, actorPrincipalId: string): Promise<IntakePacketView> {
  const intake = await getIntakePacket(db, input.id, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "admin");
  await db.update(intakePackets).set({ status: "rejected", riskNotes: input.reason ? [{ reason: input.reason }] : intake.riskNotes, updatedAt: new Date() }).where(eq(intakePackets.id, input.id));
  const updated = await getIntakeRow(db, input.id);
  await emitIntakeEvent(db, "intake.rejected", updated, actorPrincipalId, { reason: input.reason ?? null });
  return updated;
}

export async function dismissIntakePacket(db: DB, input: { id: string }, actorPrincipalId: string): Promise<IntakePacketView> {
  const intake = await getIntakePacket(db, input.id, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "admin");
  await db.update(intakePackets).set({ status: "dismissed", updatedAt: new Date() }).where(eq(intakePackets.id, input.id));
  const updated = await getIntakeRow(db, input.id);
  await emitIntakeEvent(db, "intake.dismissed", updated, actorPrincipalId);
  return updated;
}

export async function reopenIntakePacket(db: DB, input: { id: string }, actorPrincipalId: string): Promise<IntakePacketView> {
  const intake = await getIntakePacket(db, input.id, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "admin");
  if (intake.status !== "dismissed" && intake.status !== "rejected") return intake;
  await db.update(intakePackets).set({ status: "draft", updatedAt: new Date() }).where(eq(intakePackets.id, input.id));
  const updated = await getIntakeRow(db, input.id);
  await emitIntakeEvent(db, "intake.updated", updated, actorPrincipalId, { action: "reopened" });
  return updated;
}

function asSeedArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isJsonObject);
  if (isJsonObject(value)) return Object.entries(value).map(([key, item]) => isJsonObject(item) ? { slug: key, ...item } : { slug: key, title: key, bodyMd: String(item ?? "") });
  return [];
}

export async function provisionFromIntakePacket(
  db: DB,
  deps: ProvisionDeps & { plane: PlaneClient },
  input: { id: string; specOverride?: ProvisionSpec },
  actorPrincipalId: string
): Promise<{ intake: IntakePacketView; result: ProvisionResult; recordId: string; artifacts: Record<string, unknown> }> {
  const intake = await getIntakePacket(db, input.id, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "admin");
  if (intake.status !== "approved") throw new IntakeStateError(`Only approved intakes can be provisioned; got ${intake.status}`);
  const spec = input.specOverride ?? (isJsonObject(intake.proposedProvisionSpec) ? intake.proposedProvisionSpec as unknown as ProvisionSpec : null);
  if (!spec || !spec.scopePath) throw new Error("Approved intake has no proposed provision spec with scopePath");

  const result = await provisionScope(db, deps, { ...spec, scopePath: intake.scopePath }, actorPrincipalId);
  const artifacts: Record<string, unknown> = { provisionSteps: result.steps };

  const docs = [];
  for (const seed of asSeedArray(intake.proposedDocs)) {
    const title = String(seed.title ?? seed.slug ?? "Intake document");
    const bodyMd = String(seed.bodyMd ?? seed.body_md ?? "");
    const slug = seed.slug ? String(seed.slug) : undefined;
    docs.push(await saveDoc(db, { scopePath: intake.scopePath, title, slug, bodyMd }, actorPrincipalId));
  }
  const wiki = [];
  for (const seed of asSeedArray(intake.proposedWikiUpdates)) {
    const title = String(seed.title ?? seed.slug ?? "Wiki update");
    const bodyMd = String(seed.bodyMd ?? seed.body_md ?? "");
    const slug = seed.slug ? String(seed.slug) : undefined;
    wiki.push(await saveDoc(db, { scopePath: intake.scopePath, title, slug, bodyMd }, actorPrincipalId));
  }
  const tasks = [];
  for (const seed of asSeedArray(intake.proposedTasks)) {
    const title = String(seed.title ?? seed.name ?? "");
    if (!title) continue;
    tasks.push(await createTask(db, deps.plane, { scopePath: intake.scopePath, title, description: seed.description ? String(seed.description) : undefined }, actorPrincipalId));
  }
  artifacts.docs = docs.map((doc) => ({ id: doc.id, slug: doc.slug }));
  artifacts.wiki = wiki.map((doc) => ({ id: doc.id, slug: doc.slug }));
  artifacts.tasks = tasks;

  const report = await createSystemRecord(db, {
    scopePath: intake.scopePath,
    kind: "report",
    title: "Creation wizard intake packet",
    bodyMd: intake.packetMd || "Provisioned from creation wizard.",
    data: { intakeId: intake.id, artifacts, provision: result },
  }, actorPrincipalId);

  const sourceRefs = normalizeRelatedSelections(intake.relatedHistorySelections);
  if (sourceRefs.length) {
    const bodyMd = [
      "# source-refs",
      "",
      "Related pre-scope history selected during creation wizard intake.",
      "",
      ...sourceRefs.map((ref) => `- [${ref.type}${ref.kind ? `:${ref.kind}` : ""}] ${ref.title} (${ref.scopePath}) - ${ref.id}${ref.slug ? ` / ${ref.slug}` : ""}`),
    ].join("\n");
    const sourceRecord = await createSystemRecord(db, {
      scopePath: intake.scopePath,
      kind: "note",
      title: "source-refs",
      bodyMd,
      data: { intakeId: intake.id, relatedHistorySelections: sourceRefs },
    }, actorPrincipalId);
    artifacts.sourceRefsRecordId = sourceRecord.id;
  }

  await db.update(intakePackets).set({
    status: "provisioned",
    reportRecordId: report.id,
    artifactLinks: artifacts,
    provisionedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(intakePackets.id, intake.id));
  const updated = await getIntakeRow(db, intake.id);
  await emitIntakeEvent(db, "intake.provisioned", updated, actorPrincipalId, { reportRecordId: report.id, artifacts });
  return { intake: updated, result, recordId: report.id, artifacts };
}

export interface WizardTemplateEntry {
  path: string;
  slug: string;
  title: string;
  kind: WizardTemplate["kind"];
  appliesTo: WizardTemplate["appliesTo"];
  version: string;
  errors: string[];
}

export interface WizardFramingTemplate {
  slug: string;
  questions: Array<{ key: string; question: string }>;
}

export async function listWizardTemplates(db: DB, actorPrincipalId: string): Promise<WizardTemplateEntry[]> {
  await requireRootAdmin(db, actorPrincipalId);
  const rows = (await db.select().from(skillsIndex).where(eq(skillsIndex.name, "scope-intake")).limit(1)) as Array<{ body: string; path: string }>;
  const entries: WizardTemplateEntry[] = [];
  const syncedBySlug = new Map((await syncedWizardTemplateSources(db)).map((source) => [source.template.slug, source]));
  const usedSyncedSlugs = new Set<string>();
  for (const fixture of DEFAULT_TEMPLATE_FILES) {
    const parsed = parseWizardTemplateMarkdown(fixture.body);
    const source = parsed.template ? syncedBySlug.get(parsed.template.slug) : undefined;
    const body = source?.body ?? fixture.body;
    const path = source?.path ?? fixture.path;
    if (source) usedSyncedSlugs.add(source.template.slug);
    const effective = parseWizardTemplateMarkdown(body);
    entries.push(parsed.template
      ? {
          path,
          slug: effective.template?.slug ?? parsed.template.slug,
          title: effective.template?.title ?? parsed.template.title,
          kind: effective.template?.kind ?? parsed.template.kind,
          appliesTo: effective.template?.appliesTo ?? parsed.template.appliesTo,
          version: effective.template?.version ?? parsed.template.version,
          errors: effective.errors,
        }
      : { path: fixture.path, slug: fixture.path, title: fixture.path, kind: "interview", appliesTo: "any", version: "unknown", errors: parsed.errors });
  }
  for (const source of syncedBySlug.values()) {
    if (usedSyncedSlugs.has(source.template.slug)) continue;
    entries.push({
      path: source.path,
      slug: source.template.slug,
      title: source.template.title,
      kind: source.template.kind,
      appliesTo: source.template.appliesTo,
      version: source.template.version,
      errors: [],
    });
  }
  if (rows[0]) {
    entries.unshift({ path: rows[0].path, slug: "scope-intake", title: "scope-intake skill", kind: "interview", appliesTo: "any", version: "skill", errors: [] });
  }
  return entries;
}

export async function listWizardFramingQuestions(db: DB, actorPrincipalId: string): Promise<WizardFramingTemplate[]> {
  void actorPrincipalId;
  return (await wizardTemplateSources(db))
    .map((source) => {
      if (source.template.kind !== "framing") return null;
      return {
        slug: source.template.slug,
        questions: parseFramingQuestions(source.body),
      };
    })
    .filter((entry): entry is WizardFramingTemplate => !!entry);
}

export async function saveWizardTemplate(
  db: DB,
  client: GitHubClient,
  input: { repo: string; path: string; body: string; authorName?: string; authorEmail?: string },
  actorPrincipalId: string
): Promise<{ written: boolean; sync: unknown }> {
  await requireRootAdmin(db, actorPrincipalId);
  const parsed = input.path.endsWith("SKILL.md") ? { ok: true, errors: [] } : parseWizardTemplateMarkdown(input.body);
  if (!parsed.ok) throw new Error(`Template invalid: ${parsed.errors.join("; ")}`);
  const write = await client.putFile(input.repo, input.path, input.body, `companyos: update wizard template ${input.path}`);
  const sync = await syncSkills(db, client, { repo: input.repo }, actorPrincipalId);
  await emitEvent(db, {
    type: "intake.templates_updated",
    scopePath: await getRootPath(db),
    principalId: actorPrincipalId,
    payload: { path: input.path, written: write.written, authorName: input.authorName ?? null, authorEmail: input.authorEmail ?? null },
  });
  return { written: write.written, sync };
}

export const DEFAULT_SCOPE_INTAKE_SKILL = "---\nname: scope-intake\ndescription: Operating guide for the external agent running a CompanyOS scope-intake interview.\nscope_pattern: \"**\"\ndomains: [intake, onboarding, wizard]\n---\n\n# scope-intake\n\nYou are conducting an intake interview for CompanyOS. Read this whole guide before\nasking your first question.\n\n## What CompanyOS is\n\nCompanyOS is the operating system a company's AI agents and people work inside. Work\nis organized into **scopes** \u2014 projects, clients, and sub-projects arranged in a\ntree. Every scope carries: **docs** (current truth), **records** (an append-only log\nof what happened), **tasks** (in Plane), optionally a **GitHub workbench** (code\nrepo), a **credential vault**, and a **wiki** that a nightly brain distills from\neverything above. Agents connect over MCP and read this context before working.\n\nCompanyOS sits on top of the company's existing tools \u2014 CRM, email, accounting stay\nwhere they are; their key events get mirrored into the OS so agents can always\nanswer \"what's the state of this?\" from inside.\n\n## Why this interview\n\nA new scope was just created and it is empty. Your interview produces its **intake\npacket** \u2014 the scope's starting DNA: what it exists to achieve, how it should be\nprovisioned, its first documents and tasks, its risks and unknowns. Everything you\nproduce will be reviewed by an admin before anything is provisioned, and the brain\nwill distill your packet into the scope's wiki. Quality here compounds; a lazy\npacket costs every future agent that touches this scope.\n\n## Who you are talking to\n\nAn internal person who will personally work on this scope. They know their\nrequirement \u2014 your job is to draw it out and structure it, not to educate them.\nMatch their depth: if they are brief, ask the follow-ups that matter; if they pour\nout detail, capture it and organize rather than interrupt.\n\n## How to conduct it\n\n- The pack you received contains the scope's position in the tree, why it was\n  created (the reason, verbatim), context from its parent scope, related history\n  the user selected (e.g. the sales trail for a converted client), and similar past\n  work (pattern pages). **Read all of it first and don't re-ask what it already\n  answers.**\n- Open-ended, one focused question at a time. Prefer specifics: names, numbers,\n  deadlines, URLs.\n- Separate **facts** (stated by the interviewee or a cited source) from\n  **assumptions** (yours). Label them in the packet.\n- When the interviewee doesn't know something, record it in `open_questions` \u2014\n  never guess and never pad.\n- Ask what **external systems** this scope touches (CRM, email tracking,\n  accounting, ads platforms, hosting) \u2014 capture them in `external_systems`.\n- Ask which **credentials** agents will need (VPS/SSH, admin logins, API keys) \u2014\n  capture **names and what each is for only**, in `required_credentials`.\n\n## Hard rules\n\n- **Never collect secret values.** No passwords, API keys, tokens \u2014 not even if\n  offered. Values are entered directly into the OS vault later; you collect only\n  the list of what will be needed.\n- **Do not invent scope structure.** Fill the intake for the existing scope only;\n  propose child scopes only inside the provision spec, and only if genuinely\n  needed.\n- Do not promise integrations or automation the packet can't specify; if desired,\n  record it in `external_systems` notes or `open_questions`.\n\n## Output format\n\nEnd your final message with the markdown packet summary followed by **one fenced\nJSON block** \u2014 the packet. Field guidance:\n\n- `packet_md` \u2014 the readable brief: goal, scope of work, key facts vs assumptions\n  (labelled), stakeholders, timeline. This becomes the scope's founding document.\n- `proposed_provision_spec` \u2014 modules the scope needs: `docs` always; `tasks` if\n  work will be tracked; `workbench` (+ repo name) only if code will be written.\n- `proposed_docs` \u2014 1\u20133 starting docs max, each with real content distilled from\n  the interview (not placeholders).\n- `proposed_tasks` \u2014 the first two weeks of concrete work, not the whole project.\n- `proposed_wiki_updates` \u2014 durable facts the brain should know from day one.\n- `required_credentials` \u2014 `[{name, whatFor, loginMethodNotes}]`, names only.\n- `external_systems` \u2014 `[{name, purpose, notes}]`.\n- `open_questions` \u2014 everything unresolved, phrased so a human can answer it.\n- `risk_notes` \u2014 what could sink this; be honest, not decorative.\n- `research_sources` \u2014 anything you cited.\n- `source_engine` / `source_model` \u2014 identify yourself.\n";

const DEFAULT_INTERVIEW_TEMPLATE = bodyWithoutFrontmatter("---\nslug: external-interview\ntitle: External interview\nkind: interview\napplies_to: any\nversion: \"2\"\ndomains: [onboarding]\n---\n\n## Interview guide\n\nWork through these areas in whatever order the conversation flows; skip what the\npack already answers. Depth follows the interviewee \u2014 brief answers get follow-ups,\ndetailed answers get structured.\n\n1. **Outcome** \u2014 what does success look like for this scope, concretely? By when?\n   How will it be measured (metrics, deliverables, revenue)?\n2. **The work** \u2014 what actually gets done here, by whom, how often? One-off build\n   or ongoing operation?\n3. **History** \u2014 if the pack included related history (e.g. a sales trail), confirm\n   what was promised/quoted and what carries over as commitments.\n4. **Systems** \u2014 which external tools does this scope touch (CRM, email, hosting,\n   ads, accounting, analytics)? What already exists vs needs setting up?\n5. **Access** \u2014 which credentials will agents need (names + what-for only, never\n   values)? Who currently holds them? Any access do's/don'ts worth writing into a\n   connection doc?\n6. **Provisioning** \u2014 does this scope need task tracking (Plane)? A code workbench\n   (repo)? An agent token from day one?\n7. **Starting state** \u2014 what should exist the moment the scope is provisioned:\n   first documents, first two weeks of tasks, facts the wiki should know.\n8. **Risks & unknowns** \u2014 what could sink this? What couldn't the interviewee\n   answer?\n\n## Packet instructions\n\nReturn your markdown brief, then end with the single fenced JSON packet exactly as\nspecified in the operating guide. Facts labelled as facts, assumptions as\nassumptions, unknowns in `open_questions`. No secret values anywhere.\n");

export const DEFAULT_TEMPLATE_FILES = [
  {
    path: "scope-intake/SKILL.md",
    body: DEFAULT_SCOPE_INTAKE_SKILL,
  },
  {
    path: "scope-intake/templates/new-project.md",
    body: "---\nslug: new-project\ntitle: New project framing\nkind: framing\napplies_to: project\nversion: \"2\"\ndomains: [onboarding]\n---\n\n## Framing questions\n\n- project_kind: What kind of project is this (client engagement, internal product, function/team, experiment)?\n- size: How large is the expected effort (days / weeks / months / ongoing)?\n- workbench: Will code be written here (needs a GitHub workbench)?\n- plane: Will work be tracked as tasks (needs Plane)?\n- agent_token: Should an agent token be minted at provisioning so AI agents can start immediately?\n- external_systems: Which existing tools does this touch (CRM, email, hosting, ads, accounting)? Comma-separated is fine.\n\n## Provision skeleton\n\n```json\n{ \"modules\": [\"docs\"] }\n```\n",
  },
  {
    path: "scope-intake/templates/new-sub-scope.md",
    body: "---\nslug: new-sub-scope\ntitle: New sub-scope framing\nkind: framing\napplies_to: sub-scope\nversion: \"2\"\ndomains: [onboarding]\n---\n\n## Framing questions\n\n- outcome: What outcome should this sub-scope own that its parent doesn't already cover?\n- reuse: Is this similar to something we've done before (a client type, a campaign type, a build we've repeated)?\n- plane: Does it need its own task tracking (becomes a Plane project in the parent's workspace)?\n- workbench: Will code be written here (needs a repo/workbench)?\n- external_systems: Which existing tools does this touch that the parent doesn't (client's CRM, hosting, ad accounts)?\n\n## Provision skeleton\n\n```json\n{ \"modules\": [\"docs\"] }\n```\n",
  },
  {
    path: "scope-intake/templates/interview.md",
    body: "---\nslug: external-interview\ntitle: External interview\nkind: interview\napplies_to: any\nversion: \"2\"\ndomains: [onboarding]\n---\n\n## Interview guide\n\nWork through these areas in whatever order the conversation flows; skip what the\npack already answers. Depth follows the interviewee \u2014 brief answers get follow-ups,\ndetailed answers get structured.\n\n1. **Outcome** \u2014 what does success look like for this scope, concretely? By when?\n   How will it be measured (metrics, deliverables, revenue)?\n2. **The work** \u2014 what actually gets done here, by whom, how often? One-off build\n   or ongoing operation?\n3. **History** \u2014 if the pack included related history (e.g. a sales trail), confirm\n   what was promised/quoted and what carries over as commitments.\n4. **Systems** \u2014 which external tools does this scope touch (CRM, email, hosting,\n   ads, accounting, analytics)? What already exists vs needs setting up?\n5. **Access** \u2014 which credentials will agents need (names + what-for only, never\n   values)? Who currently holds them? Any access do's/don'ts worth writing into a\n   connection doc?\n6. **Provisioning** \u2014 does this scope need task tracking (Plane)? A code workbench\n   (repo)? An agent token from day one?\n7. **Starting state** \u2014 what should exist the moment the scope is provisioned:\n   first documents, first two weeks of tasks, facts the wiki should know.\n8. **Risks & unknowns** \u2014 what could sink this? What couldn't the interviewee\n   answer?\n\n## Packet instructions\n\nReturn your markdown brief, then end with the single fenced JSON packet exactly as\nspecified in the operating guide. Facts labelled as facts, assumptions as\nassumptions, unknowns in `open_questions`. No secret values anywhere.\n",
  },
];
