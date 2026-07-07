/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { eq } from "drizzle-orm";
import * as dbMod from "@companyos/db";
import {
  createRecord,
  createScope,
  getDoc,
  grantRole,
  listAlerts,
  listCapabilityRuns,
  listDocs,
  saveDoc,
} from "@companyos/api";
import {
  handleBrainEvent,
  runBrainEngine,
  type BrainLlmClient,
  type BrainLlmRequest,
} from "./engine";

const schema: any = (dbMod as any).schema ?? dbMod;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

class FixtureLlm implements BrainLlmClient {
  calls: BrainLlmRequest[] = [];

  async complete(request: BrainLlmRequest) {
    this.calls.push(request);
    const payload = JSON.parse(request.prompt) as any;
    if (request.purpose === "scope-ingest") {
      const first = payload.inputs?.[0] ?? {};
      const style = request.system.includes("STYLE: terse") ? "TERSE" : "NORMAL";
      return {
        text: JSON.stringify({
          recordsDistilled: payload.inputs?.filter((input: any) => input.kind === "record").length ?? 0,
          pages: [{
            slug: "operations",
            title: "Operations",
            bodyMd: [
              "---",
              `learned_at: "${first.createdAt ?? "2026-07-07T00:00:00.000Z"}"`,
              `verified_at: "2026-07-07T00:00:00.000Z"`,
              "confidence: high",
              "---",
              "",
              "# Operations",
              "",
              `${style} scope ${payload.scopePath} maintains a repeatable meta ads launch workflow linked to [[wiki]].`,
              "",
              "## Sources",
              "",
              `- extracted: record:${first.id ?? "none"} (2026-07-07) - ${first.title ?? "input"}`,
            ].join("\n"),
          }],
        }),
        totalTokens: 120,
      };
    }
    if (request.purpose === "root-distill") {
      return {
        text: JSON.stringify({
          pages: [
            {
              slug: "critical-facts",
              title: "Critical Facts",
              bodyMd: "# Critical Facts\n\nTwo client launch scopes are active.\n\n## Sources\n\n- inferred: scope references",
            },
            {
              slug: "scope-map",
              title: "Scope Map",
              bodyMd: "# Scope Map\n\nAlphaCorp and BetaCo share a marketing delivery structure.\n\n## Sources\n\n- inferred: scope references",
            },
            {
              slug: "pattern-meta-ads",
              title: "Pattern: Meta Ads",
              bodyMd: "# Pattern: Meta Ads\n\nAlphaCorp playbook: structure, pitfalls, and typical provision spec.\n\n## Sources\n\n- inferred: scope references",
            },
          ],
        }),
        totalTokens: 150,
      };
    }
    return {
      text: JSON.stringify({
        findings: [{
          type: "contradiction",
          severity: "warning",
          message: "Conflicting pricing claims.",
          slugs: ["pricing-a", "pricing-b"],
          action: "flagged",
        }],
      }),
      totalTokens: 90,
    };
  }
}

describe("brain engine", () => {
  let client: PGlite;
  let db: any;
  let adminPrincipalId: string;
  let fixture: FixtureLlm;
  let unique = 0;

  beforeEach(async () => {
    unique += 1;
    fixture = new FixtureLlm();
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    const [admin] = await db.insert(schema.principals).values({ kind: "agent", name: `Brain ${unique}` }).returning();
    adminPrincipalId = admin.id;
    await createScope(db, { slug: "root", name: "Root", type: "root" }, adminPrincipalId);
    await grantRole(db, { principalId: adminPrincipalId, scopePath: "root", role: "admin" }, adminPrincipalId);
    await saveDoc(db, { scopePath: "root", slug: "wiki", title: "Wiki", bodyMd: "# Wiki\n" }, adminPrincipalId);
    await db.insert(schema.skillsIndex).values({
      name: "wiki-maintenance",
      scopePattern: "**",
      domains: ["brain"],
      path: "wiki-maintenance/SKILL.md",
      description: "Brain wiki maintenance",
      body: "---\nname: wiki-maintenance\n---\nMaintain WIKI.md conventions.",
      sha: `sha-${unique}`,
      syncedAt: new Date(),
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function createProject(slug: string, name = slug) {
    await createScope(db, { slug, name, type: "project" }, adminPrincipalId);
    await grantRole(db, { principalId: adminPrincipalId, scopePath: slug, role: "admin" }, adminPrincipalId);
    await saveDoc(db, { scopePath: slug, slug: "wiki", title: "Wiki", bodyMd: "# Wiki\n\n- [[operations]]" }, adminPrincipalId);
  }

  it("ingests deltas into existing topic pages with frontmatter and provenance, then no-ops with no new inputs", async () => {
    await createProject("alpha");
    const record = await createRecord(db, {
      scopePath: "alpha",
      kind: "changelog",
      title: "Meta ads launch",
      bodyMd: "Created launch checklist.",
    }, adminPrincipalId);

    const first = await runBrainEngine(db, { mode: "ingest", runRef: "ingest-1" }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    expect(first.pagesTouched).toBeGreaterThanOrEqual(3);
    expect(first.recordsDistilled).toBe(1);
    const doc = await getDoc(db, { scopePath: "alpha", slug: "operations" }, adminPrincipalId);
    expect(doc?.bodyMd).toContain("learned_at:");
    expect(doc?.bodyMd).toContain("confidence: high");
    expect(doc?.bodyMd).toContain(`record:${record.id}`);
    expect(doc?.bodyMd).toContain("extracted:");

    const callsAfterFirst = fixture.calls.length;
    const second = await runBrainEngine(db, { mode: "ingest", runRef: "ingest-2" }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T01:00:00.000Z"),
    });
    expect(second.pagesTouched).toBe(0);
    expect(second.llmCalls).toBe(0);
    expect(fixture.calls.length).toBe(callsAfterFirst);
  });

  it("distills root reserved pages and sanitizes pattern pages from client specifics", async () => {
    await createProject("alpha", "AlphaCorp");
    await createProject("beta", "BetaCo");
    await createRecord(db, { scopePath: "alpha", kind: "changelog", title: "Meta ads launch", bodyMd: "Launch pattern." }, adminPrincipalId);
    await createRecord(db, { scopePath: "beta", kind: "changelog", title: "Meta ads launch", bodyMd: "Same launch pattern." }, adminPrincipalId);

    await runBrainEngine(db, { mode: "ingest", runRef: "root-distill" }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    await expect(getDoc(db, { scopePath: "root", slug: "critical-facts" }, adminPrincipalId)).resolves.toBeTruthy();
    await expect(getDoc(db, { scopePath: "root", slug: "scope-map" }, adminPrincipalId)).resolves.toBeTruthy();
    const pattern = await getDoc(db, { scopePath: "root", slug: "pattern-meta-ads" }, adminPrincipalId);
    expect(pattern?.bodyMd).toContain("typical provision spec");
    expect(pattern?.bodyMd).not.toContain("AlphaCorp");
    expect(pattern?.bodyMd).not.toContain("BetaCo");
  });

  it("lint flags contradictions and stale claims, reports orphans, and auto-fixes only index links and exact duplicates", async () => {
    await createProject("linty");
    await saveDoc(db, { scopePath: "linty", slug: "wiki", title: "Wiki", bodyMd: "# Wiki\n\n- [[pricing-a]]" }, adminPrincipalId);
    await saveDoc(db, {
      scopePath: "linty",
      slug: "pricing-a",
      title: "Pricing A",
      bodyMd: "---\nlearned_at: \"2026-01-01T00:00:00.000Z\"\nverified_at: \"2026-01-01T00:00:00.000Z\"\nstale_after: \"2026-02-01T00:00:00.000Z\"\nconfidence: medium\n---\n\nPrice is $10.\n\n## Sources\n\n- extracted: record:r1",
    }, adminPrincipalId);
    await saveDoc(db, { scopePath: "linty", slug: "pricing-b", title: "Pricing B", bodyMd: "Price is $20.\n\n## Sources\n\n- extracted: record:r2" }, adminPrincipalId);
    await saveDoc(db, { scopePath: "linty", slug: "dupe-a", title: "Dupe A", bodyMd: "Same body.\n\n## Sources\n\n- extracted: record:r3" }, adminPrincipalId);
    await saveDoc(db, { scopePath: "linty", slug: "dupe-b", title: "Dupe B", bodyMd: "Same body.\n\n## Sources\n\n- extracted: record:r4" }, adminPrincipalId);

    const result = await runBrainEngine(db, { mode: "lint", scopePath: "linty", runRef: "lint-1" }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    expect(result.lintFindings.some((finding) => finding.type === "orphan")).toBe(true);
    expect(result.lintFindings.some((finding) => finding.type === "stale")).toBe(true);
    expect(result.lintFindings.some((finding) => finding.type === "contradiction")).toBe(true);
    const report = await getDoc(db, { scopePath: "linty", slug: "lint-report" }, adminPrincipalId);
    expect(report?.bodyMd).toContain("Conflicting pricing claims");
    const index = await getDoc(db, { scopePath: "linty", slug: "wiki" }, adminPrincipalId);
    expect(index?.bodyMd).toContain("[[pricing-b]]");
    const docs = await listDocs(db, { scopePath: "linty" }, adminPrincipalId);
    expect(docs.some((doc) => doc.slug === "dupe-b")).toBe(false);
    const alerts = await listAlerts(db, { scopePath: "root", severity: "warning" }, adminPrincipalId);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("targets event-hook ingest to the event scope's top-level project", async () => {
    await createProject("event-alpha");
    await createProject("event-beta");
    await createRecord(db, { scopePath: "event-beta", kind: "changelog", title: "Event workbench burst", bodyMd: "Changed code." }, adminPrincipalId);

    const result = await handleBrainEvent(db, {
      eventType: "workbench.push",
      scopePath: "event-beta",
      runRef: "event-ingest",
    }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    expect(result?.scopeRuns.map((run) => run.scopePath)).toEqual(["event-beta"]);
    await expect(getDoc(db, { scopePath: "event-beta", slug: "operations" }, adminPrincipalId)).resolves.toBeTruthy();
    await expect(getDoc(db, { scopePath: "event-alpha", slug: "operations" }, adminPrincipalId)).resolves.toBeNull();
  });

  it("enforces token ceilings and reports partial runs with token counts", async () => {
    await createProject("budgeted");
    await createRecord(db, { scopePath: "budgeted", kind: "changelog", title: "Budget input", bodyMd: "Input." }, adminPrincipalId);

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "budget", tokenCeiling: 1 }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    expect(result.partial).toBe(true);
    expect(result.llmCalls).toBe(0);
    const runs = await listCapabilityRuns(db, { scopePath: "root", name: "brain-engine", limit: 5 }, adminPrincipalId);
    expect(runs[0]?.payload).toMatchObject({ partial: true, tokens: 0 });
  });

  it("loads engine instructions from the synced skill on every run", async () => {
    await createProject("skillful");
    await createRecord(db, { scopePath: "skillful", kind: "changelog", title: "First style", bodyMd: "Input." }, adminPrincipalId);
    await runBrainEngine(db, { mode: "ingest", runRef: "skill-1" }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    let doc = await getDoc(db, { scopePath: "skillful", slug: "operations" }, adminPrincipalId);
    expect(doc?.bodyMd).toContain("NORMAL");

    await db.update(schema.skillsIndex).set({
      body: "---\nname: wiki-maintenance\n---\nMaintain WIKI.md conventions.\nSTYLE: terse",
      syncedAt: new Date(),
    }).where(eq(schema.skillsIndex.name, "wiki-maintenance"));
    await createRecord(db, { scopePath: "skillful", kind: "changelog", title: "Second style", bodyMd: "Input." }, adminPrincipalId);
    await runBrainEngine(db, { mode: "ingest", runRef: "skill-2" }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T01:00:00.000Z"),
    });
    doc = await getDoc(db, { scopePath: "skillful", slug: "operations" }, adminPrincipalId);
    expect(doc?.bodyMd).toContain("TERSE");
    expect(fixture.calls.at(-2)?.system).toContain("STYLE: terse");
  });
});
