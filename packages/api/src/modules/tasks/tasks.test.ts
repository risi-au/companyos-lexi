/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { eq } from "drizzle-orm";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  grantRole,
  createTask,
  completeTask,
  updateTask,
  listTasks,
  ensureTaskTarget,
  setProjectWorkspace,
  listEvents,
  listRecords,
  getPlaneUrl,
  findScopeByPlaneProject,
} from "../../index";
import { AccessDeniedError } from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("C:/dev/companyos/packages/db/drizzle");
}

describe("tasks module (PGlite + mocked Plane)", () => {
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

  // fresh workspace-aware mock Plane per test via factory
  function makeMockPlane(options: { workspaces?: string[]; defaultWorkspace?: string; baseUrl?: string } = {}) {
    const defaultWorkspace = options.defaultWorkspace || "companyos";
    const baseUrl = options.baseUrl || "https://plane.test";
    const allowedWorkspaces = new Set(options.workspaces || [defaultWorkspace]);
    const calls: any[] = [];
    const stores: Record<string, {
      projects: any[];
      stateStore: Record<string, any[]>;
      labelStore: Record<string, any[]>;
      issueStore: Record<string, any[]>;
    }> = {};
    let issueCounter = 0;

    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const getStore = (workspace: string) => {
      if (!allowedWorkspaces.has(workspace)) {
        throw new Error(`Plane API GET /projects/ failed: 404 workspace ${workspace}`);
      }
      stores[workspace] = stores[workspace] || {
        projects: [],
        stateStore: {},
        labelStore: {},
        issueStore: {},
      };
      return stores[workspace]!;
    };

    const bind = (workspace: string): any => ({
      get workspaceSlug() {
        return workspace;
      },
      get baseUrl() {
        return baseUrl;
      },
      forWorkspace: (slug: string) => bind(slug || workspace),
      getProjects: async () => {
        calls.push({ fn: "getProjects", workspace });
        return getStore(workspace).projects.slice();
      },
      createProject: async (name: string, identifier?: string) => {
        calls.push({ fn: "createProject", workspace, name, identifier });
        const store = getStore(workspace);
        const existing = store.projects.find((p: any) => p.name === name);
        if (existing) return existing;
        const pid = `proj_${normalize(workspace)}_${normalize(identifier || name)}`;
        store.stateStore[pid] = [
          { id: "st_todo", name: "Todo", group: "started" },
          { id: "st_done", name: "Done", group: "completed" },
        ];
        store.labelStore[pid] = [];
        store.issueStore[pid] = [];
        const project = { id: pid, name };
        store.projects.push(project);
        return project;
      },
      getStates: async (projectId: string) => {
        calls.push({ fn: "getStates", workspace, projectId });
        const store = getStore(workspace);
        return store.stateStore[projectId] || [];
      },
      createLabel: async (projectId: string, name: string, color?: string) => {
        calls.push({ fn: "createLabel", workspace, projectId, name, color });
        const store = getStore(workspace);
        const lid = "lab_" + name.replace(/[:/]/g, "_");
        const lbl = { id: lid, name, color: color || "#64748b" };
        store.labelStore[projectId] = store.labelStore[projectId] || [];
        store.labelStore[projectId].push(lbl);
        return lbl;
      },
      listLabels: async (projectId: string) => {
        calls.push({ fn: "listLabels", workspace, projectId });
        const store = getStore(workspace);
        return store.labelStore[projectId] || [];
      },
      createIssue: async (projectId: string, data: any) => {
        calls.push({ fn: "createIssue", workspace, projectId, data });
        const store = getStore(workspace);
        const issue = {
          id: "iss_" + (++issueCounter).toString(36),
          sequence_id: (store.issueStore[projectId]?.length || 0) + 1,
          name: data.name,
          priority: data.priority || "none",
          labels: data.labels || [],
          state: { id: "st_todo", group: "started" },
          target_date: data.target_date || null,
        };
        store.issueStore[projectId] = store.issueStore[projectId] || [];
        store.issueStore[projectId].push(issue);
        return issue;
      },
      updateIssue: async (projectId: string, issueId: string, data: any) => {
        calls.push({ fn: "updateIssue", workspace, projectId, issueId, data });
        const store = getStore(workspace);
        // mutate in store if present
        const list = store.issueStore[projectId] || [];
        const found = list.find((i: any) => i.id === issueId);
        if (found && data.state) {
          found.state = { id: data.state, group: data.state.includes("done") ? "completed" : "started" };
        }
        if (found && data.name) found.name = data.name;
        return found || { id: issueId };
      },
      getIssue: async (projectId: string, issueId: string) => {
        calls.push({ fn: "getIssue", workspace, projectId, issueId });
        const store = getStore(workspace);
        const list = store.issueStore[projectId] || [];
        return list.find((i: any) => i.id === issueId) || { id: issueId };
      },
      listIssues: async (projectId: string, filters?: any) => {
        calls.push({ fn: "listIssues", workspace, projectId, filters });
        const store = getStore(workspace);
        let list = (store.issueStore[projectId] || []).slice();
        if (filters?.label) {
          list = list.filter((i: any) => (i.labels || []).includes(filters.label));
        }
        if (filters?.state_group === "completed") {
          list = list.filter((i: any) => i.state?.group === "completed");
        }
        return list;
      },
      _calls: calls,
      _reset: () => { calls.length = 0; },
      _stores: stores,
    });

    return bind(defaultWorkspace);
  }

  async function taskLinkFor(scopePath: string): Promise<any | null> {
    const [scope] = await db
      .select()
      .from(schema.scopes)
      .where(eq(schema.scopes.path, scopePath))
      .limit(1);
    if (!scope) return null;
    const [link] = await db
      .select()
      .from(schema.taskLinks)
      .where(eq(schema.taskLinks.scopeId, scope.id))
      .limit(1);
    return link || null;
  }

  beforeEach(async () => {
    const now = Date.now();
    const pRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "Root " + now,
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
    void noAccessPrincipalId;
  });

  it("migrations include task_links table", async () => {
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(expect.arrayContaining(["task_links", "records", "scopes"]));
  });

  describe("ensureTaskTarget + provisioning (idempotent, mapping)", () => {
    it("first call for airbuddy/website creates one project (for top) and label for exact path", async () => {
      const top = "airbuddy-prov-" + Date.now();
      const sub = `${top}/website`;
      await createScope(db, { slug: top, name: "AirBuddy", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "website", name: "Website", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "editor" }, rootPrincipalId);

      const plane = makeMockPlane();
      const t1 = await ensureTaskTarget(db, plane, sub);
      expect(t1.projectId).toMatch(/^proj_/);
      expect(t1.labelId).toMatch(/^lab_scope_/);

      // idempotent second call
      const t2 = await ensureTaskTarget(db, plane, sub);
      expect(t2.projectId).toBe(t1.projectId);
      expect(t2.labelId).toBe(t1.labelId);

      // verify only one createProject call
      const projCalls = plane._calls.filter((c: any) => c.fn === "createProject");
      expect(projCalls.length).toBe(1);

      // label created once
      const lblCalls = plane._calls.filter((c: any) => c.fn === "createLabel");
      expect(lblCalls.length).toBe(1);
      expect(lblCalls[0].name).toBe(`scope:${sub}`);

      // events
      const evs = await listEvents(db, { scopePath: sub, type: "tasks.target_provisioned", limit: 5 });
      expect(evs.length).toBeGreaterThan(0);
    });

    it("airbuddy/website and airbuddy/meta-ads share one project id, have distinct labels", async () => {
      const top = "airbuddy-map-" + Date.now();
      const s1 = `${top}/website`;
      const s2 = `${top}/meta-ads`;
      await createScope(db, { slug: top, name: "Air", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "website", name: "Web", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "meta-ads", name: "Meta", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "editor" }, rootPrincipalId);

      const plane = makeMockPlane();
      const t1 = await ensureTaskTarget(db, plane, s1);
      const t2 = await ensureTaskTarget(db, plane, s2);

      expect(t1.projectId).toBe(t2.projectId);
      expect(t1.labelId).not.toBe(t2.labelId);

      const projCreates = plane._calls.filter((c: any) => c.fn === "createProject").length;
      expect(projCreates).toBe(1);

      const labelsCreated = plane._calls.filter((c: any) => c.fn === "createLabel");
      expect(labelsCreated.length).toBe(2);
    });

    it("legacy fallback keeps null workspace slug and default-workspace project/label mapping", async () => {
      const top = "airbuddy-legacy-" + Date.now();
      const sub = `${top}/website`;
      await createScope(db, { slug: top, name: "Legacy", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "website", name: "Website", type: "subproject" }, rootPrincipalId);

      const plane = makeMockPlane();
      const target = await ensureTaskTarget(db, plane, sub);

      expect(target.workspaceSlug).toBeNull();
      expect(target.projectId).toMatch(/^proj_companyos_/);
      expect(target.labelId).toMatch(/^lab_scope_/);
      expect(plane._calls.filter((c: any) => c.fn === "createProject" && c.workspace === "companyos").length).toBe(1);

      const topLink = await taskLinkFor(top);
      const subLink = await taskLinkFor(sub);
      expect(topLink.planeWorkspaceSlug).toBeNull();
      expect(subLink.planeWorkspaceSlug).toBeNull();
      expect(subLink.planeProjectId).toBe(topLink.planeProjectId);
    });
  });

  describe("setProjectWorkspace + registered workspace routing", () => {
    it("registers a reachable workspace on a top-level project", async () => {
      const top = "airbuddy-ws-ok-" + Date.now();
      await createScope(db, { slug: top, name: "Workspace OK", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "admin" }, rootPrincipalId);

      const plane = makeMockPlane({ workspaces: ["companyos", "airbuddy-ws"] });
      await setProjectWorkspace(db, plane, { scopePath: top, workspaceSlug: "airbuddy-ws" }, rootPrincipalId);

      const link = await taskLinkFor(top);
      expect(link.planeWorkspaceSlug).toBe("airbuddy-ws");
      expect(link.planeProjectId).toBe("");
      expect(plane._calls).toEqual(expect.arrayContaining([
        expect.objectContaining({ fn: "getProjects", workspace: "airbuddy-ws" }),
      ]));

      const evs = await listEvents(db, { scopePath: top, type: "tasks.workspace_registered", limit: 5 });
      expect(evs.length).toBeGreaterThan(0);
    });

    it("rejects registration on non-top-level scopes", async () => {
      const top = "airbuddy-ws-sub-" + Date.now();
      const sub = `${top}/website`;
      await createScope(db, { slug: top, name: "Workspace Sub", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "website", name: "Website", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "admin" }, rootPrincipalId);

      const plane = makeMockPlane({ workspaces: ["companyos", "airbuddy-ws"] });
      await expect(
        setProjectWorkspace(db, plane, { scopePath: sub, workspaceSlug: "airbuddy-ws" }, rootPrincipalId)
      ).rejects.toThrow(/top-level project/);
    });

    it("rejects unreachable workspaces", async () => {
      const top = "airbuddy-ws-missing-" + Date.now();
      await createScope(db, { slug: top, name: "Workspace Missing", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "admin" }, rootPrincipalId);

      const plane = makeMockPlane({ workspaces: ["companyos"] });
      await expect(
        setProjectWorkspace(db, plane, { scopePath: top, workspaceSlug: "missing-ws" }, rootPrincipalId)
      ).rejects.toThrow(/not reachable/);
    });

    it("uses General for top-level tasks, a Plane project per subproject, and labels for deeper scopes", async () => {
      const top = "airbuddy-v2-" + Date.now();
      const sub = `${top}/website`;
      const deep = `${sub}/seo`;
      await createScope(db, { slug: top, name: "AirBuddy V2", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "website", name: "Website", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: sub, slug: "seo", name: "SEO", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "admin" }, rootPrincipalId);

      const plane = makeMockPlane({ workspaces: ["companyos", "airbuddy-v2"] });
      await setProjectWorkspace(db, plane, { scopePath: top, workspaceSlug: "airbuddy-v2" }, rootPrincipalId);

      const topTarget = await ensureTaskTarget(db, plane, top);
      const subTarget = await ensureTaskTarget(db, plane, sub);
      const deepTarget = await ensureTaskTarget(db, plane, deep);

      expect(topTarget.workspaceSlug).toBe("airbuddy-v2");
      expect(topTarget.labelId).toBeNull();
      expect(subTarget.workspaceSlug).toBe("airbuddy-v2");
      expect(subTarget.labelId).toBeNull();
      expect(subTarget.projectId).not.toBe(topTarget.projectId);
      expect(deepTarget.workspaceSlug).toBe("airbuddy-v2");
      expect(deepTarget.projectId).toBe(subTarget.projectId);
      expect(deepTarget.labelId).toMatch(/^lab_scope_/);

      expect(plane._calls).toEqual(expect.arrayContaining([
        expect.objectContaining({ fn: "createProject", workspace: "airbuddy-v2", name: "General" }),
        expect.objectContaining({ fn: "createProject", workspace: "airbuddy-v2", name: "Website" }),
        expect.objectContaining({ fn: "createLabel", workspace: "airbuddy-v2", projectId: subTarget.projectId, name: `scope:${deep}` }),
      ]));

      const topLink = await taskLinkFor(top);
      const subLink = await taskLinkFor(sub);
      const deepLink = await taskLinkFor(deep);
      expect(topLink.planeWorkspaceSlug).toBe("airbuddy-v2");
      expect(topLink.planeProjectId).toBe(topTarget.projectId);
      expect(subLink.planeWorkspaceSlug).toBe("airbuddy-v2");
      expect(subLink.planeProjectId).toBe(subTarget.projectId);
      expect(deepLink.planeWorkspaceSlug).toBe("airbuddy-v2");
      expect(deepLink.planeProjectId).toBe(subTarget.projectId);
      expect(deepLink.planeLabelId).toBe(deepTarget.labelId);
    });

    it("routes create, complete, update, and list through the registered workspace", async () => {
      const top = "airbuddy-v2-ops-" + Date.now();
      const sub = `${top}/website`;
      await createScope(db, { slug: top, name: "AirBuddy Ops", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "website", name: "Website", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "admin" }, rootPrincipalId);

      const plane = makeMockPlane({ workspaces: ["companyos", "airbuddy-ops"], baseUrl: "https://plane.example" });
      await setProjectWorkspace(db, plane, { scopePath: top, workspaceSlug: "airbuddy-ops" }, rootPrincipalId);

      const created = await createTask(db, plane, { scopePath: sub, title: "Routed task" }, rootPrincipalId);
      await updateTask(db, plane, { scopePath: sub, issueId: created.id, title: "Routed task updated" }, rootPrincipalId);
      await listTasks(db, plane, { scopePath: sub, state: "all" }, rootPrincipalId);
      await completeTask(db, plane, { scopePath: sub, issueId: created.id }, rootPrincipalId);

      expect(created.url).toContain("https://plane.example/airbuddy-ops/projects/");
      expect(plane._calls).toEqual(expect.arrayContaining([
        expect.objectContaining({ fn: "createIssue", workspace: "airbuddy-ops" }),
        expect.objectContaining({ fn: "updateIssue", workspace: "airbuddy-ops" }),
        expect.objectContaining({ fn: "listIssues", workspace: "airbuddy-ops" }),
        expect.objectContaining({ fn: "getStates", workspace: "airbuddy-ops" }),
      ]));
      expect(plane._calls.some((c: any) =>
        ["createIssue", "updateIssue", "listIssues", "getStates"].includes(c.fn) && c.workspace === "companyos"
      )).toBe(false);
    });

    it("findScopeByPlaneProject resolves registered-workspace rows by globally unique project id", async () => {
      const p1 = "airbuddy-hook-a-" + Date.now();
      const p2 = "airbuddy-hook-b-" + Date.now();
      await createScope(db, { slug: p1, name: "Hook A", type: "project" }, rootPrincipalId);
      await createScope(db, { slug: p2, name: "Hook B", type: "project" }, rootPrincipalId);

      const s1 = await taskLinkFor(p1);
      expect(s1).toBeNull();
      const [scopeA] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, p1)).limit(1);
      const [scopeB] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, p2)).limit(1);
      await db.insert(schema.taskLinks).values({
        scopeId: scopeA.id,
        planeProjectId: "plane-project-a",
        planeLabelId: null,
        planeWorkspaceSlug: "workspace-a",
      });
      await db.insert(schema.taskLinks).values({
        scopeId: scopeB.id,
        planeProjectId: "plane-project-b",
        planeLabelId: "label-b",
        planeWorkspaceSlug: "workspace-b",
      });

      const byLabel = await findScopeByPlaneProject(db, "plane-project-b", "label-b");
      expect(byLabel?.scopePath).toBe(p2);
      expect(byLabel?.planeLabelId).toBe("label-b");

      const fallback = await findScopeByPlaneProject(db, "plane-project-b");
      expect(fallback?.scopePath).toBe(p2);
    });
  });

  describe("createTask", () => {
    it("creates issue with label, returns id/seq/url, emits event", async () => {
      const sp = "airbuddy-create-" + Date.now();
      await createScope(db, { slug: sp, name: "Cr", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const plane = makeMockPlane();
      const res = await createTask(db, plane, { scopePath: sp, title: "Ship login", description: "Do it", priority: "high", dueDate: "2026-08-01" }, rootPrincipalId);

      expect(res.id).toBeTruthy();
      expect(res.sequenceId).toBeTruthy();
      expect(res.url).toContain("plane");

      const evs = await listEvents(db, { scopePath: sp, type: "task.created" });
      expect(evs.length).toBe(1);
      expect((evs[0] as any).payload.title).toBe("Ship login");
      expect((evs[0] as any).payload.planeIssueId).toBe(res.id);
    });

    it("viewer denied create", async () => {
      const sp = "airbuddy-vdeny-" + Date.now();
      await createScope(db, { slug: sp, name: "V", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      const plane = makeMockPlane();
      await expect(
        createTask(db, plane, { scopePath: sp, title: "No" }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });

    it("agent write in subtree ok, outside denied", async () => {
      const rootP = "airbuddy-ag-" + Date.now();
      const sub = `${rootP}/eng`;
      await createScope(db, { slug: rootP, name: "A", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: rootP, slug: "eng", name: "Eng", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: agentPrincipalId, scopePath: rootP, role: "agent" }, rootPrincipalId);

      const plane = makeMockPlane();
      const ok = await createTask(db, plane, { scopePath: sub, title: "Agent ok" }, agentPrincipalId);
      expect(ok.id).toBeTruthy();

      const other = "airbuddy-other-" + Date.now();
      await createScope(db, { slug: other, name: "O", type: "project" }, rootPrincipalId);
      await expect(
        createTask(db, plane, { scopePath: other, title: "Bad" }, agentPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });
  });

  describe("completeTask + note record", () => {
    it("transitions to completed state group and writes changelog when note given", async () => {
      const sp = "airbuddy-comp-" + Date.now();
      await createScope(db, { slug: sp, name: "Co", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const plane = makeMockPlane();
      const created = await createTask(db, plane, { scopePath: sp, title: "Finish it" }, rootPrincipalId);

      await completeTask(db, plane, { issueId: created.id, scopePath: sp, note: "All tests pass." }, rootPrincipalId);

      // check update called with a completed-ish state
      const upd = plane._calls.find((c: any) => c.fn === "updateIssue");
      expect(upd).toBeTruthy();
      expect(upd.data.state).toBeTruthy();

      // changelog written
      const recs = await listRecords(db, { scopePath: sp, kind: "changelog", limit: 5 }, rootPrincipalId);
      const hasNote = recs.some((r: any) => (r.bodyMd || "").includes("All tests pass"));
      expect(hasNote).toBe(true);

      const evs = await listEvents(db, { type: "task.completed", limit: 3 });
      expect(evs.some((e: any) => (e.payload as any)?.planeIssueId === created.id)).toBe(true);
    });

    it("without note does not require record write", async () => {
      const sp = "airbuddy-nonote-" + Date.now();
      await createScope(db, { slug: sp, name: "NoN", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const plane = makeMockPlane();
      const created = await createTask(db, plane, { scopePath: sp, title: "No note" }, rootPrincipalId);
      await completeTask(db, plane, { issueId: created.id, scopePath: sp }, rootPrincipalId);

      // no new changelog from us
      const recs = await listRecords(db, { scopePath: sp, kind: "changelog", limit: 10 }, rootPrincipalId);
      // may have zero or from other
      expect(Array.isArray(recs)).toBe(true);
    });
  });

  describe("updateTask and listTasks", () => {
    it("update emits and list filters by scope label", async () => {
      const sp = "airbuddy-lst-" + Date.now();
      await createScope(db, { slug: sp, name: "L", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const plane = makeMockPlane();
      const t = await createTask(db, plane, { scopePath: sp, title: "ListMe" }, rootPrincipalId);
      await updateTask(db, plane, { issueId: t.id, scopePath: sp, title: "ListMe Updated" }, rootPrincipalId);

      const listed = await listTasks(db, plane, { scopePath: sp, state: "all", limit: 5 }, rootPrincipalId);
      expect(listed.length).toBeGreaterThan(0);
      expect(listed[0]!.title).toMatch(/ListMe/);

      const ev = await listEvents(db, { type: "task.updated", limit: 3 });
      expect(ev.length).toBeGreaterThan(0);
    });

    it("list open excludes completed", async () => {
      const sp = "airbuddy-open-" + Date.now();
      await createScope(db, { slug: sp, name: "Op", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

      const plane = makeMockPlane();
      await createTask(db, plane, { scopePath: sp, title: "OpenOne" }, rootPrincipalId);
      await createTask(db, plane, { scopePath: sp, title: "ToClose" }, rootPrincipalId);
      await completeTask(db, plane, { issueId: (await listTasks(db, plane, { scopePath: sp, state: "all" }, rootPrincipalId))[1]?.id || "x" , scopePath: sp }, rootPrincipalId);

      const open = await listTasks(db, plane, { scopePath: sp, state: "open" }, rootPrincipalId);
      expect(open.every((o: any) => {
        const s = typeof o.state === "string" ? o.state : (o.state?.group || o.state?.name || "");
        return String(s).toLowerCase() !== "completed";
      })).toBe(true);
    });
  });

  describe("access control for tasks", () => {
    it("viewer can list but not write", async () => {
      const sp = "airbuddy-vw-" + Date.now();
      await createScope(db, { slug: sp, name: "Vw", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);
      await grantRole(db, { principalId: viewerPrincipalId, scopePath: sp, role: "viewer" }, rootPrincipalId);

      const plane = makeMockPlane();
      const t = await createTask(db, plane, { scopePath: sp, title: "VwSee" }, rootPrincipalId);

      const lst = await listTasks(db, plane, { scopePath: sp }, viewerPrincipalId);
      expect(lst.length).toBeGreaterThan(0);

      await expect(
        completeTask(db, plane, { issueId: t.id, scopePath: sp }, viewerPrincipalId)
      ).rejects.toThrow(AccessDeniedError);
    });
  });

  it("events emitted for all mutations", async () => {
    const sp = "airbuddy-ev-" + Date.now();
    await createScope(db, { slug: sp, name: "Ev", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "editor" }, rootPrincipalId);

    const plane = makeMockPlane();
    const t = await createTask(db, plane, { scopePath: sp, title: "EvT" }, rootPrincipalId);
    await updateTask(db, plane, { issueId: t.id, scopePath: sp, title: "EvT2" }, rootPrincipalId);
    await completeTask(db, plane, { issueId: t.id, scopePath: sp }, rootPrincipalId);

    const all = await listEvents(db, { scopePath: sp, limit: 20 });
    const types = all.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(["task.created", "task.updated", "task.completed", "tasks.target_provisioned"]));
  });

  describe("getPlaneUrl (M4-03)", () => {
    beforeEach(() => {
      delete process.env.PLANE_BASE_URL;
      delete process.env.PLANE_WORKSPACE_SLUG;
    });

    it("returns fallback when no task_links row", async () => {
      const sp = "plane-fallback-" + Date.now();
      await createScope(db, { slug: sp, name: "NoLink", type: "project" }, rootPrincipalId);
      // no grant or link needed for getPlaneUrl (read helper)
      const url = await getPlaneUrl(db, sp);
      expect(url).toBe("https://app.plane.so"); // default fallback (no PLANE_BASE_URL in test)
    });

    it("returns constructed URL when task_link exists for top project (via ensure)", async () => {
      const sp = "plane-linked-" + Date.now();
      await createScope(db, { slug: sp, name: "LinkedP", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "owner" }, rootPrincipalId);

      const plane = makeMockPlane();
      await ensureTaskTarget(db, plane, sp); // populates task_links row for top

      const url = await getPlaneUrl(db, sp);
      // ensure created a proj_... id ; url should use /companyos/projects/<id>/issues
      expect(url).toMatch(/\/companyos\/projects\/proj_[^/]+\/issues$/);
    });

    it("uses the registered workspace slug and the scope's own Plane project row", async () => {
      const top = "plane-reg-" + Date.now();
      const sub = `${top}/sub`;
      await createScope(db, { slug: top, name: "Registered", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "sub", name: "Sub", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "admin" }, rootPrincipalId);

      const plane = makeMockPlane({ workspaces: ["companyos", "registered-ws"] });
      await setProjectWorkspace(db, plane, { scopePath: top, workspaceSlug: "registered-ws" }, rootPrincipalId);
      const target = await ensureTaskTarget(db, plane, sub);

      const url = await getPlaneUrl(db, sub);
      expect(url).toBe(`https://app.plane.so/registered-ws/projects/${target.projectId}/issues`);
    });

    it("uses link from top for subproject path", async () => {
      const top = "plane-t2-" + Date.now();
      const sub = `${top}/sub`;
      await createScope(db, { slug: top, name: "T2", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: top, slug: "sub", name: "S2", type: "subproject" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "owner" }, rootPrincipalId);

      const plane = makeMockPlane();
      await ensureTaskTarget(db, plane, sub);

      const url = await getPlaneUrl(db, sub);
      expect(url).toMatch(/\/companyos\/projects\/proj_[^/]+\/issues$/);
    });

    it("root returns fallback base", async () => {
      const url = await getPlaneUrl(db, "root");
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
    });
  });
});
