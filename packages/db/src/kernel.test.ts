/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as schema from "./schema";
import { scopes, principals, grants, events } from "./schema";
import { eq, and } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(__dirname, "../../drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  // fallback for some pnpm/vitest layouts
  migrationsFolder = path.resolve(process.cwd(), "drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}
console.log("[test] using migrationsFolder:", migrationsFolder);

describe("kernel schema (PGlite + migrations)", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof import("./schema")>>;

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

  it("migrations apply cleanly", async () => {
    // basic smoke: can query tables
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(
      expect.arrayContaining(["scopes", "principals", "grants", "tokens", "module_instances", "events"])
    );
  });

  it("inserting a scope tree of depth 4 works", async () => {
    // clean-ish insert new paths
    const rootRes = (await db.insert(scopes).values({ slug: "r-test", path: "r-test", name: "R", type: "root", status: "active", settings: {} }).returning()) as any[];
    const [root] = rootRes;
    if (!root) throw new Error("root insert failed");

    const c1Res = (await db.insert(scopes).values({ parentId: root.id, slug: "c1", path: "r-test/c1", name: "C1", type: "project", status: "active" }).returning()) as any[];
    const [c1] = c1Res;
    if (!c1) throw new Error("c1 insert failed");

    const c2Res = (await db.insert(scopes).values({ parentId: c1.id, slug: "c2", path: "r-test/c1/c2", name: "C2", type: "project", status: "active" }).returning()) as any[];
    const [c2] = c2Res;
    if (!c2) throw new Error("c2 insert failed");

    const c3Res = (await db.insert(scopes).values({ parentId: c2.id, slug: "c3", path: "r-test/c1/c2/c3", name: "C3", type: "subproject", status: "active" }).returning()) as any[];
    const [c3] = c3Res;
    if (!c3) throw new Error("c3 insert failed");

    expect(c3.path).toBe("r-test/c1/c2/c3");
    expect(c3.parentId).toBe(c2.id);
  });

  it("unique path constraint fires", async () => {
    const basePath = "unique-path-test-" + Date.now();
    await db.insert(scopes).values({
      slug: "u1",
      path: basePath,
      name: "U1",
      type: "root",
      status: "active",
    });

    await expect(
      db.insert(scopes).values({
        slug: "u2",
        path: basePath,
        name: "U2",
        type: "root",
        status: "active",
      })
    ).rejects.toThrow(/duplicate|unique|already exists|constraint/i);
  });

  it("grants unique constraint fires", async () => {
    const pRes = (await db.insert(principals).values({ kind: "human", name: "GrantTestUser", status: "active" }).returning()) as any[];
    const [p] = pRes;
    if (!p) throw new Error("failed to create principal for grant test");

    const sRes = (await db.insert(scopes).values({ slug: "g1", path: "grant-test-" + Date.now(), name: "G", type: "subproject", status: "active" }).returning()) as any[];
    const [s] = sRes;
    if (!s) throw new Error("failed to create scope for grant test");

    await db.insert(grants).values({
      principalId: p.id,
      scopeId: s.id,
      role: "owner",
    });

    await expect(
      db.insert(grants).values({
        principalId: p.id,
        scopeId: s.id,
        role: "viewer",
      })
    ).rejects.toThrow();
  });

  it("events insert with jsonb payload", async () => {
    const payload = { action: "test", meta: { count: 3, tags: ["a", "b"] } };
    const evRes = (await db.insert(events).values({ type: "test.event", payload }).returning()) as any[];
    const [ev] = evRes;
    if (!ev) throw new Error("failed to insert event");

    expect(ev.type).toBe("test.event");
    expect(ev.payload).toEqual(payload);
    expect(ev.createdAt).toBeTruthy();
  });

  it("seed is idempotent (run twice, same row counts)", async () => {
    const getCounts = async () => {
      const s = await db.select().from(scopes);
      const p = await db.select().from(principals);
      const g = await db.select().from(grants);
      return { scopes: s.length, principals: p.length, grants: g.length };
    };

    const rootPath = "seed-idem-" + Date.now();
    const pName = "Seed Owner";
    const pEmail = "seed@test.local";

    const doSeedOnce = async () => {
      // root
      let [root] = await db.select().from(scopes).where(eq(scopes.path, rootPath)).limit(1);
      if (!root) {
        const rRes = (await db.insert(scopes).values({ slug: "root", path: rootPath, name: "Root", type: "root", status: "active", settings: {} }).returning()) as any[];
        [root] = rRes;
      }
      if (!root) throw new Error("failed to ensure root in seed test");

      // principal
      let [principal] = await db
        .select()
        .from(principals)
        .where(eq(principals.email, pEmail))
        .limit(1);
      if (!principal) {
        const prRes = (await db.insert(principals).values({ kind: "human", name: pName, email: pEmail, status: "active" }).returning()) as any[];
        [principal] = prRes;
      }
      if (!principal) throw new Error("failed to ensure principal in seed test");

      // grant
      if (root && principal) {
        const [ex] = await db
          .select()
          .from(grants)
          .where(and(eq(grants.principalId, principal.id), eq(grants.scopeId, root.id)))
          .limit(1);
        if (!ex) {
          await db.insert(grants).values({
            principalId: principal.id,
            scopeId: root.id,
            role: "owner",
          });
        }
      }
    };

    await doSeedOnce();
    const c1 = await getCounts();
    await doSeedOnce();
    const c2 = await getCounts();

    expect(c2.scopes).toBe(c1.scopes);
    expect(c2.principals).toBe(c1.principals);
    expect(c2.grants).toBe(c1.grants);
  });
});
