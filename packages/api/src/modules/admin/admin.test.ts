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
import {
  AccessDeniedError,
  completeTempPasswordChange,
  createAdminUser,
  createScope,
  getAdminLiteLlmState,
  grantRole,
  isTempPasswordChangeRequired,
  listEvents,
  listAdminUsers,
  mintAdminLiteLlmKey,
  revokeAdminLiteLlmKey,
  setAdminLiteLlmKeyBudget,
  type BetterAuthAdminApi,
} from "../../index";

const schema: any = (dbMod as any).schema ?? dbMod;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

function makeAuthAdmin(db: any): BetterAuthAdminApi & { created: Array<{ email: string; password: string }> } {
  const created: Array<{ email: string; password: string }> = [];
  return {
    created,
    async createUser(input) {
      created.push({ email: input.email, password: input.password });
      const [row] = await db.insert(schema.user).values({
        id: `auth-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        email: input.email,
        name: input.name,
        emailVerified: true,
      }).returning();
      await db.insert(schema.account).values({
        id: `acct-${row.id}`,
        accountId: row.id,
        providerId: "credential",
        userId: row.id,
        password: "hashed-by-better-auth-stub",
      });
      return { user: row };
    },
    async listUsers() {
      const rows = await db.select().from(schema.user).orderBy(schema.user.email);
      return { users: rows, total: rows.length };
    },
    async setUserPassword() {
      return {};
    },
  };
}

function makeFetch(routes: Record<string, unknown>, calls: Array<{ url: string; init?: RequestInit }>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const pathName = new URL(href).pathname;
    const body = routes[pathName] ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

describe("tenant admin module", () => {
  let client: PGlite;
  let db: any;
  let adminPrincipalId: string;
  let outsiderPrincipalId: string;
  let authAdmin: ReturnType<typeof makeAuthAdmin>;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    const now = Date.now();
    const [admin] = await db.insert(schema.principals).values({ kind: "human", name: `Root Admin ${now}` }).returning();
    const [outsider] = await db.insert(schema.principals).values({ kind: "human", name: `Outsider ${now}` }).returning();
    adminPrincipalId = admin.id;
    outsiderPrincipalId = outsider.id;
    await createScope(db, { slug: "root", name: "Root", type: "root" }, adminPrincipalId).catch(() => null);
    await grantRole(db, { principalId: adminPrincipalId, scopePath: "root", role: "admin" }, adminPrincipalId);
    authAdmin = makeAuthAdmin(db);
  });

  it("gates tenant-admin services to root admin", async () => {
    await expect(listAdminUsers(db, authAdmin, outsiderPrincipalId)).rejects.toThrow(AccessDeniedError);
    await expect(getAdminLiteLlmState(db, { masterKey: "sk-master", fetch: makeFetch({}, []) }, outsiderPrincipalId)).rejects.toThrow(AccessDeniedError);

    await expect(listAdminUsers(db, authAdmin, adminPrincipalId)).resolves.toEqual([]);
  });

  it("creates temp-password users and clears forced change after first password change", async () => {
    const created = await createAdminUser(db, authAdmin, {
      email: "New.User@Example.com",
      name: "New User",
      tempPassword: "Temporary-12345",
      grants: [{ scopePath: "root", role: "viewer" }],
    }, adminPrincipalId);

    expect(authAdmin.created[0]).toEqual({ email: "new.user@example.com", password: "Temporary-12345" });
    expect(created.tempPassword).toBe("Temporary-12345");
    expect(created.user.email).toBe("new.user@example.com");
    expect(created.user.forcePasswordChange).toBe(true);

    const principalId = created.user.principalId;
    expect(principalId).toBeTruthy();
    expect(await isTempPasswordChangeRequired(db, principalId!,)).toBe(true);
    await completeTempPasswordChange(db, principalId!);
    expect(await isTempPasswordChangeRequired(db, principalId!)).toBe(false);

    const accountRows = await db.select().from(schema.account).where(eq(schema.account.userId, created.user.authUserId));
    expect(accountRows[0].scope).toContain("forcePasswordChange");
  });

  it("applies the default LiteLLM monthly budget idempotently to env-backed keys", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = makeFetch({
      "/key/list": {
        keys: [
          { token: "sk-embed", key_alias: "embed", max_budget: null, spend: 1 },
          { token: "sk-brain", key_alias: "brain", max_budget: 99, spend: 2 },
        ],
      },
      "/model/info": { data: [] },
      "/spend/models": { data: [] },
      "/key/update": { ok: true },
    }, calls);

    const state = await getAdminLiteLlmState(db, {
      baseUrl: "http://litellm.test",
      masterKey: "sk-master",
      env: { LITELLM_EMBED_KEY: "sk-embed", BRAIN_LITELLM_API_KEY: "sk-brain" },
      fetch: fetchMock,
    }, adminPrincipalId);

    expect(state.budgetBootstrap.updatedEnvNames).toEqual(["LITELLM_EMBED_KEY"]);
    expect(state.budgetBootstrap.skippedEnvNames).toEqual(["BRAIN_LITELLM_API_KEY"]);
    expect(state.keys.find((key) => key.alias === "embed")?.budgetUsd).toBe(25);

    calls.length = 0;
    await getAdminLiteLlmState(db, {
      baseUrl: "http://litellm.test",
      masterKey: "sk-master",
      env: { LITELLM_EMBED_KEY: "sk-embed", BRAIN_LITELLM_API_KEY: "sk-brain" },
      fetch: makeFetch({
        "/key/list": {
          keys: [
            { token: "sk-embed", key_alias: "embed", max_budget: 25, spend: 1 },
            { token: "sk-brain", key_alias: "brain", max_budget: 99, spend: 2 },
          ],
        },
        "/model/info": { data: [] },
        "/spend/models": { data: [] },
      }, calls),
    }, adminPrincipalId);

    expect(calls.some((call) => new URL(call.url).pathname === "/key/update")).toBe(false);
  });

  it("redacts LiteLLM key values and provider env values from service state and events", async () => {
    const secretKey = "sk-live-secret-value";
    const providerSecret = "provider-secret-value";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = makeFetch({
      "/key/list": {
        keys: [{ token: secretKey, key_alias: "embed", max_budget: 25, spend: 3, model_spend: { "text-embedding-3-small": 3 } }],
      },
      "/model/info": {
        data: [{ model_name: "embed", litellm_params: { model: "openai/text-embedding-3-small", custom_llm_provider: "openai" } }],
      },
      "/spend/models": { data: [{ model: "gpt-4.1-mini", spend: 4 }] },
      "/key/generate": { key: "sk-new-secret", key_alias: "new-key" },
      "/key/delete": { ok: true },
      "/key/update": { ok: true },
    }, calls);

    const config = {
      baseUrl: "http://litellm.test",
      masterKey: "sk-master",
      env: { LITELLM_EMBED_KEY: secretKey, OPENAI_API_KEY: providerSecret },
      fetch: fetchMock,
    };
    const state = await getAdminLiteLlmState(db, config, adminPrincipalId);
    await mintAdminLiteLlmKey(db, config, { alias: "new-key", budgetUsd: 12 }, adminPrincipalId);
    await setAdminLiteLlmKeyBudget(db, config, { key: secretKey, alias: "embed", budgetUsd: 20 }, adminPrincipalId);
    await revokeAdminLiteLlmKey(db, config, { key: secretKey, alias: "embed" }, adminPrincipalId);

    const serializedState = JSON.stringify(state);
    expect(serializedState).not.toContain(secretKey);
    expect(serializedState).not.toContain(providerSecret);
    expect(state.providerKeys.find((key) => key.name === "OPENAI_API_KEY")).toEqual({ name: "OPENAI_API_KEY", present: true });

    const adminEvents = await listEvents(db, { scopePath: "root", limit: 20 });
    const serializedEvents = safeStringify(adminEvents);
    expect(serializedEvents).not.toContain(secretKey);
    expect(serializedEvents).not.toContain("sk-new-secret");
    expect(serializedEvents).not.toContain(providerSecret);
  });
});
