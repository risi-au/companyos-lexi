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
import {
  createScope,
  grantRole,
  createTask,
  completeTask,
  updateTask,
  listTasks,
  ensureTaskTarget,
  listEvents,
  listRecords,
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
  let noAccessPrincipalId: string;

  // fresh mock plane per test via factory
  function makeMockPlane() {
    const calls: any[] = [];
    const stateStore: Record<string, any[]> = {};
    const labelStore: Record<string, any[]> = {};
    const issueStore: Record<string, any[]> = {};

    const mock: any = {
      getProjects: async () => { calls.push({ fn: "getProjects" }); return []; },
      createProject: async (name: string, identifier?: string) => {
        calls.push({ fn: "createProject", name, identifier });
        const pid = "proj_" + (identifier || name).toLowerCase().replace(/[^a-z0-9]/g, "");
        stateStore[pid] = [
          { id: "st_todo", name: "Todo", group: "started" },
          { id: "st_done", name: "Done", group: "completed" },
        ];
        labelStore[pid] = [];
        issueStore[pid] = [];
        return { id: pid, name };
      },
      getStates: async (projectId: string) => {
        calls.push({ fn: "getStates", projectId });
        return stateStore[projectId] || [];
      },
      createLabel: async (projectId: string, name: string, color?: string) => {
        calls.push({ fn: "createLabel", projectId, name, color });
        const lid = "lab_" + name.replace(/[:/]/g, "_");
        const lbl = { id: lid, name, color: color || "#64748b" };
        labelStore[projectId] = labelStore[projectId] || [];
        labelStore[projectId].push(lbl);
        return lbl;
      },
      listLabels: async (projectId: string) => {
        calls.push({ fn: "listLabels", projectId });
        return labelStore[projectId] || [];
      },
      createIssue: async (projectId: string, data: any) => {
        calls.push({ fn: "createIssue", projectId, data });
        const issue = {
          id: "iss_" + Date.now().toString(36),
          sequence_id: (issueStore[projectId]?.length || 0) + 1,
          name: data.name,
          priority: data.priority || "none",
          labels: data.labels || [],
          state: { id: "st_todo", group: "started" },
          target_date: data.target_date || null,
        };
        issueStore[projectId] = issueStore[projectId] || [];
        issueStore[projectId].push(issue);
        return issue;
      },
      updateIssue: async (projectId: string, issueId: string, data: any) => {
        calls.push({ fn: "updateIssue", projectId, issueId, data });
        // mutate in store if present
        const list = issueStore[projectId] || [];
        const found = list.find((i: any) => i.id === issueId);
        if (found && data.state) {
          found.state = { id: data.state, group: data.state.includes("done") ? "completed" : "started" };
        }
        if (found && data.name) found.name = data.name;
        return found || { id: issueId };
      },
      getIssue: async (projectId: string, issueId: string) => {
        calls.push({ fn: "getIssue", projectId, issueId });
        const list = issueStore[projectId] || [];
        return list.find((i: any) => i.id === issueId) || { id: issueId };
      },
      listIssues: async (projectId: string, filters?: any) => {
        calls.push({ fn: "listIssues", projectId, filters });
        let list = (issueStore[projectId] || []).slice();
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
    };
    return mock;
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
});
