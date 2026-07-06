/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHmac } from "crypto";
import { eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;

import {
  completeSession,
  createRecord,
  createScope,
  getScope,
  grantRole,
  handleGitHubWebhook,
  listEvents,
  listRecords,
  registerSession,
  resolveWorkbenchScopes,
  verifyGitHubWebhookSignature,
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

function suffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function pushPayload(repoFullName: string, branch: string, paths: string[], commits = ["abc123"]) {
  return {
    ref: `refs/heads/${branch}`,
    before: "before123",
    after: commits[commits.length - 1],
    compare: `https://github.test/${repoFullName}/compare/before123...${commits[commits.length - 1]}`,
    repository: { full_name: repoFullName, default_branch: "main" },
    sender: { login: "octocat" },
    commits: commits.map((sha) => ({ id: sha, added: [], modified: paths, removed: [] })),
  };
}

function prPayload(
  repoFullName: string,
  paths: string[],
  options: Partial<{ action: string; merged: boolean; title: string; number: number; sha: string; headSha: string; baseSha: string }> = {}
) {
  const number = options.number ?? 42;
  const sha = options.sha ?? "mergeabc";
  return {
    action: options.action ?? "closed",
    number,
    changed_paths: paths,
    repository: { full_name: repoFullName, default_branch: "main" },
    sender: { login: "octocat" },
    pull_request: {
      number,
      title: options.title ?? "Ship tracked work",
      html_url: `https://github.test/${repoFullName}/pull/${number}`,
      merged: options.merged ?? true,
      merge_commit_sha: sha,
      head: { ref: "feature/tracked-work", sha: options.headSha ?? "headabc" },
      base: { ref: "main", sha: options.baseSha ?? "baseabc" },
      user: { login: "octocat" },
    },
  };
}

describe("workbench-events module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;
  let agentPrincipalId: string;

  beforeAll(async () => {
    client = new PGlite();
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

  async function principal(name: string, kind: "human" | "agent" = "human") {
    const [row] = await db
      .insert(schema.principals)
      .values({ kind, name: `${name} ${suffix()}`, status: "active" })
      .returning();
    return row.id as string;
  }

  async function scopeTree() {
    const top = `gh-${suffix()}`;
    const repo = `acme/${top}`;
    const website = `${top}/website`;
    const nested = `${website}/seo`;
    const meta = `${top}/meta-ads`;
    await createScope(db, { slug: top, name: "GitHub Client", type: "project" }, rootPrincipalId);
    await createScope(db, { parentPath: top, slug: "website", name: "Website", type: "subproject" }, rootPrincipalId);
    await createScope(db, { parentPath: website, slug: "seo", name: "SEO", type: "subproject" }, rootPrincipalId);
    await createScope(db, { parentPath: top, slug: "meta-ads", name: "Meta Ads", type: "subproject" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: top, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath: top, role: "agent" }, rootPrincipalId);

    const rows = await db.select().from(schema.scopes).where(eq(schema.scopes.path, top));
    const [topScope] = rows;
    const [websiteScope] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, website));
    const [nestedScope] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, nested));
    const [metaScope] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, meta));
    await db.insert(schema.workbenches).values([
      { scopeId: topScope.id, repo, path: "" },
      { scopeId: websiteScope.id, repo, path: "website" },
      { scopeId: nestedScope.id, repo, path: "website/seo" },
      { scopeId: metaScope.id, repo, path: "meta-ads" },
    ]);
    return { top, website, nested, meta, repo };
  }

  beforeEach(async () => {
    rootPrincipalId = await principal("Root Admin");
    agentPrincipalId = await principal("Agent", "agent");
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);
  });

  it("verifies GitHub HMAC signatures", () => {
    const secret = "webhook-secret";
    const raw = JSON.stringify({ ok: true });
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyGitHubWebhookSignature(raw, signature, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(raw, "sha256=bad", secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(raw, null, secret)).toBe(false);
  });

  it("maps repo and changed paths to deepest workbench scopes", async () => {
    const scopes = await scopeTree();
    const groups = await resolveWorkbenchScopes(db, {
      repoFullName: scopes.repo,
      changedPaths: ["README.md", "website/app/page.tsx", "website/seo/meta.ts", "meta-ads/campaign.json"],
    });

    expect(groups.map((group) => group.scopePath)).toEqual(expect.arrayContaining([
      scopes.top,
      scopes.website,
      scopes.nested,
      scopes.meta,
    ]));
    expect(groups.find((group) => group.scopePath === scopes.nested)?.changedPaths).toEqual(["website/seo/meta.ts"]);
  });

  it("groups one push across multiple scopes without sibling leakage", async () => {
    const scopes = await scopeTree();
    const result = await handleGitHubWebhook(db, {
      event: "push",
      deliveryId: `delivery-${suffix()}`,
      payload: pushPayload(scopes.repo, "feature/site", [
        "website/app/page.tsx",
        "meta-ads/campaign.json",
      ]),
    });

    expect(result.groups?.map((group) => group.scopePath)).toEqual(expect.arrayContaining([scopes.website, scopes.meta]));
    const websiteEvents = await listEvents(db, { scopePath: scopes.website, type: "workbench.push", limit: 10 });
    const metaEvents = await listEvents(db, { scopePath: scopes.meta, type: "workbench.push", limit: 10 });
    expect(websiteEvents[0]?.payload.changedPathSamples).toEqual(["website/app/page.tsx"]);
    expect(metaEvents[0]?.payload.changedPathSamples).toEqual(["meta-ads/campaign.json"]);
  });

  it("uses delivery id idempotency for events and records", async () => {
    const scopes = await scopeTree();
    const deliveryId = `delivery-${suffix()}`;
    const payload = prPayload(scopes.repo, ["website/app/page.tsx"], { number: 77, sha: "merge777" });

    await handleGitHubWebhook(db, { event: "pull_request", deliveryId, payload });
    const duplicate = await handleGitHubWebhook(db, { event: "pull_request", deliveryId, payload });

    expect(duplicate.duplicate).toBe(true);
    const events = await listEvents(db, { scopePath: scopes.website, type: "workbench.pr_merged", limit: 10 });
    const records = await listRecords(db, { scopePath: scopes.website, kind: "changelog", limit: 10 }, rootPrincipalId);
    expect(events.filter((event: any) => event.payload.deliveryId === deliveryId)).toHaveLength(1);
    expect(records.filter((record: any) => record.data?.deliveryId === deliveryId)).toHaveLength(1);
  });

  it("creates separate stubs for separate merged PRs in the same scope", async () => {
    const scopes = await scopeTree();

    await handleGitHubWebhook(db, {
      event: "pull_request",
      deliveryId: `delivery-${suffix()}`,
      payload: prPayload(scopes.repo, ["website/app/page.tsx"], { title: "First merge", number: 301, sha: "merge301", headSha: "head301" }),
    });
    await handleGitHubWebhook(db, {
      event: "pull_request",
      deliveryId: `delivery-${suffix()}`,
      payload: prPayload(scopes.repo, ["website/app/page.tsx"], { title: "Second merge", number: 302, sha: "merge302", headSha: "head302" }),
    });

    const records = await listRecords(db, { scopePath: scopes.website, kind: "changelog", limit: 10 }, rootPrincipalId);
    const githubRecords = records.filter((record: any) => record.data?.source === "github");
    expect(githubRecords.map((record) => record.title)).toEqual(expect.arrayContaining([
      "GitHub merge: First merge",
      "GitHub merge: Second merge",
    ]));
    expect(githubRecords).toHaveLength(2);
  });

  it("creates one stub when a PR merge and push-to-main share a merge commit in either order", async () => {
    for (const order of ["pr-first", "push-first"] as const) {
      const scopes = await scopeTree();
      const mergeSha = `merge-${order}-${suffix()}`;
      const pr = {
        event: "pull_request",
        deliveryId: `delivery-pr-${suffix()}`,
        payload: prPayload(scopes.repo, ["website/app/page.tsx"], { title: `Merge ${order}`, number: 401, sha: mergeSha }),
      };
      const push = {
        event: "push",
        deliveryId: `delivery-push-${suffix()}`,
        payload: pushPayload(scopes.repo, "main", ["website/app/page.tsx"], [mergeSha]),
      };

      const deliveries = order === "pr-first" ? [pr, push] : [push, pr];
      for (const delivery of deliveries) {
        await handleGitHubWebhook(db, delivery);
      }

      const records = await listRecords(db, { scopePath: scopes.website, kind: "changelog", limit: 10 }, rootPrincipalId);
      expect(records.filter((record: any) => record.data?.source === "github")).toHaveLength(1);
    }
  });

  it("creates a GitHub changelog stub for a PR merge without agent wrap-up and rolls up to ancestors", async () => {
    const scopes = await scopeTree();
    const deliveryId = `delivery-${suffix()}`;
    const result = await handleGitHubWebhook(db, {
      event: "pull_request",
      deliveryId,
      payload: prPayload(scopes.repo, ["website/seo/meta.ts"], { title: "Improve SEO metadata", number: 88, sha: "merge888" }),
    });

    expect(result.groups?.[0]?.recordId).toBeTruthy();
    const exact = await listRecords(db, { scopePath: scopes.nested, kind: "changelog", limit: 10 }, rootPrincipalId);
    expect(exact[0]?.title).toBe("GitHub merge: Improve SEO metadata");
    expect(exact[0]?.bodyMd).toContain("Needs human/agent summary");
    expect(exact[0]?.bodyMd).toContain(`https://github.test/${scopes.repo}/pull/88`);
    expect(exact[0]?.data).toMatchObject({ source: "github", deliveryId, prNumber: 88 });

    const clientRollup = await listRecords(db, { scopePath: scopes.top, includeDescendants: true, kind: "changelog", limit: 10 }, rootPrincipalId);
    const rootRollup = await listRecords(db, { scopePath: "root", includeDescendants: true, kind: "changelog", limit: 10 }, rootPrincipalId);
    expect(clientRollup.some((record) => record.id === exact[0]?.id && record.scopePath === scopes.nested)).toBe(true);
    expect(rootRollup.some((record) => record.id === exact[0]?.id && record.scopePath === scopes.nested)).toBe(true);
  });

  it("does not create a duplicate stub when a recent changelog references the PR", async () => {
    const scopes = await scopeTree();
    await createRecord(
      db,
      {
        scopePath: scopes.website,
        kind: "changelog",
        title: "Agent wrap-up",
        bodyMd: `Merged https://github.test/${scopes.repo}/pull/101 with summary.`,
      },
      agentPrincipalId
    );

    const result = await handleGitHubWebhook(db, {
      event: "pull_request",
      deliveryId: `delivery-${suffix()}`,
      payload: prPayload(scopes.repo, ["website/app/page.tsx"], { number: 101, sha: "merge101" }),
    });

    expect(result.groups?.[0]?.recordId).toBeNull();
    const records = await listRecords(db, { scopePath: scopes.website, kind: "changelog", limit: 10 }, rootPrincipalId);
    expect(records.filter((record: any) => record.data?.source === "github")).toHaveLength(0);
  });

  it("does not create a duplicate stub when a recent completed session references the PR", async () => {
    const scopes = await scopeTree();
    const session = await registerSession(db, {
      scopePath: scopes.website,
      title: "Feature work",
      engine: "codex",
      worktreeRef: "feature/tracked-work",
    }, agentPrincipalId);
    await completeSession(db, {
      sessionId: session.id,
      summary: `Wrapped up https://github.test/${scopes.repo}/pull/202`,
    }, agentPrincipalId);

    const result = await handleGitHubWebhook(db, {
      event: "pull_request",
      deliveryId: `delivery-${suffix()}`,
      payload: prPayload(scopes.repo, ["website/app/page.tsx"], { number: 202, sha: "merge202" }),
    });

    expect(result.groups?.[0]?.recordId).toBeNull();
    const eventRows = await listEvents(db, { scopePath: scopes.website, type: "workbench.pr_merged", limit: 10 });
    expect(eventRows[0]?.payload.linkedSessionIds).toContain(session.id);
  });

  it("does not link unrelated recent sessions", async () => {
    const scopes = await scopeTree();
    await registerSession(db, {
      scopePath: scopes.website,
      title: "Unrelated work",
      engine: "codex",
      worktreeRef: "feature/other-work",
    }, agentPrincipalId);
    const deliveryId = `delivery-${suffix()}`;

    await handleGitHubWebhook(db, {
      event: "pull_request",
      deliveryId,
      payload: prPayload(scopes.repo, ["website/app/page.tsx"], { number: 303, sha: "merge303" }),
    });

    const eventRows = await listEvents(db, { scopePath: scopes.website, type: "workbench.pr_merged", limit: 10 });
    const event = eventRows.find((row: any) => row.payload?.deliveryId === deliveryId);
    expect(event?.payload.linkedSessionIds).toEqual([]);
  });
});
