/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  createRecord,
  grantRole,
  saveDoc,
  search,
  AccessDeniedError,
  setEmbeddingClientForTests,
  backfillSemanticLayer,
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

describe("search module", () => {
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

  let rootPrincipalId: string;
  let viewerPrincipalId: string;
  let noAccessPrincipalId: string;

  beforeEach(async () => {
    setEmbeddingClientForTests(null);
    const now = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [root] = await db.insert(schema.principals).values({ kind: "human", name: `Root ${now}`, status: "active" }).returning();
    rootPrincipalId = root.id;
    const [viewer] = await db.insert(schema.principals).values({ kind: "human", name: `Viewer ${now}`, status: "active" }).returning();
    viewerPrincipalId = viewer.id;
    const [noAccess] = await db.insert(schema.principals).values({ kind: "human", name: `NoAccess ${now}`, status: "active" }).returning();
    noAccessPrincipalId = noAccess.id;
  });

  function semanticVector(text: string): number[] {
    const vector = Array.from({ length: 1536 }, () => 0);
    const normalized = text.toLowerCase();
    if (normalized.includes("paid social") || normalized.includes("meta ads")) {
      vector[0] = 1;
    } else if (normalized.includes("checkout")) {
      vector[1] = 1;
    } else {
      vector[2] = 1;
    }
    return vector;
  }

  async function waitForEmbedding(entityType: "doc" | "record", entityId: string) {
    for (let i = 0; i < 20; i++) {
      const rows = await db
        .select()
        .from(schema.embeddings)
        .where(and(eq(schema.embeddings.entityType, entityType), eq(schema.embeddings.entityId, entityId)))
        .limit(1);
      if (rows[0]) return rows[0];
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${entityType} embedding ${entityId}`);
  }

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
        bodyMd: "---\naliases:\n  - cartalias\n---\nThe checkout migration uses the gateway reconciliation pattern from the old report.",
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

    const aliasHit = await search(db, { scopePath: clientA, query: "cartalias", kinds: ["doc"], mode: "keyword" }, viewerPrincipalId);
    expect(aliasHit.some((h) => h.type === "doc" && h.slug === "checkout")).toBe(true);

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

  it("upserts embeddings after saves, skips unchanged content, and fails open on embedding errors", async () => {
    const sp = `semantic-upsert-${Date.now()}`;
    await createScope(db, { slug: sp, name: "Semantic Upsert", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
    let calls = 0;
    setEmbeddingClientForTests({
      async embed({ text }) {
        calls += 1;
        return semanticVector(text);
      },
    });

    const doc = await saveDoc(db, { scopePath: sp, slug: "meta-ads", title: "Meta Ads", bodyMd: "Meta ads plan." }, rootPrincipalId);
    await waitForEmbedding("doc", doc.id);
    expect(calls).toBe(1);

    await saveDoc(db, { scopePath: sp, slug: "meta-ads", title: "Meta Ads", bodyMd: "Meta ads plan." }, rootPrincipalId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);

    setEmbeddingClientForTests({
      async embed() {
        calls += 1;
        throw new Error("litellm unavailable");
      },
    });
    await saveDoc(db, { scopePath: sp, slug: "meta-ads", title: "Meta Ads", bodyMd: "Meta ads plan updated." }, rootPrincipalId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(2);

    const usageRows = await db
      .select()
      .from(schema.usageEvents)
      .where(and(eq(schema.usageEvents.source, "semantic"), eq(schema.usageEvents.success, false)));
    expect(usageRows.length).toBeGreaterThan(0);
    expect(JSON.stringify(usageRows)).not.toContain("Meta ads plan updated");
  });

  it("falls back to keyword when no vectors exist and uses hybrid semantic hits when vectors exist", async () => {
    const sp = `semantic-search-${Date.now()}`;
    await createScope(db, { slug: sp, name: "Semantic Search", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "admin" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

    await saveDoc(db, { scopePath: sp, slug: "meta-ads", title: "Meta Ads Playbook", bodyMd: "Audience testing and campaign structure." }, rootPrincipalId);

    const beforeVectors = await search(db, { scopePath: sp, query: "paid social", mode: "hybrid", kinds: ["doc"] }, viewerPrincipalId);
    const keywordOnly = await search(db, { scopePath: sp, query: "paid social", mode: "keyword", kinds: ["doc"] }, viewerPrincipalId);
    expect(beforeVectors).toEqual(keywordOnly);

    setEmbeddingClientForTests({
      async embed({ text }) {
        return semanticVector(text);
      },
    });
    const backfill = await backfillSemanticLayer(db, { scopePath: sp }, rootPrincipalId);
    expect(backfill.docsSeen).toBeGreaterThanOrEqual(1);
    expect(backfill.embedded).toBeGreaterThanOrEqual(1);

    const hybrid = await search(db, { scopePath: sp, query: "paid social", mode: "hybrid", kinds: ["doc"] }, viewerPrincipalId);
    expect(hybrid.some((hit) => hit.slug === "meta-ads")).toBe(true);
  });

  it("backfills records and docs idempotently", async () => {
    const sp = `semantic-backfill-${Date.now()}`;
    await createScope(db, { slug: sp, name: "Semantic Backfill", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "admin" }, rootPrincipalId);

    await saveDoc(db, { scopePath: sp, slug: "wiki", title: "Wiki", bodyMd: "See [[meta-ads]]." }, rootPrincipalId);
    await saveDoc(db, { scopePath: sp, slug: "meta-ads", title: "Meta Ads", bodyMd: "Meta ads source." }, rootPrincipalId);
    await createRecord(db, { scopePath: sp, kind: "report", title: "Meta report", bodyMd: "Meta ads weekly notes." }, rootPrincipalId);
    setEmbeddingClientForTests({
      async embed({ text }) {
        return semanticVector(text);
      },
    });

    const first = await backfillSemanticLayer(db, { scopePath: sp }, rootPrincipalId);
    const second = await backfillSemanticLayer(db, { scopePath: sp }, rootPrincipalId);
    expect(first.embedded).toBeGreaterThanOrEqual(3);
    expect(second.embedded).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(3);
  });
});
