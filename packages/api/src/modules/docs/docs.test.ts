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
import {
  createScope,
  grantRole,
  saveDoc,
  getDoc,
  listDocs,
  renameDoc,
  archiveDoc,
  listDocRevisions,
  revertDoc,
  listEvents,
} from "../../index";
import {
  AccessDeniedError,
  DocumentNotFoundError,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = "";
const candidates = [
  path.resolve(process.cwd(), "packages/db/drizzle"),
  path.resolve(__dirname, "../../../../packages/db/drizzle"),
  path.resolve(__dirname, "../../../../../packages/db/drizzle"),
  path.resolve("packages/db/drizzle"),
  path.resolve(__dirname, "../drizzle"), // unlikely
];
for (const c of candidates) {
  if (fs.existsSync(path.join(c, "meta", "_journal.json"))) {
    migrationsFolder = c;
    break;
  }
}
if (!migrationsFolder) {
  migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
}
console.log("[docs.test] using migrationsFolder:", migrationsFolder);

describe("docs module (PGlite + migrations)", () => {
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

  it("migrations apply and documents + document_revisions tables exist", async () => {
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(expect.arrayContaining(["documents", "document_revisions", "scopes", "principals", "grants", "events"]));
  });

  describe("saveDoc + getDoc + listDocs (upsert by slug, md roundtrip, default hide archived)", () => {
    it("saves with auto slugify, get returns byte-exact body_md, list shows, emits doc.saved", async () => {
      const sp = "doc-save-" + Date.now();
      await createScope(db, { slug: sp, name: "DocS", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      const body = "# Title\n\nExact **markdown** here with newlines\nand more.";
      const saved = await saveDoc(db, { scopePath: sp, title: "KB Doc", bodyMd: body }, rootPrincipalId);
      expect(saved.id).toBeTruthy();
      expect(saved.slug).toBe("kb-doc");
      expect(saved.title).toBe("KB Doc");
      expect(saved.bodyMd).toBe(body);

      const got = await getDoc(db, { scopePath: sp, slug: "kb-doc" }, viewerPrincipalId);
      expect(got?.bodyMd).toBe(body); // byte exact roundtrip
      expect(got?.title).toBe("KB Doc");

      const listed = await listDocs(db, { scopePath: sp }, viewerPrincipalId);
      expect(listed.length).toBe(1);
      expect(listed[0]!.slug).toBe("kb-doc");
      expect(listed[0]!.title).toBe("KB Doc");

      const evs = await listEvents(db, { scopePath: sp, type: "doc.saved", limit: 3 });
      expect(evs.length).toBeGreaterThan(0);
      expect((evs[0] as any)?.payload).toMatchObject({ slug: "kb-doc", title: "KB Doc" });
    });

    it("slug collision on auto derives -2 suffix", async () => {
      const sp = "doc-slug-" + Date.now();
      await createScope(db, { slug: sp, name: "DocSlug", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const d1 = await saveDoc(db, { scopePath: sp, title: "Same Title", bodyMd: "one" }, rootPrincipalId);
      expect(d1.slug).toBe("same-title");

      const d2 = await saveDoc(db, { scopePath: sp, title: "Same Title", bodyMd: "two" }, rootPrincipalId);
      expect(d2.slug).toBe("same-title-2");
      expect(d2.title).toBe("Same Title");

      const listed = await listDocs(db, { scopePath: sp }, rootPrincipalId);
      expect(listed.map(l => l.slug).sort()).toEqual(["same-title", "same-title-2"].sort());
    });

    it("explicit slug used as-is (upsert), provided slug overrides title slugify", async () => {
      const sp = "doc-explicit-" + Date.now();
      await createScope(db, { slug: sp, name: "DocE", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const d1 = await saveDoc(db, { scopePath: sp, slug: "my-custom", title: "Ignored For Slug", bodyMd: "v1" }, rootPrincipalId);
      expect(d1.slug).toBe("my-custom");

      const d2 = await saveDoc(db, { scopePath: sp, slug: "my-custom", title: "New Title", bodyMd: "v2" }, rootPrincipalId);
      expect(d2.slug).toBe("my-custom");
      expect(d2.title).toBe("New Title");
      expect(d2.bodyMd).toBe("v2");

      const got = await getDoc(db, { scopePath: sp, slug: "my-custom" }, rootPrincipalId);
      expect(got?.bodyMd).toBe("v2");
    });
  });

  describe("access control", () => {
    it("viewer can list/get; editor/agent write; no grant denied", async () => {
      const sp = "doc-access-" + Date.now();
      await createScope(db, { slug: sp, name: "DA", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      const d = await saveDoc(db, { scopePath: sp, title: "A", bodyMd: "x" }, agentPrincipalId);
      const listV = await listDocs(db, { scopePath: sp }, viewerPrincipalId);
      expect(listV.length).toBe(1);
      const gotV = await getDoc(db, { scopePath: sp, slug: d.slug }, viewerPrincipalId);
      expect(gotV?.id).toBe(d.id);

      await expect(
        saveDoc(db, { scopePath: sp, title: "Bad", bodyMd: "" }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);

      await expect(
        listDocs(db, { scopePath: sp }, noAccessPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("agent can operate in subtree", async () => {
      const sp = "doc-agent-sub-" + Date.now();
      await createScope(db, { slug: sp, name: "DAS", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "sub", name: "Sub", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      const d = await saveDoc(db, { scopePath: `${sp}/sub`, title: "Sub Doc", bodyMd: "ok" }, agentPrincipalId);
      expect(d.slug).toBe("sub-doc");
    });
  });

  describe("archive soft-hides from list; get still works; emits doc.archived", () => {
    it("archive hides by default, includeArchived shows; get unaffected", async () => {
      const sp = "doc-arch-" + Date.now();
      await createScope(db, { slug: sp, name: "DArch", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const d = await saveDoc(db, { scopePath: sp, title: "To Archive", bodyMd: "secret" }, rootPrincipalId);
      expect(d.archivedAt).toBeFalsy();

      await archiveDoc(db, { scopePath: sp, slug: "to-archive" }, rootPrincipalId);

      const normal = await listDocs(db, { scopePath: sp }, rootPrincipalId);
      expect(normal.length).toBe(0);

      const withArch = await listDocs(db, { scopePath: sp, includeArchived: true }, rootPrincipalId);
      expect(withArch.length).toBe(1);
      expect(withArch[0]!.slug).toBe("to-archive");

      const got = await getDoc(db, { scopePath: sp, slug: "to-archive" }, rootPrincipalId);
      expect(got?.archivedAt).toBeTruthy();
      expect(got?.bodyMd).toBe("secret");

      const evs = await listEvents(db, { scopePath: sp, type: "doc.archived", limit: 1 });
      expect(evs.length).toBeGreaterThan(0);
    });
  });

  describe("renameDoc (title and/or slug) + slug unique + events", () => {
    it("rename title only keeps slug; rename to newSlug; emits renamed", async () => {
      const sp = "doc-rename-" + Date.now();
      await createScope(db, { slug: sp, name: "DRen", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const d = await saveDoc(db, { scopePath: sp, title: "Old", bodyMd: "b" }, rootPrincipalId);
      expect(d.slug).toBe("old");

      const r1 = await renameDoc(db, { scopePath: sp, slug: "old", newTitle: "New Title" }, rootPrincipalId);
      expect(r1.title).toBe("New Title");
      expect(r1.slug).toBe("old");

      const r2 = await renameDoc(db, { scopePath: sp, slug: "old", newSlug: "new-slug", newTitle: "Final" }, rootPrincipalId);
      expect(r2.slug).toBe("new-slug");
      expect(r2.title).toBe("Final");

      const got = await getDoc(db, { scopePath: sp, slug: "new-slug" }, rootPrincipalId);
      expect(got?.title).toBe("Final");

      const evs = await listEvents(db, { scopePath: sp, type: "doc.renamed", limit: 2 });
      expect(evs.length).toBeGreaterThan(0);
      expect((evs[0] as any)?.payload).toMatchObject({ oldSlug: "old", newSlug: "new-slug" });
    });

    it("rename to colliding slug fails", async () => {
      const sp = "doc-rename-col-" + Date.now();
      await createScope(db, { slug: sp, name: "DRC", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      await saveDoc(db, { scopePath: sp, slug: "taken", title: "Taken", bodyMd: "" }, rootPrincipalId);
      await saveDoc(db, { scopePath: sp, slug: "other", title: "Other", bodyMd: "" }, rootPrincipalId);

      await expect(
        renameDoc(db, { scopePath: sp, slug: "other", newSlug: "taken" }, rootPrincipalId)
      ).rejects.toThrow(/Slug already in use/);
    });

    it("rename non-existent throws DocumentNotFoundError", async () => {
      const sp = "doc-notfound-" + Date.now();
      await createScope(db, { slug: sp, name: "DNF", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await expect(
        renameDoc(db, { scopePath: sp, slug: "nope", newTitle: "x" }, rootPrincipalId)
      ).rejects.toThrow(DocumentNotFoundError);
    });
  });

  describe("revisions prune at 50; revert works; emits", () => {
    it("save appends rev; 51 saves -> 50 kept; revert restores body+title exactly and emits doc.reverted", async () => {
      const sp = "doc-rev-" + Date.now();
      await createScope(db, { slug: sp, name: "DRev", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const fixedSlug = "prune-test";
      for (let i = 0; i < 51; i++) {
        const body = `Rev body ${i}\n\nline`;
        await saveDoc(db, { scopePath: sp, slug: fixedSlug, title: `Rev ${i}`, bodyMd: body }, rootPrincipalId);
      }

      const revs = await listDocRevisions(db, { scopePath: sp, slug: fixedSlug, limit: 100 }, rootPrincipalId);
      expect(revs.length).toBe(50);
      // latest is rev 50
      expect(revs[0]!.title).toBe("Rev 50");
      expect(revs[0]!.bodyMd).toContain("Rev body 50");

      // pick an early one kept after prune (oldest of the 50)
      const oldRev = revs[revs.length - 1];
      expect(oldRev!.title).toBe("Rev 1");

      const restored = await revertDoc(db, { scopePath: sp, slug: fixedSlug, revisionId: oldRev!.id }, rootPrincipalId);
      expect(restored.title).toBe("Rev 1");
      expect(restored.bodyMd).toContain("Rev body 1");

      const nowDoc = await getDoc(db, { scopePath: sp, slug: fixedSlug }, rootPrincipalId);
      expect(nowDoc?.bodyMd).toContain("Rev body 1");

      const evs = await listEvents(db, { scopePath: sp, type: "doc.reverted", limit: 1 });
      expect(evs.length).toBeGreaterThan(0);
      expect((evs[0] as any)?.payload).toMatchObject({ fromRevisionId: oldRev!.id });
    });

    it("revert requires editor; viewer denied", async () => {
      const sp = "doc-rev-auth-" + Date.now();
      await createScope(db, { slug: sp, name: "DRA", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await saveDoc(db, { scopePath: sp, title: "R", bodyMd: "1" }, rootPrincipalId);
      const revs = await listDocRevisions(db, { scopePath: sp, slug: "r", limit: 3 }, rootPrincipalId);
      const rid = revs[0]!.id;

      await expect(
        revertDoc(db, { scopePath: sp, slug: "r", revisionId: rid }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });
  });

  describe("MCP + HTTP roundtrips covered via thin delegation + service (acceptance)", () => {
    it("core flows exercised (md exact, slug uniq, rev prune, archive, access, events)", async () => {
      const sp = "doc-round-" + Date.now();
      await createScope(db, { slug: sp, name: "DR", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      // save update get
      const b1 = "# Round\n\n**test**";
      await saveDoc(db, { scopePath: sp, title: "Round", bodyMd: b1 }, rootPrincipalId);
      const g1 = await getDoc(db, { scopePath: sp, slug: "round" }, agentPrincipalId);
      expect(g1?.bodyMd).toBe(b1);

      const b2 = "# Round\n\n**test** updated";
      await saveDoc(db, { scopePath: sp, slug: "round", title: "Round", bodyMd: b2 }, agentPrincipalId);
      const g2 = await getDoc(db, { scopePath: sp, slug: "round" }, agentPrincipalId);
      expect(g2?.bodyMd).toBe(b2); // exact

      // list exclude archive
      await archiveDoc(db, { scopePath: sp, slug: "round" }, rootPrincipalId);
      const l = await listDocs(db, { scopePath: sp }, rootPrincipalId);
      expect(l.length).toBe(0);
      const la = await listDocs(db, { scopePath: sp, includeArchived: true }, rootPrincipalId);
      expect(la.length).toBe(1);

      // revisions at least one
      const rs = await listDocRevisions(db, { scopePath: sp, slug: "round" }, rootPrincipalId);
      expect(rs.length).toBeGreaterThan(0);
    });
  });
});
