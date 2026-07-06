/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;

import {
  AccessDeniedError,
  createScope,
  getScope,
  grantRole,
  listConnectionTokens,
  listEvents,
  mintConnectionToken,
  resolveAccess,
  revokeConnectionToken,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

function stringifyForAudit(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) =>
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
  );
}

describe("connect module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;
  let adminId: string;
  let editorId: string;
  let otherEditorId: string;
  let viewerId: string;
  let scopePath: string;
  let childPath: string;
  let otherScopePath: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    if (!await getScope(db, "root")) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, null);
    }
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") {
      await client.close();
    }
  });

  async function principal(name: string, kind: "human" | "agent" = "human") {
    const [row] = await db
      .insert(schema.principals)
      .values({ kind, name: `${name} ${Date.now()} ${Math.random()}`, status: "active" })
      .returning();
    return row.id as string;
  }

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    rootPrincipalId = await principal("Root Admin");
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);

    scopePath = `connect-${suffix}`;
    childPath = `${scopePath}/child`;
    otherScopePath = `other-connect-${suffix}`;
    await createScope(db, { slug: scopePath, name: "Connect", type: "project" }, rootPrincipalId);
    await createScope(db, { parentPath: scopePath, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
    await createScope(db, { slug: otherScopePath, name: "Other Connect", type: "project" }, rootPrincipalId);

    adminId = await principal("Admin");
    editorId = await principal("Editor");
    otherEditorId = await principal("Other Editor");
    viewerId = await principal("Viewer");

    await grantRole(db, { principalId: adminId, scopePath, role: "admin" }, rootPrincipalId);
    await grantRole(db, { principalId: editorId, scopePath, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: otherEditorId, scopePath, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerId, scopePath, role: "viewer" }, rootPrincipalId);
  });

  it("rejects escalation and out-of-subtree mints", async () => {
    await expect(mintConnectionToken(db, {
      scopePath,
      name: "Viewer attempt",
      role: "viewer",
    }, viewerId)).rejects.toThrow(AccessDeniedError);

    await expect(mintConnectionToken(db, {
      scopePath,
      name: "Editor admin attempt",
      role: "admin" as any,
    }, editorId)).rejects.toThrow(/agent or viewer/);

    await expect(mintConnectionToken(db, {
      scopePath: otherScopePath,
      name: "Outside attempt",
      role: "viewer",
    }, editorId)).rejects.toThrow(AccessDeniedError);
  });

  it("mints dedicated agent principals, grants only target scope, writes connection row, and emits redacted events", async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const result = await mintConnectionToken(db, {
      scopePath,
      name: "Workbench MCP",
      role: "agent",
      expiresAt,
    }, editorId);

    expect(result.token).toMatch(/^cos_/);
    expect(result.storeNow).toBe(true);
    expect(result.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(await resolveAccess(db, result.principalId, scopePath)).toBe("agent");
    expect(await resolveAccess(db, result.principalId, otherScopePath)).toBeNull();

    const [principalRow] = await db
      .select()
      .from(schema.principals)
      .where(eq(schema.principals.id, result.principalId))
      .limit(1);
    expect(principalRow).toMatchObject({ kind: "agent", name: "Workbench MCP" });

    const [connectionRow] = await db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.tokenId, result.tokenId))
      .limit(1);
    expect(connectionRow).toBeTruthy();
    expect(connectionRow.mintedBy).toBe(editorId);

    const tokenRows = await db.select().from(schema.tokens).where(eq(schema.tokens.id, result.tokenId));
    expect(JSON.stringify(tokenRows)).not.toContain(result.token);
    expect(tokenRows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const events = await listEvents(db, { scopePath, limit: 20 });
    const minted = events.find((event: any) => event.type === "connection.minted");
    expect(minted?.principalId).toBe(editorId);
    expect(minted?.payload).toMatchObject({
      scopePath,
      role: "agent",
      tokenId: result.tokenId,
      name: "Workbench MCP",
      expiresAt: expiresAt.toISOString(),
    });
    expect(stringifyForAudit(events)).not.toContain(result.token);
  });

  it("lists exactly the requested visible scope and inherited subtrees", async () => {
    const own = await mintConnectionToken(db, { scopePath, name: "Client token", role: "viewer" }, editorId);
    const child = await mintConnectionToken(db, { scopePath: childPath, name: "Child token", role: "viewer" }, editorId);
    await mintConnectionToken(db, { scopePath: otherScopePath, name: "Other token", role: "viewer" }, rootPrincipalId);

    const parentList = await listConnectionTokens(db, { scopePath }, editorId);
    expect(parentList.map((row) => row.tokenId)).toEqual([own.tokenId]);
    expect(parentList[0]).toMatchObject({
      name: "Client token",
      role: "viewer",
      mintedBy: editorId,
      canRevoke: true,
      revoked: false,
    });

    const childList = await listConnectionTokens(db, { scopePath: childPath }, editorId);
    expect(childList.map((row) => row.tokenId)).toEqual([child.tokenId]);

    await expect(listConnectionTokens(db, { scopePath: otherScopePath }, editorId)).rejects.toThrow(AccessDeniedError);
  });

  it("enforces revoke matrix and emits connection.revoked", async () => {
    const own = await mintConnectionToken(db, { scopePath, name: "Own token", role: "viewer" }, editorId);
    const others = await mintConnectionToken(db, { scopePath, name: "Others token", role: "viewer" }, otherEditorId);
    const adminMinted = await mintConnectionToken(db, { scopePath, name: "Admin token", role: "agent" }, adminId);

    await expect(revokeConnectionToken(db, { tokenId: others.tokenId }, editorId)).rejects.toThrow(AccessDeniedError);
    await expect(revokeConnectionToken(db, { tokenId: own.tokenId }, viewerId)).rejects.toThrow(AccessDeniedError);

    await revokeConnectionToken(db, { tokenId: own.tokenId }, editorId);
    await revokeConnectionToken(db, { tokenId: others.tokenId }, adminId);
    await revokeConnectionToken(db, { tokenId: adminMinted.tokenId }, adminId);

    const rows = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.principalId, adminMinted.principalId));
    expect(rows[0].revokedAt).toBeInstanceOf(Date);

    const revokedEvents = await listEvents(db, { scopePath, type: "connection.revoked", limit: 10 });
    expect(revokedEvents.map((event: any) => event.payload.tokenId)).toEqual(
      expect.arrayContaining([own.tokenId, others.tokenId, adminMinted.tokenId])
    );
  });

  it("does not leak plaintext through DB, events, or logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await mintConnectionToken(db, {
        scopePath,
        name: "Plaintext audit",
        role: "viewer",
      }, editorId);
      await listConnectionTokens(db, { scopePath }, editorId);

      const dbTables = {
        tokens: await db.select().from(schema.tokens),
        connections: await db.select().from(schema.connections),
        events: await db.select().from(schema.events),
      };
      expect(stringifyForAudit(dbTables)).not.toContain(result.token);
      expect([...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join("\n")).not.toContain(result.token);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("keeps connection mint insert in the same successful transaction as token issue", async () => {
    const before = await db.select().from(schema.connections);
    const minted = await mintConnectionToken(db, { scopePath, name: "Transactional", role: "viewer" }, editorId);
    const after = await db.select().from(schema.connections);
    const [row] = await db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.tokenId, minted.tokenId), eq(schema.connections.mintedBy, editorId)))
      .limit(1);

    expect(after.length).toBe(before.length + 1);
    expect(row).toBeTruthy();
  });
});
