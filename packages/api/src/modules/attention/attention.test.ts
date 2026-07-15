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
  createSystemAttentionItem,
  createScope,
  dismissAttentionItemsInternal,
  ensurePersonalScope,
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

  it("internal helpers create and dismiss items without grants while emitting events", async () => {
    const scopePath = await createProject("attention-internal");
    const [scope] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, scopePath)).limit(1);
    const [ungranted] = await db.insert(schema.principals).values({ kind: "agent", name: `Ungrant ${Date.now()}` }).returning();

    const item = await createSystemAttentionItem(db, {
      scopeId: scope.id,
      kind: "connection_expiry",
      title: "Worker token expires soon",
      summary: "Expires on 2026-07-20T00:00:00.000Z.",
      payload: { tokenId: "token-internal-1", name: "Worker", scopePath, state: "expiring", expiresAt: "2026-07-20T00:00:00.000Z" },
      createdBy: ungranted.id,
    });

    expect(item.status).toBe("open");
    expect(item.createdBy).toBe(ungranted.id);
    const createdEvents = await listEvents(db, { scopePath, type: "attention.created", limit: 10 });
    expect(createdEvents.some((event: any) => event.payload?.attentionItemId === item.id)).toBe(true);

    await expect(dismissAttentionItemsInternal(db, {
      kind: "connection_expiry",
      payloadTokenId: "token-internal-1",
      note: "token revoked",
    })).resolves.toBe(1);

    const [dismissed] = await db.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, item.id)).limit(1);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.resolvedBy).toBe(ungranted.id);
    expect(dismissed.resolutionNote).toBe("token revoked");

    const resolvedEvents = await listEvents(db, { scopePath, type: "attention.resolved", limit: 10 });
    expect(resolvedEvents.some((event: any) => event.payload?.attentionItemId === item.id)).toBe(true);
    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions.some((record: any) => record.data?.attentionItemId === item.id)).toBe(false);
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

  it("approves graduation proposals through the embedded target wiki proposal and rejects without applying", async () => {
    const scopePath = await createProject("attention-graduation");
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "graduation",
      title: "Graduate personal launch note",
      payload: {
        direction: "personal-to-scope",
        fromScopePath: "personal-source",
        fromSlug: "launch-note",
        proposal: { slug: "launch-note", title: "Launch Note", proposedMd: "Graduated launch truth." },
      },
    }, editorPrincipalId);

    await resolveAttentionItem(db, { id: item.id, resolution: "approved" }, adminPrincipalId);
    const doc = await getDoc(db, { scopePath, slug: "launch-note" }, adminPrincipalId);
    expect(doc?.bodyMd).toBe("Graduated launch truth.");

    const personal = await ensurePersonalScope(db, adminPrincipalId);
    const rejected = await createAttentionItem(db, {
      scopePath: personal.scopePath,
      kind: "graduation",
      title: "Move scope note to personal wiki",
      payload: {
        direction: "scope-to-personal",
        fromScopePath: scopePath,
        fromSlug: "working-style",
        proposal: { slug: "working-style", title: "Working Style", proposedMd: "Person-specific working style." },
      },
    }, adminPrincipalId);

    await resolveAttentionItem(db, { id: rejected.id, resolution: "rejected" }, adminPrincipalId);
    await expect(getDoc(db, { scopePath: personal.scopePath, slug: "working-style" }, adminPrincipalId)).resolves.toBeNull();
  });


  it("filters targeted page_update items to the viewing principal in list and count", async () => {
    const scopePath = await createProject("attention-targeted");
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "page_update",
      targetPrincipalId: viewerPrincipalId,
      title: "Overview changed",
      payload: { documentId: "doc-1", slug: "overview", title: "Overview", changeCount: 1 },
    }, editorPrincipalId);

    const viewerItems = await listAttentionItems(db, { scopePath, kind: "page_update", status: "open" }, viewerPrincipalId);
    expect(viewerItems.map((row) => row.id)).toEqual([item.id]);
    await expect(countOpenAttentionItems(db, { scopePath }, viewerPrincipalId)).resolves.toBe(1);

    const editorItems = await listAttentionItems(db, { scopePath, kind: "page_update", status: "open" }, editorPrincipalId);
    expect(editorItems).toHaveLength(0);
    await expect(countOpenAttentionItems(db, { scopePath }, editorPrincipalId)).resolves.toBe(0);
  });

  it("page_update items reject approve/reject and resolve as dismissed by the target viewer", async () => {
    const scopePath = await createProject("attention-page-update");
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "page_update",
      targetPrincipalId: viewerPrincipalId,
      title: "Wiki changed",
      payload: { documentId: "doc-2", slug: "wiki", title: "Wiki", changeCount: 1 },
    }, editorPrincipalId);

    await expect(resolveAttentionItem(db, { id: item.id, resolution: "approved" }, viewerPrincipalId)).rejects.toThrow(AttentionStateError);
    await expect(resolveAttentionItem(db, { id: item.id, resolution: "rejected" }, viewerPrincipalId)).rejects.toThrow(AttentionStateError);
    await expect(resolveAttentionItem(db, { id: item.id, resolution: "dismissed" }, editorPrincipalId)).rejects.toThrow();

    const resolved = await resolveAttentionItem(db, { id: item.id, resolution: "dismissed" }, viewerPrincipalId);
    expect(resolved.status).toBe("dismissed");
    const open = await listAttentionItems(db, { scopePath, kind: "page_update", status: "open" }, viewerPrincipalId);
    expect(open).toHaveLength(0);
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

  it("validates open questions and requires an answer when approving", async () => {
    const scopePath = await createProject("attention-open-question");
    const payload = {
      question: "Which launch date is approved?",
      tag: "decision",
      source: "intake",
      intakeId: "intake-open-question-1",
      ordinal: 0,
    };

    await expect(createAttentionItem(db, {
      scopePath,
      kind: "open_question",
      title: "Invalid question",
      payload: { ...payload, question: "   " },
    }, editorPrincipalId)).rejects.toThrow("requires question");

    const item = await createAttentionItem(db, {
      scopePath,
      kind: "open_question",
      title: "Which launch date is approved?",
      payload: { ...payload, tag: "unexpected" },
    }, editorPrincipalId);
    expect(item.payload).toMatchObject({ question: payload.question, tag: null, ordinal: 0 });

    await expect(resolveAttentionItem(db, { id: item.id, resolution: "approved" }, adminPrincipalId))
      .rejects.toThrow("open_question approval requires a resolution note containing the answer");
    const resolved = await resolveAttentionItem(db, {
      id: item.id,
      resolution: "approved",
      note: "Launch on 2026-08-01.",
    }, adminPrincipalId);
    expect(resolved.status).toBe("approved");

    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions[0]?.bodyMd).toContain("Question: Which launch date is approved?");
    expect(decisions[0]?.bodyMd).toContain("Answer: Launch on 2026-08-01.");

    const rejected = await createAttentionItem(db, {
      scopePath,
      kind: "open_question",
      title: "Rejectable question",
      payload: { ...payload, question: "Rejectable question", ordinal: 1 },
    }, editorPrincipalId);
    await expect(resolveAttentionItem(db, { id: rejected.id, resolution: "rejected" }, adminPrincipalId)).resolves.toMatchObject({ status: "rejected" });

    const dismissed = await createAttentionItem(db, {
      scopePath,
      kind: "open_question",
      title: "Dismissable question",
      payload: { ...payload, question: "Dismissable question", ordinal: 2 },
    }, editorPrincipalId);
    await expect(resolveAttentionItem(db, { id: dismissed.id, resolution: "dismissed" }, adminPrincipalId)).resolves.toMatchObject({ status: "dismissed" });
  });
});
