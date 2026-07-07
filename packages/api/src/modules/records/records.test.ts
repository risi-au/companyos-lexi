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
  createRecord,
  createSystemRecord,
  getRecord,
  listRecords,
  updateRecord,
  listEvents,
} from "../../index";
import {
  AccessDeniedError,
  RecordNotFoundError,
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
console.log("[records.test] using migrationsFolder:", migrationsFolder);

describe("records module (PGlite + migrations)", () => {
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

  it("migrations apply and records table + indexes exist", async () => {
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(expect.arrayContaining(["records", "scopes", "principals", "grants", "events"]));

    // check enum
    const enumsRes: any = await db.execute("SELECT typname FROM pg_type WHERE typname = 'record_kind'");
    const enumRows = Array.isArray(enumsRes?.rows) ? enumsRes.rows : [];
    expect(enumRows.length).toBeGreaterThan(0);
  });

  describe("createRecord", () => {
    it("creates with required fields and emits record.created", async () => {
      const sp = "rec-create-" + Date.now();
      await createScope(db, { slug: sp, name: "RecC", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const rec = await createRecord(
        db,
        { scopePath: sp, kind: "note", title: "First Note", bodyMd: "Hello **world**" },
        rootPrincipalId
      );
      expect(rec.id).toBeTruthy();
      expect(rec.scopeId).toBeTruthy();
      expect(rec.kind).toBe("note");
      expect(rec.title).toBe("First Note");
      expect(rec.bodyMd).toBe("Hello **world**");
      expect(rec.data).toEqual({});
      expect(rec.authorId).toBe(rootPrincipalId);

      const evs = await listEvents(db, { scopePath: sp, type: "record.created", limit: 5 });
      expect(evs.length).toBeGreaterThan(0);
      expect((evs[0] as any)?.payload).toMatchObject({ kind: "note", title: "First Note" });
    });

    it("agent with agent grant can create inside subtree", async () => {
      const sp = "rec-agent-" + Date.now();
      await createScope(db, { slug: sp, name: "RecA", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "sub", name: "Sub", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      const rec = await createRecord(
        db,
        { scopePath: `${sp}/sub`, kind: "changelog", title: "Agent Log" },
        agentPrincipalId
      );
      expect(rec.kind).toBe("changelog");
      expect(rec.authorId).toBe(agentPrincipalId);
    });

    it("agent cannot create outside grant scope", async () => {
      const sp = "rec-agent-out-" + Date.now();
      const other = "other-" + Date.now();
      await createScope(db, { slug: sp, name: "RecA", type: "project" }, rootPrincipalId);
      await createScope(db, { slug: other, name: "Other", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: sp, role: "agent" }, rootPrincipalId);

      await expect(
        createRecord(db, { scopePath: other, kind: "note", title: "Bad" }, agentPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("viewer cannot write (create)", async () => {
      const sp = "rec-viewer-write-" + Date.now();
      await createScope(db, { slug: sp, name: "V", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await expect(
        createRecord(db, { scopePath: sp, kind: "decision", title: "V" }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("no grant denies create", async () => {
      const sp = "rec-no-" + Date.now();
      await createScope(db, { slug: sp, name: "No", type: "project" }, rootPrincipalId);

      await expect(
        createRecord(db, { scopePath: sp, kind: "report", title: "X" }, noAccessPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("system writer creates without grants and emits the standard record.created event", async () => {
      const sp = "rec-system-" + Date.now();
      await createScope(db, { slug: sp, name: "System", type: "project" }, rootPrincipalId);

      const rec = await createSystemRecord(
        db,
        { scopePath: sp, kind: "changelog", title: "Webhook stub", bodyMd: "Detected upstream activity.", data: { source: "github" } },
        noAccessPrincipalId
      );

      expect(rec.authorId).toBe(noAccessPrincipalId);
      expect(rec.data).toEqual({ source: "github" });
      const evs = await listEvents(db, { scopePath: sp, type: "record.created", limit: 5 });
      expect(evs[0]?.principalId).toBe(noAccessPrincipalId);
      expect((evs[0] as any)?.payload).toEqual({ kind: "changelog", title: "Webhook stub", recordId: rec.id });
    });
  });

  describe("getRecord and listRecords", () => {
    it("viewer can read, list filters and orders newest first", async () => {
      const sp = "rec-list-" + Date.now();
      await createScope(db, { slug: sp, name: "L", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      const r1 = await createRecord(db, { scopePath: sp, kind: "note", title: "A" }, rootPrincipalId);
      // slight delay to ensure order
      await new Promise((r) => setTimeout(r, 5));
      await createRecord(db, { scopePath: sp, kind: "decision", title: "B" }, rootPrincipalId);

      const got = await getRecord(db, r1.id, viewerPrincipalId);
      expect(got?.id).toBe(r1.id);
      expect(got?.title).toBe("A");

      const all = await listRecords(db, { scopePath: sp, limit: 10 }, viewerPrincipalId);
      expect(all.length).toBe(2);
      expect(all[0]!.title).toBe("B"); // newest first
      expect(all[1]!.title).toBe("A");

      const filtered = await listRecords(db, { scopePath: sp, kind: "note", limit: 5 }, viewerPrincipalId);
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.kind).toBe("note");
    });

    it("list respects since and max limit clamp", async () => {
      const sp = "rec-since-" + Date.now();
      await createScope(db, { slug: sp, name: "S", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const old = await createRecord(db, { scopePath: sp, kind: "changelog", title: "Old" }, rootPrincipalId);
      await new Promise((r) => setTimeout(r, 10));
      await createRecord(db, { scopePath: sp, kind: "changelog", title: "New" }, rootPrincipalId);

      const recent = await listRecords(db, { scopePath: sp, since: old.createdAt, limit: 10 }, rootPrincipalId);
      expect(recent.length).toBe(2);

      const limited = await listRecords(db, { scopePath: sp, limit: 1 }, rootPrincipalId);
      expect(limited.length).toBe(1);

      const clamped = await listRecords(db, { scopePath: sp, limit: 999 }, rootPrincipalId);
      expect(clamped.length).toBeLessThanOrEqual(200);
    });

    it("list can roll up descendant records with filters, limit, ordering, and scopePath", async () => {
      const sp = "rec-rollup-" + Date.now();
      const sibling = "rec-rollup-sibling-" + Date.now();
      await createScope(db, { slug: sp, name: "Rollup", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "alpha", name: "Alpha", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "beta", name: "Beta", type: "subproject" }, rootPrincipalId);
      await createScope(db, { slug: sibling, name: "Sibling", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sibling, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      await createRecord(db, { scopePath: `${sp}/alpha`, kind: "note", title: "Old alpha note" }, rootPrincipalId);
      await new Promise((r) => setTimeout(r, 10));
      const cutoff = new Date();
      await new Promise((r) => setTimeout(r, 10));
      await createRecord(db, { scopePath: `${sp}/beta`, kind: "decision", title: "Recent beta decision" }, rootPrincipalId);
      await new Promise((r) => setTimeout(r, 10));
      await createRecord(db, { scopePath: `${sp}/alpha`, kind: "note", title: "Recent alpha note" }, rootPrincipalId);
      await createRecord(db, { scopePath: sibling, kind: "note", title: "Sibling note" }, rootPrincipalId);

      const exact = await listRecords(db, { scopePath: sp, limit: 10 }, viewerPrincipalId);
      expect(exact).toEqual([]);

      const rolledUp = await listRecords(db, { scopePath: sp, includeDescendants: true, limit: 10 }, viewerPrincipalId);
      expect(rolledUp.map((r) => r.title)).toEqual([
        "Recent alpha note",
        "Recent beta decision",
        "Old alpha note",
      ]);
      expect(rolledUp.map((r) => r.scopePath)).toEqual([
        `${sp}/alpha`,
        `${sp}/beta`,
        `${sp}/alpha`,
      ]);
      expect(rolledUp.some((r) => r.title === "Sibling note")).toBe(false);

      const filtered = await listRecords(
        db,
        { scopePath: sp, includeDescendants: true, kind: "note", since: cutoff, limit: 1 },
        viewerPrincipalId
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.title).toBe("Recent alpha note");
      expect(filtered[0]!.kind).toBe("note");
    });

    it("rollup access is checked on the requested ancestor only", async () => {
      const sp = "rec-rollup-auth-" + Date.now();
      await createScope(db, { slug: sp, name: "Rollup Auth", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: sp, slug: "leaf", name: "Leaf", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: `${sp}/leaf`, role: "viewer" }, rootPrincipalId);
      await createRecord(db, { scopePath: `${sp}/leaf`, kind: "note", title: "Leaf note" }, rootPrincipalId);

      await expect(
        listRecords(db, { scopePath: sp, includeDescendants: true }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);

      const leaf = await listRecords(db, { scopePath: `${sp}/leaf` }, viewerPrincipalId);
      expect(leaf.length).toBe(1);
      expect(leaf[0]!.title).toBe("Leaf note");
    });

    it("unauthorized cannot get or list", async () => {
      const sp = "rec-auth-" + Date.now();
      await createScope(db, { slug: sp, name: "Auth", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      const rec = await createRecord(db, { scopePath: sp, kind: "note", title: "Secret" }, rootPrincipalId);

      await expect(getRecord(db, rec.id, noAccessPrincipalId)).rejects.toThrow(AccessDeniedError);
      await expect(listRecords(db, { scopePath: sp }, noAccessPrincipalId)).rejects.toThrow(AccessDeniedError);
    });

    it("get non-existent returns null (no throw)", async () => {
      const miss = await getRecord(db, "00000000-0000-0000-0000-000000000000", rootPrincipalId);
      expect(miss).toBeNull();
    });
  });

  describe("updateRecord", () => {
    it("updates partial fields, bumps updated_at, emits record.updated", async () => {
      const sp = "rec-upd-" + Date.now();
      await createScope(db, { slug: sp, name: "U", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const rec = await createRecord(db, { scopePath: sp, kind: "report", title: "Orig", bodyMd: "orig" }, rootPrincipalId);
      const beforeUpd = rec.updatedAt.getTime();

      await new Promise((r) => setTimeout(r, 5));
      const updated = await updateRecord(
        db,
        rec.id,
        { title: "Updated", data: { foo: "bar" } },
        rootPrincipalId
      );

      expect(updated.title).toBe("Updated");
      expect(updated.bodyMd).toBe("orig");
      expect(updated.data).toEqual({ foo: "bar" });
      expect(updated.updatedAt.getTime()).toBeGreaterThan(beforeUpd);

      const evs = await listEvents(db, { type: "record.updated", limit: 5 });
      expect(evs.some((e: any) => (e.payload as any)?.recordId === rec.id)).toBe(true);
    });

    it("viewer cannot update", async () => {
      const sp = "rec-upd-view-" + Date.now();
      await createScope(db, { slug: sp, name: "UV", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);
      const rec = await createRecord(db, { scopePath: sp, kind: "note", title: "V" }, rootPrincipalId);

      await expect(
        updateRecord(db, rec.id, { title: "no" }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("update non-existent throws RecordNotFoundError", async () => {
      await expect(
        updateRecord(db, "00000000-0000-0000-0000-000000000000", { title: "x" }, rootPrincipalId)
      ).rejects.toThrow(RecordNotFoundError);
    });
  });

  describe("events for all mutations", () => {
    it("create + update emit distinct events", async () => {
      const sp = "rec-ev-" + Date.now();
      await createScope(db, { slug: sp, name: "EV", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const rec = await createRecord(db, { scopePath: sp, kind: "decision", title: "E1" }, rootPrincipalId);
      await updateRecord(db, rec.id, { bodyMd: "changed" }, rootPrincipalId);

      const allEv = await listEvents(db, { scopePath: sp, limit: 10 });
      const created = allEv.some((e: any) => e.type === "record.created");
      const updated = allEv.some((e: any) => e.type === "record.updated");
      expect(created).toBe(true);
      expect(updated).toBe(true);
    });
  });

  it("agent can list/create in subtree, denied outside (full flow)", async () => {
    const rootP = "rec-agent-full-" + Date.now();
    await createScope(db, { slug: rootP, name: "AF", type: "project" }, rootPrincipalId);
    await createScope(db, { parentPath: rootP, slug: "team", name: "Team", type: "subproject" }, rootPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath: rootP, role: "agent" }, rootPrincipalId);

    const inside = await createRecord(db, { scopePath: `${rootP}/team`, kind: "changelog", title: "In" }, agentPrincipalId);
    expect(inside).toBeTruthy();

    const listed = await listRecords(db, { scopePath: `${rootP}/team` }, agentPrincipalId);
    expect(listed.length).toBeGreaterThan(0);

    const sib = "rec-sib-" + Date.now();
    await createScope(db, { slug: sib, name: "Sib", type: "project" }, rootPrincipalId);
    await expect(
      createRecord(db, { scopePath: sib, kind: "note", title: "Out" }, agentPrincipalId)
    ).rejects.toThrow(AccessDeniedError);
  });
});
