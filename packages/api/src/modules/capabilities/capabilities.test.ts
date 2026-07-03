/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { eq } from "drizzle-orm";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;

import {
  AccessDeniedError,
  CapabilityNotFoundError,
  createScope,
  grantRole,
  listCapabilities,
  listCapabilityRuns,
  listEvents,
  registerCapability,
  reportRun,
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

describe("capabilities module", () => {
  let client: PGlite;
  let db: any;
  let adminPrincipalId: string;
  let agentPrincipalId: string;
  let viewerPrincipalId: string;
  let editorPrincipalId: string;
  let scopePath: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") {
      await client.close();
    }
  });

  beforeEach(async () => {
    const now = Date.now();
    const [admin] = await db.insert(schema.principals).values({ kind: "human", name: `Admin ${now}` }).returning();
    const [agent] = await db.insert(schema.principals).values({ kind: "agent", name: `Agent ${now}` }).returning();
    const [viewer] = await db.insert(schema.principals).values({ kind: "human", name: `Viewer ${now}` }).returning();
    const [editor] = await db.insert(schema.principals).values({ kind: "human", name: `Editor ${now}` }).returning();
    adminPrincipalId = admin.id;
    agentPrincipalId = agent.id;
    viewerPrincipalId = viewer.id;
    editorPrincipalId = editor.id;

    scopePath = `cap-${now}-${Math.floor(Math.random() * 10000)}`;
    await createScope(db, { slug: scopePath, name: "Capabilities", type: "project" }, adminPrincipalId);
    await grantRole(db, { principalId: adminPrincipalId, scopePath, role: "admin" }, adminPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath, role: "agent" }, adminPrincipalId);
    await grantRole(db, { principalId: viewerPrincipalId, scopePath, role: "viewer" }, adminPrincipalId);
    await grantRole(db, { principalId: editorPrincipalId, scopePath, role: "editor" }, adminPrincipalId);
  });

  it("registers fresh, re-registers idempotently, and updates in place", async () => {
    const first = await registerCapability(db, {
      scopePath,
      name: "daily-sync",
      engine: "n8n",
      engineRef: "https://n8n.test/workflow/1",
    }, adminPrincipalId);
    expect(first.created).toBe(true);

    const second = await registerCapability(db, {
      scopePath,
      name: "daily-sync",
      engine: "n8n",
      engineRef: "https://n8n.test/workflow/1",
    }, adminPrincipalId);
    expect(second.created).toBe(false);
    expect(second.capability.id).toBe(first.capability.id);

    const rows = await db.select().from(schema.capabilities).where(eq(schema.capabilities.name, "daily-sync"));
    expect(rows.length).toBe(1);

    const changed = await registerCapability(db, {
      scopePath,
      name: "daily-sync",
      engine: "n8n",
      engineRef: "https://n8n.test/workflow/2",
    }, adminPrincipalId);
    expect(changed.created).toBe(false);
    expect(changed.capability.id).toBe(first.capability.id);
    expect(changed.capability.engineRef).toBe("https://n8n.test/workflow/2");

    const events = await listEvents(db, { scopePath, type: "capability.registered", limit: 5 });
    expect(events.length).toBe(3);
    expect((events[0] as any).payload).toMatchObject({ name: "daily-sync", engine: "n8n" });
  });

  it("requires admin to register; agent can report, viewer cannot", async () => {
    await expect(registerCapability(db, {
      scopePath,
      name: "blocked",
      engine: "custom",
    }, editorPrincipalId)).rejects.toThrow(AccessDeniedError);

    await registerCapability(db, { scopePath, name: "agent-reporter", engine: "custom" }, adminPrincipalId);

    const agentResult = await reportRun(db, {
      scopePath,
      name: "agent-reporter",
      status: "success",
      runRef: "agent-run-1",
    }, agentPrincipalId);
    expect(agentResult.created).toBe(true);

    await expect(reportRun(db, {
      scopePath,
      name: "agent-reporter",
      status: "success",
      runRef: "viewer-run-1",
    }, viewerPrincipalId)).rejects.toThrow(AccessDeniedError);
  });

  it("reports registered runs, defaults terminal finishedAt, and updates same runRef in place", async () => {
    await registerCapability(db, { scopePath, name: "nightly", engine: "flowise" }, adminPrincipalId);

    const inserted = await reportRun(db, {
      scopePath,
      name: "nightly",
      status: "success",
      runRef: "exec-1",
      startedAt: "2026-07-02T01:00:00.000Z",
      summary: "ok",
      payload: { records: 10 },
    }, agentPrincipalId);
    expect(inserted.created).toBe(true);
    expect(inserted.run.finishedAt).toBeInstanceOf(Date);

    const running = await reportRun(db, {
      scopePath,
      name: "nightly",
      status: "running",
      runRef: "exec-2",
      startedAt: "2026-07-02T02:00:00.000Z",
    }, agentPrincipalId);
    expect(running.created).toBe(true);

    const updated = await reportRun(db, {
      scopePath,
      name: "nightly",
      status: "success",
      runRef: "exec-2",
      summary: "completed",
      durationMs: 1234,
      payload: { records: 20 },
    }, agentPrincipalId);
    expect(updated.created).toBe(false);
    expect(updated.run.id).toBe(running.run.id);
    expect(updated.run.status).toBe("success");
    expect(updated.run.summary).toBe("completed");
    expect(updated.run.durationMs).toBe(1234);

    const rows = await db.select().from(schema.capabilityRuns);
    const exec2Rows = rows.filter((row: any) => row.runRef === "exec-2");
    expect(exec2Rows.length).toBe(1);

    const events = await listEvents(db, { scopePath, type: "capability.run_reported", limit: 10 });
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("throws CapabilityNotFoundError for unknown capability reports and run lists", async () => {
    await expect(reportRun(db, {
      scopePath,
      name: "missing",
      status: "success",
    }, agentPrincipalId)).rejects.toThrow(CapabilityNotFoundError);

    await expect(listCapabilityRuns(db, {
      scopePath,
      name: "missing",
    }, viewerPrincipalId)).rejects.toThrow(CapabilityNotFoundError);
  });

  it("lists capabilities with null lastRun and latest lastRun", async () => {
    await registerCapability(db, { scopePath, name: "empty", engine: "custom" }, adminPrincipalId);
    await registerCapability(db, { scopePath, name: "runner", engine: "custom" }, adminPrincipalId);

    let listed = await listCapabilities(db, { scopePath }, viewerPrincipalId);
    expect(listed.find((cap) => cap.name === "empty")?.lastRun).toBeNull();

    await reportRun(db, {
      scopePath,
      name: "runner",
      status: "success",
      startedAt: "2026-07-01T00:00:00.000Z",
      summary: "old",
    }, agentPrincipalId);
    await reportRun(db, {
      scopePath,
      name: "runner",
      status: "error",
      startedAt: "2026-07-02T00:00:00.000Z",
      summary: "latest",
    }, agentPrincipalId);

    listed = await listCapabilities(db, { scopePath }, viewerPrincipalId);
    const runner = listed.find((cap) => cap.name === "runner");
    expect(runner?.lastRun).toMatchObject({ status: "error", summary: "latest" });
  });

  it("lists capability runs newest first with since filter and caps limit at 200", async () => {
    await registerCapability(db, { scopePath, name: "history", engine: "custom" }, adminPrincipalId);

    await reportRun(db, {
      scopePath,
      name: "history",
      status: "success",
      startedAt: "2026-07-01T00:00:00.000Z",
      summary: "old",
    }, agentPrincipalId);
    await reportRun(db, {
      scopePath,
      name: "history",
      status: "success",
      startedAt: "2026-07-02T00:00:00.000Z",
      summary: "middle",
    }, agentPrincipalId);
    await reportRun(db, {
      scopePath,
      name: "history",
      status: "error",
      startedAt: "2026-07-03T00:00:00.000Z",
      summary: "new",
    }, agentPrincipalId);

    const recent = await listCapabilityRuns(db, {
      scopePath,
      name: "history",
      since: "2026-07-02T00:00:00.000Z",
    }, viewerPrincipalId);
    expect(recent.map((run) => run.summary)).toEqual(["new", "middle"]);

    const limited = await listCapabilityRuns(db, {
      scopePath,
      name: "history",
      limit: 2,
    }, viewerPrincipalId);
    expect(limited.map((run) => run.summary)).toEqual(["new", "middle"]);

    const [capability] = await db.select().from(schema.capabilities).where(eq(schema.capabilities.name, "history")).limit(1);
    const bulk = Array.from({ length: 205 }, (_, i) => ({
      capabilityId: capability.id,
      status: "success",
      startedAt: new Date(Date.UTC(2026, 6, 10, 0, 0, i)),
      summary: `bulk-${i}`,
      payload: {},
    }));
    await db.insert(schema.capabilityRuns).values(bulk);

    const capped = await listCapabilityRuns(db, {
      scopePath,
      name: "history",
      limit: 500,
    }, viewerPrincipalId);
    expect(capped.length).toBe(200);
    expect(capped[0]?.summary).toBe("bulk-204");
  });
});
