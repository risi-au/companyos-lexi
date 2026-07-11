/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
  acceptReusePattern,
  approveIntakePacket,
  assembleIntakeExternalPack,
  createRecord,
  createScope,
  ensurePersonalScope,
  dismissIntakePacket,
  ensureDraftIntakeForScope,
  findRelatedHistory,
  findReusePatterns,
  getDoc,
  getIntakePacket,
  grantRole,
  listEvents,
  listIntakePackets,
  listWizardFramingQuestions,
  provisionFromIntakePacket,
  reopenIntakePacket,
  saveDoc,
  saveWizardTemplate,
  setEmbeddingClientForTests,
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
    setEmbeddingClientForTests(null);
    await db.delete(schema.skillsIndex);
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

    const draft = await ensureDraftIntakeForScope(db, { scopePath: slug, reason: "Client converted from paid social lead" }, editor);
    expect(draft.status).toBe("draft");
    expect(draft.proposedProvisionSpec).toMatchObject({ scopePath: slug });
    expect(draft.answers).toMatchObject({ reason: "Client converted from paid social lead" });

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
          required_credentials: [{ name: "VPS SSH", whatFor: "Deploy", loginMethodNotes: "Owner grants; no value", password: "nope" }],
          external_systems: [{ name: "CRM", purpose: "Sales trail", notes: "Existing" }],
          open_questions: ["one"],
          risk_notes: [],
        }),
        "```",
      ].join("\n"),
    }, agent);
    expect(valid.errors).toBeUndefined();
    expect(valid.intake.status).toBe("needs_review");
    expect(valid.intake.packetMd).toBe("Packet body");
    expect(valid.intake.answers).toMatchObject({
      required_credentials: [{ name: "VPS SSH", whatFor: "Deploy", loginMethodNotes: "Owner grants; no value" }],
      external_systems: [{ name: "CRM", purpose: "Sales trail", notes: "Existing" }],
    });
    expect(JSON.stringify(valid.intake.answers)).not.toContain("nope");

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
    setEmbeddingClientForTests({
      async embed() {
        throw new Error("embedding down");
      },
    });
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
    await updateIntakePacket(db, {
      id: draft.id,
      relatedHistorySelections: [{
        type: "record",
        id: "record-source-1",
        title: "Original sales note",
        scopePath: parent,
        snippet: "Client asked for launch support.",
        kind: "note",
      }],
    }, admin);
    const pack = await assembleIntakeExternalPack(db, { intakeId: draft.id }, admin);
    expect(pack.pasteBack).toContain(`Intake id: ${draft.id}`);
    expect(pack.pasteBack).toContain("Structural Context");
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
        required_credentials: [{ name: "VPS SSH", whatFor: "Deploys", loginMethodNotes: "Rishi holds access" }],
        external_systems: [],
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
    expect(provisioned.artifacts).toMatchObject({
      docs: expect.any(Array),
      wiki: expect.any(Array),
      sourceRefsRecordId: expect.any(String),
      connectionDoc: expect.objectContaining({ slug: "connection" }),
      requiredCredentials: [{ name: "VPS SSH", whatFor: "Deploys", loginMethodNotes: "Rishi holds access" }],
    });
    const connectionDoc = await getDoc(db, { scopePath, slug: "connection" }, admin);
    expect(connectionDoc?.bodyMd).toContain("{{credential:VPS SSH}}");
    expect(connectionDoc?.bodyMd).toContain("Rishi holds access");
    const [sourceRefs] = await db.select().from(schema.records).where(eq(schema.records.id, provisioned.artifacts.sourceRefsRecordId as string)).limit(1);
    expect(sourceRefs.title).toBe("source-refs");
    expect(sourceRefs.bodyMd).toContain("Original sales note");
    const events = await listEvents(db, { scopePath, limit: 20 });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "intake.submitted",
      "intake.approved",
      "provisioning.scope_provisioned",
      "record.created",
      "intake.provisioned",
    ]));
  });


  it("skips empty intake seeds, adds wiki provenance, and creates project overview stub", async () => {
    const slug = `intake-seed-polish-${Date.now()}`;
    await createScope(db, { slug, name: "Seed Polish", type: "project" }, admin);
    const draft = await ensureDraftIntakeForScope(db, { scopePath: slug, reason: "Launch a polished project" }, admin);
    await submitIntakePacket(db, {
      id: draft.id,
      packet: {
        packet_md: "## Goal\n\nLaunch the project with a clean starting wiki.",
        research_sources: [],
        proposed_provision_spec: { scopePath: slug, modules: ["docs"] },
        proposed_docs: [
          { slug: "empty-doc", title: "Empty doc", bodyMd: "   \n" },
          { slug: "brief", title: "Brief", bodyMd: "# Brief\n\nReady." },
        ],
        proposed_tasks: [],
        proposed_wiki_updates: [
          { slug: "empty-wiki", title: "Empty wiki", bodyMd: "\t" },
          { slug: "starting-state", title: "Starting state", bodyMd: "# Starting state\n\nInitial fact." },
        ],
        required_credentials: [],
        external_systems: [],
        open_questions: [],
        risk_notes: [],
      },
    }, admin);
    await approveIntakePacket(db, { id: draft.id }, admin);
    await provisionFromIntakePacket(db, { plane: planeMock(), github: null }, { id: draft.id }, admin);

    expect(await getDoc(db, { scopePath: slug, slug: "empty-doc" }, admin)).toBeNull();
    expect(await getDoc(db, { scopePath: slug, slug: "empty-wiki" }, admin)).toBeNull();
    expect((await getDoc(db, { scopePath: slug, slug: "starting-state" }, admin))?.bodyMd).toContain("- extracted: intake packet (");
    const overview = await getDoc(db, { scopePath: slug, slug: "overview" }, admin);
    expect(overview?.title).toBe("Overview");
    expect(overview?.bodyMd).toContain("Launch the project with a clean starting wiki.");
    expect(overview?.bodyMd).toContain("## Sources");
  });
  it("finds selectable related history, stores selections, snapshots the pack, and uses root fallback for top-level scopes", async () => {
    const sales = `sales-${Date.now()}`;
    const client = `history-client-${Date.now()}`;
    await createScope(db, { slug: sales, name: "Sales", type: "project" }, admin);
    await createScope(db, { slug: client, name: "History Client", type: "project" }, admin);
    await grantRole(db, { principalId: editor, scopePath: sales, role: "viewer" }, admin);
    await grantRole(db, { principalId: editor, scopePath: client, role: "editor" }, admin);

    const leadRecord = await createRecord(db, {
      scopePath: sales,
      kind: "note",
      title: "History Client proposal",
      bodyMd: "Promised a Shopify launch and Meta ads tracking during the sales call.",
    }, admin);
    await saveDoc(db, { scopePath: "root", slug: "scope-map", title: "Scope map", bodyMd: "Root map context." }, admin);
    await saveDoc(db, { scopePath: "root", slug: "critical-facts", title: "Critical facts", bodyMd: "Root critical context." }, admin);

    const draft = await ensureDraftIntakeForScope(db, { scopePath: client, reason: "Convert History Client proposal into delivery scope" }, editor);
    const hits = await findRelatedHistory(db, { intakeId: draft.id }, editor);
    expect(hits.some((hit) => hit.id === leadRecord.id && hit.scopePath === sales)).toBe(true);

    const selected = hits.filter((hit) => hit.id === leadRecord.id);
    await updateIntakePacket(db, { id: draft.id, relatedHistorySelections: selected }, editor);
    const pack = await assembleIntakeExternalPack(db, { intakeId: draft.id }, editor);
    expect(pack.pasteBack).toContain("Root map context.");
    expect(pack.pasteBack).toContain("Root critical context.");
    expect(pack.pasteBack).toContain("History Client proposal");
    expect(pack.pasteBack).toContain("Convert History Client proposal into delivery scope");

    const row = await getIntakePacket(db, draft.id, editor);
    expect(row.packSnapshot).toBe(pack.pasteBack);
    expect(row.relatedHistorySelections).toEqual(selected);
  });

  it("includes the actor's personal wiki pages in the external pack when present", async () => {
    const slug = `personal-pack-${Date.now()}`;
    await createScope(db, { slug, name: "Personal Pack", type: "project" }, admin);
    await grantRole(db, { principalId: editor, scopePath: slug, role: "editor" }, admin);
    const personal = await ensurePersonalScope(db, editor);
    await saveDoc(db, {
      scopePath: personal.scopePath,
      slug: "defaulting-style",
      title: "Defaulting Style",
      bodyMd: [
        "Use the compact intake defaulting cascade for this operator.",
        ...Array.from({ length: 45 }, (_, index) => `line-${index + 1}`),
      ].join("\n"),
    }, editor);

    const draft = await ensureDraftIntakeForScope(db, { scopePath: slug, reason: "Check personal defaults" }, editor);
    const pack = await assembleIntakeExternalPack(db, { intakeId: draft.id }, editor);

    expect(pack.pasteBack).toContain("## Personal context (actor)");
    expect(pack.pasteBack).toContain("Defaulting Style (defaulting-style)");
    expect(pack.pasteBack).toContain("compact intake defaulting cascade");
    expect(pack.pasteBack).toContain("line-39");
    expect(pack.pasteBack).not.toContain("line-45");
  });

  it("uses synced wizard framing templates before packaged defaults", async () => {
    const body = `---
slug: new-project
title: Edited project framing
kind: framing
applies_to: project
version: "3"
domains: [intake]
---

## Framing questions

- edited_goal: What edited admin question should appear?
- edited_owner: Who owns the edited answer?`;
    await db.insert(schema.skillsIndex).values({
      name: "scope-intake-template-new-project",
      scopePattern: "**",
      domains: ["intake"],
      path: "scope-intake/templates/new-project.md",
      description: "Edited project framing",
      body,
      sha: "sha-edited-project",
      syncedAt: new Date(),
    });

    const questions = await listWizardFramingQuestions(db, editor);
    const project = questions.find((template) => template.slug === "new-project");
    expect(project?.questions).toEqual([
      { key: "edited_goal", question: "What edited admin question should appear?" },
      { key: "edited_owner", question: "Who owns the edited answer?" },
    ]);
    expect(questions.find((template) => template.slug === "new-sub-scope")?.questions.length).toBeGreaterThan(0);
  });

  it("uses synced interview template body when assembling the external pack", async () => {
    const slug = `synced-interview-${Date.now()}`;
    await createScope(db, { slug, name: "Synced Interview", type: "project" }, admin);
    await grantRole(db, { principalId: editor, scopePath: slug, role: "editor" }, admin);
    await db.insert(schema.skillsIndex).values({
      name: "scope-intake-template-external-interview",
      scopePattern: "**",
      domains: ["intake"],
      path: "scope-intake/templates/interview.md",
      description: "External interview",
      body: `---
slug: external-interview
title: External interview
kind: interview
applies_to: any
version: "3"
domains: [intake]
---

## Interview guide

Ask the admin-edited synced interview question first.

## Packet instructions

Return the edited packet.`,
      sha: "sha-edited-interview",
      syncedAt: new Date(),
    });

    const draft = await ensureDraftIntakeForScope(db, { scopePath: slug, reason: "Verify synced interview template" }, editor);
    const pack = await assembleIntakeExternalPack(db, { intakeId: draft.id }, editor);
    expect(pack.pasteBack).toContain("Ask the admin-edited synced interview question first.");
    expect(pack.pasteBack).not.toContain("Work through these areas in whatever order");
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
