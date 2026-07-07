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
  AccessDeniedError,
  SkillNotFoundError,
  createScope,
  getSkill,
  grantRole,
  listEvents,
  listSkills,
  syncSkills,
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

class FakeGitHubClient {
  files = new Map<string, { body: string; sha: string }>();

  constructor(initial: Record<string, string>) {
    for (const [filePath, body] of Object.entries(initial)) {
      this.files.set(filePath, { body, sha: `sha-${filePath}-${body.length}` });
    }
  }

  async listFiles() {
    return Array.from(this.files.entries()).map(([filePath, file]) => ({
      path: filePath,
      sha: file.sha,
    }));
  }

  async getFile(_repo: string, filePath: string) {
    const file = this.files.get(filePath);
    return file ? { sha: file.sha, contentUtf8: file.body } : null;
  }
}

function skillBody(frontmatter: string, body = "Body"): string {
  return `---
${frontmatter}
---
# Skill

${body}
`;
}

function wizardTemplateBody(frontmatter: string, body = "## Framing questions\n\n- goal: What changed?"): string {
  return `---
${frontmatter}
---

${body}
`;
}

describe("skills module", () => {
  let client: PGlite;
  let db: any;
  let rootAdminId: string;
  let nonAdminId: string;
  let viewerId: string;
  let outsiderId: string;
  let scopePath: string;
  let subScopePath: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") {
      await client.close();
    }
  });

  beforeEach(async () => {
    await db.delete(schema.skillsIndex);

    const now = Date.now();
    const [rootAdmin] = await db.insert(schema.principals).values({ kind: "human", name: `Root Admin ${now}` }).returning();
    const [nonAdmin] = await db.insert(schema.principals).values({ kind: "human", name: `Non Admin ${now}` }).returning();
    const [viewer] = await db.insert(schema.principals).values({ kind: "human", name: `Viewer ${now}` }).returning();
    const [outsider] = await db.insert(schema.principals).values({ kind: "human", name: `Outsider ${now}` }).returning();
    rootAdminId = rootAdmin.id;
    nonAdminId = nonAdmin.id;
    viewerId = viewer.id;
    outsiderId = outsider.id;

    let [root] = await db.select().from(schema.scopes).where(eq(schema.scopes.path, "root")).limit(1);
    if (!root) {
      root = await createScope(db, { slug: "root", name: "Root", type: "root" }, rootAdminId);
    }
    await grantRole(db, { principalId: rootAdminId, scopePath: "root", role: "admin" }, rootAdminId);

    scopePath = `skills-${now}-${Math.floor(Math.random() * 10000)}`;
    await createScope(db, { slug: scopePath, name: "Skills", type: "project" }, rootAdminId);
    subScopePath = `${scopePath}/marketing`;
    await createScope(db, { parentPath: scopePath, slug: "marketing", name: "Marketing", type: "subproject" }, rootAdminId);
    await grantRole(db, { principalId: nonAdminId, scopePath, role: "viewer" }, rootAdminId);
    await grantRole(db, { principalId: viewerId, scopePath, role: "viewer" }, rootAdminId);
  });

  it("admin-gates sync on root", async () => {
    const github = new FakeGitHubClient({
      "general/SKILL.md": skillBody("name: general\nscope_pattern: **"),
    });

    await expect(syncSkills(db, github as any, { repo: "skills" }, nonAdminId)).rejects.toThrow(AccessDeniedError);
    const result = await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
  });

  it("upserts, removes stale rows, skips invalid files, is idempotent, and emits one event per sync", async () => {
    const github = new FakeGitHubClient({
      "global/SKILL.md": skillBody("name: global\nscope_pattern: **\ndescription: Global skill\ndomains: [ops, finance]", "v1"),
      "marketing/SKILL.md": skillBody("name: marketing-playbook\nscope_pattern: skills-*/marketing\ndomains:\n  - marketing", "marketing"),
      "bad/SKILL.md": skillBody("name: Bad Name", "invalid"),
      "README.md": "ignored",
    });

    const first = await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);
    expect(first).toMatchObject({ added: 2, updated: 0, removed: 0 });
    expect(first.skipped).toEqual([{ path: "bad/SKILL.md", reason: "missing or invalid name" }]);

    const rowsAfterFirst = await db.select().from(schema.skillsIndex);
    expect(rowsAfterFirst.length).toBe(2);

    const second = await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);
    expect(second).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(second.skipped.length).toBe(1);

    github.files.set("global/SKILL.md", {
      body: skillBody("name: global\nscope_pattern: **\ndescription: Changed\ndomains: [ops]", "v2"),
      sha: "sha-global-v2",
    });
    github.files.delete("marketing/SKILL.md");
    github.files.set("finance/SKILL.md", {
      body: skillBody("name: finance-playbook\nscope_pattern: **\ndomains: [finance]", "finance"),
      sha: "sha-finance",
    });

    const third = await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);
    expect(third).toMatchObject({ added: 1, updated: 1, removed: 1 });

    const names = (await db.select().from(schema.skillsIndex)).map((row: any) => row.name).sort();
    expect(names).toEqual(["finance-playbook", "global"]);

    const events = await listEvents(db, { scopePath: "root", type: "skills.synced", limit: 5 });
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect((events[0] as any).payload).toMatchObject({ repo: "skills", added: 1, updated: 1, removed: 1 });
  });

  it("indexes wizard template files and removes stale template rows", async () => {
    const github = new FakeGitHubClient({
      "scope-intake/SKILL.md": skillBody("name: scope-intake\nscope_pattern: **\ndomains: [intake]", "guide"),
      "scope-intake/templates/new-project.md": wizardTemplateBody(
        "slug: new-project\ntitle: Edited project framing\nkind: framing\napplies_to: project\nversion: \"2\"\ndomains: [onboarding]",
        "## Framing questions\n\n- edited: What should the edited template ask?"
      ),
      "scope-intake/templates/bad.md": wizardTemplateBody(
        "slug: Bad Template\ntitle: Bad\nkind: framing\napplies_to: project",
        "## Framing questions\n\n- bad: Bad?"
      ),
    });

    const first = await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);
    expect(first).toMatchObject({ added: 2, updated: 0, removed: 0 });
    expect(first.skipped).toEqual([{
      path: "scope-intake/templates/bad.md",
      reason: "invalid wizard template: frontmatter.slug must be kebab-case",
    }]);

    const template = await getSkill(db, { name: "scope-intake-template-new-project" }, rootAdminId);
    expect(template.path).toBe("scope-intake/templates/new-project.md");
    expect(template.description).toBe("Edited project framing");
    expect(template.domains).toEqual(["onboarding"]);
    expect(template.body).toContain("edited template");

    github.files.delete("scope-intake/templates/new-project.md");
    const second = await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);
    expect(second).toMatchObject({ added: 0, updated: 0, removed: 1 });
    await expect(getSkill(db, { name: "scope-intake-template-new-project" }, rootAdminId)).rejects.toThrow(SkillNotFoundError);
  });

  it("list_skills is viewer-gated, pattern matches, supports domain filter, and omits body", async () => {
    const github = new FakeGitHubClient({
      "global/SKILL.md": skillBody("name: global\nscope_pattern: **\ndescription: Global\ndomains: [ops]"),
      "branch/SKILL.md": skillBody(`name: branch\nscope_pattern: ${scopePath}\ndomains: [marketing]`),
      "exact/SKILL.md": skillBody(`name: exact\nscope_pattern: ${scopePath}/*\ndomains: [marketing]`),
      "other/SKILL.md": skillBody("name: other\nscope_pattern: other"),
    });
    await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);

    await expect(listSkills(db, { scope: scopePath }, outsiderId)).rejects.toThrow(AccessDeniedError);

    const rootLevel = await listSkills(db, { scope: scopePath }, viewerId);
    expect(rootLevel.map((skill) => skill.name)).toEqual(["branch", "global"]);
    expect(rootLevel.some((skill: any) => Object.prototype.hasOwnProperty.call(skill, "body"))).toBe(false);

    const subLevel = await listSkills(db, { scope: subScopePath }, viewerId);
    expect(subLevel.map((skill) => skill.name)).toEqual(["branch", "exact", "global"]);

    const marketing = await listSkills(db, { scope: subScopePath, domain: "marketing" }, viewerId);
    expect(marketing.map((skill) => skill.name)).toEqual(["branch", "exact"]);
  });

  it("get_skill returns body for any valid principal and throws SkillNotFoundError", async () => {
    const github = new FakeGitHubClient({
      "global/SKILL.md": skillBody("name: global\nscope_pattern: **", "Full body"),
    });
    await syncSkills(db, github as any, { repo: "skills" }, rootAdminId);

    const skill = await getSkill(db, { name: "global" }, outsiderId);
    expect(skill.body).toContain("Full body");

    await expect(getSkill(db, { name: "missing" }, outsiderId)).rejects.toThrow(SkillNotFoundError);
  });
});
