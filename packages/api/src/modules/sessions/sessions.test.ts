/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;

import {
  AccessDeniedError,
  completeSession,
  createScope,
  getScope,
  grantRole,
  listEvents,
  listSessions,
  registerSession,
  updateSession,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

describe("sessions module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;
  let editorId: string;
  let agentId: string;
  let viewerId: string;
  let otherViewerId: string;
  let scopePath: string;
  let childPath: string;
  let siblingPath: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    if (!await getScope(db, "root")) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, null);
    }
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") {
      await client.close();
    }
  });

  async function principal(name: string, kind: "human" | "agent" = "human") {
    const [row] = await db
      .insert(schema.principals)
      .values({ kind, name: `${name} ${Date.now()} ${Math.random()}`, status: "active" })
      .returning();
    return row.id as string;
  }

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    rootPrincipalId = await principal("Root Admin");
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);

    scopePath = `sessions-${suffix}`;
    childPath = `${scopePath}/child`;
    siblingPath = `other-sessions-${suffix}`;
    await createScope(db, { slug: scopePath, name: "Sessions", type: "project" }, rootPrincipalId);
    await createScope(db, { parentPath: scopePath, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
    await createScope(db, { slug: siblingPath, name: "Sibling Sessions", type: "project" }, rootPrincipalId);

    editorId = await principal("Editor");
    agentId = await principal("Agent", "agent");
    viewerId = await principal("Viewer");
    otherViewerId = await principal("Other Viewer");

    await grantRole(db, { principalId: editorId, scopePath, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: agentId, scopePath, role: "agent" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerId, scopePath, role: "viewer" }, rootPrincipalId);
    await grantRole(db, { principalId: otherViewerId, scopePath: siblingPath, role: "viewer" }, rootPrincipalId);
  });

  it("registers multiple sessions per scope across engines and emits session.registered", async () => {
    const codex = await registerSession(db, {
      scopePath,
      title: "Build sessions API",
      engine: "codex",
      model: "gpt-5",
      worktreeRef: "client/api",
    }, editorId);
    const claude = await registerSession(db, {
      scopePath,
      title: "Review UI",
      engine: "claude-code",
      model: "opus",
    }, agentId);

    const rows = await listSessions(db, { scopePath }, viewerId);
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([codex.id, claude.id]));
    expect(rows.map((row) => row.engine).sort()).toEqual(["claude-code", "codex"]);
    expect(rows.every((row) => row.scopePath === scopePath)).toBe(true);
    expect(rows.every((row) => row.status === "running")).toBe(true);

    const events = await listEvents(db, { scopePath, type: "session.registered", limit: 10 });
    expect(events.map((event: any) => event.payload.sessionId)).toEqual(expect.arrayContaining([codex.id, claude.id]));
    expect(events.find((event: any) => event.payload.sessionId === codex.id)?.payload).toMatchObject({
      scopePath,
      title: "Build sessions API",
      engine: "codex",
      model: "gpt-5",
    });
  });

  it("heartbeats on bare update without emitting session.updated", async () => {
    const session = await registerSession(db, {
      scopePath,
      title: "Heartbeat only",
      engine: "codex",
    }, editorId);
    const oldHeartbeat = new Date(Date.now() - 60_000);
    await db
      .update(schema.agentSessions)
      .set({ lastHeartbeat: oldHeartbeat, updatedAt: oldHeartbeat })
      .where(eq(schema.agentSessions.id, session.id));

    const beforeEvents = await listEvents(db, { scopePath, type: "session.updated", limit: 10 });
    const updated = await updateSession(db, { sessionId: session.id }, agentId);
    const afterEvents = await listEvents(db, { scopePath, type: "session.updated", limit: 10 });

    expect(updated.lastHeartbeat.getTime()).toBeGreaterThan(oldHeartbeat.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThan(oldHeartbeat.getTime());
    expect(afterEvents.length).toBe(beforeEvents.length);
  });

  it("emits session.updated for changed fields and session.completed on wrap-up", async () => {
    const session = await registerSession(db, {
      scopePath,
      title: "Mutable session",
      engine: "codex",
    }, editorId);

    const updated = await updateSession(db, {
      sessionId: session.id,
      status: "waiting",
      title: "Waiting on review",
      worktreeRef: "client/review",
    }, editorId);
    expect(updated).toMatchObject({
      status: "waiting",
      title: "Waiting on review",
      worktreeRef: "client/review",
    });

    await completeSession(db, { sessionId: session.id, summary: "Merged into branch" }, agentId);
    const rows = await listSessions(db, { scopePath }, viewerId);
    expect(rows.find((row) => row.id === session.id)?.status).toBe("completed");

    const updatedEvents = await listEvents(db, { scopePath, type: "session.updated", limit: 10 });
    expect(updatedEvents[0]?.payload).toMatchObject({
      sessionId: session.id,
      scopePath,
      changed: {
        status: "waiting",
        title: "Waiting on review",
        worktreeRef: "client/review",
      },
    });

    const completedEvents = await listEvents(db, { scopePath, type: "session.completed", limit: 10 });
    expect(completedEvents[0]?.payload).toMatchObject({
      sessionId: session.id,
      scopePath,
      summary: "Merged into branch",
    });
  });

  it("flags stale running and waiting sessions using the injected idle window", async () => {
    const stale = await registerSession(db, { scopePath, title: "Old running", engine: "codex" }, editorId);
    const fresh = await registerSession(db, { scopePath, title: "Fresh waiting", engine: "codex" }, editorId);
    const done = await registerSession(db, { scopePath, title: "Old done", engine: "codex" }, editorId);
    const oldHeartbeat = new Date(Date.now() - 10_000);
    await db
      .update(schema.agentSessions)
      .set({ lastHeartbeat: oldHeartbeat, updatedAt: oldHeartbeat })
      .where(eq(schema.agentSessions.id, stale.id));
    await updateSession(db, { sessionId: fresh.id, status: "waiting" }, editorId);
    await completeSession(db, { sessionId: done.id }, editorId);
    await db
      .update(schema.agentSessions)
      .set({ lastHeartbeat: oldHeartbeat, updatedAt: oldHeartbeat })
      .where(eq(schema.agentSessions.id, done.id));

    const rows = await listSessions(db, { scopePath, idleWindowMs: 1_000 }, viewerId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(stale.id)?.stale).toBe(true);
    expect(byId.get(fresh.id)?.stale).toBe(false);
    expect(byId.get(done.id)?.stale).toBe(false);
  });

  it("enforces access and rolls up descendant sessions without leaking siblings", async () => {
    await expect(registerSession(db, { scopePath, title: "Viewer attempt", engine: "codex" }, viewerId))
      .rejects.toThrow(AccessDeniedError);

    const parent = await registerSession(db, { scopePath, title: "Parent", engine: "codex" }, editorId);
    const child = await registerSession(db, { scopePath: childPath, title: "Child", engine: "claude-code" }, editorId);
    await registerSession(db, { scopePath: siblingPath, title: "Sibling", engine: "codex" }, rootPrincipalId);

    await updateSession(db, { sessionId: child.id, worktreeRef: "child/work" }, agentId);
    await expect(updateSession(db, { sessionId: parent.id, title: "Nope" }, viewerId)).rejects.toThrow(AccessDeniedError);
    await expect(listSessions(db, { scopePath }, otherViewerId)).rejects.toThrow(AccessDeniedError);

    const exactRows = await listSessions(db, { scopePath, includeDescendants: false }, viewerId);
    expect(exactRows.map((row) => row.id)).toContain(parent.id);
    expect(exactRows.map((row) => row.id)).not.toContain(child.id);

    const branchRows = await listSessions(db, { scopePath, includeDescendants: true }, viewerId);
    expect(branchRows.map((row) => row.id)).toEqual(expect.arrayContaining([parent.id, child.id]));
    expect(branchRows.some((row) => row.scopePath === siblingPath)).toBe(false);
    expect(branchRows.find((row) => row.id === child.id)?.scopePath).toBe(childPath);
  });
});
