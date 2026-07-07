/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  acceptReusePattern,
  approveIntakePacket,
  assembleIntakeExternalPack,
  createScope,
  dismissIntakePacket,
  ensureDraftIntakeForScope,
  findReusePatterns,
  grantRole,
  listEvents,
  listIntakePackets,
  provisionFromIntakePacket,
  reopenIntakePacket,
  saveDoc,
  saveWizardTemplate,
  submitIntakePacket,
  updateIntakePacket,
} from "../../index";
import { AccessDeniedError } from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = "C:/dev/companyos/packages/db/drizzle";
}

function planeMock() {
  return {
    baseUrl: "https://plane.test",
    workspaceSlug: "companyos",
    forWorkspace: vi.fn().mockReturnThis(),
    getProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: "plane-project" }),
    listLabels: vi.fn().mockResolvedValue([]),
    createLabel: vi.fn().mockResolvedValue({ id: "plane-label" }),
    listWebhooks: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue({ id: "hook" }),
    createIssue: vi.fn().mockResolvedValue({ id: "issue-1", sequence_id: 1 }),
  } as any;
}

describe("intake creation wizard module", () => {
  let client: PGlite;
  let db: any;
  let admin: string;
  let editor: string;
  let agent: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    await createScope(db, { slug: "root", name: "Root", type: "root" }, null);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    const stamp = Date.now() + "-" + Math.random();
    admin = (await db.insert(schema.principals).values({ kind: "human", name: `Admin ${stamp}`, status: "active" }).returning())[0].id;
    editor = (await db.insert(schema.principals).values({ kind: "human", name: `Editor ${stamp}`, status: "active" }).returning())[0].id;
    agent = (await db.insert(schema.principals).values({ kind: "agent", name: `Agent ${stamp}`, status: "active" }).returning())[0].id;
    await grantRole(db, { principalId: admin, scopePath: "root", role: "admin" }, admin);
  });

  it("creates draft intakes, persists framing, skips/resumes/dismisses, and emits events", async () => {
    const slug = `intake-life-${Date.now()}`;
    await createScope(db, { slug, name: "Lifecycle", type: "project" }, admin);
    await grantRole(db, { principalId: editor, scopePath: slug, role: "editor" }, admin);

    const draft = await ensureDraftIntakeForScope(db, { scopePath: slug }, editor);
    expect(draft.status).toBe("draft");
    expect(draft.proposedProvisionSpec).toMatchObject({ scopePath: slug });

    const updated = await updateIntakePacket(db, { id: draft.id, answers: { plane: "yes", workbench: false } }, editor);
    expect(updated.answers).toEqual({ plane: "yes", workbench: false });

    const dismissed = await dismissIntakePacket(db, { id: draft.id }, admin);
    expect(dismissed.status).toBe("dismissed");
    const reopened = await reopenIntakePacket(db, { id: draft.id }, admin);
    expect(reopened.status).toBe("draft");

    const queue = await listIntakePackets(db, { scopePath: slug }, editor);
    expect(queue.map((row) => row.id)).toContain(draft.id);
    const events = await listEvents(db, { scopePath: slug, limit: 20 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["intake.updated", "intake.dismissed"]));
  });

  it("parses valid paste-back, reports malformed JSON precisely, accepts markdown-only, and enforces subtree submission", async () => {
    const slug = `intake-submit-${Date.now()}`;
    const other = `intake-submit-other-${Date.now()}`;
    await createScope(db, { slug, name: "Submit", type: "project" }, admin);
    await createScope(db, { slug: other, name: "Other", type: "project" }, admin);
    await grantRole(db, { principalId: agent, scopePath: slug, role: "agent" }, admin);

    const draft = await ensureDraftIntakeForScope(db, { scopePath: slug }, agent);
    await updateIntakePacket(db, { id: draft.id, status: "awaiting_external" }, agent);

    const malformed = await submitIntakePacket(db, { id: draft.id, pasteText: "```json\n{ nope\n```" }, agent);
    expect(malformed.errors?.[0]).toContain("json:");

    const valid = await submitIntakePacket(db, {
      id: draft.id,
      pasteText: [
        "Summary",
        "```json",
        JSON.stringify({
          packet_md: "Packet body",
          research_sources: [{ url: "https://example.test" }],
          proposed_provision_spec: { scopePath: slug, modules: ["docs"] },
          proposed_docs: [{ slug: "brief", title: "Brief", bodyMd: "# Brief" }],
          proposed_tasks: [],
          proposed_wiki_updates: [],
          open_questions: ["one"],
          risk_notes: [],
        }),
        "```",
      ].join("\n"),
    }, agent);
    expect(valid.errors).toBeUndefined();
    expect(valid.intake.status).toBe("needs_review");
    expect(valid.intake.packetMd).toBe("Packet body");

    const mdOnly = await submitIntakePacket(db, { scopePath: slug, pasteText: "Only markdown" }, agent);
    expect(mdOnly.markdownOnly).toBe(true);
    expect(mdOnly.intake.status).toBe("needs_review");

    await expect(
      submitIntakePacket(db, { scopePath: other, pasteText: "Denied" }, agent)
    ).rejects.toThrow(AccessDeniedError);
  });

  it("prefills from reusable pattern pages and withholds source attribution without viewer access", async () => {
    const source = `airbuddy-${Date.now()}`;
    const slug = `meta-ads-${Date.now()}`;
    await createScope(db, { slug: source, name: "Airbuddy", type: "project" }, admin);
    await createScope(db, { slug, name: "Meta Ads", type: "project" }, admin);
    await grantRole(db, { principalId: editor, scopePath: slug, role: "editor" }, admin);

    await saveDoc(db, {
      scopePath: "root",
      slug: "pattern-meta-ads",
      title: "Meta ads pattern",
      bodyMd: `Meta ads launch pattern.

<!-- companyos:source_scope_path:start -->
"${source}"
<!-- companyos:source_scope_path:end -->

<!-- companyos:provision_spec:start -->
{ "scopePath": "replace-me", "modules": ["docs"], "subprojects": [{ "slug": "creative", "name": "Creative" }] }
<!-- companyos:provision_spec:end -->

<!-- companyos:doc_seeds:start -->
[{ "slug": "brief", "title": "Brief", "bodyMd": "# Brief" }]
<!-- companyos:doc_seeds:end -->`,
    }, admin);

    const draft = await ensureDraftIntakeForScope(db, { scopePath: slug }, editor);
    const patterns = await findReusePatterns(db, { scopePath: slug, query: "meta ads airbuddy" }, editor);
    expect(patterns[0]).toMatchObject({ slug: "pattern-meta-ads", reusable: true, sourceVisible: false });

    await grantRole(db, { principalId: editor, scopePath: source, role: "viewer" }, admin);
    const visible = await findReusePatterns(db, { scopePath: slug, query: "meta ads airbuddy" }, editor);
    expect(visible[0]?.sourceVisible).toBe(true);

    const reused = await acceptReusePattern(db, { intakeId: draft.id, patternSlug: "pattern-meta-ads" }, editor);
    expect(reused.status).toBe("needs_review");
    expect(reused.proposedProvisionSpec).toMatchObject({ scopePath: slug, modules: ["docs"] });
    expect(reused.proposedDocs).toEqual([{ slug: "brief", title: "Brief", bodyMd: "# Brief" }]);
  });

  it("assembles external pack with parent context and provisions only after approval", async () => {
    const parent = `intake-parent-${Date.now()}`;
    await createScope(db, { slug: parent, name: "Parent", type: "project" }, admin);
    await createScope(db, { parentPath: parent, slug: "child", name: "Child", type: "subproject" }, admin);

    const scopePath = `${parent}/child`;
    const draft = await ensureDraftIntakeForScope(db, { scopePath }, admin);
    const pack = await assembleIntakeExternalPack(db, { intakeId: draft.id }, admin);
    expect(pack.pasteBack).toContain(`Intake id: ${draft.id}`);
    expect(pack.pasteBack).toContain("Parent Context");
    expect(pack.mcp).toContain("submit_intake_packet");

    await submitIntakePacket(db, {
      id: draft.id,
      packet: {
        packet_md: "Ready",
        research_sources: [],
        proposed_provision_spec: { scopePath, modules: ["docs"] },
        proposed_docs: [{ slug: "launch", title: "Launch", bodyMd: "# Launch" }],
        proposed_tasks: [],
        proposed_wiki_updates: [{ slug: "wiki", title: "WIKI", bodyMd: "# Wiki" }],
        open_questions: [],
        risk_notes: [],
      },
    }, admin);

    await expect(provisionFromIntakePacket(db, { plane: planeMock(), github: null }, { id: draft.id }, admin))
      .rejects.toThrow(/approved/);
    await approveIntakePacket(db, { id: draft.id }, admin);
    const provisioned = await provisionFromIntakePacket(db, { plane: planeMock(), github: null }, { id: draft.id }, admin);

    expect(provisioned.intake.status).toBe("provisioned");
    expect(provisioned.recordId).toBeTruthy();
    expect(provisioned.artifacts).toMatchObject({ docs: expect.any(Array), wiki: expect.any(Array) });
    const events = await listEvents(db, { scopePath, limit: 20 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "intake.submitted",
      "intake.approved",
      "provisioning.scope_provisioned",
      "record.created",
      "intake.provisioned",
    ]));
  });

  it("commits template edits through GitHubClient and triggers skills sync", async () => {
    const files = new Map<string, string>();
    files.set("scope-intake/SKILL.md", `---
name: scope-intake
description: Intake
scope_pattern: "**"
domains: [intake]
---
# Intake`);
    const clientMock = {
      putFile: vi.fn(async (_repo: string, pathName: string, content: string) => {
        files.set(pathName, content);
        return { written: true, sha: "sha-next" };
      }),
      listFiles: vi.fn(async () => Array.from(files.keys()).map((pathName) => ({ path: pathName, sha: "sha" }))),
      getFile: vi.fn(async (_repo: string, pathName: string) => ({ sha: "sha", contentUtf8: files.get(pathName) || "" })),
    } as any;

    const body = `---
slug: new-project
title: New project
kind: framing
applies_to: project
version: "1"
domains: [intake]
---

## Framing questions

- kind: What is it?`;
    const result = await saveWizardTemplate(db, clientMock, { repo: "skills", path: "scope-intake/templates/new-project.md", body }, admin);
    expect(result.written).toBe(true);
    expect(clientMock.putFile).toHaveBeenCalledWith("skills", "scope-intake/templates/new-project.md", body, expect.stringContaining("companyos"));
    expect(clientMock.listFiles).toHaveBeenCalled();
  });
});
