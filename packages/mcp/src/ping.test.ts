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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createScope,
  grantRole,
  createRecord,
  listRecords,
} from "@companyos/api";
import { createServer, ping } from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(__dirname, "../../../packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

describe("mcp ping", () => {
  it("returns pong", () => {
    expect(ping()).toBe("pong");
  });
});

describe("MCP server roundtrips (in-memory + PGlite)", () => {
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
  let testScope: string;
  let subScope: string;

  beforeEach(async () => {
    const now = Date.now();
    // principals
    const pRes = (await db.insert(schema.principals).values({ kind: "human", name: "Root " + now }).returning()) as any[];
    rootPrincipalId = pRes[0]?.id;

    const aRes = (await db.insert(schema.principals).values({ kind: "agent", name: "Agent " + now }).returning()) as any[];
    agentPrincipalId = aRes[0]?.id;

    const vRes = (await db.insert(schema.principals).values({ kind: "human", name: "Viewer " + now }).returning()) as any[];
    viewerPrincipalId = vRes[0]?.id;

    // scope tree
    testScope = "mcp-test-" + now;
    await createScope(db, { slug: testScope, name: "MCP Test", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath: testScope, role: "agent" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerPrincipalId, scopePath: testScope, role: "viewer" }, rootPrincipalId);

    subScope = `${testScope}/sub`;
    await createScope(db, { parentPath: testScope, slug: "sub", name: "Sub", type: "area" }, rootPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath: subScope, role: "agent" }, rootPrincipalId);

    // attach a module instance for context test
    const { eq } = await import("drizzle-orm");
    const scopeRow = (await db.select({ id: schema.scopes.id }).from(schema.scopes).where(eq(schema.scopes.path, testScope)).limit(1))[0];
    if (scopeRow) {
      await db.insert(schema.moduleInstances).values({
        scopeId: scopeRow.id,
        moduleType: "records",
        config: {},
        position: 0,
      });
    }

    // seed some records
    await createRecord(db, { scopePath: testScope, kind: "changelog", title: "Initial setup", bodyMd: "Started the project with good progress. **bold** here." }, rootPrincipalId);
    await createRecord(db, { scopePath: testScope, kind: "decision", title: "Choose Postgres", bodyMd: "We picked Postgres for durability." }, rootPrincipalId);
    await createRecord(db, { scopePath: testScope, kind: "note", title: "Side note", bodyMd: "Not in context primary." }, rootPrincipalId);
    await createRecord(db, { scopePath: subScope, kind: "changelog", title: "Sub change", bodyMd: "Did sub work." }, agentPrincipalId);
  });

  async function makeRoundtrip(principalIdForServer: string | null) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
    const server = createServer({ db, principalId: principalIdForServer });

    await Promise.all([
      mcpClient.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    return { mcpClient, server };
  }

  it("covers all 9 tools via roundtrip (ping + 8)", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId);

    // list tools
    const tools = await mcpClient.listTools();
    const names = (tools.tools || []).map((t: any) => t.name).sort();
    expect(names).toEqual([
      "get_context",
      "get_record",
      "get_tree",
      "list_records",
      "log_change",
      "log_decision",
      "ping",
      "save_note",
      "save_report",
    ].sort());

    // ping
    const p = await mcpClient.callTool({ name: "ping", arguments: {} });
    expect((p as any).content?.[0]?.text).toBe("pong");

    // get_tree (use explicit scope; default root edge returns simple tree)
    const tree = await mcpClient.callTool({ name: "get_tree", arguments: { scope: testScope } });
    expect((tree as any).content?.[0]?.text).toMatch(testScope);

    // get_context
    const ctx = await mcpClient.callTool({ name: "get_context", arguments: { scope: testScope } });
    const ctxText = (ctx as any).content?.[0]?.text || "";
    expect(ctxText).toContain(`path: ${testScope}`);
    expect(ctxText).toContain("Identity");
    expect(ctxText).toContain("Modules");
    expect(ctxText).toContain("records");
    expect(ctxText).toContain("Children");
    expect(ctxText).toContain("Recent changelog/decision records");
    expect(ctxText).toContain("Initial setup");
    expect(ctxText).toContain("Choose Postgres");
    expect(ctxText).toMatch(/use list_records \/ get_record/i);

    // list_records
    const listed = await mcpClient.callTool({ name: "list_records", arguments: { scope: testScope, limit: 20 } });
    expect((listed as any).content?.[0]?.text).toMatch(/changelog/);
    expect((listed as any).content?.[0]?.text).toMatch(/decision/);

    // get_record
    const recs = await listRecords(db, { scopePath: testScope, limit: 3 }, rootPrincipalId);
    const recId = (recs as any)[0]?.id;
    const got = await mcpClient.callTool({ name: "get_record", arguments: { id: recId } });
    expect((got as any).content?.[0]?.text).toContain((recs as any)[0]?.title);

    // log_change (write)
    const ch = await mcpClient.callTool({
      name: "log_change",
      arguments: { scope: testScope, title: "MCP log test", body_md: "Via mcp tool **test**." },
    });
    expect((ch as any).content?.[0]?.text).toMatch(/Created changelog/);

    // log_decision
    const dec = await mcpClient.callTool({
      name: "log_decision",
      arguments: { scope: testScope, title: "MCP decision", body_md: "Decided via tool." },
    });
    expect((dec as any).content?.[0]?.text).toMatch(/Created decision/);

    // save_report
    const rep = await mcpClient.callTool({
      name: "save_report",
      arguments: { scope: testScope, title: "MCP report", body_md: "Report body." },
    });
    expect((rep as any).content?.[0]?.text).toMatch(/Created report/);

    // save_note
    const nt = await mcpClient.callTool({
      name: "save_note",
      arguments: { scope: testScope, title: "MCP note", body_md: "Note body." },
    });
    expect((nt as any).content?.[0]?.text).toMatch(/Created note/);
  });

  it("agent can write (log_change) in granted subtree", async () => {
    const { mcpClient } = await makeRoundtrip(agentPrincipalId);
    const res = await mcpClient.callTool({
      name: "log_change",
      arguments: { scope: subScope, title: "Agent sub change", body_md: "ok" },
    });
    expect(res.isError).toBeFalsy();
    expect((res as any).content?.[0]?.text).toMatch(/Created changelog/);
  });

  it("agent denied write outside grant subtree", async () => {
    // create another scope with no grant for agent
    const other = "other-mcp-" + Date.now();
    await createScope(db, { slug: other, name: "Other", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: other, role: "editor" }, rootPrincipalId);

    const { mcpClient } = await makeRoundtrip(agentPrincipalId);
    const res = await mcpClient.callTool({
      name: "log_change",
      arguments: { scope: other, title: "Bad", body_md: "x" },
    });
    expect(res.isError).toBe(true);
    expect((res as any).content?.[0]?.text).toMatch(/Access denied/);
  });

  it("viewer cannot write (save_note etc)", async () => {
    const { mcpClient } = await makeRoundtrip(viewerPrincipalId);
    const res = await mcpClient.callTool({
      name: "save_note",
      arguments: { scope: testScope, title: "V", body_md: "no" },
    });
    expect(res.isError).toBe(true);
    expect((res as any).content?.[0]?.text).toMatch(/Access denied.*editor/);
  });

  it("unauthenticated (null principal) returns auth error on protected tool", async () => {
    const { mcpClient } = await makeRoundtrip(null);
    const res = await mcpClient.callTool({
      name: "get_context",
      arguments: { scope: testScope },
    });
    expect(res.isError).toBe(true);
    expect((res as any).content?.[0]?.text).toMatch(/Unauthenticated|Access denied/);
  });

  it("bad token case (principalId null) fails writes and reads protected", async () => {
    const { mcpClient } = await makeRoundtrip(null);
    const listRes = await mcpClient.callTool({ name: "list_records", arguments: { scope: testScope } });
    expect(listRes.isError).toBe(true);
  });

  it("get_context assertions: contains identity, modules, children, recent records", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId);
    const ctx = await mcpClient.callTool({ name: "get_context", arguments: { scope: testScope } });
    const text = (ctx as any).content?.[0]?.text || "";
    expect(text).toContain("name: MCP Test");
    expect(text).toContain(`path: ${testScope}`);
    expect(text).toContain("type: project");
    expect(text).toContain("status: active");
    expect(text).toContain("Modules");
    expect(text).toContain("records"); // module
    expect(text).toContain("Children");
    expect(text).toContain("Initial setup");
    expect(text).toContain("Choose Postgres");
    expect(text).toMatch(/use list_records \/ get_record/i);
  });
});
