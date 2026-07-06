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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createScope,
  grantRole,
  createRecord,
  listRecords,
  writeMetrics,
  issueToken,
  revokeToken,
  mintConnectionToken,
  revokeConnectionToken,
  GitHubClient,
} from "@companyos/api";
import { createHttpHandler, createServer, ping } from "./index";

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

  async function makeRoundtrip(principalIdForServer: string | null, planeClient: any = null, githubClient: any = undefined) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
    const server = createServer({ db, principalId: principalIdForServer, planeClient, githubClient });

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
      "get_skill",
      "get_tree",
      "list_canvases",
      "list_capabilities",
      "list_alerts",
      "list_capability_runs",
      "list_dashboards",
      "list_doc_revisions",
      "list_docs",
      "list_metric_names",
      "list_records",
      "list_skills",
      "list_tasks",
      "list_widget_types",
      "log_change",
      "log_decision",
      "ping",
      "provision_scope",
      "query_metrics",
      "register_capability",
      "report_run",
      "revert_dashboard",
      "revert_doc",
      "save_canvas",
      "save_dashboard",
      "save_doc",
      "save_note",
      "save_report",
      "sync_skills",
      "update_task",
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
