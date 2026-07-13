/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { eq } from "drizzle-orm";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;

import {
  createScope,
  getScope,
  grantRole,
  provisionScope,
  GitHubClient,
  AccessDeniedError,
} from "../../index";
import { estimateManagedSection, MANAGED_END, MANAGED_START } from "./agents-md";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeMockGitHub(options: { orgMissing?: boolean; createForbidden?: boolean; putForbidden?: boolean } = {}) {
  const repos = new Map<string, { private: boolean; files: Map<string, { content: string; sha: string }> }>();
  let shaCounter = 0;
  let writeCount = 0;

  const fetch = async (input: string, init?: any): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method || "GET";
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (method === "GET" && segments[0] === "repos" && segments.length === 3) {
      const repo = repos.get(segments[2]!);
      return repo ? jsonResponse({ name: segments[2], private: repo.private }) : jsonResponse({ message: "not found" }, 404);
    }

    if (method === "POST" && segments[0] === "orgs" && segments[2] === "repos") {
      if (options.orgMissing) return jsonResponse({ message: "org not found" }, 404);
      if (options.createForbidden) return jsonResponse({ message: "Resource not accessible by personal access token" }, 403);
      const body = JSON.parse(init?.body || "{}");
      repos.set(body.name, { private: !!body.private, files: new Map() });
      return jsonResponse({ name: body.name, private: !!body.private }, 201);
    }

    if (segments[0] === "repos" && segments[3] === "contents") {
      const repo = repos.get(segments[2]!);
      if (!repo) return jsonResponse({ message: "not found" }, 404);
      const filePath = segments.slice(4).join("/");
      if (method === "GET") {
        const file = repo.files.get(filePath);
        if (!file) return jsonResponse({ message: "not found" }, 404);
        return jsonResponse({
          type: "file",
          sha: file.sha,
          encoding: "base64",
          content: Buffer.from(file.content, "utf8").toString("base64"),
        });
      }
      if (method === "PUT") {
        if (options.putForbidden) return jsonResponse({ message: "Resource not accessible by personal access token" }, 403);
        const body = JSON.parse(init?.body || "{}");
        const content = Buffer.from(body.content, "base64").toString("utf8");
        const sha = `sha_${++shaCounter}`;
        repo.files.set(filePath, { content, sha });
        writeCount += 1;
        return jsonResponse({ content: { sha } });
      }
    }

    return jsonResponse({ message: `unhandled ${method} ${url.pathname}` }, 500);
  };

  return {
    client: new GitHubClient({ token: "gh_test", org: "test-org", baseUrl: "https://api.github.test", fetch }),
    repos,
    get writeCount() {
      return writeCount;
    },
    resetWriteCount() {
      writeCount = 0;
    },
    setFile(repo: string, filePath: string, content: string) {
      const found = repos.get(repo);
      if (!found) throw new Error(`repo missing: ${repo}`);
      found.files.set(filePath, { content, sha: `sha_${++shaCounter}` });
    },
    getFile(repo: string, filePath: string): string | null {
      return repos.get(repo)?.files.get(filePath)?.content ?? null;
    },
  };
}

function makeMockPlane(options: { workspaces?: string[]; webhookUnavailable?: boolean } = {}) {
  const workspaces = new Set(options.workspaces || ["companyos"]);
  const webhooks: Record<string, any[]> = {};
  const calls: any[] = [];

  const bind = (workspace: string): any => ({
    get workspaceSlug() {
      return workspace;
    },
    get baseUrl() {
      return "https://plane.test";
    },
    forWorkspace: (slug: string) => bind(slug || workspace),
    getProjects: async () => {
      calls.push({ fn: "getProjects", workspace });
      if (!workspaces.has(workspace)) {
        throw new Error(`Plane API GET /projects/ failed: 404 workspace ${workspace}`);
      }
      return [];
    },
    listWebhooks: async () => {
      calls.push({ fn: "listWebhooks", workspace });
      if (options.webhookUnavailable) {
        throw new Error("Plane API GET /webhooks/ failed: 404 not found");
      }
      webhooks[workspace] = webhooks[workspace] || [];
      return webhooks[workspace]!.slice();
    },
    createWebhook: async (data: { url: string; secret: string }) => {
      calls.push({ fn: "createWebhook", workspace, data });
      webhooks[workspace] = webhooks[workspace] || [];
      const hook = { id: `hook_${webhooks[workspace]!.length + 1}`, url: data.url };
      webhooks[workspace]!.push(hook);
      return hook;
    },
    _calls: calls,
    _webhooks: webhooks,
  });

  return bind("companyos");
}

describe("provisioning module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    if (!await getScope(db, "root")) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, null);
    }
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") {
      await client.close();
    }
  });

  beforeEach(async () => {
    process.env.COMPANYOS_URL = "https://companyos.test";
    process.env.MCP_PUBLIC_URL = "https://mcp.companyos.test/mcp";
    process.env.COMPANYOS_TOKEN = "cos_env_secret_should_not_render";
    process.env.PLANE_WEBHOOK_URL = "https://companyos.test/api/v1/webhooks/plane";
    process.env.PLANE_WEBHOOK_SECRET = "whsec_test";

    const [principal] = await db
      .insert(schema.principals)
      .values({ kind: "human", name: `Root Admin ${Date.now()}`, status: "active" })
      .returning();
    rootPrincipalId = principal.id;
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);
  });

  async function countRows(table: any, where?: any): Promise<number> {
    const q = db.select().from(table);
    const rows = where ? await q.where(where) : await q;
    return rows.length;
  }

  it("fresh provision creates scopes, modules, agent, Plane workspace, webhook, repo, workbenches, and AGENTS files; second run is a no-op", async () => {
    const slug = `prov-fresh-${Date.now()}`;
    const plane = makeMockPlane({ workspaces: ["companyos", `${slug}-ws`] });
    const github = makeMockGitHub();
    const spec = {
      scopePath: slug,
      name: "Provision Fresh",
      subprojects: [
        { slug: "seo", name: "SEO" },
        { slug: "content", name: "Content" },
      ],
      modules: ["tasks", "records"],
      agent: { name: `${slug} Agent`, tokenName: "Workbench token" },
      planeWorkspaceSlug: `${slug}-ws`,
      workbench: {},
    };

    const first = await provisionScope(db, { plane, github: github.client }, spec, rootPrincipalId);
    expect(first.manual).toEqual([]);
    expect(first.agentToken?.plaintext).toMatch(/^cos_/);
    expect(first.agentToken?.storeNow).toBe(true);
    expect(first.steps.some((s) => s.status === "created")).toBe(true);

    const rootAgents = github.getFile(slug, "AGENTS.md") || "";
    const seoAgents = github.getFile(slug, "seo/AGENTS.md") || "";
    expect(rootAgents).toContain(MANAGED_START);
    expect(rootAgents).toContain("`seo/` ->");
    expect(seoAgents).toContain(`Scope path: \`${slug}/seo\``);
    expect(seoAgents).toContain(MANAGED_END);

    github.resetWriteCount();
    const second = await provisionScope(db, { plane, github: github.client }, spec, rootPrincipalId);
    expect(second.manual).toEqual([]);
    expect(second.agentToken).toBeUndefined();
    expect(second.steps.every((s) => s.status === "existing" || s.status === "skipped")).toBe(true);
    expect(github.writeCount).toBe(0);

    const [target] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, slug)).limit(1);
    const moduleCount = await countRows(schema.moduleInstances, eq(schema.moduleInstances.scopeId, target.id));
    expect(moduleCount).toBe(2);

    const [agent] = await db.select().from(schema.principals).where(eq(schema.principals.name, `${slug} Agent`)).limit(1);
    expect(await countRows(schema.tokens, eq(schema.tokens.principalId, agent.id))).toBe(1);
    expect(await countRows(schema.grants, eq(schema.grants.principalId, agent.id))).toBe(1);
  });

  it("fresh provision renders the enriched AGENTS.md playbook without token values", async () => {
    const slug = `prov-agents-playbook-${Date.now()}`;
    const github = makeMockGitHub();
    const spec = {
      scopePath: slug,
      subprojects: [{ slug: "seo", name: "SEO" }],
      agent: { name: `${slug} Agent`, tokenName: "Workbench token" },
      workbench: {},
    };
    const memoryPrecedence = `## Memory precedence
- CompanyOS (get_context, list_records, tasks, docs) = authoritative for all
  client/scope facts.
- CompanyOS recall_memory = distilled scope memory and company-wide patterns to check
  before external research or broad record trawling.
- Vendor memory (Claude/OpenAI) = personal preferences only.
- On conflict: follow CompanyOS; log_decision if the OS record should be updated.
- Never assume vendor memory knows the current scope — always call get_context at
  session start.`;

    const result = await provisionScope(db, { plane: makeMockPlane(), github: github.client }, spec, rootPrincipalId);
    const rootAgents = github.getFile(slug, "AGENTS.md") || "";

    expect(rootAgents).toContain("- MCP_PUBLIC_URL: `https://mcp.companyos.test/mcp`");
    expect(rootAgents).toContain("### MCP Connection");
    expect(rootAgents).toContain("- Token env var: `COMPANYOS_TOKEN` (if missing or expired, mint at Connect to MCP on this scope's page in the OS)");
    expect(rootAgents).toContain("### Session Start Checklist");
    expect(rootAgents).toContain("Call `whoami`.");
    expect(rootAgents).toContain(`Call \`get_context("${slug}")\`.`);
    expect(rootAgents).toContain("Call `recall_memory` before external research or broad record trawling.");
    expect(rootAgents).toContain("Use `list_credentials` / `get_credential` only when work needs vault values; never store or log retrieved values.");
    expect(rootAgents).toContain("If MCP is unreachable or auth fails: STOP and tell the user - never proceed on assumed OS state.");
    expect(rootAgents).toContain("### Session End / Handover");
    expect(rootAgents).toContain("Use `log_change` incrementally during work; include PR URLs, PR numbers, and commit SHAs when available.");
    expect(rootAgents).toContain("Call `complete_session` on wrap-up for any session registered at start; include PR URLs, PR numbers, and commit SHAs when available.");
    expect(rootAgents).toContain("call `complete_task` and `log_decision` where applicable.");
    expect(rootAgents).toContain("update the affected wiki topic page via `save_doc` (see docs/patterns/WIKI.md - update in place, cite record ids).");
    expect(rootAgents).toContain("Durable state lives in the OS, not the chat transcript.");
    expect(rootAgents).toContain("### Git Worktree Convention");
    expect(rootAgents).toContain("named `<scope-slug>/<session-slug>`");
    expect(rootAgents).toContain("Merge via PR to main.");
    expect(rootAgents).toContain("### Folder Guard");
    expect(rootAgents).toContain("Your cwd must be under `<workbench.path>`; if it isn't, stop and ask the user.");
    expect(rootAgents).toContain("Call `verify_workbench` (if available) after `get_context` when doing file work.");
    expect(rootAgents).toContain(memoryPrecedence);
    expect(rootAgents).toContain("CompanyOS recall_memory = distilled scope memory and company-wide patterns");
    expect(rootAgents).not.toContain("CompanyOS MCP endpoint:");
    expect(rootAgents).not.toContain(result.agentToken!.plaintext);
    expect(rootAgents).not.toContain(process.env.COMPANYOS_TOKEN!);
  });

  it("reports managed AGENTS.md byte and token estimates without secret values", async () => {
    const scope = {
      id: "00000000-0000-0000-0000-000000000001",
      parentId: null,
      slug: "estimate",
      path: "estimate",
      name: "Estimate",
      type: "project",
      status: "active",
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
    const child = { ...scope, id: "00000000-0000-0000-0000-000000000002", slug: "seo", path: "estimate/seo", name: "SEO", parentId: scope.id };
    const measured = estimateManagedSection({
      scope,
      children: [child],
      companyosUrl: "https://companyos.test",
      mcpPublicUrl: "https://companyos.test/api/mcp",
      tokenEnvVar: "COMPANYOS_TOKEN",
    });

    expect(measured.markdown).toContain(MANAGED_START);
    expect(measured.bytes).toBeGreaterThan(100);
    expect(measured.tokensEst).toBeGreaterThan(20);
    expect(JSON.stringify(measured)).not.toContain(process.env.COMPANYOS_TOKEN!);
  });

  it("AGENTS.md regeneration preserves human content outside managed markers", async () => {
    const slug = `prov-human-${Date.now()}`;
    const plane = makeMockPlane();
    const github = makeMockGitHub();
    await provisionScope(db, { plane, github: github.client }, {
      scopePath: slug,
      workbench: {},
    }, rootPrincipalId);

    const humanContent = `# Local Notes\n\nKeep this intro.\n\n${MANAGED_START}\nold\n${MANAGED_END}\n\nKeep this footer.\n`;
    github.setFile(slug, "AGENTS.md", humanContent);

    await provisionScope(db, { plane, github: github.client }, {
      scopePath: slug,
      workbench: {},
    }, rootPrincipalId);
    const updated = github.getFile(slug, "AGENTS.md") || "";
    expect(updated.startsWith("# Local Notes\n\nKeep this intro.\n\n")).toBe(true);
    expect(updated.endsWith("\n\nKeep this footer.\n")).toBe(true);
    expect(updated).toContain(`Scope path: \`${slug}\``);
    expect(updated).not.toContain("\nold\n");
  });

  it("nested add-on under existing project creates only the missing chain and requires project admin, not root admin", async () => {
    const top = `indya-nested-${Date.now()}`;
    await createScope(db, { slug: top, name: "Indya", type: "project" }, rootPrincipalId);

    const [projectAdmin] = await db
      .insert(schema.principals)
      .values({ kind: "human", name: `Project Admin ${Date.now()}`, status: "active" })
      .returning();
    await grantRole(db, { principalId: projectAdmin.id, scopePath: top, role: "admin" }, rootPrincipalId);

    const result = await provisionScope(db, { plane: makeMockPlane(), github: null }, {
      scopePath: `${top}/marketing/seo`,
      name: "SEO",
      modules: ["tasks"],
    }, projectAdmin.id);

    expect(result.steps.find((s) => s.key === `scope:${top}`)?.status).toBe("existing");
    expect(result.steps.find((s) => s.key === `scope:${top}/marketing`)?.status).toBe("created");
    expect(result.steps.find((s) => s.key === `scope:${top}/marketing/seo`)?.status).toBe("created");
    expect(await getScope(db, `${top}/marketing/seo`)).toBeTruthy();
  });

  it("rejects non-admin actors and rejects planeWorkspaceSlug on nested targets before mutation", async () => {
    const top = `prov-reject-${Date.now()}`;
    await createScope(db, { slug: top, name: "Reject", type: "project" }, rootPrincipalId);

    const [viewer] = await db
      .insert(schema.principals)
      .values({ kind: "human", name: `Viewer ${Date.now()}`, status: "active" })
      .returning();
    await grantRole(db, { principalId: viewer.id, scopePath: top, role: "viewer" }, rootPrincipalId);

    await expect(provisionScope(db, { plane: makeMockPlane(), github: null }, {
      scopePath: `${top}/seo`,
    }, viewer.id)).rejects.toThrow(AccessDeniedError);

    await expect(provisionScope(db, { plane: makeMockPlane({ workspaces: ["companyos", "nested-ws"] }), github: null }, {
      scopePath: `${top}/nested-will-not-exist`,
      planeWorkspaceSlug: "nested-ws",
    }, rootPrincipalId)).rejects.toThrow(/top-level project/);
    expect(await getScope(db, `${top}/nested-will-not-exist`)).toBeNull();
  });

  it("reports manual steps for missing GitHub org, GitHub permission failures, unavailable webhook API, and null GitHub dependency", async () => {
    const orgMissing = `prov-org-${Date.now()}`;
    const orgResult = await provisionScope(db, {
      plane: makeMockPlane(),
      github: makeMockGitHub({ orgMissing: true }).client,
    }, {
      scopePath: orgMissing,
      workbench: {},
    }, rootPrincipalId);
    expect(orgResult.manual.join("\n")).toMatch(/create GitHub org test-org manually/);

    const forbidden = `prov-gh-403-${Date.now()}`;
    const forbiddenResult = await provisionScope(db, {
      plane: makeMockPlane(),
      github: makeMockGitHub({ createForbidden: true }).client,
    }, {
      scopePath: forbidden,
      modules: ["docs"],
      workbench: {},
    }, rootPrincipalId);
    expect(forbiddenResult.scopePath).toBe(forbidden);
    expect(forbiddenResult.steps.find((step) => step.key === "module:docs")?.status).toBe("created");
    expect(forbiddenResult.steps.find((step) => step.key === "github.repo")).toMatchObject({
      status: "manual",
      message: "GitHub token cannot create repos in test-org (403). Grant the token Administration: read/write + All repositories, then re-run setup.",
    });

    const syncForbidden = `prov-gh-file-403-${Date.now()}`;
    const syncGithub = makeMockGitHub({ putForbidden: true });
    const syncResult = await provisionScope(db, {
      plane: makeMockPlane(),
      github: syncGithub.client,
    }, {
      scopePath: syncForbidden,
      workbench: {},
    }, rootPrincipalId);
    expect(syncResult.steps.find((step) => step.key === `workbench:${syncForbidden}`)?.status).toBe("created");
    expect(syncResult.steps.find((step) => step.key === "github.file:AGENTS.md")).toMatchObject({ status: "manual" });

    const webhookMissing = `prov-hook-${Date.now()}`;
    const webhookResult = await provisionScope(db, {
      plane: makeMockPlane({ workspaces: ["companyos", "hook-ws"], webhookUnavailable: true }),
      github: null,
    }, {
      scopePath: webhookMissing,
      planeWorkspaceSlug: "hook-ws",
    }, rootPrincipalId);
    expect(webhookResult.manual.join("\n")).toMatch(/register webhook .*Plane workspace settings/);

    const noGithub = `prov-nogithub-${Date.now()}`;
    const noGithubResult = await provisionScope(db, { plane: makeMockPlane(), github: null }, {
      scopePath: noGithub,
      workbench: {},
    }, rootPrincipalId);
    expect(noGithubResult.manual.join("\n")).toMatch(/configure GITHUB_TOKEN and GITHUB_ORG/);
  });

  it("skips the workbench cleanly when no workbench is requested", async () => {
    const slug = `prov-no-workbench-${Date.now()}`;
    const result = await provisionScope(db, { plane: makeMockPlane(), github: null }, {
      scopePath: slug,
      modules: ["docs"],
    }, rootPrincipalId);

    expect(result.steps.find((step) => step.key === "workbench")).toMatchObject({
      status: "skipped",
      message: "No workbench requested",
    });
    const [scope] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, slug)).limit(1);
    expect(await countRows(schema.workbenches, eq(schema.workbenches.scopeId, scope.id))).toBe(0);
  });
  it("creates workbench rows with repo root for projects and nested paths for subprojects", async () => {
    const slug = `prov-paths-${Date.now()}`;
    const github = makeMockGitHub();
    await provisionScope(db, { plane: makeMockPlane(), github: github.client }, {
      scopePath: slug,
      subprojects: [{ slug: "seo", name: "SEO" }],
      workbench: { repo: `${slug}-repo` },
    }, rootPrincipalId);

    const [project] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, slug)).limit(1);
    const [sub] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, `${slug}/seo`)).limit(1);
    const [projectWorkbench] = await db.select().from(schema.workbenches).where(eq(schema.workbenches.scopeId, project.id)).limit(1);
    const [subWorkbench] = await db.select().from(schema.workbenches).where(eq(schema.workbenches.scopeId, sub.id)).limit(1);

    expect(projectWorkbench.repo).toBe(`${slug}-repo`);
    expect(projectWorkbench.path).toBe("");
    expect(subWorkbench.repo).toBe(`${slug}-repo`);
    expect(subWorkbench.path).toBe("seo");
    expect(github.getFile(`${slug}-repo`, "seo/AGENTS.md")).toContain(`${slug}/seo`);
  });
});
