/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, gte } from "drizzle-orm";
import {
  capabilities,
  capabilityRuns,
  tokens,
  type Capability,
  type CapabilityRun,
} from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { CapabilityNotFoundError, ScopeNotFoundError } from "../../errors";

export type CapabilityStatus = "active" | "disabled";
export type CapabilityRunStatus = "running" | "success" | "error";

export interface RegisterCapabilityInput {
  scopePath: string;
  name: string;
  engine: string;
  engineRef?: string | null;
  tokenId?: string | null;
  description?: string | null;
  status?: CapabilityStatus;
}

export interface RegisterCapabilityResult {
  capability: Capability;
  created: boolean;
}

export interface ReportRunInput {
  scopePath: string;
  name: string;
  status: CapabilityRunStatus;
  runRef?: string | null;
  summary?: string | null;
  startedAt?: Date | string;
  finishedAt?: Date | string | null;
  durationMs?: number | null;
  payload?: Record<string, unknown>;
}

export interface ReportRunResult {
  run: CapabilityRun;
  created: boolean;
}

export interface CapabilityLastRun {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  summary: string | null;
}

export interface ListedCapability extends Capability {
  lastRun: CapabilityLastRun | null;
}

export interface ListCapabilitiesInput {
  scopePath: string;
}

export interface ListCapabilityRunsInput {
  scopePath: string;
  name: string;
  since?: Date | string;
  limit?: number;
}

function normalizeDate(value: Date | string | null | undefined): Date | null | undefined {
  if (value == null) return value;
  return value instanceof Date ? value : new Date(value);
}

function assertRunStatus(status: string): asserts status is CapabilityRunStatus {
  if (!["running", "success", "error"].includes(status)) {
    throw new Error(`Invalid capability run status: ${status}`);
  }
}

function terminalFinishedAt(status: CapabilityRunStatus, finishedAt: Date | string | null | undefined): Date | null | undefined {
  const normalized = normalizeDate(finishedAt);
  if ((status === "success" || status === "error") && normalized === undefined) {
    return new Date();
  }
  return normalized;
}

async function getRequiredScope(db: DB, scopePath: string) {
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  return scope;
}

async function getCapabilityByScopeName(db: DB, scopeId: string, name: string): Promise<Capability | null> {
  const [row] = (await db
    .select()
    .from(capabilities)
    .where(and(eq(capabilities.scopeId, scopeId), eq(capabilities.name, name)))
    .limit(1)) as Capability[];
  return row || null;
}

export async function registerCapability(
  db: DB,
  input: RegisterCapabilityInput,
  actorPrincipalId: string
): Promise<RegisterCapabilityResult> {
  const scope = await getRequiredScope(db, input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "admin");

  if (input.tokenId) {
    const [token] = await db
      .select({ id: tokens.id })
      .from(tokens)
      .where(eq(tokens.id, input.tokenId))
      .limit(1);
    if (!token) {
      throw new Error(`Token not found: ${input.tokenId}`);
    }
  }

  const existing = await getCapabilityByScopeName(db, scope.id, input.name);
  const now = new Date();
  let capability: Capability;
  let created = false;

  if (existing) {
    const set: any = {
      engine: input.engine,
      updatedAt: now,
    };
    if (Object.prototype.hasOwnProperty.call(input, "engineRef")) set.engineRef = input.engineRef ?? null;
    if (Object.prototype.hasOwnProperty.call(input, "tokenId")) set.tokenId = input.tokenId ?? null;
    if (Object.prototype.hasOwnProperty.call(input, "description")) set.description = input.description ?? null;
    if (Object.prototype.hasOwnProperty.call(input, "status")) set.status = input.status;

    const [updated] = (await db
      .update(capabilities)
      .set(set)
      .where(eq(capabilities.id, existing.id))
      .returning()) as Capability[];
    if (!updated) throw new Error("Failed to update capability");
    capability = updated;
  } else {
    const [inserted] = (await db
      .insert(capabilities)
      .values({
        scopeId: scope.id,
        name: input.name,
        engine: input.engine,
        engineRef: input.engineRef ?? null,
        tokenId: input.tokenId ?? null,
        status: input.status ?? "active",
        description: input.description ?? null,
      })
      .returning()) as Capability[];
    if (!inserted) throw new Error("Failed to register capability");
    capability = inserted;
    created = true;
  }

  await emitEvent(db, {
    type: "capability.registered",
    scopePath: input.scopePath,
    principalId: actorPrincipalId,
    payload: {
      name: input.name,
      engine: input.engine,
      created,
    },
  });

  return { capability, created };
}

export async function reportRun(
  db: DB,
  input: ReportRunInput,
  actorPrincipalId: string
): Promise<ReportRunResult> {
  assertRunStatus(input.status);
  const scope = await getRequiredScope(db, input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "editor");

  const capability = await getCapabilityByScopeName(db, scope.id, input.name);
  if (!capability) {
    throw new CapabilityNotFoundError(input.scopePath, input.name);
  }

  const finishedAt = terminalFinishedAt(input.status, input.finishedAt);
  const payload = input.payload ?? {};
  let run: CapabilityRun;
  let created = false;

  if (input.runRef) {
    const [existing] = (await db
      .select()
      .from(capabilityRuns)
      .where(and(eq(capabilityRuns.capabilityId, capability.id), eq(capabilityRuns.runRef, input.runRef)))
      .limit(1)) as CapabilityRun[];

    if (existing) {
      const [updated] = (await db
        .update(capabilityRuns)
        .set({
          status: input.status,
          finishedAt,
          durationMs: input.durationMs ?? null,
          summary: input.summary ?? null,
          payload,
        })
        .where(eq(capabilityRuns.id, existing.id))
        .returning()) as CapabilityRun[];
      if (!updated) throw new Error("Failed to update capability run");
      run = updated;
    } else {
      const [inserted] = (await db
        .insert(capabilityRuns)
        .values({
          capabilityId: capability.id,
          runRef: input.runRef,
          status: input.status,
          startedAt: normalizeDate(input.startedAt) ?? undefined,
          finishedAt,
          durationMs: input.durationMs ?? null,
          summary: input.summary ?? null,
          payload,
        })
        .returning()) as CapabilityRun[];
      if (!inserted) throw new Error("Failed to insert capability run");
      run = inserted;
      created = true;
    }
  } else {
    const [inserted] = (await db
      .insert(capabilityRuns)
      .values({
        capabilityId: capability.id,
        runRef: null,
        status: input.status,
        startedAt: normalizeDate(input.startedAt) ?? undefined,
        finishedAt,
        durationMs: input.durationMs ?? null,
        summary: input.summary ?? null,
        payload,
      })
      .returning()) as CapabilityRun[];
    if (!inserted) throw new Error("Failed to insert capability run");
    run = inserted;
    created = true;
  }

  await emitEvent(db, {
    type: "capability.run_reported",
    scopePath: input.scopePath,
    principalId: actorPrincipalId,
    payload: {
      name: input.name,
      status: input.status,
      runRef: input.runRef ?? null,
      summary: input.summary ?? null,
      durationMs: input.durationMs ?? null,
    },
  });

  return { run, created };
}

export async function listCapabilities(
  db: DB,
  input: ListCapabilitiesInput,
  actorPrincipalId: string
): Promise<ListedCapability[]> {
  const scope = await getRequiredScope(db, input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");

  const rows = (await db
    .select()
    .from(capabilities)
    .where(eq(capabilities.scopeId, scope.id))
    .orderBy(capabilities.name)) as Capability[];

  const results: ListedCapability[] = [];
  for (const capability of rows) {
    const [lastRun] = (await db
      .select({
        status: capabilityRuns.status,
        startedAt: capabilityRuns.startedAt,
        finishedAt: capabilityRuns.finishedAt,
        summary: capabilityRuns.summary,
      })
      .from(capabilityRuns)
      .where(eq(capabilityRuns.capabilityId, capability.id))
      .orderBy(desc(capabilityRuns.startedAt))
      .limit(1)) as CapabilityLastRun[];
    results.push({
      ...capability,
      lastRun: lastRun || null,
    });
  }

  return results;
}

export async function listCapabilityRuns(
  db: DB,
  input: ListCapabilityRunsInput,
  actorPrincipalId: string
): Promise<CapabilityRun[]> {
  const scope = await getRequiredScope(db, input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");

  const capability = await getCapabilityByScopeName(db, scope.id, input.name);
  if (!capability) {
    throw new CapabilityNotFoundError(input.scopePath, input.name);
  }

  const conditions: any[] = [eq(capabilityRuns.capabilityId, capability.id)];
  const since = normalizeDate(input.since);
  if (since) {
    conditions.push(gte(capabilityRuns.startedAt, since));
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  return (await db
    .select()
    .from(capabilityRuns)
    .where(and(...conditions))
    .orderBy(desc(capabilityRuns.startedAt))
    .limit(limit)) as CapabilityRun[];
}
