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
  AccessDeniedError,
  createRecord,
  createScope,
  getContextBundle,
  getScope,
  grantRole,
  listEvents,
  logUsageEvent,
  queryUsage,
  saveDoc,
  setContextProfile,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

describe("usage module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;
  let adminId: string;
  let viewerId: string;
  let scopePath: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    if (!await getScope(db, "root")) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, null);
    }
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  async function principal(name: string, kind: "human" | "agent" = "human") {
    const [row] = await db
      .insert(schema.principals)
      .values({ kind, name: `${name} ${Date.now()} ${Math.random()}`, status: "active" })
      .returning();
    return row.id as string;
  }

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    rootPrincipalId = await principal("Root Admin");
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);

    scopePath = `usage-${suffix}`;
    await createScope(db, { slug: scopePath, name: "Usage Scope", type: "project" }, rootPrincipalId);
    adminId = await principal("Usage Admin");
    viewerId = await principal("Usage Viewer");
    await grantRole(db, { principalId: adminId, scopePath, role: "admin" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerId, scopePath, role: "viewer" }, rootPrincipalId);
  });

  it("redacts sensitive metadata and returns admin-gated grouped summaries", async () => {
    await logUsageEvent(db, {
      scopePath,
      principalId: adminId,
      source: "mcp_http",
      operation: "save_report",
      inputTokensEst: 12,
      outputTokensEst: 8,
      byteIn: 40,
      byteOut: 20,
      latencyMs: 15,
      success: true,
      metadata: {
        argumentKeys: ["scope", "body_md"],
        authorization: "Bearer cos_secret",
        body_md: "raw markdown body",
        nested: { token: "cos_plaintext" },
      },
    });

    const result = await queryUsage(db, { scope: scopePath, groupBy: "operation" }, adminId);
    expect(result.estimated).toBe(true);
    expect(result.rows[0]).toMatchObject({
      key: "save_report",
      calls: 1,
      inputTokensEst: 12,
      outputTokensEst: 8,
      totalTokensEst: 20,
    });
    const audit = JSON.stringify(result);
    expect(audit).not.toContain("cos_secret");
    expect(audit).not.toContain("cos_plaintext");
    expect(audit).not.toContain("raw markdown body");

    await expect(queryUsage(db, { scope: scopePath }, viewerId)).rejects.toThrow(AccessDeniedError);
  });

  it("updates context profiles with events and lean profile reduces get_context estimate", async () => {
    for (let idx = 0; idx < 8; idx += 1) {
      await createRecord(
        db,
        {
          scopePath,
          kind: idx % 2 === 0 ? "changelog" : "decision",
          title: `Record ${idx}`,
          bodyMd: "A long operational note about this scope. ".repeat(30),
        },
        adminId
      );
    }
    await saveDoc(
      db,
      {
        scopePath,
        slug: "wiki",
        title: "Wiki",
        bodyMd: "Index page",
      },
      adminId
    );
    for (let idx = 0; idx < 12; idx += 1) {
      await saveDoc(
        db,
        {
          scopePath,
          slug: `topic-${idx}`,
          title: `Topic ${idx}`,
          bodyMd: "Knowledge topic",
        },
        adminId
      );
    }

    await setContextProfile(db, { scopePath, name: "standard", preset: "standard" }, adminId);
    const standard = await getContextBundle(db, scopePath, adminId);

    const leanProfile = await setContextProfile(db, { scopePath, name: "lean", preset: "lean" }, adminId);
    const lean = await getContextBundle(db, scopePath, adminId);

    expect(lean.length).toBeLessThan(standard.length);
    expect(leanProfile.impact.comparedToStandard).toBeLessThan(0);

    const usage = await queryUsage(db, { scope: scopePath, operation: "get_context", groupBy: "operation" }, adminId);
    expect(usage.rows[0]?.totalTokensEst).toBeGreaterThan(0);
    const contextEvent = usage.events.find((event: any) => event.operation === "get_context");
    const sections = (contextEvent?.metadata.sections || []) as Array<{ name?: string }>;
    expect(sections.some((section) => section.name === "recent_records")).toBe(true);

    const profileEvents = await listEvents(db, { scopePath, type: "usage.profile_updated", limit: 10 });
    expect(profileEvents.map((event: any) => event.payload.name)).toEqual(expect.arrayContaining(["standard", "lean"]));
  });
});
