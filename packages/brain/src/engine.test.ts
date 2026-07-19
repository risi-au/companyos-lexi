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
  createAttentionItem,
  createRecord,
  createScope,
  ensurePersonalScope,
  getDoc,
  grantRole,
  listAttentionItems,
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
    if (request.purpose === "project-overview") {
      const payload = JSON.parse(request.prompt) as any;
      return {
        text: JSON.stringify({
          pages: [{
            slug: "overview",
            title: "Overview",
            bodyMd: `# Overview\n\n${payload.scope?.name ?? payload.scopePath ?? "Project"} is active. Recent activity is reflected in changelog and decision records.\n\n## Sources\n\n- inferred: recent project activity`,
          }],
        }),
        totalTokens: 100,
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

class ScriptedLlm implements BrainLlmClient {
  calls: BrainLlmRequest[] = [];
  private readonly responses: Partial<Record<BrainLlmRequest["purpose"], string[]>>;

  constructor(responses: Partial<Record<BrainLlmRequest["purpose"], string | string[]>>) {
    this.responses = Object.fromEntries(
      Object.entries(responses).map(([purpose, value]) => [purpose, Array.isArray(value) ? [...value] : [value]])
    ) as Partial<Record<BrainLlmRequest["purpose"], string[]>>;
  }

  async complete(request: BrainLlmRequest) {
    this.calls.push(request);
    const queued = this.responses[request.purpose];
    const text = queued && queued.length > 0
      ? queued.shift()!
      : request.purpose === "lint-scope"
        ? JSON.stringify({ findings: [] })
        : request.purpose === "project-overview"
          ? JSON.stringify({ pages: [{ slug: "overview", title: "Overview", bodyMd: "# Overview\\n\\nProject is active.\\n\\n## Sources\\n\\n- inferred: recent project activity" }] })
          : JSON.stringify({ pages: [] });
    return { text, totalTokens: 50 };
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

  function v2Conflict(overrides: any = {}) {
    const pricingA = overrides.pricingA ?? "Price is 10 USD for 2026.";
    const pricingB = overrides.pricingB ?? "Price is 20 USD for 2026.";
    return {
      version: 2,
      type: "contradiction",
      relation: "scalar-mismatch",
      subject: { entity: "standard plan", property: "price", timeframe: "2026" },
      explanation: "Two wiki pages list different 2026 prices for the standard plan.",
      claims: [
        { slug: "pricing-a", title: "Pricing A", quote: pricingA, normalizedValue: "10 USD" },
        { slug: "pricing-b", title: "Pricing B", quote: pricingB, normalizedValue: "20 USD" },
      ],
      choices: [
        {
          id: "first",
          label: "Use the 10 USD price",
          repair: {
            slug: "pricing-b",
            title: "Pricing B",
            currentMd: pricingB,
            proposedMd: pricingA,
          },
        },
        {
          id: "second",
          label: "Use the 20 USD price",
          repair: {
            slug: "pricing-a",
            title: "Pricing A",
            currentMd: pricingA,
            proposedMd: pricingB,
          },
        },
      ],
      ...overrides.finding,
    };
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


  it("maintains a project overview page and skips unchanged rewrites", async () => {
    await createProject("overviewed", "Overviewed Project");
    await createRecord(db, { scopePath: "overviewed", kind: "changelog", title: "Launch update", bodyMd: "Launch work moved forward." }, adminPrincipalId);
    const overviewBody = "# Overview\n\nOverviewed Project is active and recently advanced launch work.\n\n## Sources\n\n- extracted: record:launch-update";
    const llm = new ScriptedLlm({
      "scope-ingest": JSON.stringify({ recordsDistilled: 1, pages: [] }),
      "project-overview": JSON.stringify({
        pages: [{ slug: "overview", title: "Overview", bodyMd: overviewBody }],
      }),
      "root-distill": JSON.stringify({ pages: [] }),
    });

    const first = await runBrainEngine(db, { mode: "ingest", runRef: "overview-1" }, adminPrincipalId, {
      llm,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    expect(first.pagesTouched).toBe(1);
    const overview = await getDoc(db, { scopePath: "overviewed", slug: "overview" }, adminPrincipalId);
    expect(overview?.bodyMd).toContain("Overviewed Project is active");

    const revisionsBefore = await db
      .select()
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.documentId, overview!.id));

    const second = await runBrainEngine(db, { mode: "ingest", runRef: "overview-2" }, adminPrincipalId, {
      llm,
      now: new Date("2026-07-07T01:00:00.000Z"),
    });
    expect(second.pagesTouched).toBe(0);

    const revisionsAfter = await db
      .select()
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.documentId, overview!.id));
    expect(revisionsAfter).toHaveLength(revisionsBefore.length);
    expect(llm.calls.filter((call) => call.purpose === "project-overview")).toHaveLength(1);
  });
  it("lint creates a V2 conflict item, keeps run payload history, and auto-fixes only index links and exact duplicates", async () => {
    await createProject("linty");
    await saveDoc(db, { scopePath: "linty", slug: "wiki", title: "Wiki", bodyMd: "# Wiki\n\n- [[pricing-a]]" }, adminPrincipalId);
    await saveDoc(db, { scopePath: "linty", slug: "pricing-a", title: "Pricing A", bodyMd: "Price is 10 USD for 2026." }, adminPrincipalId);
    await saveDoc(db, { scopePath: "linty", slug: "pricing-b", title: "Pricing B", bodyMd: "Price is 20 USD for 2026." }, adminPrincipalId);
    await saveDoc(db, { scopePath: "linty", slug: "dupe-a", title: "Dupe A", bodyMd: "Same body.\n\n## Sources\n\n- extracted: record:r3" }, adminPrincipalId);
    await saveDoc(db, { scopePath: "linty", slug: "dupe-b", title: "Dupe B", bodyMd: "Same body.\n\n## Sources\n\n- extracted: record:r4" }, adminPrincipalId);
    const legacyReportBody = "# Old health report\n\nHistorical only.";
    await saveDoc(db, { scopePath: "linty", slug: "lint-report", title: "Old health report", bodyMd: legacyReportBody }, adminPrincipalId);
    const llm = new ScriptedLlm({ "lint-scope": JSON.stringify({ findings: [v2Conflict()] }) });

    const result = await runBrainEngine(db, { mode: "lint", scopePath: "linty", runRef: "lint-1" }, adminPrincipalId, {
      llm,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    expect(result.lintFindings.some((finding) => finding.type === "orphan")).toBe(true);
    expect(result.lintFindings.some((finding) => finding.type === "contradiction")).toBe(true);
    const report = await getDoc(db, { scopePath: "linty", slug: "lint-report" }, adminPrincipalId);
    expect(report?.bodyMd).toBe(legacyReportBody);
    const lintPrompt = JSON.parse(llm.calls.find((call) => call.purpose === "lint-scope")!.prompt);
    expect(lintPrompt.pages.some((page: any) => page.slug.startsWith("lint-report"))).toBe(false);
    const items = await listAttentionItems(db, { scopePath: "linty", kind: "lint_finding", status: "open" }, adminPrincipalId);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Two wiki pages disagree");
    expect(items[0]?.payload).toMatchObject({
      version: 2,
      type: "contradiction",
      relation: "scalar-mismatch",
      claims: [
        { slug: "pricing-a", quote: "Price is 10 USD for 2026.", normalizedValue: "10 USD" },
        { slug: "pricing-b", quote: "Price is 20 USD for 2026.", normalizedValue: "20 USD" },
      ],
    });
    const runs = await listCapabilityRuns(db, { scopePath: "root", name: "brain-engine", limit: 5 }, adminPrincipalId);
    expect(runs[0]?.payload).toMatchObject({
      lintFindings: expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ version: 2, type: "contradiction" }) }),
      ]),
    });
    const index = await getDoc(db, { scopePath: "linty", slug: "wiki" }, adminPrincipalId);
    expect(index?.bodyMd).toContain("[[pricing-b]]");
    const docs = await listDocs(db, { scopePath: "linty" }, adminPrincipalId);
    expect(docs.some((doc) => doc.slug === "dupe-b")).toBe(false);
    const alerts = await listAlerts(db, { scopePath: "root", severity: "warning" }, adminPrincipalId);
    expect(alerts.length).toBeGreaterThan(0);
  });

  async function seedPricingConflict(scopePath: string) {
    await createProject(scopePath);
    await saveDoc(db, { scopePath, slug: "wiki", title: "Wiki", bodyMd: "# Wiki\n\n- [[pricing-a]]\n- [[pricing-b]]" }, adminPrincipalId);
    await saveDoc(db, { scopePath, slug: "pricing-a", title: "Pricing A", bodyMd: "Price is 10 USD for 2026." }, adminPrincipalId);
    await saveDoc(db, { scopePath, slug: "pricing-b", title: "Pricing B", bodyMd: "Price is 20 USD for 2026." }, adminPrincipalId);
  }

  async function runRejectedFinding(scopePath: string, finding: any) {
    const llm = new ScriptedLlm({ "lint-scope": JSON.stringify({ findings: [finding] }) });
    const result = await runBrainEngine(db, { mode: "lint", scopePath, runRef: `reject-${scopePath}` }, adminPrincipalId, {
      llm,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });
    const items = await listAttentionItems(db, { scopePath, kind: "lint_finding", status: "open" }, adminPrincipalId);
    expect(result.status).toBe("error");
    expect(result.lintFindings.some((finding) => finding.type === "contradiction")).toBe(false);
    expect(items).toHaveLength(0);
    expect(result.scopeRuns[0]?.parseFailed).toBe(true);
  }

  it.each([
    ["missing quote", (finding: any) => {
      finding.claims[0].quote = "Price is 11 USD for 2026.";
      return finding;
    }],
    ["missing page", (finding: any) => {
      finding.claims[1].slug = "missing";
      return finding;
    }],
    ["same slug", (finding: any) => {
      finding.claims[1].slug = "pricing-a";
      return finding;
    }],
    ["mismatched subject", (finding: any) => {
      finding.claims[1].subject = { entity: "premium plan", property: "price", timeframe: "2026" };
      return finding;
    }],
    ["invalid relation and value pair", (finding: any) => {
      finding.relation = "opposite-boolean";
      return finding;
    }],
    ["unsafe current markdown", (finding: any) => {
      finding.choices[0].repair.currentMd = "Price is 19 USD for 2026.";
      return finding;
    }],
    ["no-op repair", (finding: any) => {
      finding.choices[0].repair.proposedMd = finding.choices[0].repair.currentMd;
      return finding;
    }],
    ["multi-page repair", (finding: any) => {
      finding.choices.push({ ...finding.choices[0], id: "extra" });
      return finding;
    }],
  ])("rejects V2 conflict output with %s", async (_name, mutate) => {
    const scopePath = `reject-${unique}`;
    await seedPricingConflict(scopePath);
    await runRejectedFinding(scopePath, mutate(v2Conflict()));
  });

  it("rejects completion versus dismissal as an unsupported conflict", async () => {
    const scopePath = "completion-dismissal";
    await createProject(scopePath);
    await saveDoc(db, { scopePath, slug: "intake-complete", title: "Intake Complete", bodyMd: "The intake workflow completed." }, adminPrincipalId);
    await saveDoc(db, { scopePath, slug: "intake-dismissed", title: "Intake Dismissed", bodyMd: "The intake dismissed the request." }, adminPrincipalId);
    await runRejectedFinding(scopePath, {
      version: 2,
      type: "contradiction",
      relation: "exclusive-status",
      subject: { entity: "intake request", property: "approval status", timeframe: "current" },
      explanation: "The intake outcome appears inconsistent.",
      claims: [
        { slug: "intake-complete", title: "Intake Complete", quote: "The intake workflow completed.", normalizedValue: "approved" },
        { slug: "intake-dismissed", title: "Intake Dismissed", quote: "The intake dismissed the request.", normalizedValue: "dismissed" },
      ],
      choices: [
        { id: "first", label: "Use completed", repair: { slug: "intake-dismissed", title: "Intake Dismissed", currentMd: "The intake dismissed the request.", proposedMd: "The intake workflow completed." } },
        { id: "second", label: "Use dismissed", repair: { slug: "intake-complete", title: "Intake Complete", currentMd: "The intake workflow completed.", proposedMd: "The intake dismissed the request." } },
      ],
    });
  });

  it("does not let a legacy weak finding suppress a later valid V2 finding", async () => {
    await seedPricingConflict("legacy-dedupe");
    await createAttentionItem(db, {
      scopePath: "legacy-dedupe",
      kind: "lint_finding",
      title: "Wiki lint: contradiction",
      summary: "Old weak conflict.",
      payload: { type: "contradiction", slugs: ["pricing-a", "pricing-b"], message: "Old weak conflict." },
    }, adminPrincipalId);
    const llm = new ScriptedLlm({ "lint-scope": JSON.stringify({ findings: [v2Conflict()] }) });

    await runBrainEngine(db, { mode: "lint", scopePath: "legacy-dedupe", runRef: "legacy-dedupe" }, adminPrincipalId, { llm });

    const items = await listAttentionItems(db, { scopePath: "legacy-dedupe", kind: "lint_finding", status: "open" }, adminPrincipalId);
    expect(items).toHaveLength(2);
    expect(items.some((item) => (item.payload as any)?.version === 2)).toBe(true);
  });

  it("deduplicates the same valid V2 finding on later runs", async () => {
    await seedPricingConflict("v2-dedupe");
    const llm = new ScriptedLlm({
      "lint-scope": [
        JSON.stringify({ findings: [v2Conflict()] }),
        JSON.stringify({ findings: [v2Conflict()] }),
      ],
    });

    await runBrainEngine(db, { mode: "lint", scopePath: "v2-dedupe", runRef: "v2-dedupe-1" }, adminPrincipalId, { llm });
    await runBrainEngine(db, { mode: "lint", scopePath: "v2-dedupe", runRef: "v2-dedupe-2" }, adminPrincipalId, { llm });

    const items = await listAttentionItems(db, { scopePath: "v2-dedupe", kind: "lint_finding", status: "open" }, adminPrincipalId);
    expect(items).toHaveLength(1);
    expect((items[0]?.payload as any)?.fingerprint).toMatch(/^v2\|/);
    expect((items[0]?.payload as any)?.payload).toBeUndefined();
  });

  it("accepts matching prefix currency units", async () => {
    await createProject("supported-relations");
    await saveDoc(db, { scopePath: "supported-relations", slug: "pricing-a", title: "Pricing A", bodyMd: "Price is $10 for 2026." }, adminPrincipalId);
    await saveDoc(db, { scopePath: "supported-relations", slug: "pricing-b", title: "Pricing B", bodyMd: "Price is $20 for 2026." }, adminPrincipalId);
    const currency = v2Conflict({ pricingA: "Price is $10 for 2026.", pricingB: "Price is $20 for 2026." });
    currency.claims[0].normalizedValue = "$10";
    currency.claims[1].normalizedValue = "$20";
    const llm = new ScriptedLlm({ "lint-scope": JSON.stringify({ findings: [currency] }) });

    const result = await runBrainEngine(db, { mode: "lint", scopePath: "supported-relations", runRef: "currency" }, adminPrincipalId, { llm });

    expect(result.lintFindings.some((finding) => finding.type === "contradiction")).toBe(true);
  });

  it("creates V2 stale payloads from elapsed frontmatter only", async () => {
    await createProject("stale-v2");
    const staleBody = [
      "---",
      "stale_after: \"2026-02-01T00:00:00.000Z\"",
      "confidence: medium",
      "---",
      "",
      "This page should be reviewed.",
    ].join("\n");
    await saveDoc(db, { scopePath: "stale-v2", slug: "elapsed", title: "Elapsed", bodyMd: staleBody }, adminPrincipalId);
    await saveDoc(db, { scopePath: "stale-v2", slug: "future", title: "Future", bodyMd: "---\nstale_after: \"2026-12-01T00:00:00.000Z\"\n---\n\nNot due yet." }, adminPrincipalId);
    await saveDoc(db, { scopePath: "stale-v2", slug: "invalid", title: "Invalid", bodyMd: "---\nstale_after: \"not a date\"\n---\n\nBad date." }, adminPrincipalId);

    const result = await runBrainEngine(db, { mode: "lint", scopePath: "stale-v2", runRef: "stale-v2" }, adminPrincipalId, {
      llm: new ScriptedLlm({ "lint-scope": JSON.stringify({ findings: [] }) }),
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    const stale = result.lintFindings.filter((finding) => finding.type === "stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.payload).toEqual({
      version: 2,
      type: "stale",
      slug: "elapsed",
      title: "Elapsed",
      currentMd: staleBody,
      reviewDueAt: "2026-02-01T00:00:00.000Z",
    });
    const items = await listAttentionItems(db, { scopePath: "stale-v2", kind: "lint_finding", status: "open" }, adminPrincipalId);
    expect(items).toHaveLength(1);
    expect(items[0]?.payload).toMatchObject({ version: 2, type: "stale", currentMd: staleBody });
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

  it("excludes personal scopes from routine ingest targets", async () => {
    const [human] = await db.insert(schema.principals).values({ kind: "human", name: `Personal Owner ${unique}` }).returning();
    const personal = await ensurePersonalScope(db, human.id);
    await createRecord(db, { scopePath: personal.scopePath, kind: "note", title: "Personal-only input", bodyMd: "Do not sweep this routinely." }, adminPrincipalId);

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "personal-routine" }, adminPrincipalId, {
      llm: fixture,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    expect(result.scopeRuns.map((run) => run.scopePath)).not.toContain(personal.scopePath);
    expect(fixture.calls.some((call) => call.purpose === "scope-ingest")).toBe(false);
  });

  it("passes personal routing targets to ingest and writes valid routed pages to a personal wiki", async () => {
    await createProject("routing-work");
    const [human] = await db.insert(schema.principals).values({ kind: "human", name: `Routing Human ${unique}` }).returning();
    const personal = await ensurePersonalScope(db, human.id);
    await createRecord(db, { scopePath: "routing-work", kind: "note", title: "Tool preference", bodyMd: "The operator prefers CLI drafts." }, adminPrincipalId);
    const llm = new ScriptedLlm({
      "scope-ingest": JSON.stringify({
        recordsDistilled: 1,
        pages: [{
          slug: "tool-preferences",
          title: "Tool Preferences",
          targetScopePath: personal.scopePath,
          bodyMd: "# Tool Preferences\n\nOperator prefers CLI drafts.\n\n## Sources\n\n- extracted: record:r1",
        }],
      }),
      "root-distill": JSON.stringify({ pages: [] }),
    });

    await runBrainEngine(db, { mode: "ingest", scopePath: "routing-work", runRef: "personal-routing" }, adminPrincipalId, { llm });

    const prompt = JSON.parse(llm.calls.find((call) => call.purpose === "scope-ingest")!.prompt) as any;
    expect(prompt.routingRule).toContain("is the fact about the person or about the work?");
    expect(prompt.personalWikiTargets).toEqual(expect.arrayContaining([expect.objectContaining({ scopePath: personal.scopePath })]));
    await expect(getDoc(db, { scopePath: personal.scopePath, slug: "tool-preferences" }, adminPrincipalId)).resolves.toBeTruthy();
  });

  it("emits deduped graduation attention items from lint maintenance proposals", async () => {
    await createProject("graduation-work");
    const [human] = await db.insert(schema.principals).values({ kind: "human", name: `Graduation Human ${unique}` }).returning();
    const personal = await ensurePersonalScope(db, human.id);
    await saveDoc(db, {
      scopePath: personal.scopePath,
      slug: "client-truth",
      title: "Client Truth",
      bodyMd: "# Client Truth\n\nGraduation source personal note says the work scope owns this fact.",
    }, human.id);
    const llm = new ScriptedLlm({
      "lint-scope": [
        JSON.stringify({ findings: [] }),
        JSON.stringify({
          graduations: [{
            direction: "personal-to-scope",
            targetScopePath: "graduation-work",
            fromScopePath: personal.scopePath,
            fromSlug: "client-truth",
            proposal: {
              slug: "client-truth",
              title: "Client Truth",
              proposedMd: "Graduated target page only.",
            },
          }],
        }),
      ],
    });

    await runBrainEngine(db, { mode: "lint", scopePath: "graduation-work", runRef: "graduation-lint" }, adminPrincipalId, { llm });
    await runBrainEngine(db, { mode: "lint", scopePath: "graduation-work", runRef: "graduation-lint-2" }, adminPrincipalId, { llm });

    const items = await listAttentionItems(db, { scopePath: "graduation-work", kind: "graduation", status: "open" }, adminPrincipalId);
    expect(items).toHaveLength(1);
    expect(items[0]?.payload).toMatchObject({
      direction: "personal-to-scope",
      fromScopePath: personal.scopePath,
      fromSlug: "client-truth",
      proposal: { slug: "client-truth", proposedMd: "Graduated target page only." },
    });
    expect(JSON.stringify(items[0]?.payload)).not.toContain("Graduation source personal note");
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

  it("fails and reports a bounded excerpt for a prose-only scope-ingest response", async () => {
    await createProject("bad-prose");
    await createRecord(db, { scopePath: "bad-prose", kind: "changelog", title: "Bad output", bodyMd: "Input." }, adminPrincipalId);
    const llm = new ScriptedLlm({
      "scope-ingest": `I updated the wiki in prose instead of JSON. ${"x".repeat(3000)}`,
      "root-distill": JSON.stringify({ pages: [] }),
    });

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "bad-prose" }, adminPrincipalId, { llm });

    expect(result.status).toBe("error");
    expect(result.scopeRuns[0]).toMatchObject({ scopePath: "bad-prose", parseFailed: true });
    expect(result.scopeRuns[0]?.parseFailureExcerpt?.length).toBeLessThanOrEqual(2048);
    expect(result.scopeRuns[0]?.parseFailureExcerpt).toContain("instead of JSON");
    const runs = await listCapabilityRuns(db, { scopePath: "root", name: "brain-engine", limit: 5 }, adminPrincipalId);
    expect(runs[0]?.status).toBe("error");
    expect(runs[0]?.payload).toMatchObject({
      status: "error",
      scopeRuns: [expect.objectContaining({ parseFailed: true })],
    });
  });

  it("accepts fenced JSON with a prose preamble before giving up", async () => {
    await createProject("fenced");
    await createRecord(db, { scopePath: "fenced", kind: "changelog", title: "Fenced output", bodyMd: "Input." }, adminPrincipalId);
    const llm = new ScriptedLlm({
      "scope-ingest": [
        "Here is the JSON:\n```json\n" + JSON.stringify({
          recordsDistilled: 1,
          pages: [{
            slug: "fenced-page",
            title: "Fenced Page",
            bodyMd: "# Fenced Page\n\nValid fenced JSON output.\n\n## Sources\n\n- extracted: record:r1",
          }],
        }) + "\n```",
      ],
      "root-distill": JSON.stringify({ pages: [] }),
    });

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "fenced" }, adminPrincipalId, { llm });

    expect(result.status).toBe("success");
    expect(result.scopeRuns.some((run) => run.parseFailed)).toBe(false);
    await expect(getDoc(db, { scopePath: "fenced", slug: "fenced-page" }, adminPrincipalId)).resolves.toBeTruthy();
  });

  it("fails and reports a bounded excerpt for truncated JSON", async () => {
    await createProject("truncated");
    await createRecord(db, { scopePath: "truncated", kind: "changelog", title: "Truncated output", bodyMd: "Input." }, adminPrincipalId);
    const llm = new ScriptedLlm({
      "scope-ingest": "{\"pages\":[{\"slug\":\"broken\",\"title\":\"Broken\",\"bodyMd\":\"# Broken\"}",
      "root-distill": JSON.stringify({ pages: [] }),
    });

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "truncated" }, adminPrincipalId, { llm });

    expect(result.status).toBe("error");
    expect(result.scopeRuns[0]).toMatchObject({ parseFailed: true });
    expect(result.scopeRuns[0]?.parseFailureExcerpt).toContain("\"pages\"");
  });

  it("reports root-distill pages dropped for non-reserved slugs", async () => {
    await createProject("root-drop");
    await createRecord(db, { scopePath: "root-drop", kind: "changelog", title: "Root output", bodyMd: "Input." }, adminPrincipalId);
    const llm = new ScriptedLlm({
      "scope-ingest": JSON.stringify({
        recordsDistilled: 1,
        pages: [{
          slug: "operations",
          title: "Operations",
          bodyMd: "# Operations\n\nDurable fact.\n\n## Sources\n\n- extracted: record:r1",
        }],
      }),
      "root-distill": JSON.stringify({
        pages: [{
          slug: "client-specific-plan",
          title: "Client Plan",
          bodyMd: "# Client Plan\n\nThis should not be saved at root.",
        }],
      }),
    });

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "root-drop" }, adminPrincipalId, { llm });

    const rootRun = result.scopeRuns.find((run) => run.scopePath === "root");
    expect(result.status).toBe("error");
    expect(rootRun).toMatchObject({
      parseFailed: true,
      droppedNonReservedSlugs: 1,
      parseFailureReason: "root distill returned only non-reserved slugs",
    });
    await expect(getDoc(db, { scopePath: "root", slug: "client-specific-plan" }, adminPrincipalId)).resolves.toBeNull();
  });

  it("adds the mandatory JSON envelope instruction to scope-ingest, root-distill, and lint prompts", async () => {
    await createProject("enveloped");
    await createRecord(db, { scopePath: "enveloped", kind: "changelog", title: "Envelope", bodyMd: "Input." }, adminPrincipalId);
    await runBrainEngine(db, { mode: "ingest", runRef: "envelope-ingest" }, adminPrincipalId, { llm: fixture });
    await runBrainEngine(db, { mode: "lint", scopePath: "enveloped", runRef: "envelope-lint" }, adminPrincipalId, { llm: fixture });

    for (const purpose of ["scope-ingest", "project-overview", "root-distill", "lint-scope"] as const) {
      const call = fixture.calls.find((entry) => entry.purpose === purpose);
      expect(call, purpose).toBeTruthy();
      const prompt = JSON.parse(call!.prompt);
      expect(prompt.outputFormatMandatory).toContain("Return only one JSON object");
      if (purpose === "lint-scope") {
        expect(prompt.outputFormatMandatory).toContain("\"version\":2");
        expect(prompt.instruction).toContain("Never treat process completion");
      } else {
        expect(JSON.stringify(prompt)).toContain("current-work");
        expect(JSON.stringify(prompt)).toContain("decisions-policies");
        expect(JSON.stringify(prompt)).toContain("guides-processes");
        expect(JSON.stringify(prompt)).toContain("reference");
      }
    }
  });
});
