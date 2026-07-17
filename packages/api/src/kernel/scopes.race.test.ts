/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

import { ensurePersonalScope, getPersonalScopePath, resolveAccess } from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) migrationsFolder = path.resolve(__dirname, "../../packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) migrationsFolder = "C:/dev/companyos/packages/db/drizzle";
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) migrationsFolder = path.resolve("packages/db/drizzle");

// Regression test for #70: ensurePersonalScope races on first sign-up render.
// Two concurrent renders both pass the check-then-insert pre-check, then the losing
// INSERT violates scopes_path_unique (and, one layer down, grants_principal_scope_unique).
// Before the fix the raw Postgres 23505 propagated and the first render 500ed. After
// the fix createScope inserts ON CONFLICT DO NOTHING (loser -> DuplicatePathError, which
// ensurePersonalScope recovers from) and grantRole upserts ON CONFLICT DO UPDATE, so
// concurrent first renders all converge on one scope + one owner grant.
describe("ensurePersonalScope concurrency (PGlite) — #70", () => {
  let client: PGlite;
  let db: any;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    await db
      .insert(schema.scopes)
      .values({ slug: "root", path: "root", name: "Root", type: "root", status: "active", settings: {} })
      .returning();
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  it("concurrent first-render calls all resolve to one scope + one owner grant", async () => {
    const [principal] = (await db
      .insert(schema.principals)
      .values({ kind: "human", name: "Race User", email: "race@example.com", status: "active" })
      .returning()) as any[];

    const scopePath = getPersonalScopePath(principal.id);

    // Fire several concurrent ensurePersonalScope calls, as concurrent renders would.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensurePersonalScope(db, principal.id))
    );

    // All calls succeed and agree on the personal scope path.
    for (const res of results) {
      expect(res.scopePath).toBe(scopePath);
    }

    // Exactly one personal scope row exists (no duplicate insert leaked through).
    const scopeRows = await db.select().from(schema.scopes).where(eq(schema.scopes.path, scopePath));
    expect(scopeRows).toHaveLength(1);

    // The principal owns it.
    expect(await resolveAccess(db, principal.id, scopePath)).toBe("owner");

    // Exactly one owner grant for this principal on the personal scope.
    const grantRows = await db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.principalId, principal.id));
    const ownerGrants = grantRows.filter(
      (g: any) => g.scopeId === scopeRows[0].id && g.role === "owner"
    );
    expect(ownerGrants).toHaveLength(1);
  });
});
