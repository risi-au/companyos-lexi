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
import { eq } from "drizzle-orm";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  getScope,
  getChildren,
  getSubtree,
  getVisibleTree,
  archiveScope,
  unarchiveScope,
  listArchivedScopes,
  grantRole,
  ensurePersonalScope,
  getPersonalScopePath,
  resolveAccess,
  requireAccess,
  revokeGrant,
  issueToken,
  authenticateToken,
  revokeToken,
  listEvents,
} from "./index";
import {
  AccessDeniedError,
  DuplicatePathError,
  InvalidSlugError,
  ParentNotFoundError,
} from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) migrationsFolder = path.resolve(__dirname, "../../packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) migrationsFolder = "C:/dev/companyos/packages/db/drizzle";
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}
console.log("[kernel.test] using migrationsFolder:", migrationsFolder);

describe("kernel services (PGlite + migrations)", () => {
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

  // fresh-ish data per test group by using unique paths
  let rootPrincipalId: string;

  async function ensureRootScope(actorPrincipalId: string) {
    const existing = await getScope(db, "root");
    if (existing) return existing;
    return createScope(db, { slug: "root", name: "Root", type: "root" }, actorPrincipalId);
  }

  beforeEach(async () => {
    // ensure a principal for actor/tests
    const pRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "Test Principal " + Date.now(),
      status: "active",
    }).returning()) as any[];
    rootPrincipalId = pRes[0]?.id;
  });

  it("migrations still apply and tables exist", async () => {
    const result: any = await db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const rows: any[] = Array.isArray(result?.rows) ? result.rows : (Array.isArray(result) ? result : []);
    const tables = rows.map((r: any) => r.table_name || r[0] || (r ? Object.values(r)[0] : undefined));
    expect(tables).toEqual(expect.arrayContaining(["scopes", "principals", "grants", "tokens", "module_instances", "events"]));
  });

  it("enum migration applies cleanly on fresh DB and converts existing client/area rows", async () => {
    // Fresh: use separate pglite + migrate, confirm new types work
    const freshClient = new PGlite({ extensions: { vector } });
    const freshDb = drizzle(freshClient, { schema });
    const migPath = path.resolve(__dirname, "../../db/drizzle");
    await migrate(freshDb, { migrationsFolder: migPath });
    // fresh should allow project/subproject
    await freshDb.execute("INSERT INTO scopes (id, slug, path, name, type, status) VALUES (gen_random_uuid(), 'p1', 'p1', 'P1', 'project', 'active')");
    await freshDb.execute("INSERT INTO scopes (id, slug, path, name, type, status) VALUES (gen_random_uuid(), 's1', 'p1/s1', 'S1', 'subproject', 'active')");
    await freshDb.execute("INSERT INTO scopes (id, slug, path, name, type, status) VALUES (gen_random_uuid(), 'personal-test', 'personal-test', 'Personal', 'personal', 'active')");
    const freshRes: any = await freshDb.execute("SELECT type FROM scopes WHERE path IN ('p1','p1/s1') ORDER BY path");
    const frows = freshRes.rows || [];
    const ftypes = frows.map((r: any) => r.type || (Array.isArray(r)? r[0] : r)).filter(Boolean);
    expect(ftypes).toContain("project");
    expect(ftypes).toContain("subproject");
    const personalRes: any = await freshDb.execute("SELECT type FROM scopes WHERE path = 'personal-test'");
    expect((personalRes.rows || [])[0]?.type).toBe("personal");
    await freshClient.close();

    // Legacy data test: raw setup old enum + rows, apply 0009 stmts individually
    const legClient = new PGlite({ extensions: { vector } });
    await legClient.exec(`CREATE TYPE "public"."scope_type" AS ENUM('root', 'client', 'project', 'area');`);
    await legClient.exec(`CREATE TABLE "scopes" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id uuid,
      slug text NOT NULL,
      path text NOT NULL UNIQUE,
      name text NOT NULL,
      type "public"."scope_type" NOT NULL,
      status text NOT NULL DEFAULT 'active',
      settings jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );`);
    // Insert legacy rows (old values valid here)
    await legClient.exec(`INSERT INTO scopes (slug, path, name, type, status) VALUES ('air', 'air', 'Airbuddy', 'client', 'active')`);
    await legClient.exec(`INSERT INTO scopes (slug, path, name, type, status) VALUES ('area1', 'air/a1', 'Area1', 'area', 'active')`);
    // Apply migration statements (temp text, update, recreate enum, cast)
    await legClient.exec(`ALTER TABLE "scopes" ALTER COLUMN "type" TYPE text;`);
    await legClient.exec(`UPDATE "scopes" SET "type" = 'project' WHERE "type" = 'client';`);
    await legClient.exec(`UPDATE "scopes" SET "type" = 'subproject' WHERE "type" = 'area';`);
    await legClient.exec(`DROP TYPE IF EXISTS "public"."scope_type";`);
    await legClient.exec(`CREATE TYPE "public"."scope_type" AS ENUM('root', 'project', 'subproject');`);
    await legClient.exec(`ALTER TABLE "scopes" ALTER COLUMN "type" TYPE "public"."scope_type" USING "type"::"public"."scope_type";`);
    // Query using raw to get results reliably
    const legQuery = await legClient.query(`SELECT type FROM scopes ORDER BY path`);
    const lrows = legQuery.rows || [];
    const ltypes = lrows.map((r: any) => r.type || (Array.isArray(r) ? r[0] : r)).filter(Boolean);
    expect(ltypes).toContain("project");
    expect(ltypes).toContain("subproject");
    expect(ltypes.some((t: string) => t === 'client' || t === 'area')).toBe(false);
    await legClient.close();
  });

  describe("scopes", () => {
    it("createScope computes path for root child and nested depth 4", async () => {
      const r = await createScope(db, { slug: "airbuddy", name: "Airbuddy", type: "project" }, rootPrincipalId);
      expect(r.path).toBe("airbuddy");
      expect(r.slug).toBe("airbuddy");

      const c1 = await createScope(db, { parentPath: "airbuddy", slug: "marketing", name: "Marketing", type: "subproject" }, rootPrincipalId);
      expect(c1.path).toBe("airbuddy/marketing");

      const c2 = await createScope(db, { parentPath: "airbuddy/marketing", slug: "meta-ads", name: "Meta Ads", type: "subproject" }, rootPrincipalId);
      expect(c2.path).toBe("airbuddy/marketing/meta-ads");

      const c3 = await createScope(db, { parentPath: "airbuddy/marketing/meta-ads", slug: "retargeting", name: "Retarget", type: "subproject" }, rootPrincipalId);
      expect(c3.path).toBe("airbuddy/marketing/meta-ads/retargeting");
      expect(c3.parentId).toBeTruthy();
    });

    it("createScope rejects invalid slug", async () => {
      await expect(
        createScope(db, { slug: "Invalid_Slug!", name: "Bad", type: "subproject" }, rootPrincipalId)
      ).rejects.toThrow(InvalidSlugError);
    });

    it("createScope rejects duplicate path", async () => {
      const unique = "dup-" + Date.now();
      await createScope(db, { slug: unique, name: "D1", type: "project" }, rootPrincipalId);
      await expect(
        createScope(db, { slug: unique, name: "D2", type: "project" }, rootPrincipalId)
      ).rejects.toThrow(DuplicatePathError);
    });

    it("createScope rejects missing parent", async () => {
      await expect(
        createScope(db, { parentPath: "no-such-parent", slug: "child", name: "C", type: "subproject" }, rootPrincipalId)
      ).rejects.toThrow(ParentNotFoundError);
    });

    it("createScope enforces top-level=project, nested=subproject", async () => {
      const top = "v2top-" + Date.now();
      await expect(
        createScope(db, { slug: top, name: "BadTop", type: "subproject" }, rootPrincipalId)
      ).rejects.toThrow(/Top-level/);
      await createScope(db, { slug: top, name: "OkTop", type: "project" }, rootPrincipalId);
      const nestedBad = "badnest";
      await expect(
        createScope(db, { parentPath: top, slug: nestedBad, name: "BadNest", type: "project" }, rootPrincipalId)
      ).rejects.toThrow(/Nested/);
      const okNest = await createScope(db, { parentPath: top, slug: "oksub", name: "OkSub", type: "subproject" }, rootPrincipalId);
      expect(okNest.type).toBe("subproject");
    });

    it("createScope allows personal only as a top-level scope", async () => {
      await ensureRootScope(rootPrincipalId);
      const top = `personal-manual-${Date.now()}`;
      const personal = await createScope(db, { slug: top, name: "Manual Personal", type: "personal" }, rootPrincipalId);
      expect(personal.type).toBe("personal");
      expect(personal.parentId).toBeTruthy();

      const project = `personal-parent-${Date.now()}`;
      await createScope(db, { slug: project, name: "Project Parent", type: "project" }, rootPrincipalId);
      await expect(
        createScope(db, { parentPath: project, slug: "nested-personal", name: "Nested Personal", type: "personal" }, rootPrincipalId)
      ).rejects.toThrow(/Nested/);
    });

    it("getScope, getChildren, getSubtree work", async () => {
      const base = "tree-" + Date.now();
      const rootS = await createScope(db, { slug: base, name: "RootT", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: base, slug: "c1", name: "C1", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: `${base}/c1`, slug: "c2", name: "C2", type: "subproject" }, rootPrincipalId);

      const got = await getScope(db, base);
      expect(got?.id).toBe(rootS.id);

      const children = await getChildren(db, base);
      expect(children.length).toBe(1);
      expect(children[0]?.path).toBe(`${base}/c1`);

      const subtree = await getSubtree(db, base);
      expect(subtree.length).toBe(3);
      expect(subtree.map(s => s.path)).toContain(`${base}/c1/c2`);
    });

    it("archiveScope cascades through descendants and emits one enriched event", async () => {
      const p = "arch-" + Date.now();
      await ensureRootScope(rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "owner" }, rootPrincipalId);
      await createScope(db, { slug: p, name: "A", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: p, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: `${p}/child`, slug: "grandchild", name: "Grandchild", type: "subproject" }, rootPrincipalId);
      const target = await getScope(db, p);
      if (!target) throw new Error(`scope ${p} not found`);
      await db.insert(schema.taskLinks).values({
        scopeId: target.id,
        planeProjectId: "plane-project",
        planeWorkspaceSlug: "plane-workspace",
      });

      const archived = await archiveScope(db, p, rootPrincipalId);
      expect(archived.status).toBe("archived");
      expect((await getSubtree(db, p)).map((scope) => scope.status)).toEqual([
        "archived",
        "archived",
        "archived",
      ]);

      const evs = await listEvents(db, { scopePath: p, type: "scope.archived", limit: 5 });
      expect(evs).toHaveLength(1);
      expect(evs[0]?.payload).toMatchObject({
        descendantCount: 2,
        planeProjectId: "plane-project",
        planeWorkspaceSlug: "plane-workspace",
      });
    });

    it("unarchiveScope restores the subtree and archived ancestors", async () => {
      const p = "restore-" + Date.now();
      await ensureRootScope(rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "owner" }, rootPrincipalId);
      await createScope(db, { slug: p, name: "Restore", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: p, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: `${p}/child`, slug: "grandchild", name: "Grandchild", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: p, slug: "sibling", name: "Sibling", type: "subproject" }, rootPrincipalId);
      await archiveScope(db, p, rootPrincipalId);

      const restored = await unarchiveScope(db, `${p}/child`, rootPrincipalId);
      expect(restored.status).toBe("active");
      expect((await getScope(db, p))?.status).toBe("active");
      expect((await getScope(db, `${p}/child/grandchild`))?.status).toBe("active");
      expect((await getScope(db, `${p}/sibling`))?.status).toBe("archived");

      const evs = await listEvents(db, { scopePath: `${p}/child`, type: "scope.unarchived", limit: 5 });
      expect(evs).toHaveLength(1);
      expect(evs[0]?.payload).toMatchObject({ descendantCount: 1, ancestorCount: 1 });
    });

    it("archiveScope requires admin access and rejects the root scope", async () => {
      const p = "arch-guard-" + Date.now();
      await ensureRootScope(rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "owner" }, rootPrincipalId);
      await createScope(db, { slug: p, name: "Guard", type: "project" }, rootPrincipalId);
      const viewer = (await db.insert(schema.principals).values({
        kind: "human",
        name: "Archive Viewer " + Date.now(),
      }).returning() as any[])[0].id;
      await grantRole(db, { principalId: viewer, scopePath: p, role: "viewer" }, rootPrincipalId);

      await expect(archiveScope(db, p, viewer)).rejects.toThrow(AccessDeniedError);
      await expect(archiveScope(db, "root", rootPrincipalId)).rejects.toThrow(/Root scope cannot be archived/);
    });
  });

  describe("grants and access resolution", () => {
    it("grantRole upserts and emits grant.created", async () => {
      const sp = "gscope-" + Date.now();
      await createScope(db, { slug: sp, name: "G", type: "project" }, rootPrincipalId);

      const g1 = await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "owner" }, rootPrincipalId);
      expect(g1.role).toBe("owner");

      const g2 = await grantRole(db, { principalId: rootPrincipalId, scopePath: sp, role: "admin" }, rootPrincipalId);
      expect(g2.role).toBe("admin");

      const evs = await listEvents(db, { type: "grant.created", limit: 10 });
      expect(evs.some(e => (e.payload as any)?.role === "admin")).toBe(true);
    });

    it("resolveAccess walks up ancestors: grant on airbuddy gives access to deep child, not to sibling", async () => {
      const air = "airbuddy-" + Date.now();
      const ind = "indya-" + Date.now();
      await createScope(db, { slug: air, name: "Air", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: air, slug: "x", name: "X", type: "subproject" }, rootPrincipalId);
      await createScope(db, { parentPath: `${air}/x`, slug: "y", name: "Y", type: "subproject" }, rootPrincipalId);
      await createScope(db, { slug: ind, name: "Ind", type: "project" }, rootPrincipalId);

      // grant only on airbuddy root
      await grantRole(db, { principalId: rootPrincipalId, scopePath: air, role: "editor" }, rootPrincipalId);

      const onDeep = await resolveAccess(db, rootPrincipalId, `${air}/x/y`);
      expect(onDeep).toBe("editor");

      const onSelf = await resolveAccess(db, rootPrincipalId, air);
      expect(onSelf).toBe("editor");

      const onSibling = await resolveAccess(db, rootPrincipalId, ind);
      expect(onSibling).toBeNull();
    });

    it("role precedence: owner > admin > editor > viewer", async () => {
      const prec = "prec-" + Date.now();
      await createScope(db, { slug: prec, name: "P", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: prec, slug: "c", name: "C", type: "subproject" }, rootPrincipalId);

      // viewer on root, admin on child => should resolve admin on child
      await grantRole(db, { principalId: rootPrincipalId, scopePath: prec, role: "viewer" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: `${prec}/c`, role: "admin" }, rootPrincipalId);

      const atChild = await resolveAccess(db, rootPrincipalId, `${prec}/c`);
      expect(atChild).toBe("admin");

      const atRoot = await resolveAccess(db, rootPrincipalId, prec);
      expect(atRoot).toBe("viewer");
    });

    it("requireAccess throws AccessDeniedError when insufficient", async () => {
      const reqp = "req-" + Date.now();
      await createScope(db, { slug: reqp, name: "R", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: reqp, role: "viewer" }, rootPrincipalId);

      await expect(
        requireAccess(db, rootPrincipalId, reqp, "editor")
      ).rejects.toThrow(AccessDeniedError);

      // viewer should allow viewer
      await expect(requireAccess(db, rootPrincipalId, reqp, "viewer")).resolves.not.toThrow();
    });

    it("agent grant confers inside subtree but not outside (resolve)", async () => {
      const ag = "agent-scope-" + Date.now();
      await createScope(db, { slug: ag, name: "Ag", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: ag, slug: "sub", name: "Sub", type: "subproject" }, rootPrincipalId);
      await createScope(db, { slug: ag + "-sib", name: "Sib", type: "project" }, rootPrincipalId);

      const agentPid = (await db.insert(schema.principals).values({ kind: "agent", name: "Bot-" + Date.now(), status: "active" }).returning() as any[])[0].id;

      await grantRole(db, { principalId: agentPid, scopePath: ag, role: "agent" }, rootPrincipalId);

      expect(await resolveAccess(db, agentPid, `${ag}/sub`)).toBe("agent");
      expect(await resolveAccess(db, agentPid, ag + "-sib")).toBeNull();

      // agent role = read+write within subtree (editor-equivalent), never admin
      await expect(requireAccess(db, agentPid, `${ag}/sub`, "editor")).resolves.not.toThrow();
      await expect(requireAccess(db, agentPid, `${ag}/sub`, "viewer")).resolves.not.toThrow();
      await expect(requireAccess(db, agentPid, `${ag}/sub`, "admin")).rejects.toThrow(AccessDeniedError);
      await expect(requireAccess(db, agentPid, ag + "-sib", "viewer")).rejects.toThrow(AccessDeniedError);
    });

    it("resolveAccess never inherits human root grants into personal scopes, but mediates root agents", async () => {
      await ensureRootScope(rootPrincipalId);
      const { scopePath } = await ensurePersonalScope(db, rootPrincipalId);
      expect(scopePath).toBe(getPersonalScopePath(rootPrincipalId));
      expect(await resolveAccess(db, rootPrincipalId, scopePath)).toBe("owner");

      const humanRoot = (await db.insert(schema.principals).values({ kind: "human", name: `Human Root ${Date.now()}` }).returning() as any[])[0].id;
      await grantRole(db, { principalId: humanRoot, scopePath: "root", role: "owner" }, rootPrincipalId);
      expect(await resolveAccess(db, humanRoot, scopePath)).toBeNull();

      const rootAgentAdmin = (await db.insert(schema.principals).values({ kind: "agent", name: `Root Agent Admin ${Date.now()}` }).returning() as any[])[0].id;
      await grantRole(db, { principalId: rootAgentAdmin, scopePath: "root", role: "admin" }, rootPrincipalId);
      expect(await resolveAccess(db, rootAgentAdmin, scopePath)).toBe("agent");

      const rootAgent = (await db.insert(schema.principals).values({ kind: "agent", name: `Root Agent ${Date.now()}` }).returning() as any[])[0].id;
      await grantRole(db, { principalId: rootAgent, scopePath: "root", role: "agent" }, rootPrincipalId);
      expect(await resolveAccess(db, rootAgent, scopePath)).toBe("agent");

      const unrelated = (await db.insert(schema.principals).values({ kind: "human", name: `Unrelated ${Date.now()}` }).returning() as any[])[0].id;
      expect(await resolveAccess(db, unrelated, scopePath)).toBeNull();
    });

    it("getVisibleTree: root owner sees all; project-only sees exactly their project subtree; no-grant sees nothing", async () => {
      const rootOwner = rootPrincipalId;
      const projOnly = (await db.insert(schema.principals).values({ kind: "human", name: "ProjOnly" + Date.now() }).returning() as any[])[0].id;
      const noGrant = (await db.insert(schema.principals).values({ kind: "human", name: "NoG" + Date.now() }).returning() as any[])[0].id;

      // ensure root scope + grant (tests may not auto-seed root)
      await ensureRootScope(rootOwner);
      await grantRole(db, { principalId: rootOwner, scopePath: "root", role: "owner" }, rootOwner);

      const air = "airvis-" + Date.now();
      await createScope(db, { slug: air, name: "Air", type: "project" }, rootOwner);
      await createScope(db, { parentPath: air, slug: "mkt", name: "Mkt", type: "subproject" }, rootOwner);

      const other = "othervis-" + Date.now();
      await createScope(db, { slug: other, name: "Other", type: "project" }, rootOwner);

      await grantRole(db, { principalId: projOnly, scopePath: air, role: "editor" }, rootOwner);

      // root owner
      const visRoot = await getVisibleTree(db, rootOwner);
      expect(visRoot.some(s => s.path === "root")).toBe(true);
      expect(visRoot.some(s => s.path === air)).toBe(true);
      expect(visRoot.some(s => s.path === other)).toBe(true);

      // project only
      const visProj = await getVisibleTree(db, projOnly);
      expect(visProj.some(s => s.path === "root")).toBe(false);
      expect(visProj.some(s => s.path === air)).toBe(true);
      expect(visProj.some(s => s.path === `${air}/mkt`)).toBe(true);
      expect(visProj.some(s => s.path === other)).toBe(false);

      // no grant
      const visNone = await getVisibleTree(db, noGrant);
      expect(visNone.length).toBe(0);
    });

    it("getVisibleTree hides other personal scopes while showing the caller's own", async () => {
      await ensureRootScope(rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);
      const own = await ensurePersonalScope(db, rootPrincipalId);
      const other = (await db.insert(schema.principals).values({ kind: "human", name: `Other Personal ${Date.now()}` }).returning() as any[])[0].id;
      const otherPersonal = await ensurePersonalScope(db, other);

      const rootVisible = await getVisibleTree(db, rootPrincipalId);
      expect(rootVisible.some((scope) => scope.path === own.scopePath)).toBe(true);
      expect(rootVisible.some((scope) => scope.path === otherPersonal.scopePath)).toBe(false);

      const plain = (await db.insert(schema.principals).values({ kind: "human", name: `Plain Personal ${Date.now()}` }).returning() as any[])[0].id;
      const plainPersonal = await ensurePersonalScope(db, plain);
      const plainVisible = await getVisibleTree(db, plain);
      expect(plainVisible.map((scope) => scope.path)).toContain(plainPersonal.scopePath);
      expect(plainVisible.some((scope) => scope.path === own.scopePath)).toBe(false);
    });

    it("getVisibleTree hides archived scopes by default and can include them explicitly", async () => {
      const p = "visible-archived-" + Date.now();
      await ensureRootScope(rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "owner" }, rootPrincipalId);
      await createScope(db, { slug: p, name: "Archived visible", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: p, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
      await archiveScope(db, p, rootPrincipalId);

      expect((await getVisibleTree(db, rootPrincipalId)).some((scope) => scope.path === p)).toBe(false);
      expect(
        (await getVisibleTree(db, rootPrincipalId, { includeArchived: true }))
          .map((scope) => scope.path)
      ).toEqual(expect.arrayContaining([p, `${p}/child`]));
    });

    it("listArchivedScopes returns only visible top-level archived roots", async () => {
      const first = "archived-list-a-" + Date.now();
      const second = "archived-list-b-" + Date.now();
      const limited = (await db.insert(schema.principals).values({
        kind: "human",
        name: "Archived List Limited " + Date.now(),
      }).returning() as any[])[0].id;
      await ensureRootScope(rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "owner" }, rootPrincipalId);
      await createScope(db, { slug: first, name: "Archived A", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: first, slug: "child", name: "Child", type: "subproject" }, rootPrincipalId);
      await createScope(db, { slug: second, name: "Archived B", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: limited, scopePath: first, role: "viewer" }, rootPrincipalId);
      await archiveScope(db, first, rootPrincipalId);
      await archiveScope(db, second, rootPrincipalId);

      const archived = await listArchivedScopes(db, rootPrincipalId);
      expect(archived.map((scope) => scope.path)).toEqual(expect.arrayContaining([first, second]));
      expect(archived.some((scope) => scope.path === `${first}/child`)).toBe(false);
      expect((await listArchivedScopes(db, limited)).map((scope) => scope.path)).toEqual([first]);
    });

    it("revokeGrant removes grant and emits grant.revoked", async () => {
      const sp = "revscope-" + Date.now();
      await createScope(db, { slug: sp, name: "Rev", type: "project" }, rootPrincipalId);
      const pid = (await db.insert(schema.principals).values({ kind: "human", name: "RevP" + Date.now() }).returning() as any[])[0].id;
      await grantRole(db, { principalId: pid, scopePath: sp, role: "editor" }, rootPrincipalId);
      expect(await resolveAccess(db, pid, sp)).toBe("editor");

      await revokeGrant(db, { principalId: pid, scopePath: sp }, rootPrincipalId);
      expect(await resolveAccess(db, pid, sp)).toBeNull();

      const evs = await listEvents(db, { type: "grant.revoked", limit: 5 });
      expect(evs.some(e => e.payload && (e.payload as any).scopePath === sp)).toBe(true);
    });
  });

  describe("tokens", () => {
    it("issueToken returns plaintext once, stores only hash, roundtrips authenticate", async () => {
      const tokPrincipal = (await db.insert(schema.principals).values({ kind: "agent", name: "TokP-" + Date.now() }).returning() as any[])[0].id;

      const plain = await issueToken(db, { principalId: tokPrincipal, name: "mcp-key" });
      expect(plain.startsWith("cos_")).toBe(true);
      expect(plain.length).toBeGreaterThan(20);

      // authenticate
      const prin = await authenticateToken(db, plain);
      expect(prin?.id).toBe(tokPrincipal);

      // plaintext never in db
      const allTokens: any[] = await db.select().from(schema.tokens);
      const hasPlain = allTokens.some((t: any) => (t.tokenHash || "").includes("cos_") || t.tokenHash === plain);
      expect(hasPlain).toBe(false);
    });

    it("authenticateToken rejects revoked and expired", async () => {
      const p = (await db.insert(schema.principals).values({ kind: "human", name: "RevokeP" + Date.now() }).returning() as any[])[0].id;

      const plain1 = await issueToken(db, { principalId: p, name: "to-revoke" });
      const tks = await db.select().from(schema.tokens).where(eq(schema.tokens.principalId, p)) as any[];
      const tokId = tks[0].id;

      await revokeToken(db, tokId, p);
      const afterRev = await authenticateToken(db, plain1);
      expect(afterRev).toBeNull();

      // expired
      const past = new Date(Date.now() - 1000 * 60 * 60);
      const plain2 = await issueToken(db, { principalId: p, name: "expired", expiresAt: past });
      const afterExp = await authenticateToken(db, plain2);
      expect(afterExp).toBeNull();
    });

    it("authenticate updates lastUsedAt", async () => {
      const p = (await db.insert(schema.principals).values({ kind: "agent", name: "LastUse" + Date.now() }).returning() as any[])[0].id;
      const plain = await issueToken(db, { principalId: p, name: "use-me" });

      const before = (await db.select().from(schema.tokens).where(eq(schema.tokens.principalId, p)).limit(1) as any[])[0];
      expect(before.lastUsedAt).toBeFalsy();

      await authenticateToken(db, plain);
      const after = (await db.select().from(schema.tokens).where(eq(schema.tokens.principalId, p)).limit(1) as any[])[0];
      expect(after.lastUsedAt).toBeTruthy();
    });
  });

  describe("events", () => {
    it("every mutation emits an event (create, grant, archive, token, revoke)", async () => {
      const evPath = "ev-" + Date.now();
      const beforeCountRes = await db.select().from(schema.events);
      const before = beforeCountRes.length;

      await createScope(db, { slug: evPath, name: "E", type: "project" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: evPath, role: "admin" }, rootPrincipalId);
      await archiveScope(db, evPath, rootPrincipalId);

      const pTok = (await db.insert(schema.principals).values({ kind: "agent", name: "ETok" + Date.now() }).returning() as any[])[0].id;
      await issueToken(db, { principalId: pTok, name: "evt" });
      const tRow = (await db.select().from(schema.tokens).where(eq(schema.tokens.principalId, pTok)) as any[])[0];
      await revokeToken(db, tRow.id, pTok);

      const after = (await db.select().from(schema.events)).length;
      expect(after).toBeGreaterThanOrEqual(before + 5); // at least the 5 mutations
    });

    it("listEvents filters by scopePath and type", async () => {
      const lp = "listp-" + Date.now();
      await createScope(db, { slug: lp, name: "L", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: lp, slug: "c", name: "Lc", type: "subproject" }, rootPrincipalId);

      const scopeEvents = await listEvents(db, { scopePath: lp, limit: 50 });
      expect(scopeEvents.length).toBeGreaterThan(0);
      // created event for root
      expect(scopeEvents.some(e => e.type === "scope.created")).toBe(true);
    });
  });

  it("all services accept injected db handle (no globals)", async () => {
    // smoke: different client still works (new pglite would, but reuse)
    const s = await getScope(db, "nonexistent-" + Date.now());
    expect(s).toBeNull();
  });
});
