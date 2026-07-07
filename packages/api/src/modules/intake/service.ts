/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { documents, intakePackets, scopes, skillsIndex, type IntakePacket } from "@companyos/db";
import {
  assembleExternalPack,
  parsePastedIntakePacket,
  parseWizardTemplateMarkdown,
  type IntakePacketPayload,
  type WizardTemplate,
} from "@companyos/wizard";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess, resolveAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";
import { getContextBundle } from "../../agent";
import { createSystemRecord } from "../records/service";
import { saveDoc } from "../docs/service";
import { createTask } from "../tasks/service";
import type { PlaneClient } from "../tasks/plane-client";
import { provisionScope, type ProvisionDeps, type ProvisionResult, type ProvisionSpec } from "../provisioning/service";
import { syncSkills } from "../skills/service";
import type { GitHubClient } from "../../lib/github-client";

export type IntakeStatus = IntakePacket["status"];

export interface IntakePacketView extends IntakePacket {
  scopePath: string;
  scopeName: string;
  ageMs: number;
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
  input: { scopePath: string; templateSlug?: string },
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
      answers: {},
      proposedProvisionSpec: skeletonSpec(scope.path, {}),
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

export async function findReusePatterns(
  db: DB,
  input: { scopePath: string; query: string; limit?: number },
  actorPrincipalId: string
): Promise<Array<{ slug: string; title: string; summary: string; reusable: boolean; sourceScopePath: string | null; sourceVisible: boolean }>> {
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");
  const query = input.query.trim().toLowerCase();
  const rows = (await db
    .select({ slug: documents.slug, title: documents.title, bodyMd: documents.bodyMd })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(eq(scopes.path, "root"), like(documents.slug, "pattern-%"), isNull(documents.archivedAt)))
    .orderBy(desc(documents.updatedAt))
    .limit(Math.min(Math.max(1, input.limit ?? 5), 20))) as Array<{ slug: string; title: string; bodyMd: string }>;

  const terms = query.split(/[^a-z0-9]+/).filter((part) => part.length > 2);
  const scored = rows
    .map((row) => {
      const hay = `${row.slug} ${row.title} ${row.bodyMd}`.toLowerCase();
      const score = terms.reduce((acc, term) => acc + (hay.includes(term) ? 1 : 0), 0);
      return { row, score };
    })
    .filter((item) => item.score > 0 || terms.length === 0)
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

export async function assembleIntakeExternalPack(
  db: DB,
  input: { intakeId: string; templateBody?: string },
  actorPrincipalId: string
): Promise<{ pasteBack: string; mcp: string }> {
  const intake = await getIntakePacket(db, input.intakeId, actorPrincipalId);
  await requireAccess(db, actorPrincipalId, intake.scopePath, "editor");
  const parentPath = intake.scopePath.includes("/") ? intake.scopePath.split("/").slice(0, -1).join("/") : null;
  const parentContext = parentPath ? await getContextBundle(db, parentPath, actorPrincipalId) : null;
  await updateIntakePacket(db, { id: intake.id, status: "awaiting_external" }, actorPrincipalId);
  return assembleExternalPack({
    intakeId: intake.id,
    scopePath: intake.scopePath,
    answers: intake.answers,
    templateBody: input.templateBody ?? DEFAULT_INTERVIEW_TEMPLATE,
    parentContext,
  });
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

export async function listWizardTemplates(db: DB, actorPrincipalId: string): Promise<WizardTemplateEntry[]> {
  await requireRootAdmin(db, actorPrincipalId);
  const rows = (await db.select().from(skillsIndex).where(eq(skillsIndex.name, "scope-intake")).limit(1)) as Array<{ body: string; path: string }>;
  const entries: WizardTemplateEntry[] = [];
  for (const fixture of DEFAULT_TEMPLATE_FILES) {
    const parsed = parseWizardTemplateMarkdown(fixture.body);
    entries.push(parsed.template
      ? { path: fixture.path, slug: parsed.template.slug, title: parsed.template.title, kind: parsed.template.kind, appliesTo: parsed.template.appliesTo, version: parsed.template.version, errors: [] }
      : { path: fixture.path, slug: fixture.path, title: fixture.path, kind: "interview", appliesTo: "any", version: "unknown", errors: parsed.errors });
  }
  if (rows[0]) {
    entries.unshift({ path: rows[0].path, slug: "scope-intake", title: "scope-intake skill", kind: "interview", appliesTo: "any", version: "skill", errors: [] });
  }
  return entries;
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

export const DEFAULT_SCOPE_INTAKE_SKILL = `---
name: scope-intake
description: External interview operating guide for CompanyOS creation wizard packets.
scope_pattern: "**"
domains: [intake, onboarding, wizard]
---

# scope-intake

Read parent context first. CompanyOS is authoritative: fill the existing intake id and scope only.
Cite sources, separate facts from assumptions, and end with the fenced JSON packet schema.
`;

const DEFAULT_INTERVIEW_TEMPLATE = `## Interview guide

Understand the business outcome, required systems, workbench needs, Plane needs, agent token needs, starting documents, starting tasks, risks, and unanswered questions.

## Packet instructions

Return markdown plus the final fenced JSON packet.`;

export const DEFAULT_TEMPLATE_FILES = [
  {
    path: "scope-intake/SKILL.md",
    body: DEFAULT_SCOPE_INTAKE_SKILL,
  },
  {
    path: "scope-intake/templates/new-project.md",
    body: `---
slug: new-project
title: New project framing
kind: framing
applies_to: project
version: "1"
domains: [onboarding]
---

## Framing questions

- project_kind: What kind of project or client is this?
- size: How large is the expected effort?
- workbench: Does it need a GitHub workbench?
- plane: Does it need Plane task management?
- agent_token: Does it need a scoped agent token?

## Provision skeleton

\`\`\`json
{ "modules": ["docs"] }
\`\`\``,
  },
  {
    path: "scope-intake/templates/new-sub-scope.md",
    body: `---
slug: new-sub-scope
title: New sub-scope framing
kind: framing
applies_to: sub-scope
version: "1"
domains: [onboarding]
---

## Framing questions

- outcome: What outcome should this sub-scope own?
- reuse: Is this similar to an existing pattern?
- plane: Does it need task tracking?

## Provision skeleton

\`\`\`json
{ "modules": ["docs"] }
\`\`\``,
  },
  {
    path: "scope-intake/templates/interview.md",
    body: `---
slug: external-interview
title: External interview
kind: interview
applies_to: any
version: "1"
domains: [onboarding]
---

${DEFAULT_INTERVIEW_TEMPLATE}`,
  },
];
