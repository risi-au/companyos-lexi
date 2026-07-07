/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  getScope,
  grantRole,
  recallMemory,
  saveDoc,
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

describe("memory module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;
  let agentPrincipalId: string;
  let clientA: string;
  let clientB: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    if (!await getScope(db, "root")) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, null);
    }
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [root] = await db.insert(schema.principals).values({ kind: "human", name: `Root ${suffix}`, status: "active" }).returning();
    rootPrincipalId = root.id;
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);

    const [agent] = await db.insert(schema.principals).values({ kind: "agent", name: `Agent ${suffix}`, status: "active" }).returning();
    agentPrincipalId = agent.id;

    clientA = `memory-a-${suffix}`;
    clientB = `memory-b-${suffix}`;
    await createScope(db, { slug: clientA, name: "Memory A", type: "project" }, rootPrincipalId);
    await createScope(db, { parentPath: clientA, slug: "ads", name: "Ads", type: "subproject" }, rootPrincipalId);
    await createScope(db, { slug: clientB, name: "Memory B", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: clientA, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: clientB, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath: clientA, role: "agent" }, rootPrincipalId);
  });

  it("recalls scoped wiki pages plus root patterns without leaking sibling or non-allowlisted root pages", async () => {
    await saveDoc(db, {
      scopePath: clientA,
      slug: "retargeting",
      title: "Retargeting Memory",
      bodyMd: "---\nconfidence: high\n---\nRetargeting margin guardrail memory-a-only.",
    }, rootPrincipalId);
    await saveDoc(db, {
      scopePath: clientB,
      slug: "retargeting",
      title: "Other Client Retargeting",
      bodyMd: "Retargeting margin guardrail client-b-secret.",
    }, rootPrincipalId);
    await saveDoc(db, {
      scopePath: "root",
      slug: "pattern-retargeting",
      title: "Pattern Retargeting",
      bodyMd: "Retargeting margin guardrail company-wide reusable pattern.",
    }, rootPrincipalId);
    await saveDoc(db, {
      scopePath: "root",
      slug: "root-private-retargeting",
      title: "Root Private Retargeting",
      bodyMd: "Retargeting margin guardrail root-private-secret.",
    }, rootPrincipalId);

    const hits = await recallMemory(db, { scopePath: clientA, query: "retargeting margin guardrail", limit: 10 }, agentPrincipalId);

    expect(hits.some((hit) => hit.scopePath === clientA && hit.slug === "retargeting")).toBe(true);
    expect(hits.some((hit) => hit.scopePath === "root" && hit.slug === "pattern-retargeting")).toBe(true);
    expect(hits.every((hit) => hit.scopePath !== clientB)).toBe(true);
    expect(hits.every((hit) => hit.slug !== "root-private-retargeting")).toBe(true);
    expect(hits.find((hit) => hit.slug === "retargeting")?.confidence).toBe("high");
  });

  it("never treats root as the nearest ancestor wiki: scope without a wiki page gets only allowlisted root slugs", async () => {
    await saveDoc(db, { scopePath: "root", slug: "wiki", title: "Wiki", bodyMd: "Root index mentions margin guardrail." }, rootPrincipalId);
    await saveDoc(db, { scopePath: "root", slug: "scope-map", title: "Scope Map", bodyMd: "Margin guardrail map of every client scope." }, rootPrincipalId);
    await saveDoc(db, { scopePath: "root", slug: "pattern-margin", title: "Pattern Margin", bodyMd: "Margin guardrail reusable pattern." }, rootPrincipalId);
    await saveDoc(db, { scopePath: clientA, slug: "guardrails", title: "Guardrails", bodyMd: "Margin guardrail for this client." }, rootPrincipalId);

    const hits = await recallMemory(db, { scopePath: clientA, query: "margin guardrail" }, agentPrincipalId);

    expect(hits.some((hit) => hit.scopePath === clientA && hit.slug === "guardrails")).toBe(true);
    expect(hits.some((hit) => hit.scopePath === "root" && hit.slug === "pattern-margin")).toBe(true);
    expect(hits.every((hit) => hit.scopePath !== "root" || hit.slug.startsWith("pattern-") || hit.slug === "critical-facts")).toBe(true);
  });

  it("narrows root requests from a scoped agent token to the token subtree", async () => {
    await saveDoc(db, {
      scopePath: clientA,
      slug: "scope-memory",
      title: "Scope Memory",
      bodyMd: "Narrowed token query banana-alpha.",
    }, rootPrincipalId);
    await saveDoc(db, {
      scopePath: clientB,
      slug: "scope-memory",
      title: "Other Scope Memory",
      bodyMd: "Narrowed token query banana-alpha client-b-secret.",
    }, rootPrincipalId);

    const hits = await recallMemory(db, { scopePath: "root", query: "banana-alpha" }, agentPrincipalId);

    expect(hits.some((hit) => hit.scopePath === clientA)).toBe(true);
    expect(hits.every((hit) => hit.scopePath !== clientB)).toBe(true);
  });

  it("includes the nearest ancestor wiki scope for a deeper token", async () => {
    const child = `${clientA}/ads`;
    await grantRole(db, { principalId: agentPrincipalId, scopePath: child, role: "agent" }, rootPrincipalId);
    await saveDoc(db, { scopePath: clientA, slug: "wiki", title: "Wiki", bodyMd: "Index for ancestor memory." }, rootPrincipalId);
    await saveDoc(db, {
      scopePath: clientA,
      slug: "ancestor-playbook",
      title: "Ancestor Playbook",
      bodyMd: "Seasonality ladder ancestor-only memory.",
    }, rootPrincipalId);

    const hits = await recallMemory(db, { scopePath: child, query: "seasonality ladder" }, agentPrincipalId);

    expect(hits.some((hit) => hit.scopePath === clientA && hit.slug === "ancestor-playbook" && hit.source === "ancestor")).toBe(true);
  });

  it("logs redacted usage without query text or snippets", async () => {
    await saveDoc(db, {
      scopePath: clientA,
      slug: "redaction",
      title: "Redaction",
      bodyMd: "needle-secret-query memory body snippet secret-body-value.",
    }, rootPrincipalId);

    await recallMemory(db, { scopePath: clientA, query: "needle-secret-query" }, agentPrincipalId);

    const usageRows = await db
      .select()
      .from(schema.usageEvents)
      .where(and(eq(schema.usageEvents.operation, "recall_memory"), eq(schema.usageEvents.principalId, agentPrincipalId)));
    expect(usageRows.length).toBeGreaterThan(0);
    const audit = JSON.stringify(usageRows);
    expect(audit).toContain("resultCount");
    expect(audit).not.toContain("needle-secret-query");
    expect(audit).not.toContain("secret-body-value");
  });
});
