/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  grantRole,
  saveDashboard,
  getDashboard,
  listDashboards,
  listRevisions,
  revertDashboard,
  getWidgetVocabulary,
  listEvents,
} from "../../index";
import {
  AccessDeniedError,
  DashboardValidationError,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = "C:/dev/companyos/packages/db/drizzle";
}
console.log("[dashboards.test] using migrationsFolder:", migrationsFolder);

describe("dashboards module (PGlite + migrations)", () => {
  let client: PGlite;
  let db: any;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") {
      await client.close();
    }
  });

  let rootPrincipalId: string;
  let agentPrincipalId: string;
  let viewerPrincipalId: string;
  let noAccessPrincipalId: string;

  beforeEach(async () => {
    const now = Date.now();
    const pRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "Root Principal " + now,
      status: "active",
    }).returning()) as any[];
    rootPrincipalId = pRes[0]?.id;

    const aRes = (await db.insert(schema.principals).values({
      kind: "agent",
      name: "Agent " + now,
      status: "active",
    }).returning()) as any[];
    agentPrincipalId = aRes[0]?.id;

    const vRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "Viewer " + now,
      status: "active",
    }).returning()) as any[];
    viewerPrincipalId = vRes[0]?.id;

    const nRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "NoAccess " + now,
      status: "active",
    }).returning()) as any[];
    noAccessPrincipalId = nRes[0]?.id;
  });

  it("migrations apply and dashboards + revisions tables exist", async () => {
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(expect.arrayContaining(["dashboards", "dashboard_revisions", "scopes", "principals", "grants", "events"]));
  });

  describe("spec validation (via save)", () => {
    it("valid spec round-trips and saves", async () => {
      const sp = "dash-valid-" + Date.now();
      await createScope(db, { slug: sp, name: "DashV", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const validSpec = {
        version: 1,
        title: "AirBuddy Overview",
        range: { default: "7d" as const },
        widgets: [
          {
            id: "spend-card",
            type: "metric-card" as const,
            title: "Spend",
            grid: { x: 0, y: 0, w: 3, h: 2 },
            query: { metrics: ["meta.spend"], agg: "sum" as const, compare: "prev_period" as const },
          },
          {
            id: "overview-text",
            type: "text" as const,
            grid: { x: 4, y: 0, w: 8, h: 2 },
            options: { markdown: "# Hello\nWorld" },
          },
        ],
      };

      const saved = await saveDashboard(db, { scopePath: sp, spec: validSpec }, rootPrincipalId);
      expect(saved.id).toBeTruthy();
      expect(saved.name).toBe("main");
      expect(saved.spec).toMatchObject({ title: "AirBuddy Overview" });

      const got = await getDashboard(db, { scopePath: sp }, rootPrincipalId);
      expect(got?.spec).toEqual(saved.spec);
    });

    it("rejects unknown type", async () => {
      const sp = "dash-badtype-" + Date.now();
      await createScope(db, { slug: sp, name: "DashBT", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const bad = {
        version: 1,
        title: "Bad",
        range: { default: "7d" as const },
        widgets: [{ id: "w1", type: "pie" as any, grid: { x: 0, y: 0, w: 2, h: 2 }, query: { metrics: ["m"] } }],
      };
      await expect(saveDashboard(db, { scopePath: sp, spec: bad }, rootPrincipalId)).rejects.toThrow(DashboardValidationError);
    });

    it("rejects duplicate widget ids", async () => {
      const sp = "dash-dup-" + Date.now();
      await createScope(db, { slug: sp, name: "DashD", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const bad = {
        version: 1,
        title: "Dup",
        range: { default: "30d" as const },
        widgets: [
          { id: "same", type: "metric-card" as const, grid: { x: 0, y: 0, w: 2, h: 2 }, query: { metrics: ["a"] } },
          { id: "same", type: "text" as const, grid: { x: 3, y: 0, w: 2, h: 2 }, options: { markdown: "x" } },
        ],
      };
      await expect(saveDashboard(db, { scopePath: sp, spec: bad }, rootPrincipalId)).rejects.toThrow(DashboardValidationError);
    });

    it("rejects >24 widgets", async () => {
      const sp = "dash-many-" + Date.now();
      await createScope(db, { slug: sp, name: "DashM", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const widgets = Array.from({ length: 25 }).map((_, i) => ({
        id: `w${i}`,
        type: "text" as const,
        grid: { x: 0, y: i, w: 1, h: 1 },
        options: { markdown: "x" },
      }));
      const bad = { version: 1, title: "TooMany", range: { default: "7d" as const }, widgets };
      await expect(saveDashboard(db, { scopePath: sp, spec: bad }, rootPrincipalId)).rejects.toThrow(DashboardValidationError);
    });

    it("rejects missing query on data widget (metric-card)", async () => {
      const sp = "dash-noquery-" + Date.now();
      await createScope(db, { slug: sp, name: "DashNQ", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const bad = {
        version: 1,
        title: "NoQ",
        range: { default: "7d" as const },
        widgets: [{ id: "c", type: "metric-card" as const, grid: { x: 0, y: 0, w: 2, h: 2 } }],
      };
      await expect(saveDashboard(db, { scopePath: sp, spec: bad }, rootPrincipalId)).rejects.toThrow(DashboardValidationError);
    });

    it("rejects missing markdown on text widget", async () => {
      const sp = "dash-notext-" + Date.now();
      await createScope(db, { slug: sp, name: "DashNT", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const bad = {
        version: 1,
        title: "NoMd",
        range: { default: "7d" as const },
        widgets: [{ id: "t", type: "text" as const, grid: { x: 0, y: 0, w: 2, h: 2 }, options: {} }],
      };
      await expect(saveDashboard(db, { scopePath: sp, spec: bad }, rootPrincipalId)).rejects.toThrow(DashboardValidationError);
    });
  });

  describe("save + get + list + access", () => {
    it("editor can save, viewer can get/list, name defaults to main, emits dashboard.saved", async () => {
      const sp = "dash-save-" + Date.now();
      await createScope(db, { slug: sp, name: "DashS", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      const spec = { version: 1, title: "Main", range: { default: "30d" as const }, widgets: [] };
      const saved = await saveDashboard(db, { scopePath: sp, spec }, rootPrincipalId);
      expect(saved.name).toBe("main");

      const got = await getDashboard(db, { scopePath: sp }, viewerPrincipalId);
      expect((got?.spec as any)?.title).toBe("Main");

      const listed = await listDashboards(db, { scopePath: sp }, viewerPrincipalId);
      expect(listed.length).toBe(1);

      const evs = await listEvents(db, { scopePath: sp, type: "dashboard.saved", limit: 3 });
      expect(evs.length).toBeGreaterThan(0);
      expect((evs[0] as any)?.payload).toMatchObject({ name: "main" });
    });

    it("viewer cannot save", async () => {
      const sp = "dash-vwrite-" + Date.now();
      await createScope(db, { slug: sp, name: "DVW", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await expect(
        saveDashboard(db, { scopePath: sp, spec: { version: 1, title: "x", range: { default: "7d" }, widgets: [] } }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("no grant denies save/get", async () => {
      const sp = "dash-noacc-" + Date.now();
      await createScope(db, { slug: sp, name: "DNA", type: "project" }, rootPrincipalId);

      await expect(
        saveDashboard(db, { scopePath: sp, spec: { version: 1, title: "x", range: { default: "7d" }, widgets: [] } }, noAccessPrincipalId)
      ).rejects.toThrow(AccessDeniedError);

      await expect(
        getDashboard(db, { scopePath: sp }, noAccessPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("agent can save in subtree", async () => {
      const sp = "dash-agent-" + Date.now();
      await createScope(db, { slug: sp, name: "DA", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "sub", name: "Sub", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      const spec = { version: 1, title: "A", range: { default: "7d" as const }, widgets: [] };
      const saved = await saveDashboard(db, { scopePath: `${sp}/sub`, spec }, agentPrincipalId);
      expect(saved).toBeTruthy();
    });
  });

  describe("revisions and revert", () => {
    it("each save appends revision; 51 saves prunes to 50", async () => {
      const sp = "dash-rev-" + Date.now();
      await createScope(db, { slug: sp, name: "DR", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      for (let i = 0; i < 51; i++) {
        const spec = {
          version: 1 as const,
          title: `Rev ${i}`,
          range: { default: "7d" as const },
          widgets: [{ id: `w${i}`, type: "text" as const, grid: { x: 0, y: 0, w: 1, h: 1 }, options: { markdown: `${i}` } }],
        };
        await saveDashboard(db, { scopePath: sp, spec }, rootPrincipalId);
      }

      const revs = await listRevisions(db, { scopePath: sp, limit: 100 }, rootPrincipalId);
      expect(revs.length).toBe(50);
      // most recent should be the last saved
      expect((revs[0] as any).spec.title).toBe("Rev 50");
    });

    it("revert restores exact prior spec and emits dashboard.reverted", async () => {
      const sp = "dash-revert-" + Date.now();
      await createScope(db, { slug: sp, name: "DRev", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const spec1 = { version: 1 as const, title: "V1", range: { default: "7d" as const }, widgets: [] };
      await saveDashboard(db, { scopePath: sp, spec: spec1 }, rootPrincipalId);

      const spec2 = { version: 1 as const, title: "V2", range: { default: "30d" as const }, widgets: [{ id: "t", type: "text" as const, grid: { x: 0, y: 0, w: 12, h: 1 }, options: { markdown: "hi" } }] };
      await saveDashboard(db, { scopePath: sp, spec: spec2 }, rootPrincipalId);

      const revs = await listRevisions(db, { scopePath: sp, limit: 5 }, rootPrincipalId);
      expect(revs.length).toBe(2);
      const oldRevId = revs[1]!.id; // the first one

      const restored = await revertDashboard(db, { scopePath: sp, revisionId: oldRevId }, rootPrincipalId);
      expect((restored.spec as any).title).toBe("V1");

      const now = await getDashboard(db, { scopePath: sp }, rootPrincipalId);
      expect((now?.spec as any).title).toBe("V1");

      const evs = await listEvents(db, { scopePath: sp, type: "dashboard.reverted", limit: 2 });
      expect(evs.length).toBeGreaterThan(0);
      expect((evs[0] as any)?.payload).toMatchObject({ fromRevisionId: oldRevId });
    });

    it("revert requires editor, viewer denied", async () => {
      const sp = "dash-rev-auth-" + Date.now();
      await createScope(db, { slug: sp, name: "DRA", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      const spec = { version: 1 as const, title: "X", range: { default: "7d" as const }, widgets: [] };
      await saveDashboard(db, { scopePath: sp, spec }, rootPrincipalId);
      const revs = await listRevisions(db, { scopePath: sp }, rootPrincipalId);
      const rid = revs[0]!.id;

      await expect(
        revertDashboard(db, { scopePath: sp, revisionId: rid }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });
  });

  describe("getWidgetVocabulary", () => {
    it("returns vocabulary with all 7 types and examples", () => {
      const v = getWidgetVocabulary();
      expect(v.version).toBe(1);
      expect(v.types.length).toBe(7);
      const types = v.types.map((t: any) => t.type);
      expect(types).toEqual(expect.arrayContaining(["metric-card", "timeseries", "bar", "table", "tasks", "records", "text"]));
      // check examples exist
      for (const t of v.types) {
        expect(t.example).toBeTruthy();
        expect(t.example.type).toBe(t.type);
      }
      expect(v.constraints.maxWidgets).toBe(24);
    });
  });

  describe("MCP roundtrip coverage (via direct service, see mcp integration)", () => {
    it("all core functions round-trip for agent/editor", async () => {
      const sp = "dash-mcp-" + Date.now();
      await createScope(db, { slug: sp, name: "DM", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      const spec = {
        version: 1 as const,
        title: "Agent Dash",
        range: { default: "90d" as const },
        widgets: [
          { id: "m", type: "metric-card" as const, grid: { x: 0, y: 0, w: 4, h: 2 }, query: { metrics: ["meta.spend"] } },
        ],
      };
      const saved = await saveDashboard(db, { scopePath: sp, spec }, agentPrincipalId);
      const got = await getDashboard(db, { scopePath: sp }, agentPrincipalId);
      expect(got?.id).toBe(saved.id);

      const list = await listDashboards(db, { scopePath: sp }, agentPrincipalId);
      expect(list.length).toBe(1);

      const vocab = getWidgetVocabulary();
      expect(vocab.types.length).toBeGreaterThan(0);

      const revs = await listRevisions(db, { scopePath: sp, limit: 10 }, agentPrincipalId);
      expect(revs.length).toBe(1);

      // revert to self (no-op but valid)
      const restored = await revertDashboard(db, { scopePath: sp, revisionId: revs[0]!.id }, agentPrincipalId);
      expect(restored.id).toBe(saved.id);
    });
  });
});
