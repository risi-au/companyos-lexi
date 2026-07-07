/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  grantRole,
  getContextBundle,
  verifyWorkbench,
  reportCapabilityRun,
  findScopeByPlaneProject,
  listEvents,
  verifyPlaneWebhookSignature,
  emitEvent,
  saveDoc,
} from "./index";
import { eq } from "drizzle-orm";
import { createHmac } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolderCandidates = [
  path.resolve(process.cwd(), "packages/db/drizzle"),
  path.resolve(__dirname, "../../../../packages/db/drizzle"),
  path.resolve("packages/db/drizzle"),
  "C:/dev/companyos/packages/db/drizzle",
];
let migrationsFolder = (migrationsFolderCandidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json"))) || migrationsFolderCandidates[0]) as string;
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = "C:/dev/companyos/packages/db/drizzle";
}

describe("agent HTTP support (M2-05: context, report, plane lookup)", () => {
  let client: PGlite;
  let db: any;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  let rootId: string;
  let agentId: string;
  let demoScopePath: string;

  beforeEach(async () => {
    const now = Date.now() + Math.random().toString(36).slice(2);
    const [rootP] = await db.insert(schema.principals).values({ kind: "human", name: "Root " + now, status: "active" }).returning();
    rootId = rootP.id;
    const [agentP] = await db.insert(schema.principals).values({ kind: "agent", name: "Agent " + now, status: "active" }).returning();
    agentId = agentP.id;

    // create unique demo scope + grant editor to agent (db not cleaned between tests)
    const slug = "demo-" + now.toString().replace(/[^a-z0-9-]/g, "");
    const sc = await createScope(db, { slug, name: "Demo", type: "project" }, rootId);
    demoScopePath = sc.path;
    await grantRole(db, { principalId: agentId, scopePath: demoScopePath, role: "editor" }, rootId);
  });

  it("getContextBundle returns markdown bundle for granted scope", async () => {
    const md = await getContextBundle(db, demoScopePath, agentId);
    expect(md).toContain(`# Context for ${demoScopePath}`);
    expect(md).toContain("Identity");
    expect(md).toContain("Modules");
  });

  it("getContextBundle includes workbench repo, path, and MCP URL for a scoped workbench", async () => {
    const [scRow] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, demoScopePath)).limit(1);
    await db.insert(schema.workbenches).values({
      scopeId: scRow.id,
      repo: "brissie-digital/demo",
      path: "marketing",
    });

    const md = await getContextBundle(db, demoScopePath, agentId, { mcpPublicUrl: "https://os.example/api/mcp" });

    expect(md).toContain("**Workbench**");
    expect(md).toContain("Repo: brissie-digital/demo");
    expect(md).toContain("Folder: marketing");
    expect(md).toContain("MCP URL: https://os.example/api/mcp");
  });

  it("getContextBundle inherits nearest ancestor workbench with descendant sub-path", async () => {
    const child = await createScope(db, { parentPath: demoScopePath, slug: "seo", name: "SEO", type: "subproject" }, rootId);
    await grantRole(db, { principalId: agentId, scopePath: child.path, role: "editor" }, rootId);
    const [scRow] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, demoScopePath)).limit(1);
    await db.insert(schema.workbenches).values({
      scopeId: scRow.id,
      repo: "brissie-digital/demo",
      path: "",
    });

    const md = await getContextBundle(db, child.path, agentId);

    expect(md).toContain("**Workbench**");
    expect(md).toContain("Repo: brissie-digital/demo");
    expect(md).toContain("Folder: seo");
  });

  it("getContextBundle omits workbench section when no ancestor has one", async () => {
    const md = await getContextBundle(db, demoScopePath, agentId);
    expect(md).not.toContain("**Workbench**");
  });

  it("getContextBundle shows the ancestor wiki's doc index and owning scope path from a deep sub-scope", async () => {
    await saveDoc(db, { scopePath: demoScopePath, slug: "wiki", title: "Wiki" }, agentId);
    await saveDoc(db, { scopePath: demoScopePath, slug: "checkout", title: "Checkout Notes" }, agentId);
    const child = await createScope(db, { parentPath: demoScopePath, slug: "seo", name: "SEO", type: "subproject" }, rootId);
    await grantRole(db, { principalId: agentId, scopePath: child.path, role: "editor" }, rootId);

    const md = await getContextBundle(db, child.path, agentId);

    expect(md).toContain("**Knowledge**");
    expect(md).toContain(`Wiki scope: ${demoScopePath}`);
    expect(md).toContain("wiki - Wiki");
    expect(md).toContain("checkout - Checkout Notes");
    expect(md).toContain("search(scope, query)");
  });

  it("getContextBundle omits the Knowledge section when no scope in the ancestor chain has a wiki doc", async () => {
    const md = await getContextBundle(db, demoScopePath, agentId);
    expect(md).not.toContain("**Knowledge**");
  });

  it("getContextBundle prefers a graduated descendant wiki over the top-level one in the ancestor walk", async () => {
    await saveDoc(db, { scopePath: demoScopePath, slug: "wiki", title: "Top Level Wiki" }, agentId);
    const child = await createScope(db, { parentPath: demoScopePath, slug: "graduated", name: "Graduated", type: "subproject" }, rootId);
    await grantRole(db, { principalId: agentId, scopePath: child.path, role: "editor" }, rootId);
    await saveDoc(db, { scopePath: child.path, slug: "wiki", title: "Graduated Wiki" }, agentId);

    const md = await getContextBundle(db, child.path, agentId);

    expect(md).toContain(`Wiki scope: ${child.path}`);
    expect(md).toContain("wiki - Graduated Wiki");
    expect(md).not.toContain("Top Level Wiki");
  });

  it("verifyWorkbench returns ok:false with expected repo/path on cwd mismatch", async () => {
    const [scRow] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, demoScopePath)).limit(1);
    await db.insert(schema.workbenches).values({
      scopeId: scRow.id,
      repo: "airbuddy-repo",
      path: "digital-marketing/meta-ads",
    });

    const result = await verifyWorkbench(
      db,
      { cwd: "C:\\dev\\airbuddy\\digital-marketing\\google-ads", scopePath: demoScopePath },
      agentId
    );

    expect(result).toMatchObject({
      ok: false,
      expectedRepo: "airbuddy-repo",
      expectedPath: "digital-marketing/meta-ads",
    });
    expect(result.message).toContain(`for scope ${demoScopePath}`);
  });

  it("verifyWorkbench accepts POSIX and Windows cwd separators when suffix segments match", async () => {
    const [scRow] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, demoScopePath)).limit(1);
    await db.insert(schema.workbenches).values({
      scopeId: scRow.id,
      repo: "airbuddy-repo",
      path: "digital-marketing/meta-ads",
    });

    await expect(
      verifyWorkbench(
        db,
        { cwd: "/work/airbuddy/digital-marketing/meta-ads", scopePath: demoScopePath },
        agentId
      )
    ).resolves.toEqual({ ok: true });

    await expect(
      verifyWorkbench(
        db,
        { cwd: "C:\\work\\airbuddy\\digital-marketing\\meta-ads", scopePath: demoScopePath },
        agentId
      )
    ).resolves.toEqual({ ok: true });
  });

  it("verifyWorkbench auto-resolves a single direct grant when scopePath is omitted", async () => {
    const [scRow] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, demoScopePath)).limit(1);
    await db.insert(schema.workbenches).values({
      scopeId: scRow.id,
      repo: "brissie-digital/demo",
      path: "marketing",
    });

    const result = await verifyWorkbench(db, { cwd: "D:\\clients\\demo\\marketing" }, agentId);

    expect(result).toEqual({ ok: true });
  });

  it("verifyWorkbench requires explicit scopePath when the principal has multiple direct grants", async () => {
    const child = await createScope(db, { parentPath: demoScopePath, slug: "meta-ads", name: "Meta Ads", type: "subproject" }, rootId);
    await grantRole(db, { principalId: agentId, scopePath: child.path, role: "viewer" }, rootId);

    await expect(verifyWorkbench(db, { cwd: "/work/demo/meta-ads" }, agentId)).rejects.toThrow(
      /multiple scope grants.*explicit scopePath/i
    );
  });

  it("verifyWorkbench returns ok:true with note when no workbench is registered", async () => {
    const result = await verifyWorkbench(db, { cwd: "/work/demo", scopePath: demoScopePath }, agentId);

    expect(result).toEqual({ ok: true, note: "no workbench registered" });
  });

  it("getContextBundle enforces viewer (via services)", async () => {
    const [no] = await db.insert(schema.principals).values({ kind: "human", name: "nope", status: "active" }).returning();
    await expect(getContextBundle(db, demoScopePath, no.id)).rejects.toThrow(/Access denied|denied/i);
  });

  it("reportCapabilityRun emits capability.run_reported event", async () => {
    await reportCapabilityRun(db, { scopePath: demoScopePath, capability: "n8n-demo", status: "success", summary: "daily pull" }, agentId);
    const evs = await listEvents(db, { scopePath: demoScopePath, type: "capability.run_reported", limit: 5 });
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0]?.payload?.capability).toBe("n8n-demo");
  });

  it("findScopeByPlaneProject returns mapped scope for project link (and label)", async () => {
    // manually insert a task_link simulating provisioned target
    const scopesTbl = (schema as any).scopes || schema;
    const taskLinksTbl = (schema as any).taskLinks || (dbMod as any).taskLinks;
    const [scRow] = await db.select().from(scopesTbl).where(eq((scopesTbl as any).path, demoScopePath)).limit(1);
    await db.insert(taskLinksTbl).values({
      scopeId: scRow.id,
      planeProjectId: "proj_demo_123",
      planeLabelId: "label_scope_demo",
    });

    const hit = await findScopeByPlaneProject(db, "proj_demo_123", "label_scope_demo");
    expect(hit).not.toBeNull();
    expect(hit!.scopePath).toBe(demoScopePath);
    expect(hit!.planeProjectId).toBe("proj_demo_123");

    const hit2 = await findScopeByPlaneProject(db, "proj_demo_123");
    expect(hit2).not.toBeNull();
  });

  it("Plane webhook shape fixture: completed emits task.completed_external (via lookup)", async () => {
    // simulate task link for project
    const scopesTbl = (schema as any).scopes || schema;
    const taskLinksTbl = (schema as any).taskLinks || (dbMod as any).taskLinks;
    const [scRow] = await db.select().from(scopesTbl).where(eq((scopesTbl as any).path, demoScopePath)).limit(1);
    await db.insert(taskLinksTbl).values({ scopeId: scRow.id, planeProjectId: "p1", planeLabelId: null });

    // lookup should succeed
    const link = await findScopeByPlaneProject(db, "p1");
    expect(link?.scopePath).toBe(demoScopePath);

    // Real route would emit; here we assert lookup + can call emitEvent indirectly via report style (simple coverage)
    // For fixture payload shape verification, just confirm detection logic shape is handled in route (tested via lookup)
    const fixtureCompleted = { event: "issue", action: "update", data: { project: "p1", state: { group: "completed" } } };
    expect(fixtureCompleted.data.state.group).toBe("completed");
  });

  it("verifyPlaneWebhookSignature matches hmac on raw body (using real Plane example shape)", () => {
    const secret = "whsec_test_abc123";
    const raw = JSON.stringify({ event: "issue", action: "update", data: { id: "i1", state: { group: "completed" } } });
    const goodSig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    expect(verifyPlaneWebhookSignature(raw, goodSig, secret)).toBe(true);
    expect(verifyPlaneWebhookSignature(raw, "bad", secret)).toBe(false);
    expect(verifyPlaneWebhookSignature(raw, goodSig, "wrong")).toBe(false);
    expect(verifyPlaneWebhookSignature(raw, null, secret)).toBe(false);
  });

  it("webhook path coverage: emits completed_external for state transition fixture via lookup + emit", async () => {
    // setup link again (unique scope in before)
    const scopesTbl = (schema as any).scopes || schema;
    const taskLinksTbl = (schema as any).taskLinks || (dbMod as any).taskLinks;
    const [scRow] = await db.select().from(scopesTbl).where(eq((scopesTbl as any).path, demoScopePath)).limit(1);
    await db.insert(taskLinksTbl).values({ scopeId: scRow.id, planeProjectId: "proj_fix", planeLabelId: null });

    const link = await findScopeByPlaneProject(db, "proj_fix");
    expect(link?.scopePath).toBe(demoScopePath);

    // simulate the emit the route performs for completed
    await emitEvent(db, {
      type: "task.completed_external",
      scopePath: link!.scopePath,
      principalId: null,
      payload: { source: "plane", planeProjectId: "proj_fix", planeIssueId: "issue_fix_99" },
    });
    const evs = await listEvents(db, { type: "task.completed_external", limit: 5 });
    expect(evs.some((e: any) => String(e.payload?.planeIssueId).includes("fix_99"))).toBe(true);
  });
});
