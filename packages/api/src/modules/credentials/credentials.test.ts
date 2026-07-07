/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;

import {
  AccessDeniedError,
  createScope,
  deleteCredential,
  getCredentialValue,
  getScope,
  grantRole,
  listCredentials,
  listEvents,
  setCredential,
  VaultNotConfiguredError,
} from "../../index";

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

describe("credentials module", () => {
  let client: PGlite;
  let db: any;
  let previousVaultKey: string | undefined;
  let rootAdmin: string;
  let scopeAdmin: string;
  let agent: string;
  let viewer: string;
  let scopePath: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    if (!await getScope(db, "root")) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, null);
    }
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    previousVaultKey = process.env.COS_VAULT_KEY;
    process.env.COS_VAULT_KEY = Buffer.alloc(32, 7).toString("base64");

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    rootAdmin = (await db.insert(schema.principals).values({ kind: "human", name: `Root ${suffix}`, status: "active" }).returning())[0].id;
    scopeAdmin = (await db.insert(schema.principals).values({ kind: "human", name: `Admin ${suffix}`, status: "active" }).returning())[0].id;
    agent = (await db.insert(schema.principals).values({ kind: "agent", name: `Agent ${suffix}`, status: "active" }).returning())[0].id;
    viewer = (await db.insert(schema.principals).values({ kind: "human", name: `Viewer ${suffix}`, status: "active" }).returning())[0].id;

    await grantRole(db, { principalId: rootAdmin, scopePath: "root", role: "admin" }, rootAdmin);
    scopePath = `cred-${suffix}`;
    await createScope(db, { slug: scopePath, name: "Credential Scope", type: "project" }, rootAdmin);
    await grantRole(db, { principalId: scopeAdmin, scopePath, role: "admin" }, rootAdmin);
    await grantRole(db, { principalId: agent, scopePath, role: "agent" }, rootAdmin);
    await grantRole(db, { principalId: viewer, scopePath, role: "viewer" }, rootAdmin);
  });

  afterEach(() => {
    if (previousVaultKey === undefined) {
      delete process.env.COS_VAULT_KEY;
    } else {
      process.env.COS_VAULT_KEY = previousVaultKey;
    }
  });

  it("encrypts stored values, decrypts on read, and never exposes values in list rows or events", async () => {
    const secret = "ssh-private-key-do-not-store-plaintext";
    const saved = await setCredential(db, {
      scopePath,
      name: "VPS SSH",
      description: "Deploy access",
      value: secret,
    }, scopeAdmin);
    expect(saved).toMatchObject({ name: "VPS SSH", description: "Deploy access", hasValue: true });

    const [row] = await db.select().from(schema.credentials).where(eq(schema.credentials.name, "VPS SSH")).limit(1);
    expect(row.valueCiphertext).toBeTruthy();
    expect(row.valueCiphertext).not.toContain(secret);
    expect(JSON.stringify(row)).not.toContain(secret);

    const list = await listCredentials(db, { scopePath }, viewer);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "VPS SSH", description: "Deploy access", hasValue: true });
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(JSON.stringify(list)).not.toContain(row.valueCiphertext);

    const got = await getCredentialValue(db, { scopePath, name: "VPS SSH" }, agent);
    expect(got).toEqual({ name: "VPS SSH", value: secret });

    const after = (await db.select().from(schema.credentials).where(eq(schema.credentials.id, row.id)).limit(1))[0];
    expect(after.lastAccessedAt).toBeInstanceOf(Date);
    const events = await listEvents(db, { scopePath, type: "credential.accessed", limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]!.principalId).toBe(agent);
    expect(events[0]!.payload).toMatchObject({ credentialId: row.id, name: "VPS SSH" });
    expect(safeJson(events)).not.toContain(secret);
    expect(safeJson(events)).not.toContain(row.valueCiphertext);
  });

  it("upserts same-name credentials per scope while allowing the same name in another scope", async () => {
    await setCredential(db, { scopePath, name: "API key", value: "first" }, scopeAdmin);
    await setCredential(db, { scopePath, name: "API key", description: "Updated", value: "second" }, scopeAdmin);

    const list = await listCredentials(db, { scopePath }, scopeAdmin);
    expect(list).toHaveLength(1);
    expect(list[0]!.description).toBe("Updated");
    expect((await getCredentialValue(db, { scopePath, name: "API key" }, agent)).value).toBe("second");

    const other = `${scopePath}-other`;
    await createScope(db, { slug: other, name: "Other Credential Scope", type: "project" }, rootAdmin);
    await grantRole(db, { principalId: scopeAdmin, scopePath: other, role: "admin" }, rootAdmin);
    await setCredential(db, { scopePath: other, name: "API key", value: "third" }, scopeAdmin);

    expect(await db.select().from(schema.credentials)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "API key" }),
    ]));
    expect(await listCredentials(db, { scopePath: other }, scopeAdmin)).toHaveLength(1);
  });

  it("enforces grant matrix for value reads, writes, and deletes", async () => {
    await expect(
      setCredential(db, { scopePath, name: "Viewer denied", value: "secret" }, viewer)
    ).rejects.toThrow(AccessDeniedError);

    await setCredential(db, { scopePath, name: "Allowed", value: "secret" }, scopeAdmin);
    await expect(
      getCredentialValue(db, { scopePath, name: "Allowed" }, viewer)
    ).rejects.toThrow(AccessDeniedError);
    await expect(getCredentialValue(db, { scopePath, name: "Allowed" }, agent)).resolves.toMatchObject({
      value: "secret",
    });

    await expect(
      deleteCredential(db, { scopePath, name: "Allowed" }, agent)
    ).rejects.toThrow(AccessDeniedError);
    await deleteCredential(db, { scopePath, name: "Allowed" }, scopeAdmin);
    expect(await listCredentials(db, { scopePath }, scopeAdmin)).toHaveLength(0);
  });

  it("degrades cleanly when COS_VAULT_KEY is missing or invalid", async () => {
    delete process.env.COS_VAULT_KEY;
    await expect(
      setCredential(db, { scopePath, name: "Missing", value: "secret" }, scopeAdmin)
    ).rejects.toThrow(VaultNotConfiguredError);

    process.env.COS_VAULT_KEY = Buffer.alloc(32, 8).toString("base64");
    await setCredential(db, { scopePath, name: "Stored", value: "secret" }, scopeAdmin);
    delete process.env.COS_VAULT_KEY;
    await expect(
      getCredentialValue(db, { scopePath, name: "Stored" }, agent)
    ).rejects.toThrow(/vault-not-configured/);

    process.env.COS_VAULT_KEY = Buffer.alloc(10, 1).toString("base64");
    await expect(
      setCredential(db, { scopePath, name: "Invalid", value: "secret" }, scopeAdmin)
    ).rejects.toThrow(/vault-not-configured/);
  });
});
