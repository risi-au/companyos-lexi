/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, like, or } from "drizzle-orm";
import { agentSessions, scopes, type AgentSession } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError, KernelError } from "../../errors";
import type { Citation } from "../memory/service";

export type SessionStatus = AgentSession["status"];

export class SessionNotFoundError extends KernelError {
  public readonly id: string;
  constructor(id: string) {
    super(`Session not found: ${id}`);
    this.name = "SessionNotFoundError";
    this.id = id;
  }
}

export interface RegisterSessionInput {
  scopePath: string;
  title: string;
  engine: string;
  model?: string | null;
  tokenId?: string | null;
  worktreeRef?: string | null;
}

export interface UpdateSessionInput {
  sessionId: string;
  status?: SessionStatus;
  title?: string;
  worktreeRef?: string | null;
}

export interface CompleteSessionInput {
  sessionId: string;
  summary?: string;
  citations?: Citation[];
}

export interface ListSessionsInput {
  scopePath: string;
  status?: SessionStatus;
  includeDescendants?: boolean;
  idleWindowMs?: number;
  limit?: number;
}

export type ListedSession = AgentSession & {
  scopePath: string;
  stale: boolean;
};

function getIdleWindowMs(input?: number): number {
  if (typeof input === "number" && Number.isFinite(input) && input >= 0) {
    return input;
  }
  const env = Number(process.env.SESSIONS_IDLE_WINDOW_MS);
  if (Number.isFinite(env) && env >= 0) {
    return env;
  }
  return 30 * 60 * 1000;
}

function isStale(row: AgentSession, now: number, idleWindowMs: number): boolean {
  return (row.status === "running" || row.status === "waiting") &&
    now - row.lastHeartbeat.getTime() > idleWindowMs;
}

export async function registerSession(
  db: DB,
  input: RegisterSessionInput,
  actorPrincipalId: string
): Promise<AgentSession> {
  const scopePath = input.scopePath.trim();
  const title = input.title.trim();
  const engine = input.engine.trim();
  if (!title) throw new Error("Session title is required");
  if (!engine) throw new Error("Session engine is required");

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "editor");

  const now = new Date();
  const [created] = (await db
    .insert(agentSessions)
    .values({
      scopeId: scope.id,
      title,
      engine,
      model: input.model ?? null,
      tokenId: input.tokenId ?? null,
      principalId: actorPrincipalId,
      worktreeRef: input.worktreeRef ?? null,
      status: "running",
      lastHeartbeat: now,
      createdBy: actorPrincipalId,
      updatedAt: now,
    })
    .returning()) as AgentSession[];

  if (!created) {
    throw new Error("Failed to register session");
  }

  await emitEvent(db, {
    type: "session.registered",
    scopePath,
    principalId: actorPrincipalId,
    payload: {
      scopePath,
      sessionId: created.id,
      title: created.title,
      engine: created.engine,
      model: created.model,
    },
  });

  return created;
}

async function loadSessionWithScope(
  db: DB,
  sessionId: string
): Promise<(AgentSession & { scopePath: string }) | null> {
  const [row] = (await db
    .select({
      id: agentSessions.id,
      scopeId: agentSessions.scopeId,
      title: agentSessions.title,
      engine: agentSessions.engine,
      model: agentSessions.model,
      status: agentSessions.status,
      tokenId: agentSessions.tokenId,
      principalId: agentSessions.principalId,
      worktreeRef: agentSessions.worktreeRef,
      summary: agentSessions.summary,
      citations: agentSessions.citations,
      lastHeartbeat: agentSessions.lastHeartbeat,
      createdBy: agentSessions.createdBy,
      createdAt: agentSessions.createdAt,
      updatedAt: agentSessions.updatedAt,
      scopePath: scopes.path,
    })
    .from(agentSessions)
    .innerJoin(scopes, eq(agentSessions.scopeId, scopes.id))
    .where(eq(agentSessions.id, sessionId))
    .limit(1)) as Array<AgentSession & { scopePath: string }>;

  return row ?? null;
}

export async function updateSession(
  db: DB,
  input: UpdateSessionInput,
  actorPrincipalId: string
): Promise<AgentSession> {
  const existing = await loadSessionWithScope(db, input.sessionId);
  if (!existing) {
    throw new SessionNotFoundError(input.sessionId);
  }

  await requireAccess(db, actorPrincipalId, existing.scopePath, "editor");

  const now = new Date();
  const updates: Partial<AgentSession> & { updatedAt: Date; lastHeartbeat: Date } = {
    updatedAt: now,
    lastHeartbeat: now,
  };
  const changed: Record<string, unknown> = {};

  if (input.status !== undefined && input.status !== existing.status) {
    updates.status = input.status;
    changed.status = input.status;
  }
  if (input.title !== undefined && input.title !== existing.title) {
    updates.title = input.title;
    changed.title = input.title;
  }
  if (input.worktreeRef !== undefined && input.worktreeRef !== existing.worktreeRef) {
    updates.worktreeRef = input.worktreeRef;
    changed.worktreeRef = input.worktreeRef;
  }

  const [updated] = (await db
    .update(agentSessions)
    .set(updates)
    .where(eq(agentSessions.id, input.sessionId))
    .returning()) as AgentSession[];

  if (!updated) {
    throw new SessionNotFoundError(input.sessionId);
  }

  if (Object.keys(changed).length > 0) {
    await emitEvent(db, {
      type: "session.updated",
      scopePath: existing.scopePath,
      principalId: actorPrincipalId,
      payload: {
        sessionId: input.sessionId,
        scopePath: existing.scopePath,
        changed,
      },
    });
  }

  return updated;
}

export async function completeSession(
  db: DB,
  input: CompleteSessionInput,
  actorPrincipalId: string
): Promise<AgentSession> {
  const existing = await loadSessionWithScope(db, input.sessionId);
  if (!existing) {
    throw new SessionNotFoundError(input.sessionId);
  }

  await requireAccess(db, actorPrincipalId, existing.scopePath, "editor");

  const now = new Date();
  const summary = input.summary ?? null;
  const citations = input.citations ?? null;
  const [updated] = (await db
    .update(agentSessions)
    .set({ status: "completed", summary, citations, updatedAt: now, lastHeartbeat: now })
    .where(eq(agentSessions.id, input.sessionId))
    .returning()) as AgentSession[];

  if (!updated) {
    throw new SessionNotFoundError(input.sessionId);
  }

  await emitEvent(db, {
    type: "session.completed",
    scopePath: existing.scopePath,
    principalId: actorPrincipalId,
    payload: {
      sessionId: input.sessionId,
      scopePath: existing.scopePath,
      summary,
      citations,
    },
  });

  return updated;
}

export async function listSessions(
  db: DB,
  input: ListSessionsInput,
  actorPrincipalId: string
): Promise<ListedSession[]> {
  const scopePath = input.scopePath.trim();
  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const conditions: any[] = input.includeDescendants
    ? scopePath === "root"
      ? [like(scopes.path, "%")]
      : [or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`))]
    : [eq(agentSessions.scopeId, scope.id)];
  if (input.status) {
    conditions.push(eq(agentSessions.status, input.status));
  }

  const rows = (await db
    .select({
      id: agentSessions.id,
      scopeId: agentSessions.scopeId,
      title: agentSessions.title,
      engine: agentSessions.engine,
      model: agentSessions.model,
      status: agentSessions.status,
      tokenId: agentSessions.tokenId,
      principalId: agentSessions.principalId,
      worktreeRef: agentSessions.worktreeRef,
      summary: agentSessions.summary,
      citations: agentSessions.citations,
      lastHeartbeat: agentSessions.lastHeartbeat,
      createdBy: agentSessions.createdBy,
      createdAt: agentSessions.createdAt,
      updatedAt: agentSessions.updatedAt,
      scopePath: scopes.path,
    })
    .from(agentSessions)
    .innerJoin(scopes, eq(agentSessions.scopeId, scopes.id))
    .where(and(...conditions))
    .orderBy(desc(agentSessions.updatedAt))
    .limit(Math.min(Math.max(1, input.limit ?? 200), 500))) as Array<AgentSession & { scopePath: string }>;

  const now = Date.now();
  const idleWindowMs = getIdleWindowMs(input.idleWindowMs);
  return rows.map((row) => ({
    ...row,
    stale: isStale(row, now, idleWindowMs),
  }));
}
