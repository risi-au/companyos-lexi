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
  assertBrainManualTriggerAllowed,
  createScope,
  getBrainEngineOps,
  getBrainGraph,
  grantRole,
  logUsageEvent,
  registerCapability,
  reportRun,
  saveDoc,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolderCandidates = [
  path.resolve(process.cwd(), "packages/db/drizzle"),
  path.resolve(__dirname, "../../../../packages/db/drizzle"),
  path.resolve("packages/db/drizzle"),
  "C:/dev/companyos/packages/db/drizzle",
];
const migrationsFolder = migrationsFolderCandidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json"))) || migrationsFolderCandidates[0]!;

describe("brain surfaces (M8-05)", () => {
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

  let rootAdminId: string;
  let viewerId: string;
  let projectPath: string;

  beforeEach(async () => {
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2)}`;
    const [admin] = await db.insert(schema.principals).values({ kind: "human", name: `Admin ${suffix}`, status: "active" }).returning();
    const [viewer] = await db.insert(schema.principals).values({ kind: "human", name: `Viewer ${suffix}`, status: "active" }).returning();
    rootAdminId = admin.id;
    viewerId = viewer.id;

    const existingRoot = await db.select({ id: schema.scopes.id }).from(schema.scopes).where(eq(schema.scopes.path, "root")).limit(1);
    if (existingRoot.length === 0) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, rootAdminId);
    }
    await grantRole(db, { principalId: rootAdminId, scopePath: "root", role: "admin" }, rootAdminId);

    const projectSlug = `brain-${suffix}`.replace(/[^a-z0-9-]/g, "");
    const project = await createScope(db, { slug: projectSlug, name: "Brain Project", type: "project" }, rootAdminId);
    projectPath = project.path;
    await grantRole(db, { principalId: viewerId, scopePath: projectPath, role: "viewer" }, rootAdminId);
  });

  it("returns bounded global graph nodes, edges, tints, lint flags, workbench anchors, and denies non-root", async () => {
    await saveDoc(db, { scopePath: "root", slug: "critical-facts", title: "Critical Facts", bodyMd: "Instance summary." }, rootAdminId);
    await saveDoc(db, { scopePath: "root", slug: "pattern-meta-ads", title: "Pattern: Meta Ads", bodyMd: "Root pattern." }, rootAdminId);
    await saveDoc(db, { scopePath: projectPath, slug: "target", title: "Target", bodyMd: "Target page." }, rootAdminId);
    await saveDoc(db, { scopePath: projectPath, slug: "wiki", title: "Wiki", bodyMd: "See [[target]] and [[missing]]." }, rootAdminId);
    await saveDoc(db, { scopePath: projectPath, slug: "lint-report", title: "Lint Report", bodyMd: "- warning: stale - Check [[target]]." }, rootAdminId);

    const [scopeRow] = await db.select({ id: schema.scopes.id }).from(schema.scopes).where(eq(schema.scopes.path, projectPath)).limit(1);
    await db.insert(schema.workbenches).values({ scopeId: scopeRow.id, repo: "company/project", path: "apps/site" });

    const graph = await getBrainGraph(db, { nodeLimit: 100, edgeLimit: 100 }, rootAdminId);
    expect(graph.meta.returnedNodes).toBeGreaterThan(0);
    expect(graph.nodes.some((node) => node.type === "scope" && node.scopePath === projectPath)).toBe(true);
    expect(graph.nodes.some((node) => node.type === "root-pattern" && node.slug === "pattern-meta-ads")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "workbench" && node.scopePath === projectPath)).toBe(true);
    expect(graph.nodes.some((node) => node.slug === "target" && node.flagged)).toBe(true);
    expect(graph.nodes.some((node) => node.type === "unresolved" && node.slug === "missing")).toBe(true);
    expect(graph.edges.some((edge) => edge.type === "scope-hierarchy")).toBe(true);
    expect(graph.edges.some((edge) => edge.type === "wikilink" && edge.label === "target")).toBe(true);

    await expect(getBrainGraph(db, {}, viewerId)).rejects.toThrow(AccessDeniedError);
  });

  it("assembles run history, lint findings, spend, and gates manual triggers", async () => {
    await registerCapability(
      db,
      { scopePath: "root", name: "brain-engine", engine: "native", engineRef: "packages/brain" },
      rootAdminId
    );
    await reportRun(
      db,
      {
        scopePath: "root",
        name: "brain-engine",
        status: "success",
        runRef: "m8-05-test",
        summary: "lint: 1 pages, 0 records, 123 tokens",
        payload: { mode: "lint", pagesTouched: 1, recordsDistilled: 0, tokens: 123, partial: false },
      },
      rootAdminId
    );
    await saveDoc(db, { scopePath: projectPath, slug: "lint-report", title: "Lint Report", bodyMd: "- warning: stale - Check [[wiki]]." }, rootAdminId);
    await logUsageEvent(db, {
      scopePath: "root",
      principalId: rootAdminId,
      source: "brain",
      model: "analysis",
      operation: "brain.llm",
      totalTokensEst: 123,
      actualCostUsd: "0.42",
      success: true,
    });

    const ops = await getBrainEngineOps(db, { limit: 10 }, rootAdminId);
    expect(ops.runs[0]).toMatchObject({ mode: "lint", pagesTouched: 1, tokens: 123 });
    expect(ops.lintFindings.some((finding) => finding.scopePath === projectPath && finding.pageSlug === "wiki")).toBe(true);
    expect(ops.spend.totalTokensEst).toBeGreaterThanOrEqual(123);
    expect(ops.spend.actualCostUsd).toBeGreaterThanOrEqual(0.42);
    await expect(assertBrainManualTriggerAllowed(db, { mode: "ingest" }, rootAdminId)).resolves.toEqual({ ok: true, mode: "ingest" });
    await expect(assertBrainManualTriggerAllowed(db, { mode: "lint" }, viewerId)).rejects.toThrow(AccessDeniedError);
  });
});
