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
  linkAuthUser,
  getPrincipalIdForAuthUser,
} from "./index";
import { listEvents } from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(__dirname, "../../packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

describe("auth-link service (PGlite)", () => {
  let client: PGlite;
  let db: any;
  let rootScopeId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });

    // ensure root scope for bootstrap tests
    const [root] = (await db
      .insert(schema.scopes)
      .values({ slug: "root", path: "root", name: "Root", type: "root", status: "active", settings: {} })
      .returning()) as any[];
    rootScopeId = root.id;
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  beforeEach(async () => {
    // clean non-root principals for isolation between tests (keep root)
    await db.delete(schema.grants).where(eq(schema.grants.scopeId, rootScopeId)).execute?.().catch(() => {});
    await db.delete(schema.principals).where(eq(schema.principals.kind, "human")).execute?.().catch(() => {});
  });

  it("creates new principal when no email match and links authUserId", async () => {
    const res = await linkAuthUser(db, {
      authUserId: "au-new-1",
      email: "new@example.com",
      name: "New User",
    });
    expect(res.principalId).toBeTruthy();
    expect(res.bootstrapped).toBe(true); // first linked user bootstraps owner on root

    const pid = await getPrincipalIdForAuthUser(db, "au-new-1");
    expect(pid).toBe(res.principalId);

    const [row] = await db.select().from(schema.principals).where(eq(schema.principals.id, pid));
    expect(row.authUserId).toBe("au-new-1");
    expect(row.email).toBe("new@example.com");
  });

  it("links by email when a matching unlinked principal exists", async () => {
    // pre-create unlinked principal
    const [pre] = (await db
      .insert(schema.principals)
      .values({ kind: "human", name: "Email Match", email: "match@example.com", status: "active" })
      .returning()) as any[];

    const res = await linkAuthUser(db, {
      authUserId: "au-match-1",
      email: "match@example.com",
      name: "Should not override",
    });
    expect(res.principalId).toBe(pre.id);

    const [updated] = await db.select().from(schema.principals).where(eq(schema.principals.id, pre.id));
    expect(updated.authUserId).toBe("au-match-1");
  });

  it("bootstrap: first linked user on root with no prior linked owner gets owner grant + principal.bootstrapped event", async () => {
    // ensure no owner grants on root for linked
    const res = await linkAuthUser(db, {
      authUserId: "au-boot-1",
      email: "first@owner.com",
      name: "First Owner",
    });
    expect(res.bootstrapped).toBe(true);

    // verify grant
    const grants = await db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.principalId, res.principalId));
    const rootGrant = grants.find((g: any) => g.scopeId === rootScopeId && g.role === "owner");
    expect(rootGrant).toBeTruthy();

    // event
    const evs = await listEvents(db, { type: "principal.bootstrapped" });
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0]?.payload?.authUserId).toBe("au-boot-1");
  });

  it("subsequent linked user does not re-bootstrap", async () => {
    // first
    const first = await linkAuthUser(db, { authUserId: "au-b2", email: "b2@ex.com", name: "B2" });
    expect(first.bootstrapped).toBe(true);

    // second should not
    const second = await linkAuthUser(db, { authUserId: "au-b3", email: "b3@ex.com", name: "B3" });
    expect(second.bootstrapped).toBe(false);
  });
});
