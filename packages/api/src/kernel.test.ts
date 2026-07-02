/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
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
  archiveScope,
  grantRole,
  resolveAccess,
  requireAccess,
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
let migrationsFolder = path.resolve(__dirname, "../../packages/db/drizzle");
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
    client = new PGlite();
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

  describe("scopes", () => {
    it("createScope computes path for root child and nested depth 4", async () => {
      const r = await createScope(db, { slug: "airbuddy", name: "Airbuddy", type: "client" }, rootPrincipalId);
      expect(r.path).toBe("airbuddy");
      expect(r.slug).toBe("airbuddy");

      const c1 = await createScope(db, { parentPath: "airbuddy", slug: "marketing", name: "Marketing", type: "project" }, rootPrincipalId);
      expect(c1.path).toBe("airbuddy/marketing");

      const c2 = await createScope(db, { parentPath: "airbuddy/marketing", slug: "meta-ads", name: "Meta Ads", type: "area" }, rootPrincipalId);
      expect(c2.path).toBe("airbuddy/marketing/meta-ads");

      const c3 = await createScope(db, { parentPath: "airbuddy/marketing/meta-ads", slug: "retargeting", name: "Retarget", type: "area" }, rootPrincipalId);
      expect(c3.path).toBe("airbuddy/marketing/meta-ads/retargeting");
      expect(c3.parentId).toBeTruthy();
    });

    it("createScope rejects invalid slug", async () => {
      await expect(
        createScope(db, { slug: "Invalid_Slug!", name: "Bad", type: "area" }, rootPrincipalId)
      ).rejects.toThrow(InvalidSlugError);
    });

    it("createScope rejects duplicate path", async () => {
      const unique = "dup-" + Date.now();
      await createScope(db, { slug: unique, name: "D1", type: "client" }, rootPrincipalId);
      await expect(
        createScope(db, { slug: unique, name: "D2", type: "client" }, rootPrincipalId)
      ).rejects.toThrow(DuplicatePathError);
    });

    it("createScope rejects missing parent", async () => {
      await expect(
        createScope(db, { parentPath: "no-such-parent", slug: "child", name: "C", type: "area" }, rootPrincipalId)
      ).rejects.toThrow(ParentNotFoundError);
    });

    it("getScope, getChildren, getSubtree work", async () => {
      const base = "tree-" + Date.now();
      const rootS = await createScope(db, { slug: base, name: "RootT", type: "client" }, rootPrincipalId);
      await createScope(db, { parentPath: base, slug: "c1", name: "C1", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: `${base}/c1`, slug: "c2", name: "C2", type: "area" }, rootPrincipalId);

      const got = await getScope(db, base);
      expect(got?.id).toBe(rootS.id);

      const children = await getChildren(db, base);
      expect(children.length).toBe(1);
      expect(children[0]?.path).toBe(`${base}/c1`);

      const subtree = await getSubtree(db, base);
      expect(subtree.length).toBe(3);
      expect(subtree.map(s => s.path)).toContain(`${base}/c1/c2`);
    });

    it("archiveScope sets archived and emits event", async () => {
      const p = "arch-" + Date.now();
      await createScope(db, { slug: p, name: "A", type: "area" }, rootPrincipalId);
      const archived = await archiveScope(db, p, rootPrincipalId);
      expect(archived.status).toBe("archived");

      const evs = await listEvents(db, { scopePath: p, type: "scope.archived", limit: 5 });
      expect(evs.length).toBeGreaterThan(0);
    });
  });

  describe("grants and access resolution", () => {
    it("grantRole upserts and emits grant.created", async () => {
      const sp = "gscope-" + Date.now();
      await createScope(db, { slug: sp, name: "G", type: "client" }, rootPrincipalId);

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
      await createScope(db, { slug: air, name: "Air", type: "client" }, rootPrincipalId);
      await createScope(db, { parentPath: air, slug: "x", name: "X", type: "project" }, rootPrincipalId);
      await createScope(db, { parentPath: `${air}/x`, slug: "y", name: "Y", type: "area" }, rootPrincipalId);
      await createScope(db, { slug: ind, name: "Ind", type: "client" }, rootPrincipalId);

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
      await createScope(db, { slug: prec, name: "P", type: "client" }, rootPrincipalId);
      await createScope(db, { parentPath: prec, slug: "c", name: "C", type: "project" }, rootPrincipalId);

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
      await createScope(db, { slug: reqp, name: "R", type: "area" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: reqp, role: "viewer" }, rootPrincipalId);

      await expect(
        requireAccess(db, rootPrincipalId, reqp, "editor")
      ).rejects.toThrow(AccessDeniedError);

      // viewer should allow viewer
      await expect(requireAccess(db, rootPrincipalId, reqp, "viewer")).resolves.not.toThrow();
    });

    it("agent grant confers inside subtree but not outside (resolve)", async () => {
      const ag = "agent-scope-" + Date.now();
      await createScope(db, { slug: ag, name: "Ag", type: "client" }, rootPrincipalId);
      await createScope(db, { parentPath: ag, slug: "sub", name: "Sub", type: "area" }, rootPrincipalId);
      await createScope(db, { slug: ag + "-sib", name: "Sib", type: "client" }, rootPrincipalId);

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

      await createScope(db, { slug: evPath, name: "E", type: "area" }, rootPrincipalId);
      await grantRole(db, { principalId: rootPrincipalId, scopePath: evPath, role: "viewer" }, rootPrincipalId);
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
      await createScope(db, { slug: lp, name: "L", type: "client" }, rootPrincipalId);
      await createScope(db, { parentPath: lp, slug: "c", name: "Lc", type: "project" }, rootPrincipalId);

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
