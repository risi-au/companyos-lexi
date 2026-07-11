/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
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
  createScope,
  getOpsHealth,
  grantRole,
  issueToken,
  listEvents,
  registerCapability,
  registerExternalCredential,
  reportRun,
} from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolderCandidates = [
  path.resolve(process.cwd(), "packages/db/drizzle"),
  path.resolve(__dirname, "../../packages/db/drizzle"),
  path.resolve("packages/db/drizzle"),
  "C:/dev/companyos/packages/db/drizzle",
];
const migrationsFolder = migrationsFolderCandidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json"))) || migrationsFolderCandidates[0]!;

describe("ops health (M9-01)", () => {
  let client: PGlite;
  let db: any;
  let rootAdminId: string;
  let rootViewerId: string;
  const now = new Date("2026-10-01T00:00:00.000Z");

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  beforeEach(async () => {
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2)}`;
    const [admin] = await db.insert(schema.principals).values({
      kind: "human",
      name: `Root Admin ${suffix}`,
      email: `admin-${suffix}@example.test`,
      status: "active",
    }).returning();
    const [viewer] = await db.insert(schema.principals).values({
      kind: "human",
      name: `Root Viewer ${suffix}`,
      email: `viewer-${suffix}@example.test`,
      status: "active",
    }).returning();
    rootAdminId = admin.id;
    rootViewerId = viewer.id;

    const existingRoot = await db.select({ id: schema.scopes.id }).from(schema.scopes).where(eq(schema.scopes.path, "root")).limit(1);
    if (existingRoot.length === 0) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, rootAdminId);
    }
    await grantRole(db, { principalId: rootAdminId, scopePath: "root", role: "admin" }, rootAdminId);
    await grantRole(db, { principalId: rootViewerId, scopePath: "root", role: "viewer" }, rootAdminId);
    await db.delete(schema.opsAlertState);
    await db.delete(schema.tokens).where(eq(schema.tokens.name, "BRAIN_ENGINE_TOKEN"));
  });

  it("requires root admin and includes the seeded GitHub PAT registry row", async () => {
    await expect(getOpsHealth(db, { now }, rootViewerId)).rejects.toThrow(AccessDeniedError);

    const health = await getOpsHealth(db, { now }, rootAdminId, {
      llmProbe: async () => ({ ok: true, checkedAt: now }),
    });
    const github = health.checks.find((check) => check.key === "external-credential:GITHUB_TOKEN");
    expect(github).toMatchObject({
      component: "GITHUB_TOKEN",
      kind: "external_credential",
      status: "warning",
    });
    expect(github?.expiryAt?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("evaluates token expiry threshold boundaries", async () => {
    const [agent] = await db.insert(schema.principals).values({ kind: "agent", name: `Brain Token ${Date.now()}` }).returning();
    await issueToken(db, { principalId: agent.id, name: "BRAIN_ENGINE_TOKEN", expiresAt: new Date("2026-10-15T00:00:00.000Z") }, rootAdminId);

    let health = await getOpsHealth(db, { now }, rootAdminId);
    expect(health.checks.find((check) => check.key === "token:BRAIN_ENGINE_TOKEN")?.status).toBe("warning");

    await db.update(schema.tokens)
      .set({ expiresAt: new Date("2026-10-16T00:00:01.000Z") })
      .where(eq(schema.tokens.name, "BRAIN_ENGINE_TOKEN"));
    health = await getOpsHealth(db, { now }, rootAdminId);
    expect(health.checks.find((check) => check.key === "token:BRAIN_ENGINE_TOKEN")?.status).toBe("ok");

    await db.update(schema.tokens)
      .set({ expiresAt: new Date("2026-09-30T23:59:59.000Z") })
      .where(eq(schema.tokens.name, "BRAIN_ENGINE_TOKEN"));
    health = await getOpsHealth(db, { now }, rootAdminId);
    expect(health.checks.find((check) => check.key === "token:BRAIN_ENGINE_TOKEN")?.status).toBe("error");
  });

  it("flags brain-cron overdue when the profile is enabled and no run landed within 36h", async () => {
    await registerCapability(db, { scopePath: "root", name: "brain-engine", engine: "native" }, rootAdminId);
    await reportRun(db, {
      scopePath: "root",
      name: "brain-engine",
      status: "success",
      runRef: "old-brain-run",
      startedAt: "2026-09-29T10:00:00.000Z",
      finishedAt: "2026-09-29T10:10:00.000Z",
      payload: { mode: "ingest", tokens: 123 },
    }, rootAdminId);

    const health = await getOpsHealth(db, { now, env: { brainCronEnabled: true } }, rootAdminId);
    const brain = health.checks.find((check) => check.key === "capability:brain-engine");
    expect(brain).toMatchObject({
      component: "brain-cron sidecar",
      status: "error",
    });
    expect(health.runs.find((run) => run.capability === "brain-engine")).toMatchObject({
      status: "success",
      tokenSpend: 123,
    });
  });


  it("returns 14 days of wiki contribution counts from doc events", async () => {
    const [root] = await db.select({ id: schema.scopes.id }).from(schema.scopes).where(eq(schema.scopes.path, "root")).limit(1);
    await db.insert(schema.events).values([
      { type: "doc.saved", scopeId: root.id, principalId: rootAdminId, payload: {}, createdAt: new Date("2026-09-20T01:00:00.000Z") },
      { type: "doc.saved", scopeId: root.id, principalId: rootAdminId, payload: {}, createdAt: new Date("2026-09-20T02:00:00.000Z") },
      { type: "doc.verified", scopeId: root.id, principalId: rootAdminId, payload: {}, createdAt: new Date("2026-09-20T03:00:00.000Z") },
      { type: "doc.saved", scopeId: root.id, principalId: rootAdminId, payload: {}, createdAt: new Date("2026-10-01T03:00:00.000Z") },
      { type: "doc.saved", scopeId: root.id, principalId: rootAdminId, payload: {}, createdAt: new Date("2026-09-17T23:59:59.000Z") },
    ]);

    const health = await getOpsHealth(db, { now }, rootAdminId);
    expect(health.wikiContributions).toHaveLength(14);
    expect(health.wikiContributions[0]?.date).toBe("2026-09-18");
    expect(health.wikiContributions[13]?.date).toBe("2026-10-01");
    expect(health.wikiContributions.find((row) => row.date === "2026-09-20")).toEqual({ date: "2026-09-20", saves: 2, verifies: 1 });
    expect(health.wikiContributions.find((row) => row.date === "2026-10-01")).toEqual({ date: "2026-10-01", saves: 1, verifies: 0 });
  });
  it("emits one alert and one email on transition into warning/error", async () => {
    const sent: any[] = [];
    const [agent] = await db.insert(schema.principals).values({ kind: "agent", name: `Warn Token ${Date.now()}` }).returning();
    await issueToken(db, { principalId: agent.id, name: "BRAIN_ENGINE_TOKEN", expiresAt: new Date("2026-10-10T00:00:00.000Z") }, rootAdminId);

    const first = await getOpsHealth(db, { now, sendAlerts: true }, rootAdminId, {
      sendEmail: async (message) => { sent.push(message); },
    });
    expect(first.alerts.some((alert) => alert.checkKey === "token:BRAIN_ENGINE_TOKEN")).toBe(true);
    expect(sent.filter((message) => message.subject.includes("BRAIN_ENGINE_TOKEN")).length).toBe(1);

    const second = await getOpsHealth(db, { now: new Date("2026-10-01T01:00:00.000Z"), sendAlerts: true }, rootAdminId, {
      sendEmail: async (message) => { sent.push(message); },
    });
    expect(second.alerts.some((alert) => alert.checkKey === "token:BRAIN_ENGINE_TOKEN")).toBe(false);
    expect(sent.filter((message) => message.subject.includes("BRAIN_ENGINE_TOKEN")).length).toBe(1);

    const alertEvents = await listEvents(db, { scopePath: "root", type: "alert.fired", limit: 20 });
    const tokenAlerts = alertEvents.filter((event) => (event.payload as any).checkKey === "token:BRAIN_ENGINE_TOKEN");
    expect(tokenAlerts.length).toBe(1);
    expect(tokenAlerts[0]?.payload).toMatchObject({
      capability: "ops-health",
      severity: "warning",
    });
  });

  it("registers external credentials without storing secret values", async () => {
    const credential = await registerExternalCredential(db, {
      name: "CUSTOM_PAT",
      component: "custom-integration",
      ownerNote: "Rotate quarterly",
      whereItLives: "CUSTOM_PAT env var",
      expiresAt: "2026-10-20T00:00:00.000Z",
      metadata: { system: "custom" },
    }, rootAdminId);

    expect(credential.name).toBe("CUSTOM_PAT");
    expect(JSON.stringify(credential)).not.toContain("secret");
    const health = await getOpsHealth(db, { now }, rootAdminId);
    expect(health.checks.find((check) => check.key === "external-credential:CUSTOM_PAT")).toMatchObject({
      status: "ok",
      expiryAt: new Date("2026-10-20T00:00:00.000Z"),
    });
  });
});
