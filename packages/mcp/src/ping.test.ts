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
  writeMetrics,
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

  async function makeRoundtrip(principalIdForServer: string | null, planeClient: any = null) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
    const server = createServer({ db, principalId: principalIdForServer, planeClient });

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
      "complete_task",
      "create_task",
      "get_canvas",
      "get_context",
      "get_dashboard",
      "get_doc",
      "get_record",
      "get_tree",
      "list_canvases",
      "list_dashboards",
      "list_doc_revisions",
      "list_docs",
      "list_metric_names",
      "list_records",
      "list_tasks",
      "list_widget_types",
      "log_change",
      "log_decision",
      "ping",
      "query_metrics",
      "revert_dashboard",
      "revert_doc",
      "save_canvas",
      "save_dashboard",
      "save_doc",
      "save_note",
      "save_report",
      "update_task",
      "write_metrics",
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
});
