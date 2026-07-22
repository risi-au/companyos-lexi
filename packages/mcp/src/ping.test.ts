/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested);
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createScope,
  grantRole,
  createRecord,
  createAttentionItem,
  getDoc,
  listRecords,
  listEvents,
  saveDoc,
  writeMetrics,
  issueToken,
  revokeToken,
  mintConnectionToken,
  revokeConnectionToken,
  setCredential,
  GitHubClient,
} from "@companyos/api";
import { createHttpHandler, createServer, ping } from "./index";
import { SERVER_INSTRUCTIONS } from "./server";

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
    await createScope(db, { parentPath: testScope, slug: "sub", name: "Sub", type: "subproject" }, rootPrincipalId);
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

    // seed metrics for query/list roundtrips (M2-01)
    await writeMetrics(db, { scopePath: testScope, points: [
      { metric: "meta.spend", date: "2026-06-01", value: 111, dims: { campaign: "prospecting", country: "AU" } },
      { metric: "meta.spend", date: "2026-06-01", value: 22, dims: { campaign: "retargeting", country: "AU" } },
      { metric: "meta.spend", date: "2026-06-02", value: 333, dims: { campaign: "prospecting", country: "AU" } },
      { metric: "ga4.sessions", date: "2026-06-01", value: 500 },
    ] }, rootPrincipalId);
  });

  async function makeRoundtrip(
    principalIdForServer: string | null,
    planeClient: any = null,
    githubClient: any = undefined,
    mcpPublicUrl: string | null = null
  ) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
    const server = createServer({ db, principalId: principalIdForServer, planeClient, githubClient, mcpPublicUrl });

    await Promise.all([
      mcpClient.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    return { mcpClient, server };
  }

  it("covers all tools via roundtrip (ping + records + tasks + metrics + dashboards)", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId);

    // list tools
    const tools = await mcpClient.listTools();
    const names = (tools.tools || []).map((t: any) => t.name).sort();
    expect(names).toEqual([
      "approve_intake_packet",
      "archive_doc",
      "complete_session",
      "complete_task",
      "create_task",
      "get_backlinks",
      "get_canvas",
      "get_context",
      "get_context_profile",
      "get_credential",
      "get_dashboard",
      "get_digest",
      "get_doc",
      "get_intake_packet",
      "get_link_graph",
      "get_record",
      "get_session",
      "get_skill",
      "get_tree",
      "list_attention_items",
      "list_canvases",
      "list_capabilities",
      "list_alerts",
      "list_capability_runs",
      "list_dashboards",
      "list_credentials",
      "list_doc_revisions",
      "list_docs",
      "list_intake_packets",
      "list_metric_names",
      "list_records",
      "list_sessions",
      "list_skills",
      "list_tasks",
      "list_widget_types",
      "log_change",
      "log_decision",
      "ping",
      "provision_from_intake_packet",
      "provision_scope",
      "query_metrics",
      "query_usage",
      "recall_memory",
      "register_capability",
      "register_session",
      "rename_doc",
      "report_run",
      "resolve_attention_item",
      "resolve_wiki_question",
      "revert_dashboard",
      "revert_doc",
      "save_canvas",
      "save_dashboard",
      "save_doc",
      "save_note",
      "save_report",
      "set_context_profile",
      "search",
      "submit_intake_packet",
      "sync_skills",
      "update_intake_packet",
      "update_session",
      "update_task",
      "verify_workbench",
      "whoami",
      "write_metrics",
    ].sort());

    // ping
    const p = await mcpClient.callTool({ name: "ping", arguments: {} });
    expect((p as any).content?.[0]?.text).toBe("pong");

    const who = await mcpClient.callTool({ name: "whoami", arguments: {} });
    expect((who as any).isError).toBeFalsy();
    const whoJson = JSON.parse((who as any).content?.[0]?.text || "{}");
    expect(whoJson.principal).toMatchObject({
      id: rootPrincipalId,
      name: expect.stringMatching(/^Root /),
      kind: "human",
    });
    expect(whoJson.grants).toEqual(
      expect.arrayContaining([{ scopePath: testScope, role: "editor" }])
    );

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

    // docs (M3-01): save/get/list + revisions + revert via MCP roundtrip; byte-exact md
    const sd = await mcpClient.callTool({
      name: "save_doc",
      arguments: { scope: testScope, title: "KB Overview", body_md: "# Hello\n\n**exact** markdown." },
    });
    expect((sd as any).content?.[0]?.text).toMatch(/Saved doc/);

    const gd = await mcpClient.callTool({ name: "get_doc", arguments: { scope: testScope, slug: "kb-overview" } });
    const gdText = (gd as any).content?.[0]?.text || "";
    expect(gdText).toContain("KB Overview");
    expect(gdText).toContain("**exact** markdown.");

    const ld = await mcpClient.callTool({ name: "list_docs", arguments: { scope: testScope } });
    expect((ld as any).content?.[0]?.text).toMatch(/kb-overview/);

    const lrev = await mcpClient.callTool({ name: "list_doc_revisions", arguments: { scope: testScope, slug: "kb-overview", limit: 5 } });
    expect((lrev as any).content?.[0]?.text).toMatch(/kb-overview|title/);

    // save again (update) requires explicit slug (auto from same title would collide and suffix per design); here roundtrip update
    const sd2 = await mcpClient.callTool({
      name: "save_doc",
      arguments: { scope: testScope, slug: "kb-overview", title: "KB Overview", body_md: "# Hello\n\n**exact** markdown. v2" },
    });
    expect((sd2 as any).content?.[0]?.text).toMatch(/Saved doc/);

    const gd2 = await mcpClient.callTool({ name: "get_doc", arguments: { scope: testScope, slug: "kb-overview" } });
    expect((gd2 as any).content?.[0]?.text || "").toContain("v2");

    const sourceDoc = await mcpClient.callTool({
      name: "save_doc",
      arguments: { scope: testScope, slug: "link-source", title: "Link Source", body_md: "References [[kb-overview]]." },
    });
    expect((sourceDoc as any).isError).toBeFalsy();

    const backlinks = await mcpClient.callTool({ name: "get_backlinks", arguments: { scopePath: testScope, slug: "kb-overview" } });
    expect((backlinks as any).isError).toBeFalsy();
    expect((backlinks as any).content?.[0]?.text || "").toContain("link-source");

    const graph = await mcpClient.callTool({ name: "get_link_graph", arguments: { scopePath: testScope } });
    expect((graph as any).isError).toBeFalsy();
    expect((graph as any).content?.[0]?.text || "").toContain("kb-overview");
    expect((graph as any).content?.[0]?.text || "").toContain("link-source");

    const renamed = await mcpClient.callTool({
      name: "rename_doc",
      arguments: { scopePath: testScope, slug: "kb-overview", newTitle: "Renamed KB", newSlug: "kb-renamed" },
    });
    expect((renamed as any).isError).toBeFalsy();
    expect((renamed as any).content?.[0]?.text || "").toContain("kb-renamed");

    const archived = await mcpClient.callTool({
      name: "archive_doc",
      arguments: { scopePath: testScope, slug: "kb-renamed" },
    });
    expect((archived as any).isError).toBeFalsy();
    expect((archived as any).content?.[0]?.text || "").toContain("kb-renamed");
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

  it("attention MCP tools list and resolve wiki proposals end to end", async () => {
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "admin" }, rootPrincipalId);
    await saveDoc(db, { scopePath: testScope, slug: "wiki", title: "Wiki", bodyMd: "Old wiki" }, rootPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath: testScope,
      kind: "wiki_proposal",
      title: "Update wiki",
      payload: { slug: "wiki", title: "Wiki", currentMd: "Old wiki", proposedMd: "New wiki" },
    }, agentPrincipalId);

    const { mcpClient } = await makeRoundtrip(rootPrincipalId);
    const listed = await mcpClient.callTool({ name: "list_attention_items", arguments: { scopePath: testScope, status: "open", limit: 10 } });
    expect((listed as any).isError).toBeFalsy();
    const listedText = (listed as any).content?.[0]?.text || "";
    expect(listedText).toContain(item.id);
    expect(listedText.split("\n")[0]).toBe("id\tstatus\tkind\tscope\ttitle\tlabel\tsummary");

    const resolved = await mcpClient.callTool({ name: "resolve_attention_item", arguments: { id: item.id, resolution: "approved", note: "ok" } });
    expect((resolved as any).isError).toBeFalsy();
    expect((resolved as any).content?.[0]?.text || "").toContain("approved");

    const doc = await getDoc(db, { scopePath: testScope, slug: "wiki" }, rootPrincipalId);
    expect(doc?.bodyMd).toBe("New wiki");
  });

  it("requires an answer note when MCP approves an open question", async () => {
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "admin" }, rootPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath: testScope,
      kind: "open_question",
      title: "MCP open question",
      payload: {
        question: "Which owner approved this launch?",
        tag: "decision",
        source: "intake",
        intakeId: "mcp-intake-1",
        ordinal: 0,
      },
    }, agentPrincipalId);

    const { mcpClient } = await makeRoundtrip(rootPrincipalId);
    const missingNote = await mcpClient.callTool({ name: "resolve_attention_item", arguments: { id: item.id, resolution: "approved" } });
    expect((missingNote as any).isError).toBe(true);
    expect((missingNote as any).content?.[0]?.text || "").toContain("open_question approval requires a resolution note");

    const resolved = await mcpClient.callTool({
      name: "resolve_attention_item",
      arguments: { id: item.id, resolution: "approved", note: "The operations lead approved it." },
    });
    expect((resolved as any).isError).toBeFalsy();
    expect((resolved as any).content?.[0]?.text || "").toContain("approved");
  });

  it("blocks generic MCP resolution for wiki questions and exposes the dedicated resolver", async () => {
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "admin" }, rootPrincipalId);
    const item = await createAttentionItem(db, {
      scopePath: testScope,
      kind: "lint_finding",
      title: "Wiki lint: stale",
      payload: { type: "stale", slug: "page", title: "Page" },
    }, agentPrincipalId);

    const { mcpClient } = await makeRoundtrip(rootPrincipalId);
    const listed = await mcpClient.callTool({ name: "list_attention_items", arguments: { scopePath: testScope, status: "open", limit: 10 } });
    expect((listed as any).isError).toBeFalsy();
    expect((listed as any).content?.[0]?.text || "").toContain("Wiki question");
    expect((listed as any).content?.[0]?.text || "").toContain("close-unclear");

    const generic = await mcpClient.callTool({ name: "resolve_attention_item", arguments: { id: item.id, resolution: "dismissed" } });
    expect((generic as any).isError).toBe(true);
    expect((generic as any).content?.[0]?.text || "").toContain("specific outcome action");

    const dedicated = await mcpClient.callTool({ name: "resolve_wiki_question", arguments: { id: item.id, action: "close-unclear" } });
    expect((dedicated as any).isError).toBeFalsy();
    expect((dedicated as any).content?.[0]?.text || "").toContain("dismissed");
  });

  it("credential tools list metadata and return values only to agent-and-above principals", async () => {
    const previousVaultKey = process.env.COS_VAULT_KEY;
    process.env.COS_VAULT_KEY = Buffer.alloc(32, 9).toString("base64");
    try {
      await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "admin" }, rootPrincipalId);
      await setCredential(db, {
        scopePath: testScope,
        name: "Deploy token",
        description: "Deployment API access",
        value: "plain-secret-mcp-value",
      }, rootPrincipalId);

      const { mcpClient: agentClient } = await makeRoundtrip(agentPrincipalId);
      const listed = await agentClient.callTool({ name: "list_credentials", arguments: { scope: testScope } });
      expect((listed as any).isError).toBeFalsy();
      const listedText = (listed as any).content?.[0]?.text || "";
      expect(listedText).toContain("Deploy token");
      expect(listedText).toContain("Deployment API access");
      expect(listedText).not.toContain("plain-secret-mcp-value");

      const got = await agentClient.callTool({ name: "get_credential", arguments: { scope: testScope, name: "Deploy token" } });
      expect((got as any).isError).toBeFalsy();
      expect((got as any).content?.[0]?.text).toBe("plain-secret-mcp-value");

      const { mcpClient: viewerClient } = await makeRoundtrip(viewerPrincipalId);
      const denied = await viewerClient.callTool({ name: "get_credential", arguments: { scope: testScope, name: "Deploy token" } });
      expect((denied as any).isError).toBe(true);
      expect((denied as any).content?.[0]?.text || "").toMatch(/Access denied.*agent/);

      const audit = await listEvents(db, { scopePath: testScope, type: "credential.accessed", limit: 10 });
      expect(audit.length).toBeGreaterThan(0);
      expect(safeJson(audit)).not.toContain("plain-secret-mcp-value");
    } finally {
      if (previousVaultKey === undefined) {
        delete process.env.COS_VAULT_KEY;
      } else {
        process.env.COS_VAULT_KEY = previousVaultKey;
      }
    }
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

  it("get_context markdown includes workbench section when bundle has workbench info", async () => {
    const [scopeRow] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, testScope)).limit(1);
    await db.insert(schema.workbenches).values({
      scopeId: scopeRow.id,
      repo: "brissie-digital/mcp-test",
      path: "",
    });

    const { mcpClient } = await makeRoundtrip(rootPrincipalId, null, undefined, "https://os.example/api/mcp");
    const ctx = await mcpClient.callTool({ name: "get_context", arguments: { scope: subScope } });
    const text = (ctx as any).content?.[0]?.text || "";

    expect(text).toContain("**Workbench**");
    expect(text).toContain("Repo: brissie-digital/mcp-test");
    expect(text).toContain("Folder: sub");
    expect(text).toContain("MCP URL: https://os.example/api/mcp");
  });

  it("verify_workbench roundtrips as a read-only warning and does not affect other tools", async () => {
    const [scopeRow] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, testScope)).limit(1);
    await db.insert(schema.workbenches).values({
      scopeId: scopeRow.id,
      repo: "brissie-digital/mcp-test",
      path: "expected-folder",
    });

    const { mcpClient } = await makeRoundtrip(rootPrincipalId);
    const verify = await mcpClient.callTool({
      name: "verify_workbench",
      arguments: { scope: testScope, cwd: "C:\\work\\mcp-test\\wrong-folder" },
    });

    expect((verify as any).isError).toBeFalsy();
    const verifyJson = JSON.parse((verify as any).content?.[0]?.text || "{}");
    expect(verifyJson).toMatchObject({
      ok: false,
      expectedRepo: "brissie-digital/mcp-test",
      expectedPath: "expected-folder",
    });
    expect(verifyJson.message).toContain(`for scope ${testScope}`);

    const tree = await mcpClient.callTool({ name: "get_tree", arguments: { scope: testScope } });
    expect((tree as any).isError).toBeFalsy();
    expect((tree as any).content?.[0]?.text || "").toContain(testScope);
  });

  it("sessions MCP tools roundtrip register, heartbeat, list, and complete", async () => {
    const { mcpClient } = await makeRoundtrip(agentPrincipalId);

    const registered = await mcpClient.callTool({
      name: "register_session",
      arguments: {
        scope: testScope,
        title: "MCP session",
        engine: "codex",
        model: "gpt-5",
        worktree_ref: "mcp/session",
      },
    });
    expect((registered as any).isError).toBeFalsy();
    const session = JSON.parse((registered as any).content?.[0]?.text || "{}");
    expect(session).toMatchObject({
      title: "MCP session",
      engine: "codex",
      model: "gpt-5",
      status: "running",
      worktreeRef: "mcp/session",
    });

    const heartbeat = await mcpClient.callTool({
      name: "update_session",
      arguments: { session_id: session.id },
    });
    expect((heartbeat as any).isError).toBeFalsy();
    const heartbeatJson = JSON.parse((heartbeat as any).content?.[0]?.text || "{}");
    expect(new Date(heartbeatJson.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
      new Date(session.lastHeartbeat).getTime()
    );

    const listed = await mcpClient.callTool({
      name: "list_sessions",
      arguments: { scope: testScope, include_descendants: true },
    });
    expect((listed as any).isError).toBeFalsy();
    const sessions = JSON.parse((listed as any).content?.[0]?.text || "[]");
    expect(sessions.some((row: any) => row.id === session.id && row.scopePath === testScope && row.stale === false))
      .toBe(true);

    const completed = await mcpClient.callTool({
      name: "complete_session",
      arguments: {
        session_id: session.id,
        summary: "Wrapped through MCP",
        citations: [{ slug: "kb-overview", scopePath: testScope, revisionId: "rev-mcp-session" }],
      },
    });
    expect((completed as any).isError).toBeFalsy();
    const completedJson = JSON.parse((completed as any).content?.[0]?.text || "{}");
    expect(completedJson.status).toBe("completed");
    expect(completedJson.summary).toBe("Wrapped through MCP");
    expect(completedJson.citations).toEqual([{
      slug: "kb-overview",
      scopePath: testScope,
      revisionId: "rev-mcp-session",
      source: "scope",
    }]);
  });

  it("search MCP tool roundtrips over records with a snippet and tab-delimited output", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId);

    const result = await mcpClient.callTool({
      name: "search",
      arguments: { scope: testScope, query: "progress" },
    });
    expect((result as any).isError).toBeFalsy();
    const text = (result as any).content?.[0]?.text || "";
    expect(text).toContain("type\tid\tref\ttitle\tscope\tdate\tsnippet");
    expect(text).toContain("Initial setup");
    expect(text).toContain(testScope);
  });

  it("recall_memory MCP tool is listed and callable over scoped wiki docs", async () => {
    await saveDoc(db, {
      scopePath: testScope,
      slug: "memory-playbook",
      title: "Memory Playbook",
      bodyMd: "---\nconfidence: medium\n---\nDistilled memory playbook for retention loops.",
    }, rootPrincipalId);

    const { mcpClient } = await makeRoundtrip(agentPrincipalId);
    const tools = await mcpClient.listTools();
    const recallTool = (tools.tools || []).find((tool: any) => tool.name === "recall_memory");
    expect(recallTool?.description).toBe("Query the OS's distilled memory before trawling records; returns wiki knowledge for your scope plus company-wide patterns.");

    const result = await mcpClient.callTool({
      name: "recall_memory",
      arguments: { scope: testScope, query: "retention loops" },
    });
    expect((result as any).isError).toBeFalsy();
    const text = (result as any).content?.[0]?.text || "";
    expect(text).toContain("source\tid\tslug\ttitle\tscope\tupdated\tconfidence\tsnippet");
    expect(text).toContain("memory-playbook");
    expect(text).toContain(testScope);
    expect(text).toContain("medium");
  });

  // === M1-07 task MCP roundtrips (mock injected, unconfigured error) ===
  let taskScope: string;
  let taskMockPlane: any;

  beforeEach(async () => {
    const now = Date.now();
    taskScope = `mcp-task-${now}`;
    await createScope(db, { slug: taskScope, name: "TaskScope", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: taskScope, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath: taskScope, role: "agent" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerPrincipalId, scopePath: taskScope, role: "viewer" }, rootPrincipalId);

    // simple mock plane for mcp roundtrips
    const calls: any[] = [];
    taskMockPlane = {
      getProjects: async () => [],
      createProject: async (name: string) => { calls.push("createProject"); return { id: "p_" + name.slice(0,5) }; },
      getStates: async () => ([{id:"s1", group:"started"}, {id:"s_done", group:"completed"}]),
      listLabels: async () => [],
      createLabel: async (_p: string, n: string) => { calls.push("createLabel"); return { id: "l_" + n.replace(/[^a-z]/g,"") }; },
      createIssue: async (_pid: string, d: any) => { calls.push("createIssue"); return { id: "i_mcp", sequence_id: 7, name: d.name }; },
      updateIssue: async () => { calls.push("updateIssue"); return {}; },
      listIssues: async () => { calls.push("listIssues"); return [{id:"i_mcp", sequence_id:7, name:"T", state:{group:"started"}, labels:[] }]; },
      _calls: calls,
    };
  });

  it("MCP task tools roundtrip with injected mock (create, list, complete, update)", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId, taskMockPlane);

    const c = await mcpClient.callTool({ name: "create_task", arguments: { scope: taskScope, title: "MCP Task", description: "via mcp" } });
    expect((c as any).content?.[0]?.text).toMatch(/Created task/);

    const lst = await mcpClient.callTool({ name: "list_tasks", arguments: { scope: taskScope } });
    expect((lst as any).content?.[0]?.text).toMatch(/i_mcp/);

    const comp = await mcpClient.callTool({ name: "complete_task", arguments: { scope: taskScope, issue_id: "i_mcp", note: "done via test" } });
    expect((comp as any).content?.[0]?.text).toMatch(/Completed/);

    const upd = await mcpClient.callTool({ name: "update_task", arguments: { scope: taskScope, issue_id: "i_mcp", title: "Updated" } });
    expect((upd as any).content?.[0]?.text).toMatch(/Updated/);

    expect(taskMockPlane._calls).toEqual(expect.arrayContaining(["createProject", "createLabel", "createIssue", "listIssues", "updateIssue"]));
  });

  it("unconfigured plane (no client) returns clear error for task tools", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId, null);
    const res = await mcpClient.callTool({ name: "create_task", arguments: { scope: taskScope, title: "X" } });
    expect(res.isError).toBe(true);
    expect((res as any).content?.[0]?.text).toMatch(/tasks engine not configured/);

    const lres = await mcpClient.callTool({ name: "list_tasks", arguments: { scope: taskScope } });
    expect(lres.isError).toBe(true);
    expect((lres as any).content?.[0]?.text).toMatch(/tasks engine not configured/);
  });

  it("provision_scope roundtrips with mocked Plane and GitHub deps", async () => {
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "admin" }, rootPrincipalId);

    const repos = new Map<string, { files: Map<string, string> }>();
    const fetch = async (input: string, init?: any): Promise<Response> => {
      const url = new URL(input);
      const method = init?.method || "GET";
      const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (method === "GET" && segments[0] === "repos" && segments.length === 3) {
        return repos.has(segments[2]!)
          ? new Response(JSON.stringify({ name: segments[2] }), { status: 200 })
          : new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      }
      if (method === "POST" && segments[0] === "orgs" && segments[2] === "repos") {
        const body = JSON.parse(init?.body || "{}");
        repos.set(body.name, { files: new Map() });
        return new Response(JSON.stringify({ name: body.name }), { status: 201 });
      }
      if (segments[0] === "repos" && segments[3] === "contents") {
        const repo = repos.get(segments[2]!);
        if (!repo) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
        const filePath = segments.slice(4).join("/");
        if (method === "GET") {
          const content = repo.files.get(filePath);
          if (content === undefined) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
          return new Response(JSON.stringify({
            type: "file",
            sha: "sha",
            encoding: "base64",
            content: Buffer.from(content, "utf8").toString("base64"),
          }), { status: 200 });
        }
        if (method === "PUT") {
          const body = JSON.parse(init?.body || "{}");
          repo.files.set(filePath, Buffer.from(body.content, "base64").toString("utf8"));
          return new Response(JSON.stringify({ content: { sha: "sha2" } }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ message: "unhandled" }), { status: 500 });
    };

    const github = new GitHubClient({ token: "gh_test", org: "test-org", baseUrl: "https://api.github.test", fetch });
    const plane = {
      forWorkspace: () => plane,
      getProjects: async () => [],
      listWebhooks: async () => [],
      createWebhook: async () => ({}),
    };
    const { mcpClient } = await makeRoundtrip(rootPrincipalId, plane, github);
    const res = await mcpClient.callTool({
      name: "provision_scope",
      arguments: {
        scopePath: `${testScope}/provisioned`,
        modules: ["records"],
        workbench: {},
      },
    });

    expect((res as any).isError).toBeFalsy();
    const parsed = JSON.parse((res as any).content?.[0]?.text || "{}");
    expect(parsed.scopePath).toBe(`${testScope}/provisioned`);
    expect(parsed.steps.some((s: any) => s.key === "github.repo" && s.status === "created")).toBe(true);
    expect(repos.get(testScope)?.files.get("provisioned/AGENTS.md")).toContain("companyos:managed:start");
  });

  it("intake MCP tools roundtrip submit/list/get/update/approve/provision with existing scope gating", async () => {
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "admin" }, rootPrincipalId);
    const plane = {
      forWorkspace: () => plane,
      getProjects: async () => [],
      listWebhooks: async () => [],
      createWebhook: async () => ({}),
    };
    const { mcpClient } = await makeRoundtrip(rootPrincipalId, plane, null);

    const submitted = await mcpClient.callTool({
      name: "submit_intake_packet",
      arguments: {
        scope: testScope,
        packet: {
          packet_md: "MCP intake packet",
          research_sources: [],
          proposed_provision_spec: { scopePath: testScope, modules: ["docs"] },
          proposed_docs: [{ slug: "mcp-intake", title: "MCP Intake", bodyMd: "# MCP" }],
          proposed_tasks: [],
          proposed_wiki_updates: [],
          open_questions: [],
          risk_notes: [],
        },
      },
    });
    expect((submitted as any).isError).toBeFalsy();
    const submittedJson = JSON.parse((submitted as any).content?.[0]?.text || "{}");
    expect(submittedJson.status).toBe("needs_review");

    const listed = await mcpClient.callTool({
      name: "list_intake_packets",
      arguments: { scope: testScope, statuses: ["needs_review"] },
    });
    const listedJson = JSON.parse((listed as any).content?.[0]?.text || "[]");
    expect(listedJson.some((row: any) => row.id === submittedJson.id)).toBe(true);

    const got = await mcpClient.callTool({
      name: "get_intake_packet",
      arguments: { intake_id: submittedJson.id },
    });
    expect(JSON.parse((got as any).content?.[0]?.text || "{}").packetMd).toBe("MCP intake packet");

    const updated = await mcpClient.callTool({
      name: "update_intake_packet",
      arguments: { intake_id: submittedJson.id, open_questions: ["confirm budget"] },
    });
    expect(JSON.parse((updated as any).content?.[0]?.text || "{}").openQuestions).toEqual(["confirm budget"]);

    const approved = await mcpClient.callTool({
      name: "approve_intake_packet",
      arguments: { intake_id: submittedJson.id },
    });
    expect(JSON.parse((approved as any).content?.[0]?.text || "{}").status).toBe("approved");

    const provisioned = await mcpClient.callTool({
      name: "provision_from_intake_packet",
      arguments: { intake_id: submittedJson.id },
    });
    expect((provisioned as any).isError).toBeFalsy();
    const provisionedJson = JSON.parse((provisioned as any).content?.[0]?.text || "{}");
    expect(provisionedJson.intake.status).toBe("provisioned");
    expect(provisionedJson.recordId).toBeTruthy();

    const outside = `${testScope}-outside`;
    await createScope(db, { slug: outside, name: "Outside", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: outside, role: "admin" }, rootPrincipalId);
    const { mcpClient: agentClient } = await makeRoundtrip(agentPrincipalId, plane, null);
    const denied = await agentClient.callTool({
      name: "submit_intake_packet",
      arguments: { scope: outside, paste_text: "Denied" },
    });
    expect((denied as any).isError).toBe(true);
  });

  it("capabilities MCP tools roundtrip: register, report, list capabilities, list runs", async () => {
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScope, role: "admin" }, rootPrincipalId);
    const { mcpClient } = await makeRoundtrip(rootPrincipalId);

    const registered = await mcpClient.callTool({
      name: "register_capability",
      arguments: {
        scopePath: testScope,
        name: "nightly-sync",
        engine: "n8n",
        engineRef: "https://n8n.test/workflow/nightly-sync",
      },
    });
    expect((registered as any).isError).toBeFalsy();
    const registerJson = JSON.parse((registered as any).content?.[0]?.text || "{}");
    expect(registerJson.created).toBe(true);
    expect(registerJson.capability.name).toBe("nightly-sync");

    const report = await mcpClient.callTool({
      name: "report_run",
      arguments: {
        scopePath: testScope,
        name: "nightly-sync",
        status: "success",
        runRef: "mcp-run-1",
        summary: "completed",
        durationMs: 321,
      },
    });
    expect((report as any).isError).toBeFalsy();
    const reportJson = JSON.parse((report as any).content?.[0]?.text || "{}");
    expect(reportJson.created).toBe(true);
    expect(reportJson.run.runRef).toBe("mcp-run-1");

    const caps = await mcpClient.callTool({
      name: "list_capabilities",
      arguments: { scope: testScope },
    });
    const capsJson = JSON.parse((caps as any).content?.[0]?.text || "[]");
    expect(capsJson.some((cap: any) => cap.name === "nightly-sync" && cap.lastRun?.status === "success")).toBe(true);

    const runs = await mcpClient.callTool({
      name: "list_capability_runs",
      arguments: { scope: testScope, name: "nightly-sync", limit: 10 },
    });
    const runsJson = JSON.parse((runs as any).content?.[0]?.text || "[]");
    expect(runsJson.length).toBe(1);
    expect(runsJson[0].summary).toBe("completed");

    const alertReport = await mcpClient.callTool({
      name: "report_run",
      arguments: {
        scopePath: testScope,
        name: "nightly-sync",
        status: "error",
        runRef: "mcp-run-alert",
        summary: "threshold crossed",
        alert: {
          severity: "warning",
          message: "Spend crossed threshold",
          metric: "meta.spend",
          value: 75,
          threshold: 50,
        },
      },
    });
    expect((alertReport as any).isError).toBeFalsy();

    const alerts = await mcpClient.callTool({
      name: "list_alerts",
      arguments: { scope: testScope, severity: "warning", limit: 10 },
    });
    expect((alerts as any).isError).toBeFalsy();
    const alertsJson = JSON.parse((alerts as any).content?.[0]?.text || "[]");
    expect(alertsJson.length).toBe(1);
    expect(alertsJson[0]).toMatchObject({
      capability: "nightly-sync",
      severity: "warning",
      message: "Spend crossed threshold",
      metric: "meta.spend",
      value: 75,
      threshold: 50,
      runRef: "mcp-run-alert",
    });

    const badAlert = await mcpClient.callTool({
      name: "report_run",
      arguments: {
        scopePath: testScope,
        name: "nightly-sync",
        status: "success",
        runRef: "mcp-bad-alert",
        alert: { severity: "info", message: "   " },
      },
    });
    expect((badAlert as any).isError).toBe(true);
    expect((badAlert as any).content?.[0]?.text).toMatch(/Alert validation failed/);
  });

  it("skills MCP tools roundtrip: list_skills and get_skill", async () => {
    await db.insert(schema.skillsIndex).values({
      name: `mcp-skill-${Date.now()}`,
      scopePattern: testScope,
      domains: ["ops"],
      path: "ops/SKILL.md",
      description: "MCP skill",
      body: "---\nname: mcp-skill\n---\n# MCP Skill\n",
      sha: "sha-mcp",
      syncedAt: new Date(),
    });

    const { mcpClient } = await makeRoundtrip(viewerPrincipalId);
    const listed = await mcpClient.callTool({
      name: "list_skills",
      arguments: { scope: testScope, domain: "ops" },
    });
    expect((listed as any).isError).toBeFalsy();
    const listedJson = JSON.parse((listed as any).content?.[0]?.text || "[]");
    const listedSkill = listedJson.find((skill: any) => skill.description === "MCP skill");
    expect(listedSkill).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(listedSkill, "body")).toBe(false);

    const got = await mcpClient.callTool({
      name: "get_skill",
      arguments: { name: listedSkill.name },
    });
    expect((got as any).isError).toBeFalsy();
    const gotJson = JSON.parse((got as any).content?.[0]?.text || "{}");
    expect(gotJson.body).toContain("# MCP Skill");
  });

  // M2-01 metrics MCP roundtrips: groupBy date and dim key asserted
  it("query_metrics via MCP roundtrips groupBy=date and groupBy dim key; write + list_metric_names work", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId);

    // write via mcp (idempotent)
    const w = await mcpClient.callTool({
      name: "write_metrics",
      arguments: {
        scope: testScope,
        points: [
          { metric: "test.mcp", date: "2026-07-01", value: 42, dims: { v: "x" } },
        ],
      },
    });
    expect((w as any).isError).toBeFalsy();
    expect((w as any).content?.[0]?.text || "").toMatch(/Wrote 1/);

    // groupBy date
    const qDate = await mcpClient.callTool({
      name: "query_metrics",
      arguments: {
        scope: testScope,
        metrics: ["meta.spend"],
        from: "2026-06-01",
        to: "2026-06-02",
        groupBy: "date",
      },
    });
    const dateText = (qDate as any).content?.[0]?.text || "";
    expect(dateText).toContain("meta.spend:");
    expect(dateText).toContain("2026-06-01=133"); // 111+22
    expect(dateText).toContain("2026-06-02=333");

    // groupBy dim key
    const qDim = await mcpClient.callTool({
      name: "query_metrics",
      arguments: {
        scope: testScope,
        metrics: ["meta.spend"],
        from: "2026-06-01",
        to: "2026-06-02",
        groupBy: "campaign",
      },
    });
    const dimText = (qDim as any).content?.[0]?.text || "";
    expect(dimText).toContain("campaign=prospecting");
    expect(dimText).toContain("campaign=retargeting");

    // list_metric_names
    const ln = await mcpClient.callTool({ name: "list_metric_names", arguments: { scope: testScope } });
    const lnText = (ln as any).content?.[0]?.text || "";
    expect(lnText).toContain("meta.spend");
    expect(lnText).toContain("ga4.sessions");
    expect(lnText).toContain("test.mcp");
  });

  // M2-02 dashboards MCP roundtrips: 5 tools, validation, revert, vocab
  it("dashboards MCP tools round-trip: list_widget_types, save/get/list, revert; validation errors; agent write ok", async () => {
    const { mcpClient } = await makeRoundtrip(rootPrincipalId);

    // list_widget_types (no auth)
    const vocabRes = await mcpClient.callTool({ name: "list_widget_types", arguments: {} });
    const vocabText = (vocabRes as any).content?.[0]?.text || "";
    expect(vocabText).toContain("metric-card");
    expect(vocabText).toContain("text");
    expect(vocabText).toContain("maxWidgets");
    const vocab = JSON.parse(vocabText);
    expect(vocab.types.length).toBe(7);
    expect(vocab.types.some((t: any) => t.example && t.example.id)).toBe(true);

    // save valid
    const validSpec = {
      version: 1,
      title: "MCP Dash",
      range: { default: "7d" },
      widgets: [
        { id: "spend", type: "metric-card", grid: { x: 0, y: 0, w: 3, h: 2 }, query: { metrics: ["meta.spend"] } },
        { id: "txt", type: "text", grid: { x: 4, y: 0, w: 8, h: 2 }, options: { markdown: "hello" } },
      ],
    };
    const saveRes = await mcpClient.callTool({
      name: "save_dashboard",
      arguments: { scope: testScope, spec: validSpec },
    });
    expect((saveRes as any).isError).toBeFalsy();
    expect((saveRes as any).content?.[0]?.text).toMatch(/Saved dashboard/);

    // get
    const getRes = await mcpClient.callTool({ name: "get_dashboard", arguments: { scope: testScope } });
    const getText = (getRes as any).content?.[0]?.text || "";
    expect(getText).toContain("MCP Dash");
    expect(getText).toContain("metric-card");

    // list
    const listRes = await mcpClient.callTool({ name: "list_dashboards", arguments: { scope: testScope } });
    expect((listRes as any).content?.[0]?.text).toMatch(/main/);

    // save again to create rev history
    const spec2 = { ...validSpec, title: "MCP Dash v2" };
    await mcpClient.callTool({ name: "save_dashboard", arguments: { scope: testScope, spec: spec2 } });

    // list revisions? indirectly via revert: first get revs? use list via service not direct, but to get a rev id we can use get after? Wait, for test call revert with known? 
    // To get rev id, save then revert using a prior; use second save, listRevs not exposed directly, but we can save a third and revert to earlier via knowing flow.
    // For simplicity, use get to confirm, then save third, but to test revert need id: use direct? since roundtrip via mcp we use listRevisions? no tool for list revs. 
    // Revert tool exists, but to obtain id, we can use a second save then revert using previous? But MCP has no list_revisions tool (per brief only 5).
    // Workaround: use a revision id by first saving, note we can call save again, but to obtain rev id we use a hack in test via api? or skip direct id and test validation + save/get.
    // Better: use api listRevisions in test setup to fetch an id for mcp revert test (allowed in roundtrip test).
    const { listRevisions } = await import("@companyos/api");
    const revs = await listRevisions(db, { scopePath: testScope }, rootPrincipalId);
    expect(revs.length).toBeGreaterThan(1);
    const oldRev = revs[revs.length - 1]!.id; // oldest

    const revRes = await mcpClient.callTool({
      name: "revert_dashboard",
      arguments: { scope: testScope, revision_id: oldRev },
    });
    expect((revRes as any).isError).toBeFalsy();
    expect((revRes as any).content?.[0]?.text).toMatch(/Reverted/);

    // verify reverted
    const after = await mcpClient.callTool({ name: "get_dashboard", arguments: { scope: testScope } });
    const afterText = (after as any).content?.[0]?.text || "";
    expect(afterText).toContain("MCP Dash"); // back to v1 title

    // validation error via mcp
    const badSpec = { version: 1, title: "Bad", range: { default: "7d" }, widgets: [{ id: "q", type: "metric-card", grid: { x: 0, y: 0, w: 2, h: 2 } }] };
    const badRes = await mcpClient.callTool({ name: "save_dashboard", arguments: { scope: testScope, spec: badSpec } });
    expect((badRes as any).isError).toBe(true);
    expect((badRes as any).content?.[0]?.text).toMatch(/validation failed|query is required/i);

    // agent can save
    const { mcpClient: agentClient } = await makeRoundtrip(agentPrincipalId);
    const agSave = await agentClient.callTool({ name: "save_dashboard", arguments: { scope: testScope, spec: validSpec } });
    expect((agSave as any).isError).toBeFalsy();
  });

  function mcpPostHeaders(token?: string, extra?: HeadersInit): Headers {
    const headers = new Headers(extra);
    headers.set("accept", "application/json, text/event-stream");
    headers.set("content-type", "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);
    return headers;
  }

  function initializeBody(id = 1): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "vitest-http", version: "0.0.0" },
      },
    });
  }

  async function tokenRowByName(name: string) {
    const [row] = await db
      .select()
      .from(schema.tokens)
      .where(and(eq(schema.tokens.principalId, agentPrincipalId), eq(schema.tokens.name, name)))
      .limit(1);
    return row as any;
  }

  async function makeHttpClient(token: string) {
    const handler = createHttpHandler({
      db,
      allowedOrigins: ["https://client.test"],
      rateLimit: { maxRequests: 1000 },
    });
    const fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      return handler(new Request(url, init));
    };
    const transport = new StreamableHTTPClientTransport(new URL("https://companyos.test/api/mcp"), {
      fetch: fetchImpl,
      requestInit: {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://client.test",
        },
      },
    });
    const mcpClient = new Client({ name: "http-test-client", version: "0.0.0" });
    await mcpClient.connect(transport);
    return { mcpClient, transport };
  }

  it("forwards WWW-Authenticate from a 401 auth callback", async () => {
    const handler = createHttpHandler({
      db,
      authenticateRequest: async () => {
        const error = new Error("Unauthorized") as Error & { status?: number; wwwAuthenticate?: string };
        error.status = 401;
        error.wwwAuthenticate = 'Bearer resource_metadata="https://companyos.test/.well-known/oauth-protected-resource/api/mcp"';
        throw error;
      },
    });

    const response = await handler(new Request("https://companyos.test/api/mcp", { method: "POST", body: initializeBody() }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  });

  it("HTTP auth matrix covers valid, invalid, revoked, expired, and absent tokens", async () => {
    const handler = createHttpHandler({ db, allowedOrigins: ["https://client.test"] });
    const valid = await issueToken(db, { principalId: agentPrincipalId, name: "http-valid" }, rootPrincipalId);
    const revoked = await issueToken(db, { principalId: agentPrincipalId, name: "http-revoked" }, rootPrincipalId);
    const revokedRow = await tokenRowByName("http-revoked");
    await revokeToken(db, revokedRow.id, rootPrincipalId);
    const expired = await issueToken(
      db,
      { principalId: agentPrincipalId, name: "http-expired", expiresAt: new Date(Date.now() - 60_000) },
      rootPrincipalId
    );

    const postInit = (token?: string) =>
      handler(new Request("https://companyos.test/api/mcp", {
        method: "POST",
        headers: mcpPostHeaders(token, { origin: "https://client.test" }),
        body: initializeBody(),
      }));

    await expect((await postInit(valid)).status).toBe(200);
    await expect((await postInit("cos_invalid")).status).toBe(401);
    await expect((await postInit(revoked)).status).toBe(401);
    await expect((await postInit(expired)).status).toBe(401);
    await expect((await postInit()).status).toBe(401);
  });

  it("HTTP MCP roundtrip supports whoami, get_context, save_report, and subtree authorization", async () => {
    const token = await issueToken(db, { principalId: agentPrincipalId, name: "http-roundtrip" }, rootPrincipalId);
    const { mcpClient } = await makeHttpClient(token);

    const who = await mcpClient.callTool({ name: "whoami", arguments: {} });
    const whoJson = JSON.parse((who as any).content?.[0]?.text || "{}");
    expect(whoJson.principal).toMatchObject({
      id: agentPrincipalId,
      kind: "agent",
    });
    expect(whoJson.grants).toEqual(
      expect.arrayContaining([
        { scopePath: testScope, role: "agent" },
        { scopePath: subScope, role: "agent" },
      ])
    );

    const context = await mcpClient.callTool({ name: "get_context", arguments: { scope: testScope } });
    expect((context as any).isError).toBeFalsy();
    expect((context as any).content?.[0]?.text || "").toContain(`path: ${testScope}`);

    const report = await mcpClient.callTool({
      name: "save_report",
      arguments: { scope: subScope, title: "HTTP report", body_md: "Saved over remote MCP HTTP." },
    });
    expect((report as any).isError).toBeFalsy();
    expect((report as any).content?.[0]?.text || "").toMatch(/Created report/);

    const other = "other-http-" + Date.now();
    await createScope(db, { slug: other, name: "Other HTTP", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: other, role: "editor" }, rootPrincipalId);
    const denied = await mcpClient.callTool({
      name: "save_report",
      arguments: { scope: other, title: "Denied", body_md: "no" },
    });
    expect((denied as any).isError).toBe(true);
    expect((denied as any).content?.[0]?.text || "").toMatch(/Access denied/);

    const tokenRow = await tokenRowByName("http-roundtrip");
    const usageRows = await db
      .select()
      .from(schema.usageEvents)
      .where(and(eq(schema.usageEvents.source, "mcp_http"), eq(schema.usageEvents.tokenId, tokenRow.id)));
    expect(usageRows.map((row: any) => row.operation)).toEqual(expect.arrayContaining(["whoami", "get_context", "save_report"]));
    const getContextUsage = usageRows.find((row: any) => row.operation === "get_context");
    expect(getContextUsage).toMatchObject({
      principalId: agentPrincipalId,
      tokenId: tokenRow.id,
      success: true,
    });
    expect(getContextUsage.byteIn).toBeGreaterThan(0);
    expect(getContextUsage.byteOut).toBeGreaterThan(0);
    expect(getContextUsage.totalTokensEst).toBeGreaterThan(0);
    const audit = JSON.stringify(usageRows);
    expect(audit).not.toContain(token);
    expect(audit).not.toContain("Saved over remote MCP HTTP.");
  });

  it("HTTP usage logging failure does not fail the underlying MCP tool call", async () => {
    const token = await issueToken(db, { principalId: agentPrincipalId, name: "http-usage-fail-open" }, rootPrincipalId);
    const brokenDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "insert") {
          return (table: any) => {
            if (table === schema.usageEvents) {
              throw new Error("usage insert unavailable");
            }
            return target.insert(table);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const handler = createHttpHandler({
      db: brokenDb,
      allowedOrigins: ["https://client.test"],
      rateLimit: { maxRequests: 1000 },
    });
    const transport = new StreamableHTTPClientTransport(new URL("https://companyos.test/api/mcp"), {
      fetch: (url: string | URL, init?: RequestInit) => handler(new Request(url, init)),
      requestInit: {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://client.test",
        },
      },
    });
    const mcpClient = new Client({ name: "http-usage-fail-open", version: "0.0.0" });
    await mcpClient.connect(transport);

    const who = await mcpClient.callTool({ name: "whoami", arguments: {} });
    expect((who as any).isError).toBeFalsy();
    expect((who as any).content?.[0]?.text || "").toContain(agentPrincipalId);
  });

  it("connect-minted token authenticates over HTTP with only the target subtree and 401s after connect revoke", async () => {
    const connectScope = `connect-http-${Date.now()}`;
    await createScope(db, { slug: connectScope, name: "Connect HTTP", type: "project" }, rootPrincipalId);
    await createScope(db, { parentPath: connectScope, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: connectScope, role: "admin" }, rootPrincipalId);

    const sibling = `${connectScope}-sibling`;
    await createScope(db, { slug: sibling, name: "Sibling", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: sibling, role: "admin" }, rootPrincipalId);

    const minted = await mintConnectionToken(
      db,
      { scopePath: connectScope, name: "HTTP Connect Agent", role: "agent" },
      rootPrincipalId
    );
    const { mcpClient } = await makeHttpClient(minted.token);

    const who = await mcpClient.callTool({ name: "whoami", arguments: {} });
    const whoJson = JSON.parse((who as any).content?.[0]?.text || "{}");
    expect(whoJson.principal).toMatchObject({
      id: minted.principalId,
      kind: "agent",
      name: "HTTP Connect Agent",
    });
    expect(whoJson.grants).toEqual([{ scopePath: connectScope, role: "agent" }]);

    const childWrite = await mcpClient.callTool({
      name: "save_report",
      arguments: { scope: `${connectScope}/child`, title: "Connect child", body_md: "ok" },
    });
    expect((childWrite as any).isError).toBeFalsy();

    const siblingWrite = await mcpClient.callTool({
      name: "save_report",
      arguments: { scope: sibling, title: "Denied sibling", body_md: "no" },
    });
    expect((siblingWrite as any).isError).toBe(true);
    expect((siblingWrite as any).content?.[0]?.text || "").toMatch(/Access denied/);

    await revokeConnectionToken(db, { tokenId: minted.tokenId }, rootPrincipalId);
    await expect(mcpClient.callTool({ name: "whoami", arguments: {} })).rejects.toThrow(/401|Unauthorized/i);
  });

  it("revoked HTTP token fails on the very next request and last_used_at bumps on auth", async () => {
    const token = await issueToken(db, { principalId: agentPrincipalId, name: "http-revoke-next" }, rootPrincipalId);
    const before = await tokenRowByName("http-revoke-next");
    expect(before.lastUsedAt).toBeNull();

    const { mcpClient } = await makeHttpClient(token);
    const who = await mcpClient.callTool({ name: "whoami", arguments: {} });
    expect((who as any).isError).toBeFalsy();

    const after = await tokenRowByName("http-revoke-next");
    expect(after.lastUsedAt).toBeInstanceOf(Date);

    await revokeToken(db, after.id, rootPrincipalId);
    await expect(mcpClient.callTool({ name: "whoami", arguments: {} })).rejects.toThrow(/401|Unauthorized/i);
  });

  it("HTTP guardrails reject query-string tokens, bad origins, oversize bodies, and rate bursts without leaking tokens", async () => {
    const token = await issueToken(db, { principalId: agentPrincipalId, name: "http-guardrails" }, rootPrincipalId);
    const handler = createHttpHandler({
      db,
      allowedOrigins: ["https://client.test"],
      maxBodyBytes: 64,
      rateLimit: { windowMs: 60_000, maxRequests: 2 },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const queryToken = await handler(new Request(`https://companyos.test/api/mcp?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: mcpPostHeaders(undefined, { origin: "https://client.test" }),
        body: initializeBody(),
      }));
      const queryText = await queryToken.text();
      expect(queryToken.status).toBe(401);
      expect(queryText).not.toContain(token);

      const badOrigin = await handler(new Request("https://companyos.test/api/mcp", {
        method: "POST",
        headers: mcpPostHeaders(token, { origin: "https://evil.test" }),
        body: initializeBody(),
      }));
      expect(badOrigin.status).toBe(403);
      expect(await badOrigin.text()).not.toContain(token);

      const oversized = await handler(new Request("https://companyos.test/api/mcp", {
        method: "POST",
        headers: mcpPostHeaders(token, { origin: "https://client.test" }),
        body: JSON.stringify({ payload: "x".repeat(200) }),
      }));
      expect(oversized.status).toBe(413);

      const limited = await handler(new Request("https://companyos.test/api/mcp", {
        method: "POST",
        headers: mcpPostHeaders(token, { origin: "https://client.test" }),
        body: initializeBody(99),
      }));
      expect(limited.status).toBe(429);

      const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join("\n");
      expect(logged).not.toContain(token);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("MCP arming ritual (instructions + prompts)", () => {
  it("exports SERVER_INSTRUCTIONS carrying the ritual", () => {
    expect(typeof SERVER_INSTRUCTIONS).toBe("string");
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
    expect(SERVER_INSTRUCTIONS).toContain("recall_memory");
    expect(SERVER_INSTRUCTIONS).toContain("complete_session");
  });

  it("registers start_task and wrap_up prompts and renders start_task", async () => {
    const pg = new PGlite({ extensions: { vector } });
    const db2: any = drizzle(pg, { schema });
    await migrate(db2, { migrationsFolder });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "ritual-test", version: "0.0.0" });
    const server = createServer({ db: db2, principalId: null });
    await Promise.all([
      mcpClient.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    const prompts = await mcpClient.listPrompts();
    const names = (prompts.prompts || []).map((p: any) => p.name).sort();
    expect(names).toContain("start_task");
    expect(names).toContain("wrap_up");
    const got = await mcpClient.getPrompt({ name: "start_task", arguments: { scope: "root" } });
    expect(Array.isArray(got.messages)).toBe(true);
    expect(got.messages.length).toBeGreaterThan(0);
    const first: any = got.messages[0];
    const text: string = first?.content?.text ?? "";
    expect(text).toContain("get_context");
    await pg.close();
  });
});
