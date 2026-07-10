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
  AttentionStateError,
  countOpenAttentionItems,
  createAttentionItem,
  createScope,
  getDoc,
  grantRole,
  listAttentionItems,
  listEvents,
  listRecords,
  resolveAttentionItem,
  saveDoc,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = "";
const candidates = [
  path.resolve(process.cwd(), "packages/db/drizzle"),
  path.resolve(__dirname, "../../../../packages/db/drizzle"),
  path.resolve(__dirname, "../../../../../packages/db/drizzle"),
  path.resolve("packages/db/drizzle"),
];
for (const c of candidates) {
  if (fs.existsSync(path.join(c, "meta", "_journal.json"))) {
    migrationsFolder = c;
    break;
  }
}
if (!migrationsFolder) migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");

describe("attention module (PGlite + migrations)", () => {
  let client: PGlite;
  let db: any;
  let adminPrincipalId: string;
  let editorPrincipalId: string;
  let viewerPrincipalId: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await client?.close?.();
  });

  beforeEach(async () => {
    const now = Date.now();
    const [admin] = await db.insert(schema.principals).values({ kind: "human", name: `Attention Admin ${now}` }).returning();
    const [editor] = await db.insert(schema.principals).values({ kind: "human", name: `Attention Editor ${now}` }).returning();
    const [viewer] = await db.insert(schema.principals).values({ kind: "human", name: `Attention Viewer ${now}` }).returning();
    adminPrincipalId = admin.id;
    editorPrincipalId = editor.id;
    viewerPrincipalId = viewer.id;

    const [root] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, "root")).limit(1);
    if (!root) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, adminPrincipalId);
    }
    await grantRole(db, { principalId: adminPrincipalId, scopePath: "root", role: "admin" }, adminPrincipalId);
  });

  async function createProject(name = "attention-project") {
    const slug = `${name}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await createScope(db, { slug, name: slug, type: "project" }, adminPrincipalId);
    await grantRole(db, { principalId: adminPrincipalId, scopePath: slug, role: "admin" }, adminPrincipalId);
    await grantRole(db, { principalId: editorPrincipalId, scopePath: slug, role: "editor" }, adminPrincipalId);
    await grantRole(db, { principalId: viewerPrincipalId, scopePath: slug, role: "viewer" }, adminPrincipalId);
    return slug;
  }

  it("creates, lists, and counts open attention items", async () => {
    const scopePath = await createProject();
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "external_gate",
      title: "Approve launch",
      summary: "Publish gate",
      payload: { gate: "launch" },
    }, editorPrincipalId);

    expect(item.status).toBe("open");
    expect(item.scopePath).toBe(scopePath);

    const scoped = await listAttentionItems(db, { scopePath, status: "open", limit: 10 }, viewerPrincipalId);
    expect(scoped.map((row) => row.id)).toContain(item.id);

    const aggregate = await listAttentionItems(db, { scopePath: "root", status: "open", includeDescendants: true }, adminPrincipalId);
    expect(aggregate.map((row) => row.id)).toContain(item.id);

    await expect(countOpenAttentionItems(db, { scopePath, includeDescendants: false }, viewerPrincipalId)).resolves.toBe(1);
  });

  it("approves a wiki proposal, applies the doc, writes decision record, and emits events", async () => {
    const scopePath = await createProject("attention-approve");
    await saveDoc(db, { scopePath, slug: "wiki", title: "Wiki", bodyMd: "Old body" }, adminPrincipalId);

    const item = await createAttentionItem(db, {
      scopePath,
      kind: "wiki_proposal",
      title: "Update wiki",
      summary: "Agent proposed a better wiki body",
      payload: { slug: "wiki", title: "Wiki", currentMd: "Old body", proposedMd: "New body\n\n[[next]]" },
    }, editorPrincipalId);

    const resolved = await resolveAttentionItem(db, { id: item.id, resolution: "approved", note: "Looks correct" }, adminPrincipalId);
    expect(resolved.status).toBe("approved");

    const doc = await getDoc(db, { scopePath, slug: "wiki" }, adminPrincipalId);
    expect(doc?.bodyMd).toBe("New body\n\n[[next]]");

    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions[0]?.title).toBe("Resolved: Update wiki");
    expect(decisions[0]?.bodyMd).toContain("[[wiki]]");

    const events = await listEvents(db, { scopePath, limit: 20 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["attention.created", "attention.resolved", "doc.saved", "record.created"]));
  });

  it("rejects a wiki proposal without changing the doc", async () => {
    const scopePath = await createProject("attention-reject");
    await saveDoc(db, { scopePath, slug: "wiki", title: "Wiki", bodyMd: "Keep this" }, adminPrincipalId);

    const item = await createAttentionItem(db, {
      scopePath,
      kind: "wiki_proposal",
      title: "Bad wiki edit",
      payload: { slug: "wiki", title: "Wiki", currentMd: "Keep this", proposedMd: "Replace this" },
    }, editorPrincipalId);

    await resolveAttentionItem(db, { id: item.id, resolution: "rejected", note: "Not accurate" }, adminPrincipalId);
    const doc = await getDoc(db, { scopePath, slug: "wiki" }, adminPrincipalId);
    expect(doc?.bodyMd).toBe("Keep this");
  });

  it("rejects double resolve and viewer resolve", async () => {
    const scopePath = await createProject("attention-guards");
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Contradiction",
      payload: { type: "contradiction", slugs: ["a", "b"] },
    }, editorPrincipalId);

    await expect(resolveAttentionItem(db, { id: item.id, resolution: "dismissed" }, viewerPrincipalId)).rejects.toBeInstanceOf(AccessDeniedError);
    await resolveAttentionItem(db, { id: item.id, resolution: "dismissed" }, adminPrincipalId);
    await expect(resolveAttentionItem(db, { id: item.id, resolution: "rejected" }, adminPrincipalId)).rejects.toBeInstanceOf(AttentionStateError);
  });
});
