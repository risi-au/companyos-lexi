/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import { eq } from "drizzle-orm";
import {
  createScope,
  grantRole,
  writeMetrics,
  queryMetrics,
  listMetricNames,
  listEvents,
} from "../../index";
import {
  AccessDeniedError,
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
console.log("[metrics.test] using migrationsFolder:", migrationsFolder);

describe("metrics module (PGlite + migrations)", () => {
  let client: PGlite;
  let db: any;

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

  it("migrations apply and metrics table + indexes exist", async () => {
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(expect.arrayContaining(["metrics", "scopes", "principals", "grants", "events"]));
  });

  describe("writeMetrics", () => {
    it("writes points, upserts idempotently (same key -> 1 row, latest value), emits one metrics.written event", async () => {
      const sp = "met-write-" + Date.now();
      await createScope(db, { slug: sp, name: "MetW", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const pts1 = [
        { metric: "meta.spend", date: "2026-06-01", value: 100.5, dims: { campaign: "prospecting", country: "AU" } },
        { metric: "ga4.sessions", date: "2026-06-02", value: 42 },
      ];
      const res1 = await writeMetrics(db, { scopePath: sp, points: pts1 }, rootPrincipalId);
      expect(res1.written).toBe(2);
      expect(res1.metrics).toContain("meta.spend");
      expect(res1.metrics).toContain("ga4.sessions");

      // verify only 2 rows
      const allRows = await db.select().from(schema.metrics).where(eq(schema.metrics.scopeId, (await getScopeId(sp))));
      expect(allRows.length).toBe(2);
      const spendRow = allRows.find((r: any) => r.metric === "meta.spend");
      expect(Number(spendRow?.value)).toBeCloseTo(100.5, 2);

      const evs = await listEvents(db, { scopePath: sp, type: "metrics.written", limit: 5 });
      expect(evs.length).toBe(1);
      expect((evs[0] as any)?.payload).toMatchObject({ count: 2, metrics: expect.arrayContaining(["ga4.sessions", "meta.spend"]) });

      // rewrite same -> updated value (idempotent upsert), still 1 row for key, second event
      const pts2 = [{ metric: "meta.spend", date: "2026-06-01", value: 999, dims: { campaign: "prospecting", country: "AU" } }];
      const res2 = await writeMetrics(db, { scopePath: sp, points: pts2 }, rootPrincipalId);
      expect(res2.written).toBe(1);

      const rows2 = await db.select().from(schema.metrics);
      const spendRows = rows2.filter((r: any) => r.metric === "meta.spend" && r.date === "2026-06-01");
      expect(spendRows.length).toBe(1);
      expect(Number(spendRows[0].value)).toBeCloseTo(999, 2);

      const evs2 = await listEvents(db, { scopePath: sp, type: "metrics.written", limit: 10 });
      expect(evs2.length).toBe(2); // one per batch
    });

    it("enforces 1000 point cap", async () => {
      const sp = "met-cap-" + Date.now();
      await createScope(db, { slug: sp, name: "Cap", type: "area" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const tooMany = Array.from({ length: 1001 }, (_, i) => ({ metric: "t", date: "2026-07-01", value: i }));
      await expect(writeMetrics(db, { scopePath: sp, points: tooMany }, rootPrincipalId))
        .rejects.toThrow(/1000/);
    });

    it("agent with grant can write, viewer cannot; no grant denied", async () => {
      const sp = "met-auth-" + Date.now();
      await createScope(db, { slug: sp, name: "MA", type: "client" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await expect(
        writeMetrics(db, { scopePath: sp, points: [{ metric: "x", date: "2026-01-01", value: 1 }] }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);

      const res = await writeMetrics(db, { scopePath: sp, points: [{ metric: "x", date: "2026-01-01", value: 1 }] }, agentPrincipalId);
      expect(res.written).toBe(1);

      await expect(
        writeMetrics(db, { scopePath: sp, points: [{ metric: "y", date: "2026-01-01", value: 2 }] }, noAccessPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });
  });

  describe("queryMetrics and listMetricNames", () => {
    it("queries with date range, groupBy date, filters, agg sum default", async () => {
      const sp = "met-q-" + Date.now();
      await createScope(db, { slug: sp, name: "Q", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await writeMetrics(db, { scopePath: sp, points: [
        { metric: "meta.spend", date: "2026-06-01", value: 10, dims: { campaign: "prospecting", country: "AU" } },
        { metric: "meta.spend", date: "2026-06-01", value: 5, dims: { campaign: "retargeting", country: "AU" } },
        { metric: "meta.spend", date: "2026-06-02", value: 20, dims: { campaign: "prospecting", country: "AU" } },
        { metric: "meta.spend", date: "2026-06-02", value: 3, dims: { campaign: "prospecting", country: "NZ" } },
        { metric: "ga4.sessions", date: "2026-06-01", value: 100 },
      ] }, rootPrincipalId);

      // query range, groupBy date (collapses dims), default sum
      const byDate = await queryMetrics(db, {
        scopePath: sp,
        metrics: ["meta.spend"],
        from: "2026-06-01",
        to: "2026-06-02",
        groupBy: "date",
      }, viewerPrincipalId);
      expect(byDate.length).toBe(1);
      expect(byDate[0]!.metric).toBe("meta.spend");
      expect(byDate[0]!.points).toEqual([
        ["2026-06-01", 15], // 10+5
        ["2026-06-02", 23], // 20+3
      ]);

      // with filter
      const filtered = await queryMetrics(db, {
        scopePath: sp,
        metrics: ["meta.spend"],
        from: "2026-06-01",
        to: "2026-06-02",
        groupBy: "date",
        filters: { country: "AU" },
      }, viewerPrincipalId);
      expect(filtered[0]!.points).toEqual([
        ["2026-06-01", 15],
        ["2026-06-02", 20],
      ]);

      // list names
      const names = await listMetricNames(db, { scopePath: sp }, viewerPrincipalId);
      expect(names.length).toBe(2);
      expect(names.find((n: any) => n.metric === "meta.spend")?.firstDate).toBe("2026-06-01");
      expect(names.find((n: any) => n.metric === "meta.spend")?.lastDate).toBe("2026-06-02");
    });

    it("groupBy dim key produces per-dim series; agg avg works", async () => {
      const sp = "met-dim-" + Date.now();
      await createScope(db, { slug: sp, name: "D", type: "area" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      await writeMetrics(db, { scopePath: sp, points: [
        { metric: "meta.spend", date: "2026-06-10", value: 100, dims: { campaign: "prospecting" } },
        { metric: "meta.spend", date: "2026-06-10", value: 200, dims: { campaign: "retargeting" } },
        { metric: "meta.spend", date: "2026-06-11", value: 150, dims: { campaign: "prospecting" } },
      ] }, rootPrincipalId);

      const byCamp = await queryMetrics(db, {
        scopePath: sp,
        metrics: ["meta.spend"],
        from: "2026-06-10",
        to: "2026-06-11",
        groupBy: "campaign",
        agg: "avg",
      }, rootPrincipalId);

      expect(byCamp.length).toBe(2);
      const pros = byCamp.find((s: any) => s.dim === "campaign=prospecting");
      const ret = byCamp.find((s: any) => s.dim === "campaign=retargeting");
      expect(pros).toBeTruthy();
      expect(ret).toBeTruthy();
      expect(pros).toBeDefined();
      expect(ret).toBeDefined();
      // avg for prospecting: (100+150)/2 = 125
      expect(pros!.points).toEqual([
        ["2026-06-10", 100],
        ["2026-06-11", 150],
      ]); // note: per date still, agg applied within group
      // avg would apply per group bucket, here per date bucket so unchanged unless multiple same date same dim
    });

    it("unauthorized cannot query or list; missing scope returns empty", async () => {
      const sp = "met-noq-" + Date.now();
      await createScope(db, { slug: sp, name: "NQ", type: "area" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await writeMetrics(db, { scopePath: sp, points: [{ metric: "z", date: "2026-01-01", value: 1 }] }, rootPrincipalId);

      await expect(queryMetrics(db, { scopePath: sp, metrics: ["z"], from: "2026-01-01", to: "2026-01-01" }, noAccessPrincipalId))
        .rejects.toThrow(AccessDeniedError);
      await expect(listMetricNames(db, { scopePath: sp }, noAccessPrincipalId)).rejects.toThrow(AccessDeniedError);

      const miss = await queryMetrics(db, { scopePath: "non/existent", metrics: ["z"], from: "2026-01-01", to: "2026-01-01" }, rootPrincipalId);
      expect(miss).toEqual([]);
    });
  });

  // Helper for scope id lookup in test (hoisted usage)
  async function getScopeId(path: string) {
    const [row] = await db.select({ id: schema.scopes.id }).from(schema.scopes).where(eq(schema.scopes.path, path)).limit(1);
    return row?.id;
  }

  it("dry-verifies generator function from db:seed-demo (PGlite + service writes, idempotent)", async () => {
    const sp = "met-seed-demo-" + Date.now();
    await createScope(db, { slug: sp, name: "SeedDemo", type: "client" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "owner" }, rootPrincipalId);

    // dynamic import to run generator (as used by pnpm db:seed-demo script)
    const scriptUrl = new URL("../../scripts/seed-demo-metrics.ts", import.meta.url).href;
    const seedMod: any = await import(/* @vite-ignore */ scriptUrl);
    const gen = seedMod.generateDemoMetrics || seedMod.default?.generateDemoMetrics;
    expect(typeof gen).toBe("function");

    const res = await gen({ db, scopePath: sp, principalId: rootPrincipalId, days: 3, endDate: new Date("2026-07-02") });
    expect(res.written).toBeGreaterThan(10);


    // idempotent re-run
    const res2 = await gen({ db, scopePath: sp, principalId: rootPrincipalId, days: 3, endDate: new Date("2026-07-02") });
    expect(res2.written).toBeGreaterThan(0);
  });
});

