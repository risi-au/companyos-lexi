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
  getAttentionItem,
  getDoc,
  grantRole,
  listAttentionItems,
  listEvents,
  listDocRevisions,
  listRecords,
  parseWikiQuestionPayload,
  resolveAttentionItem,
  resolveWikiQuestionAttentionItem,
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
  let agentPrincipalId: string;

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
    const [agent] = await db.insert(schema.principals).values({ kind: "agent", name: `Attention Agent ${now}` }).returning();
    adminPrincipalId = admin.id;
    editorPrincipalId = editor.id;
    viewerPrincipalId = viewer.id;
    agentPrincipalId = agent.id;

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
    await grantRole(db, { principalId: agentPrincipalId, scopePath: slug, role: "admin" }, adminPrincipalId);
    return slug;
  }

  function contradictionPayload(currentA = "# A\n\nLaunch status is live.", currentB = "# B\n\nLaunch status is draft.") {
    return {
      version: 2,
      type: "contradiction",
      relation: "exclusive-status",
      subject: { entity: "Launch", property: "status", timeframe: "current" },
      explanation: "The launch cannot be both live and draft.",
      claims: [
        { slug: "alpha", title: "Alpha", quote: "Launch status is live.", normalizedValue: "live" },
        { slug: "beta", title: "Beta", quote: "Launch status is draft.", normalizedValue: "draft" },
      ],
      choices: [
        { id: "first", label: "Keep live", repair: { slug: "beta", title: "Beta", currentMd: currentB, proposedMd: "# B\n\nLaunch status is live." } },
        { id: "second", label: "Keep draft", repair: { slug: "alpha", title: "Alpha", currentMd: currentA, proposedMd: "# A\n\nLaunch status is draft." } },
      ],
      scopePath: "filled-by-test",
    };
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
    await expect(getAttentionItem(db, { id: item.id }, viewerPrincipalId)).resolves.toMatchObject({ id: item.id });
    await expect(getAttentionItem(db, { id: "00000000-0000-0000-0000-000000000000" }, viewerPrincipalId)).resolves.toBeNull();

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
    await expect(getAttentionItem(db, { id: item.id }, ungranted.id)).resolves.toBeNull();
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
    expect(decisions[0]?.bodyMd).toContain("[[Wiki|wiki]]");
    expect(decisions[0]?.bodyMd).not.toContain(item.id);

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
  it("generic resolver blocks every lint finding and viewer resolve", async () => {
    const scopePath = await createProject("attention-guards");
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Contradiction",
      payload: { type: "contradiction", slugs: ["a", "b"] },
    }, editorPrincipalId);

    await expect(resolveAttentionItem(db, { id: item.id, resolution: "dismissed" }, viewerPrincipalId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(resolveAttentionItem(db, { id: item.id, resolution: "dismissed" }, adminPrincipalId)).rejects.toThrow("specific outcome action");
  });

  it("allows only a human administrator to resolve a wiki question", async () => {
    const scopePath = await createProject("attention-wiki-access");
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki question",
      payload: { type: "stale", slug: "page", title: "Page" },
    }, editorPrincipalId);

    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "close-unclear" } }, editorPrincipalId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "close-unclear" } }, viewerPrincipalId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "close-unclear" } }, agentPrincipalId)).rejects.toBeInstanceOf(AccessDeniedError);

    const resolved = await resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "close-unclear" } }, adminPrincipalId);
    expect(resolved.status).toBe("dismissed");
  });

  it("accepts only the exact current wiki question contract", () => {
    const payload = contradictionPayload();
    expect(parseWikiQuestionPayload(payload)).toMatchObject({ state: "v2-contradiction" });
    expect(parseWikiQuestionPayload({
      ...payload,
      choices: [payload.choices[0], { ...payload.choices[1], label: "" }],
    })).toMatchObject({ state: "legacy", type: "contradiction" });
    expect(parseWikiQuestionPayload({
      ...payload,
      choices: [...payload.choices, { id: "third" }],
    })).toMatchObject({ state: "legacy", type: "contradiction" });
    expect(parseWikiQuestionPayload({
      ...payload,
      choices: [payload.choices[0], { ...payload.choices[1], repair: { ...payload.choices[1]!.repair, slug: "beta" } }],
    })).toMatchObject({ state: "legacy", type: "contradiction" });
  });

  it("applies a selected wiki correction with revision, events, decision, and audit data together", async () => {
    const scopePath = await createProject("attention-wiki-choose");
    const alpha = "# A\n\nLaunch status is live.";
    const beta = "# B\n\nLaunch status is draft.";
    await saveDoc(db, { scopePath, slug: "alpha", title: "Alpha", bodyMd: alpha }, adminPrincipalId);
    await saveDoc(db, { scopePath, slug: "beta", title: "Beta", bodyMd: beta }, adminPrincipalId);
    const payload = { ...contradictionPayload(alpha, beta), scopePath };
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki lint: contradiction",
      payload,
    }, editorPrincipalId);

    const resolved = await resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "choose", choiceId: "first" } }, adminPrincipalId);

    expect(resolved.status).toBe("approved");
    const doc = await getDoc(db, { scopePath, slug: "beta" }, adminPrincipalId);
    expect(doc?.bodyMd).toBe("# B\n\nLaunch status is live.");
    const revisions = await listDocRevisions(db, { scopePath, slug: "beta", limit: 10 }, adminPrincipalId);
    expect(revisions[0]?.bodyMd).toBe("# B\n\nLaunch status is live.");
    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions[0]?.data?.wikiQuestion).toMatchObject({
      selectedChoiceId: "first",
      selectedLabel: "Keep live",
      selectedValue: "live",
      changedSlug: "beta",
    });
    expect(JSON.stringify(decisions[0]?.data)).toContain("beforeContentHash");
    expect(JSON.stringify(decisions[0]?.data)).toContain("afterContentHash");
    const primaryDecisionCopy = String(decisions[0]?.bodyMd ?? "").split("<!--")[0];
    expect(primaryDecisionCopy).toContain("Changed page: [[Beta|beta]]");
    expect(primaryDecisionCopy).not.toContain(item.id);
    expect(primaryDecisionCopy).not.toContain("Wiki lint");
    expect(primaryDecisionCopy).not.toContain("ContentHash");
    const events = await listEvents(db, { scopePath, limit: 20 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["doc.saved", "attention.resolved", "record.created"]));
    expect(events.some((event) => event.type === "attention.resolved" && (event.payload as any)?.wikiQuestion?.selectedChoiceId === "first")).toBe(true);
  });

  it("rolls back the selected repair when a later transaction step fails", async () => {
    const scopePath = await createProject("attention-wiki-rollback");
    const alpha = "# A\n\nLaunch status is live.";
    const beta = "# B\n\nLaunch status is draft.";
    await saveDoc(db, { scopePath, slug: "alpha", title: "Alpha", bodyMd: alpha }, adminPrincipalId);
    await saveDoc(db, { scopePath, slug: "beta", title: "Beta", bodyMd: beta }, adminPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki lint: contradiction",
      payload: { ...contradictionPayload(alpha, beta), scopePath },
    }, editorPrincipalId);
    const revisionsBefore = await listDocRevisions(db, { scopePath, slug: "beta", limit: 10 }, adminPrincipalId);
    const eventsBefore = await listEvents(db, { scopePath, limit: 100 });

    await expect(resolveWikiQuestionAttentionItem(db, {
      id: item.id,
      action: { type: "choose", choiceId: "first" },
    }, adminPrincipalId, { failAfterDocWrite: true })).rejects.toThrow("Injected wiki question transaction failure");

    const doc = await getDoc(db, { scopePath, slug: "beta" }, adminPrincipalId);
    expect(doc?.bodyMd).toBe(beta);
    const [open] = await db.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, item.id)).limit(1);
    expect(open.status).toBe("open");
    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions.some((record: any) => record.data?.attentionItemId === item.id)).toBe(false);
    const revisionsAfter = await listDocRevisions(db, { scopePath, slug: "beta", limit: 10 }, adminPrincipalId);
    const eventsAfter = await listEvents(db, { scopePath, limit: 100 });
    expect(revisionsAfter).toHaveLength(revisionsBefore.length);
    expect(eventsAfter).toHaveLength(eventsBefore.length);
  });

  it("keeps a concurrent wiki correction open and changes nothing", async () => {
    const scopePath = await createProject("attention-wiki-stale-body");
    const alpha = "# A\n\nLaunch status is live.";
    const beta = "# B\n\nLaunch status is draft.";
    await saveDoc(db, { scopePath, slug: "alpha", title: "Alpha", bodyMd: alpha }, adminPrincipalId);
    await saveDoc(db, { scopePath, slug: "beta", title: "Beta", bodyMd: beta }, adminPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki lint: contradiction",
      payload: { ...contradictionPayload(alpha, beta), scopePath },
    }, editorPrincipalId);
    await saveDoc(db, { scopePath, slug: "beta", title: "Beta", bodyMd: "# B\n\nLaunch status is paused." }, adminPrincipalId);

    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "choose", choiceId: "first" } }, adminPrincipalId)).rejects.toThrow(/changed|latest/);
    const [open] = await db.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, item.id)).limit(1);
    expect(open.status).toBe("open");
    const doc = await getDoc(db, { scopePath, slug: "beta" }, adminPrincipalId);
    expect(doc?.bodyMd).toBe("# B\n\nLaunch status is paused.");
  });

  it("marks a contradiction as not a conflict without changing pages", async () => {
    const scopePath = await createProject("attention-wiki-not-conflict");
    const alpha = "# A\n\nLaunch status is live.";
    const beta = "# B\n\nLaunch status is draft.";
    await saveDoc(db, { scopePath, slug: "alpha", title: "Alpha", bodyMd: alpha }, adminPrincipalId);
    await saveDoc(db, { scopePath, slug: "beta", title: "Beta", bodyMd: beta }, adminPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki lint: contradiction",
      payload: { ...contradictionPayload(alpha, beta), scopePath },
    }, editorPrincipalId);

    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "not-a-conflict" } }, adminPrincipalId)).rejects.toThrow("Briefly explain");
    const resolved = await resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "not-a-conflict", note: "Different contexts." } }, adminPrincipalId);
    expect(resolved.status).toBe("dismissed");
    await expect(getDoc(db, { scopePath, slug: "alpha" }, adminPrincipalId)).resolves.toMatchObject({ bodyMd: alpha });
    await expect(getDoc(db, { scopePath, slug: "beta" }, adminPrincipalId)).resolves.toMatchObject({ bodyMd: beta });
    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions[0]?.data?.wikiQuestion).toMatchObject({ action: "not-a-conflict", changedSlug: null });
  });

  it("marks a stale wiki page current with a future next review date and rejects past dates", async () => {
    const scopePath = await createProject("attention-wiki-stale");
    const body = "---\nstale_after: 2026-01-01T00:00:00.000Z\n---\n# Page\n\nStill accurate.";
    await saveDoc(db, { scopePath, slug: "page", title: "Page", bodyMd: body }, adminPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki lint: stale",
      payload: { version: 2, type: "stale", slug: "page", title: "Page", currentMd: body, reviewDueAt: "2026-01-01T00:00:00.000Z" },
    }, editorPrincipalId);
    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "mark-current", nextReviewAt: "2020-01-01" } }, adminPrincipalId)).rejects.toThrow("future");

    const resolved = await resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "mark-current", nextReviewAt: "2099-01-01" } }, adminPrincipalId);
    expect(resolved.status).toBe("approved");
    const doc = await getDoc(db, { scopePath, slug: "page" }, adminPrincipalId);
    expect(doc?.bodyMd).toContain("verified_at:");
    expect(doc?.bodyMd).toContain("verified_by:");
    expect(doc?.bodyMd).toContain("stale_after: 2099-01-01T23:59:59.999Z");
    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions[0]?.data?.wikiQuestion).toMatchObject({ action: "mark-current", changedSlug: "page" });
  });

  it("rolls back a stale-page review and its audit trail together", async () => {
    const scopePath = await createProject("attention-wiki-stale-rollback");
    const body = "---\nstale_after: 2026-01-01T00:00:00.000Z\n---\n# Page\n\nStill accurate.";
    await saveDoc(db, { scopePath, slug: "page", title: "Page", bodyMd: body }, adminPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki lint: stale",
      payload: { version: 2, type: "stale", slug: "page", title: "Page", currentMd: body, reviewDueAt: "2026-01-01T00:00:00.000Z" },
    }, editorPrincipalId);
    const revisionsBefore = await listDocRevisions(db, { scopePath, slug: "page", limit: 10 }, adminPrincipalId);
    const eventsBefore = await listEvents(db, { scopePath, limit: 100 });

    await expect(resolveWikiQuestionAttentionItem(db, {
      id: item.id,
      action: { type: "mark-current", nextReviewAt: "2099-01-01" },
    }, adminPrincipalId, { failAfterDocWrite: true })).rejects.toThrow("Injected wiki question transaction failure");

    await expect(getDoc(db, { scopePath, slug: "page" }, adminPrincipalId)).resolves.toMatchObject({ bodyMd: body });
    const [open] = await db.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, item.id)).limit(1);
    expect(open.status).toBe("open");
    expect(await listDocRevisions(db, { scopePath, slug: "page", limit: 10 }, adminPrincipalId)).toHaveLength(revisionsBefore.length);
    expect(await listEvents(db, { scopePath, limit: 100 })).toHaveLength(eventsBefore.length);
    const decisions = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, adminPrincipalId);
    expect(decisions.some((record: any) => record.data?.attentionItemId === item.id)).toBe(false);
  });

  it("lets legacy wiki findings close only as unclear and denies viewers", async () => {
    const scopePath = await createProject("attention-wiki-legacy");
    const item = await createAttentionItem(db, {
      scopePath,
      kind: "lint_finding",
      title: "Wiki lint: stale",
      payload: { type: "stale", slug: "page", title: "Page" },
    }, editorPrincipalId);

    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "mark-current", nextReviewAt: "2099-01-01" } }, adminPrincipalId)).rejects.toThrow("current out-of-date");
    await expect(resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "close-unclear" } }, viewerPrincipalId)).rejects.toBeInstanceOf(AccessDeniedError);
    const resolved = await resolveWikiQuestionAttentionItem(db, { id: item.id, action: { type: "close-unclear" } }, adminPrincipalId);
    expect(resolved.status).toBe("dismissed");
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
