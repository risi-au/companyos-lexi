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
import { createRecord, createScope, getDoc, grantRole, saveDoc } from "@companyos/api";
import { runBrainEngine, type BrainLlmClient, type BrainLlmRequest } from "./engine";
import { classifyChangedPath, type CodeDocsGitHubReader } from "./code-docs";

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

class FixtureRepo implements CodeDocsGitHubReader {
  listFilesCalls = 0;
  getFileCalls: string[] = [];

  constructor(private readonly tree: Array<{ path: string; sha: string }>) {}

  async listFiles(): Promise<Array<{ path: string; sha: string }>> {
    this.listFilesCalls += 1;
    return this.tree;
  }

  async getFile(_repo: string, filePath: string): Promise<{ sha: string; contentUtf8: string } | null> {
    this.getFileCalls.push(filePath);
    const entry = this.tree.find((row) => row.path === filePath);
    if (!entry) return null;
    return { sha: entry.sha, contentUtf8: `content of ${filePath}` };
  }
}

class FixtureLlm implements BrainLlmClient {
  calls: BrainLlmRequest[] = [];

  async complete(request: BrainLlmRequest) {
    this.calls.push(request);
    if (request.purpose === "code-docs") {
      const payload = JSON.parse(request.prompt) as any;
      return {
        text: JSON.stringify({
          pages: (payload.affectedSlugs as string[]).map((slug) => ({
            slug,
            title: `Title ${slug}`,
            bodyMd: `# ${slug}\n\nDistilled ${payload.pass} view of ${payload.repo} for ${slug}. Links to [[wiki]].`,
          })),
        }),
        totalTokens: 100,
      };
    }
    if (request.purpose === "project-overview") {
      return {
        text: JSON.stringify({
          pages: [{
            slug: "overview",
            title: "Overview",
            bodyMd: "# Overview\n\nCode project is active.\n\n## Sources\n\n- inferred: code docs pass",
          }],
        }),
        totalTokens: 50,
      };
    }
    if (request.purpose === "root-distill") {
      return {
        text: JSON.stringify({
          pages: [{
            slug: "pattern-code-stack",
            title: "Pattern: Code Stack",
            bodyMd: "# Pattern: Code Stack\n\nAlphaCorp and alpha-repo scopes ship a Next.js monorepo playbook.\n\n## Sources\n\n- inferred: scope wikis",
          }],
        }),
        totalTokens: 100,
      };
    }
    // scope-ingest
    return { text: JSON.stringify({ pages: [], recordsDistilled: 0 }), totalTokens: 50 };
  }

  codeDocsCalls(): BrainLlmRequest[] {
    return this.calls.filter((call) => call.purpose === "code-docs");
  }
}

const BOOTSTRAP_TREE = [
  { path: "README.md", sha: "sha-readme" },
  { path: "AGENTS.md", sha: "sha-agents" },
  { path: "package.json", sha: "sha-pkg" },
  { path: "docker-compose.yml", sha: "sha-compose" },
  { path: ".github/workflows/deploy.yml", sha: "sha-deploy" },
  { path: "src/app/api/webhooks/route.ts", sha: "sha-webhook" },
  { path: "src/lib/util.ts", sha: "sha-util" },
];

describe("brain code-docs pass", () => {
  let client: PGlite;
  let db: any;
  let adminPrincipalId: string;
  let llm: FixtureLlm;
  let unique = 0;

  beforeEach(async () => {
    unique += 1;
    llm = new FixtureLlm();
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    const [admin] = await db.insert(schema.principals).values({ kind: "agent", name: `CodeDocs ${unique}` }).returning();
    adminPrincipalId = admin.id;
    await createScope(db, { slug: "root", name: "Root", type: "root" }, adminPrincipalId);
    await grantRole(db, { principalId: adminPrincipalId, scopePath: "root", role: "admin" }, adminPrincipalId);
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

  async function createProjectWithWorkbench(slug: string, repo: string, name = slug) {
    await createScope(db, { slug, name, type: "project" }, adminPrincipalId);
    await grantRole(db, { principalId: adminPrincipalId, scopePath: slug, role: "admin" }, adminPrincipalId);
    await saveDoc(db, { scopePath: slug, slug: "wiki", title: "Wiki", bodyMd: "# Wiki\n" }, adminPrincipalId);
    const [scope] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, slug));
    await db.insert(schema.workbenches).values({ scopeId: scope.id, repo, path: "" });
    return scope;
  }

  async function insertPushEvent(scopeId: string, after: string, changedPaths: string[]) {
    await db.insert(schema.events).values({
      type: "workbench.push",
      scopeId,
      payload: { after, changedPathSamples: changedPaths, changedPathCount: changedPaths.length },
    });
  }

  it("bootstraps the four code-* pages with frontmatter, SHA-cited sources, and index links", async () => {
    const scope = await createProjectWithWorkbench("alpha", "alpha-repo");
    await insertPushEvent(scope.id, "commit-1", ["README.md"]);
    const github = new FixtureRepo(BOOTSTRAP_TREE);

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "code-1" }, adminPrincipalId, {
      llm,
      github,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    const summary = result.scopeRuns.find((run) => run.scopePath === "alpha")?.codeDocs;
    expect(summary?.status).toBe("bootstrapped");
    expect(summary?.pagesTouched).toBe(4);
    expect(summary?.lastCommit).toBe("commit-1");
    expect(JSON.parse(llm.codeDocsCalls()[0]!.prompt).outputFormatMandatory).toContain("Return only one JSON object");

    for (const slug of ["code-architecture", "code-stack", "code-integrations", "code-ops"]) {
      const doc = await getDoc(db, { scopePath: "alpha", slug }, adminPrincipalId);
      expect(doc, slug).toBeTruthy();
      expect(doc!.bodyMd).toContain('repo: "alpha-repo"');
      expect(doc!.bodyMd).toContain('last_commit: "commit-1"');
      expect(doc!.bodyMd).toContain("learned_at:");
      expect(doc!.bodyMd).toMatch(/## Sources/);
      expect(doc!.bodyMd).toContain("commit:commit-1");
    }
    const index = await getDoc(db, { scopePath: "alpha", slug: "wiki" }, adminPrincipalId);
    expect(index?.bodyMd).toContain("[[code-architecture]]");
    expect(index?.bodyMd).toContain("[[code-ops]]");
    // lockfiles and non-authoritative source are never read
    expect(github.getFileCalls).not.toContain("src/lib/util.ts");
  });

  it("delta push updates only affected pages and advances last_commit", async () => {
    const scope = await createProjectWithWorkbench("beta", "beta-repo");
    await insertPushEvent(scope.id, "commit-1", ["README.md"]);
    const github = new FixtureRepo(BOOTSTRAP_TREE);
    await runBrainEngine(db, { mode: "ingest", runRef: "code-boot" }, adminPrincipalId, { llm, github });

    const archBefore = (await getDoc(db, { scopePath: "beta", slug: "code-architecture" }, adminPrincipalId))!.bodyMd;
    const stackBefore = (await getDoc(db, { scopePath: "beta", slug: "code-stack" }, adminPrincipalId))!.bodyMd;

    await insertPushEvent(scope.id, "commit-2", [".github/workflows/deploy.yml"]);
    const result = await runBrainEngine(db, { mode: "ingest", runRef: "code-delta" }, adminPrincipalId, { llm, github });

    const summary = result.scopeRuns.find((run) => run.scopePath === "beta")?.codeDocs;
    expect(summary?.status).toBe("updated");
    expect(summary?.lastCommit).toBe("commit-2");

    const ops = await getDoc(db, { scopePath: "beta", slug: "code-ops" }, adminPrincipalId);
    expect(ops?.bodyMd).toContain('last_commit: "commit-2"');
    expect((await getDoc(db, { scopePath: "beta", slug: "code-architecture" }, adminPrincipalId))!.bodyMd).toBe(archBefore);
    expect((await getDoc(db, { scopePath: "beta", slug: "code-stack" }, adminPrincipalId))!.bodyMd).toBe(stackBefore);
    // delta pass never lists the tree
    expect(github.listFilesCalls).toBe(1);
  });

  it("no new push events after bootstrap is a cheap no-op", async () => {
    const scope = await createProjectWithWorkbench("gamma", "gamma-repo");
    await insertPushEvent(scope.id, "commit-1", ["README.md"]);
    const github = new FixtureRepo(BOOTSTRAP_TREE);
    await runBrainEngine(db, { mode: "ingest", runRef: "noop-boot" }, adminPrincipalId, { llm, github });
    const callsAfterBootstrap = llm.codeDocsCalls().length;
    const getFileCallsAfterBootstrap = github.getFileCalls.length;

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "noop-2" }, adminPrincipalId, { llm, github });

    expect(result.scopeRuns.find((run) => run.scopePath === "gamma")?.codeDocs?.status).toBe("no-op");
    expect(llm.codeDocsCalls().length).toBe(callsAfterBootstrap);
    expect(github.getFileCalls.length).toBe(getFileCallsAfterBootstrap);
  });

  it("oversized repo yields shallow capped reads and a reported truncation, not a failure", async () => {
    const scope = await createProjectWithWorkbench("delta", "delta-repo");
    await insertPushEvent(scope.id, "commit-1", ["README.md"]);
    const bigTree = [
      ...BOOTSTRAP_TREE,
      ...Array.from({ length: 30 }, (_, i) => ({ path: `packages/mod${i}/package.json`, sha: `sha-${i}` })),
    ];
    const github = new FixtureRepo(bigTree);

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "big" }, adminPrincipalId, { llm, github });

    const summary = result.scopeRuns.find((run) => run.scopePath === "delta")?.codeDocs;
    expect(summary?.status).toBe("bootstrapped");
    expect(summary?.truncated).toBe(true);
    expect(github.getFileCalls.length).toBeLessThanOrEqual(10);
    await expect(getDoc(db, { scopePath: "delta", slug: "code-stack" }, adminPrincipalId)).resolves.toBeTruthy();
  });

  it("per-scope opt-out suppresses the pass entirely", async () => {
    const scope = await createProjectWithWorkbench("epsilon", "epsilon-repo");
    await insertPushEvent(scope.id, "commit-1", ["README.md"]);
    await db.update(schema.scopes).set({ settings: { brain: { codeDocs: false } } }).where(eq(schema.scopes.id, scope.id));
    const github = new FixtureRepo(BOOTSTRAP_TREE);

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "optout" }, adminPrincipalId, { llm, github });

    expect(result.scopeRuns.find((run) => run.scopePath === "epsilon")?.codeDocs?.status).toBe("opt-out");
    expect(github.listFilesCalls).toBe(0);
    expect(github.getFileCalls.length).toBe(0);
    await expect(getDoc(db, { scopePath: "epsilon", slug: "code-architecture" }, adminPrincipalId)).resolves.toBeNull();
  });

  it("missing github config reports no-github instead of failing", async () => {
    const scope = await createProjectWithWorkbench("zeta", "zeta-repo");
    await insertPushEvent(scope.id, "commit-1", ["README.md"]);

    const result = await runBrainEngine(db, { mode: "ingest", runRef: "nogh" }, adminPrincipalId, { llm });

    expect(result.status).toBe("success");
    expect(result.scopeRuns.find((run) => run.scopePath === "zeta")?.codeDocs?.status).toBe("no-github");
  });

  it("root pattern distillation over code pages leaks no scope or repo names", async () => {
    const alpha = await createProjectWithWorkbench("alpha", "alpha-repo", "AlphaCorp");
    await insertPushEvent(alpha.id, "commit-1", ["README.md"]);
    await createRecord(db, { scopePath: "alpha", kind: "changelog", title: "Launch", bodyMd: "Launched." }, adminPrincipalId);
    const github = new FixtureRepo(BOOTSTRAP_TREE);

    await runBrainEngine(db, { mode: "ingest", runRef: "distill" }, adminPrincipalId, { llm, github });

    const pattern = await getDoc(db, { scopePath: "root", slug: "pattern-code-stack" }, adminPrincipalId);
    expect(pattern).toBeTruthy();
    expect(pattern!.bodyMd).not.toContain("AlphaCorp");
    expect(pattern!.bodyMd).not.toContain("alpha-repo");
  });

  it("classifies changed paths to the right pages", () => {
    expect(classifyChangedPath(".github/workflows/ci.yml")).toEqual(["code-ops"]);
    expect(classifyChangedPath("package.json")).toEqual(["code-stack"]);
    expect(classifyChangedPath("src/app/api/webhooks/github/route.ts")).toContain("code-integrations");
    expect(classifyChangedPath("src/components/Button.tsx")).toEqual(["code-architecture"]);
  });
});
