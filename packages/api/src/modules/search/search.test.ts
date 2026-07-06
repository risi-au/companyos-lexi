/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import { createScope, createRecord, grantRole, saveDoc, search, AccessDeniedError } from "../../index";

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

describe("search module", () => {
  let client: PGlite;
  let db: any;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  let rootPrincipalId: string;
  let viewerPrincipalId: string;
  let noAccessPrincipalId: string;

  beforeEach(async () => {
    const now = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [root] = await db.insert(schema.principals).values({ kind: "human", name: `Root ${now}`, status: "active" }).returning();
    rootPrincipalId = root.id;
    const [viewer] = await db.insert(schema.principals).values({ kind: "human", name: `Viewer ${now}`, status: "active" }).returning();
    viewerPrincipalId = viewer.id;
    const [noAccess] = await db.insert(schema.principals).values({ kind: "human", name: `NoAccess ${now}`, status: "active" }).returning();
    noAccessPrincipalId = noAccess.id;
  });

  it("finds old descendant records, spans records and docs, filters kinds, returns snippets, and avoids cross-client leakage", async () => {
    const suffix = Date.now().toString();
    const clientA = `search-a-${suffix}`;
    const clientB = `search-b-${suffix}`;
    await createScope(db, { slug: clientA, name: "Search A", type: "project" }, rootPrincipalId);
    await createScope(db, { parentPath: clientA, slug: "ads", name: "Ads", type: "subproject" }, rootPrincipalId);
    await createScope(db, { slug: clientB, name: "Search B", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: clientA, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: clientB, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerPrincipalId, scopePath: clientA, role: "viewer" }, rootPrincipalId);

    const old = await createRecord(
      db,
      {
        scopePath: `${clientA}/ads`,
        kind: "report",
        title: "Six month checkout migration",
        bodyMd: "Backdated checkout migration fixed the cart handoff and gateway reconciliation.",
      },
      rootPrincipalId
    );
    await db
      .update(schema.records)
      .set({ createdAt: new Date("2026-01-05T00:00:00.000Z"), updatedAt: new Date("2026-01-05T00:00:00.000Z") })
      .where(eq(schema.records.id, old.id));

    await saveDoc(
      db,
      {
        scopePath: clientA,
        slug: "checkout",
        title: "Checkout Knowledge",
        bodyMd: "The checkout migration uses the gateway reconciliation pattern from the old report.",
      },
      rootPrincipalId
    );
    await createRecord(
      db,
      { scopePath: clientB, kind: "report", title: "Other checkout secret", bodyMd: "checkout migration from another client" },
      rootPrincipalId
    );

    const hits = await search(db, { scopePath: clientA, query: "checkout migration", limit: 10 }, viewerPrincipalId);

    expect(hits.map((h) => h.type)).toEqual(expect.arrayContaining(["record", "doc"]));
    expect(hits.some((h) => h.type === "record" && h.title === "Six month checkout migration" && h.scopePath === `${clientA}/ads`)).toBe(true);
    expect(hits.some((h) => h.type === "doc" && h.slug === "checkout" && h.scopePath === clientA)).toBe(true);
    expect(hits.every((h) => h.scopePath.startsWith(clientA))).toBe(true);
    expect(hits.every((h) => h.snippet && h.snippet.length > 0)).toBe(true);

    const docOnly = await search(db, { scopePath: clientA, query: "checkout migration", kinds: ["doc"] }, viewerPrincipalId);
    expect(docOnly.length).toBeGreaterThan(0);
    expect(docOnly.every((h) => h.type === "doc")).toBe(true);

    await expect(search(db, { scopePath: clientA, query: "checkout" }, noAccessPrincipalId)).rejects.toThrow(AccessDeniedError);

    const usageRows = await db
      .select()
      .from(schema.usageEvents)
      .where(and(eq(schema.usageEvents.operation, "search"), eq(schema.usageEvents.principalId, viewerPrincipalId)));
    expect(usageRows.length).toBeGreaterThan(0);
    const audit = JSON.stringify(usageRows);
    expect(audit).toContain("resultCount");
    expect(audit).not.toContain("checkout migration");
    expect(audit).not.toContain("gateway reconciliation");
  });
});
