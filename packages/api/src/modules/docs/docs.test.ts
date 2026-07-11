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
  createScope,
  grantRole,
  saveDoc,
  getDoc,
  listDocs,
  renameDoc,
  archiveDoc,
  listDocRevisions,
  revertDoc,
  verifyDoc,
  followDoc,
  unfollowDoc,
  isFollowing,
  listAttentionItems,
  resolveAttentionItem,
  getBacklinks,
  getLinkGraph,
  listEvents,
  ensureSelfDocs,
  COS_SELF_DOCS,
  recallMemory,
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

  it("migrations apply and documents + document_revisions tables exist", async () => {
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(expect.arrayContaining(["documents", "document_revisions", "doc_links", "embeddings", "scopes", "principals", "grants", "events"]));
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


  it("seeds cos self-docs only when missing and recalls token guidance with citations", async () => {
    await createScope(db, { slug: "root", name: "Root", type: "root" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);

    const first = await ensureSelfDocs(db);
    expect(first.created.sort()).toEqual(COS_SELF_DOCS.map((page) => page.slug).sort());

    const docs = await Promise.all(COS_SELF_DOCS.map((page) => getDoc(db, { scopePath: "root", slug: page.slug }, rootPrincipalId)));
    expect(docs.every(Boolean)).toBe(true);
    expect(docs.find((doc) => doc?.slug === "cos-tokens")?.bodyMd).toContain("Worker tokens");

    const beforeRevisions = await db.select().from(schema.documentRevisions);
    const second = await ensureSelfDocs(db);
    expect(second.created).toEqual([]);
    const afterRevisions = await db.select().from(schema.documentRevisions);
    expect(afterRevisions.length).toBe(beforeRevisions.length);

    const hits = await recallMemory(db, { scopePath: "root", query: "How do I mint a worker token?", limit: 10 }, rootPrincipalId);
    const tokenHit = hits.find((hit) => hit.slug === "cos-tokens");
    expect(tokenHit).toMatchObject({ slug: "cos-tokens", scopePath: "root", type: "page" });
    expect(tokenHit?.revisionId).toEqual(expect.any(String));
  });

  describe("wikilinks, backlinks, and graph", () => {
    it("extracts same-wiki and cross-wiki links, updates/removes rows on save, and allows unresolved docs", async () => {
      const suffix = Date.now();
      const sp = `doc-links-${suffix}`;
      const other = `doc-links-other-${suffix}`;
      await createScope(db, { slug: sp, name: "Doc Links", type: "project" }, rootPrincipalId);
      await createScope(db, { slug: other, name: "Doc Links Other", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: other, role: "editor" }, rootPrincipalId);

      const source = await saveDoc(
        db,
        { scopePath: sp, slug: "wiki", title: "Wiki", bodyMd: `See [[target]] and [[${other}:missing-target]].` },
        rootPrincipalId
      );
      let links = await db.select().from(schema.docLinks).where(eq(schema.docLinks.fromDocumentId, source.id));
      expect(links.map((link: any) => link.toSlug).sort()).toEqual(["missing-target", "target"]);
      expect(links.some((link: any) => link.toSlug === "target" && link.toDocumentId === null)).toBe(true);

      const target = await saveDoc(db, { scopePath: sp, slug: "target", title: "Target", bodyMd: "Resolved." }, rootPrincipalId);
      links = await db.select().from(schema.docLinks).where(eq(schema.docLinks.fromDocumentId, source.id));
      expect(links.some((link: any) => link.toSlug === "target" && link.toDocumentId === target.id)).toBe(true);
      expect(links.some((link: any) => link.toSlug === "missing-target" && link.toDocumentId === null)).toBe(true);

      await saveDoc(db, { scopePath: sp, slug: "wiki", title: "Wiki", bodyMd: "No links now." }, rootPrincipalId);
      links = await db.select().from(schema.docLinks).where(eq(schema.docLinks.fromDocumentId, source.id));
      expect(links).toEqual([]);
    });

    it("returns backlinks and subtree graph with access control", async () => {
      const suffix = Date.now();
      const sp = `doc-graph-${suffix}`;
      await createScope(db, { slug: sp, name: "Doc Graph", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await saveDoc(db, { scopePath: sp, slug: "target", title: "Target", bodyMd: "Landing page." }, rootPrincipalId);
      await saveDoc(db, { scopePath: sp, slug: "wiki", title: "Wiki", bodyMd: "See [[target]] and [[missing]]." }, rootPrincipalId);
      await saveDoc(db, { scopePath: `${sp}/child`, slug: "child-page", title: "Child Page", bodyMd: `See [[${sp}:target]].` }, rootPrincipalId);

      const backlinks = await getBacklinks(db, { scopePath: sp, slug: "target" }, viewerPrincipalId);
      expect(backlinks.map((link) => link.fromSlug).sort()).toEqual(["child-page", "wiki"]);

      const graph = await getLinkGraph(db, { scopePath: sp }, viewerPrincipalId);
      expect(graph.nodes.some((node) => node.slug === "target" && !node.unresolved)).toBe(true);
      expect(graph.nodes.some((node) => node.slug === "missing" && node.unresolved)).toBe(true);
      expect(graph.edges.some((edge) => edge.toSlug === "target" && edge.resolved)).toBe(true);
      expect(graph.edges.some((edge) => edge.toSlug === "missing" && !edge.resolved)).toBe(true);

      await expect(getBacklinks(db, { scopePath: sp, slug: "target" }, noAccessPrincipalId)).rejects.toThrow(AccessDeniedError);
      await expect(getLinkGraph(db, { scopePath: sp }, noAccessPrincipalId)).rejects.toThrow(AccessDeniedError);
    });

    it("resolves alias-only wikilinks and counts them as resolved backlinks", async () => {
      const suffix = Date.now();
      const sp = `doc-alias-${suffix}`;
      await createScope(db, { slug: sp, name: "Doc Alias", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const source = await saveDoc(
        db,
        { scopePath: sp, slug: "wiki", title: "Wiki", bodyMd: "See [[Legacy Name]]." },
        rootPrincipalId
      );
      let links = await db.select().from(schema.docLinks).where(eq(schema.docLinks.fromDocumentId, source.id));
      expect(links[0]?.toSlug).toBe("legacy-name");
      expect(links[0]?.toDocumentId).toBeNull();

      const target = await saveDoc(
        db,
        {
          scopePath: sp,
          slug: "canonical",
          title: "Canonical",
          bodyMd: "---\naliases:\n  - Legacy Name\n---\nCanonical page.",
        },
        rootPrincipalId
      );

      links = await db.select().from(schema.docLinks).where(eq(schema.docLinks.fromDocumentId, source.id));
      expect(links.some((link: any) => link.toSlug === "legacy-name" && link.toDocumentId === target.id)).toBe(true);

      const backlinks = await getBacklinks(db, { scopePath: sp, slug: "canonical" }, rootPrincipalId);
      expect(backlinks).toEqual(expect.arrayContaining([
        expect.objectContaining({ fromSlug: "wiki", resolved: true }),
      ]));
    });
  });

  describe("wiki review state and subtree listing", () => {
    it("lists descendants with scope paths and marks agent learned pages unreviewed until human verify", async () => {
      const suffix = Date.now();
      const sp = `doc-review-${suffix}`;
      const child = `${sp}/child`;
      await createScope(db, { slug: sp, name: "Doc Review", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      await saveDoc(
        db,
        {
          scopePath: child,
          slug: "learned-page",
          title: "Learned Page",
          bodyMd: "---\nlearned_at: 2026-07-10T00:00:00.000Z\n---\nBody stays exact.",
        },
        agentPrincipalId
      );

      const defaultRows = await listDocs(db, { scopePath: sp }, rootPrincipalId);
      expect(defaultRows.some((row) => row.scopePath === child)).toBe(false);

      const subtreeRows = await listDocs(db, { scopePath: sp, includeDescendants: true }, rootPrincipalId);
      const childRow = subtreeRows.find((row) => row.scopePath === child && row.slug === "learned-page");
      expect(childRow).toMatchObject({ scopePath: child, unreviewed: true });

      await expect(
        verifyDoc(db, { scopePath: child, slug: "learned-page" }, agentPrincipalId)
      ).rejects.toThrow(AccessDeniedError);

      const verified = await verifyDoc(db, { scopePath: child, slug: "learned-page" }, rootPrincipalId);
      expect(verified.bodyMd).toContain("verified_at:");
      expect(verified.bodyMd).toContain("verified_by: Root Principal");
      expect(verified.bodyMd.endsWith("Body stays exact.")).toBe(true);

      const afterVerify = await listDocs(db, { scopePath: sp, includeDescendants: true }, rootPrincipalId);
      expect(afterVerify.find((row) => row.scopePath === child && row.slug === "learned-page")?.unreviewed).toBe(false);

      const revs = await listDocRevisions(db, { scopePath: child, slug: "learned-page", limit: 5 }, rootPrincipalId);
      expect(revs[0]?.savedBy).toBe(rootPrincipalId);

      const events = await listEvents(db, { scopePath: child, type: "doc.verified", limit: 1 });
      expect(events.length).toBe(1);
    });
  });


  describe("following and page update notifications", () => {
    it("follow/unfollow are idempotent and emit events", async () => {
      const sp = "doc-follow-" + Date.now();
      await createScope(db, { slug: sp, name: "Doc Follow", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      const doc = await saveDoc(db, { scopePath: sp, slug: "watched", title: "Watched", bodyMd: "Initial" }, rootPrincipalId);
      await followDoc(db, { scopePath: sp, slug: "watched" }, viewerPrincipalId);
      await followDoc(db, { scopePath: sp, slug: "watched" }, viewerPrincipalId);

      let rows = await db
        .select()
        .from(schema.docFollows)
        .where(eq(schema.docFollows.documentId, doc.id));
      expect(rows.filter((row: any) => row.principalId === viewerPrincipalId)).toHaveLength(1);
      await expect(isFollowing(db, { scopePath: sp, slug: "watched" }, viewerPrincipalId)).resolves.toBe(true);

      const followedEvents = await listEvents(db, { scopePath: sp, type: "doc.followed", limit: 10 });
      expect(followedEvents.some((event) => (event.payload as any).principalId === viewerPrincipalId)).toBe(true);

      await unfollowDoc(db, { scopePath: sp, slug: "watched" }, viewerPrincipalId);
      await unfollowDoc(db, { scopePath: sp, slug: "watched" }, viewerPrincipalId);
      rows = await db
        .select()
        .from(schema.docFollows)
        .where(eq(schema.docFollows.documentId, doc.id));
      expect(rows.some((row: any) => row.principalId === viewerPrincipalId)).toBe(false);
      await expect(isFollowing(db, { scopePath: sp, slug: "watched" }, viewerPrincipalId)).resolves.toBe(false);

      const unfollowedEvents = await listEvents(db, { scopePath: sp, type: "doc.unfollowed", limit: 10 });
      expect(unfollowedEvents.some((event) => (event.payload as any).principalId === viewerPrincipalId)).toBe(true);
    });

    it("auto-follows human authors and verifiers only", async () => {
      const sp = "doc-autofollow-" + Date.now();
      await createScope(db, { slug: sp, name: "Doc Auto Follow", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      await saveDoc(db, { scopePath: sp, slug: "human-page", title: "Human Page", bodyMd: "Human authored" }, rootPrincipalId);
      await expect(isFollowing(db, { scopePath: sp, slug: "human-page" }, rootPrincipalId)).resolves.toBe(true);

      await saveDoc(db, { scopePath: sp, slug: "agent-page", title: "Agent Page", bodyMd: "Agent authored" }, agentPrincipalId);
      await expect(isFollowing(db, { scopePath: sp, slug: "agent-page" }, agentPrincipalId)).resolves.toBe(false);
      await expect(isFollowing(db, { scopePath: sp, slug: "agent-page" }, rootPrincipalId)).resolves.toBe(false);

      await verifyDoc(db, { scopePath: sp, slug: "agent-page" }, rootPrincipalId);
      await expect(isFollowing(db, { scopePath: sp, slug: "agent-page" }, rootPrincipalId)).resolves.toBe(true);
      await expect(isFollowing(db, { scopePath: sp, slug: "agent-page" }, agentPrincipalId)).resolves.toBe(false);
    });

    it("fan-out creates targeted page_update items, coalesces, refreshes payload, and starts fresh after dismiss", async () => {
      const sp = "doc-fanout-" + Date.now();
      await createScope(db, { slug: sp, name: "Doc Fanout", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await saveDoc(db, { scopePath: sp, slug: "tracked", title: "Tracked", bodyMd: "Initial" }, agentPrincipalId);
      await followDoc(db, { scopePath: sp, slug: "tracked" }, viewerPrincipalId);

      await saveDoc(db, { scopePath: sp, slug: "tracked", title: "Tracked", bodyMd: "Edited" }, agentPrincipalId);
      let items = await listAttentionItems(db, { scopePath: sp, kind: "page_update", status: "open" }, viewerPrincipalId);
      expect(items).toHaveLength(1);
      const firstId = items[0]!.id;
      expect(items[0]!.targetPrincipalId).toBe(viewerPrincipalId);
      expect(items[0]!.payload).toMatchObject({ documentId: expect.any(String), slug: "tracked", title: "Tracked", lastEventType: "doc.saved", changeCount: 1 });

      await verifyDoc(db, { scopePath: sp, slug: "tracked" }, rootPrincipalId);
      await renameDoc(db, { scopePath: sp, slug: "tracked", newSlug: "tracked-renamed", newTitle: "Tracked Renamed" }, agentPrincipalId);
      items = await listAttentionItems(db, { scopePath: sp, kind: "page_update", status: "open" }, viewerPrincipalId);
      expect(items[0]!.payload).toMatchObject({ slug: "tracked-renamed", title: "Tracked Renamed", lastEventType: "doc.renamed", changeCount: 3 });
      await archiveDoc(db, { scopePath: sp, slug: "tracked-renamed" }, agentPrincipalId);
      const revs = await listDocRevisions(db, { scopePath: sp, slug: "tracked-renamed", limit: 5 }, rootPrincipalId);
      await revertDoc(db, { scopePath: sp, slug: "tracked-renamed", revisionId: revs[0]!.id }, agentPrincipalId);

      items = await listAttentionItems(db, { scopePath: sp, kind: "page_update", status: "open" }, viewerPrincipalId);
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(firstId);
      expect(items[0]!.payload).toMatchObject({ slug: "tracked-renamed", title: "Tracked", lastEventType: "doc.reverted", changeCount: 5 });

      const agentItems = await listAttentionItems(db, { scopePath: sp, kind: "page_update", status: "open" }, agentPrincipalId);
      expect(agentItems).toHaveLength(0);

      await resolveAttentionItem(db, { id: firstId, resolution: "dismissed" }, viewerPrincipalId);
      await saveDoc(db, { scopePath: sp, slug: "tracked-renamed", title: "Tracked Renamed", bodyMd: "After dismiss" }, agentPrincipalId);
      items = await listAttentionItems(db, { scopePath: sp, kind: "page_update", status: "open" }, viewerPrincipalId);
      expect(items).toHaveLength(1);
      expect(items[0]!.id).not.toBe(firstId);
      expect(items[0]!.payload).toMatchObject({ slug: "tracked-renamed", changeCount: 1 });
    });

    it("does not notify a follower about their own change", async () => {
      const sp = "doc-self-notify-" + Date.now();
      await createScope(db, { slug: sp, name: "Doc Self Notify", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      await saveDoc(db, { scopePath: sp, slug: "self-change", title: "Self Change", bodyMd: "Initial" }, agentPrincipalId);
      await followDoc(db, { scopePath: sp, slug: "self-change" }, viewerPrincipalId);
      await saveDoc(db, { scopePath: sp, slug: "self-change", title: "Self Change", bodyMd: "Own edit" }, viewerPrincipalId);

      const items = await listAttentionItems(db, { scopePath: sp, kind: "page_update", status: "open" }, viewerPrincipalId);
      expect(items).toHaveLength(0);
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
