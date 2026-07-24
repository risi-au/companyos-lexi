/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as dbMod from "@companyos/db";
import {
  assembleKickoffArtifact,
  createScope,
  ensurePersonalScope,
  getDoc,
  getScope,
  grantRole,
  parseKickoffAnswers,
  recordKickoffAnswers,
  renderKickoffDoc,
  resolveKickoffAnswers,
  saveDoc,
} from "../../index";

const schema: any = (dbMod as any).schema ?? dbMod;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve(__dirname, "../../../../../packages/db/drizzle");
}
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = path.resolve("packages/db/drizzle");
}

describe("kickoff module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;
  let actorPrincipalId: string;
  let scopePath: string;

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

  async function principal(name: string): Promise<string> {
    const [row] = await db
      .insert(schema.principals)
      .values({ kind: "human", name: `${name} ${Date.now()} ${Math.random()}`, status: "active" })
      .returning();
    return row.id as string;
  }

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    rootPrincipalId = await principal("Root");
    await grantRole(db, { principalId: rootPrincipalId, scopePath: "root", role: "admin" }, rootPrincipalId);
    scopePath = `kickoff-test-${suffix}`;
    await createScope(db, { slug: scopePath, name: "Kickoff Test", type: "project" }, rootPrincipalId);
    actorPrincipalId = await principal("Actor");
    await grantRole(db, { principalId: actorPrincipalId, scopePath, role: "editor" }, rootPrincipalId);
    await ensurePersonalScope(db, actorPrincipalId);
  });

  it("resolves the cascade in run, personal, scope, template order, then misses", async () => {
    const question = { key: "outcome", question: "What outcome?", default: "Template outcome" };
    const personalScopePath = (await ensurePersonalScope(db, actorPrincipalId)).scopePath;
    await saveDoc(db, { scopePath: personalScopePath, slug: "kickoff-profile", title: "Kickoff profile", bodyMd: renderKickoffDoc("personal", { outcome: "Personal outcome" }) }, actorPrincipalId);
    await saveDoc(db, { scopePath, slug: "kickoff-defaults", title: "Kickoff defaults", bodyMd: renderKickoffDoc("scope", { outcome: "Scope outcome" }) }, actorPrincipalId);

    let result = await resolveKickoffAnswers(db, { scopePath, questions: [question], runAnswers: { outcome: "Run outcome" } }, actorPrincipalId);
    expect(result.resolved[0]).toMatchObject({ answer: "Run outcome", source: "run", layer: "scope" });
    result = await resolveKickoffAnswers(db, { scopePath, questions: [question] }, actorPrincipalId);
    expect(result.resolved[0]).toMatchObject({ answer: "Personal outcome", source: "personal" });

    await saveDoc(db, { scopePath: personalScopePath, slug: "kickoff-profile", title: "Kickoff profile", bodyMd: renderKickoffDoc("personal", {}) }, actorPrincipalId);
    result = await resolveKickoffAnswers(db, { scopePath, questions: [question] }, actorPrincipalId);
    expect(result.resolved[0]).toMatchObject({ answer: "Scope outcome", source: "scope" });
    await saveDoc(db, { scopePath, slug: "kickoff-defaults", title: "Kickoff defaults", bodyMd: renderKickoffDoc("scope", {}) }, actorPrincipalId);
    result = await resolveKickoffAnswers(db, { scopePath, questions: [question] }, actorPrincipalId);
    expect(result.resolved[0]).toMatchObject({ answer: "Template outcome", source: "template" });

    result = await resolveKickoffAnswers(db, { scopePath, questions: [{ key: "outcome", question: "What outcome?" }] }, actorPrincipalId);
    expect(result.resolved[0]).toMatchObject({ answer: null, source: null });
    expect(result.misses).toEqual(["outcome"]);
  });

  it("writes scope and personal answers back into their respective cascade layers", async () => {
    await recordKickoffAnswers(db, { scopePath, target: "scope", answers: { tone: "Direct" } }, actorPrincipalId);
    let result = await resolveKickoffAnswers(db, { scopePath, questions: [{ key: "tone", question: "What tone?" }] }, actorPrincipalId);
    expect(result.resolved[0]).toMatchObject({ answer: "Direct", source: "scope" });
    await recordKickoffAnswers(db, { scopePath, target: "personal", answers: { workflow: "Tests first" } }, actorPrincipalId);
    result = await resolveKickoffAnswers(db, { scopePath, questions: [{ key: "workflow", question: "What workflow?" }] }, actorPrincipalId);
    expect(result.resolved[0]).toMatchObject({ answer: "Tests first", source: "personal" });
  });

  it("merges applied answers, ignores blanks, and emits a write-back event", async () => {
    await recordKickoffAnswers(db, { scopePath, target: "scope", answers: { keep: "existing", override: "old" } }, actorPrincipalId);
    const result = await recordKickoffAnswers(db, { scopePath, target: "scope", answers: { override: "new", ignored: "   " } }, actorPrincipalId);
    const doc = await getDoc(db, { scopePath, slug: "kickoff-defaults" }, actorPrincipalId);
    const events = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.type, "kickoff.answers_recorded"), eq(schema.events.principalId, actorPrincipalId)));

    expect(result.written).toEqual(["override"]);
    expect(parseKickoffAnswers(doc?.bodyMd)).toEqual({ keep: "existing", override: "new" });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ scopeId: expect.any(String), principalId: actorPrincipalId });
    expect(events[1]?.payload).toMatchObject({ layer: "scope", slug: "kickoff-defaults", keys: ["override"] });
  });

  it("round-trips flat answers and safely rejects invalid bodies", () => {
    const answers = { outcome: "Ship kickoff", tone: "Direct" };
    expect(parseKickoffAnswers(renderKickoffDoc("scope", answers))).toEqual(answers);
    expect(parseKickoffAnswers("")).toEqual({});
    expect(parseKickoffAnswers("not a kickoff document")).toEqual({});
    expect(parseKickoffAnswers("```json\nnot json\n```")).toEqual({});
  });

  it("assembles validated artifacts for all connectivity tiers", async () => {
    const input = {
      scopePath,
      goal: "  Prepare the launch  ",
      questions: [
        { key: "tone", question: "What tone?", default: "Direct" },
        { key: "owner", question: "Who owns approval?" },
      ],
    };
    await expect(assembleKickoffArtifact(db, { ...input, goal: "   ", connectivity: "full" }, actorPrincipalId)).rejects.toThrow("Kickoff goal is required");

    for (const connectivity of ["full", "checklist", "paste"] as const) {
      const artifact = await assembleKickoffArtifact(db, { ...input, connectivity }, actorPrincipalId);
      expect(artifact.tier).toBe(connectivity);
      expect(artifact.artifact.length).toBeGreaterThan(0);
      expect(artifact.brief.goal).toBe("Prepare the launch");
      expect(artifact.misses).toEqual(["owner"]);
      if (connectivity !== "full") expect(artifact.artifact).toContain("Who owns approval?");
    }
  });

  it("parses the canonical json block even when an answer value contains a fenced json block", () => {
    // A value that itself contains a ```json fence must not poison the cache: parse
    // must return the canonical (last) block, not the injected one in the bullet list.
    const answers = { note: "see ```json\n{\"injected\":\"nope\"}\n``` here", outcome: "real" };
    expect(parseKickoffAnswers(renderKickoffDoc("scope", answers))).toEqual(answers);
  });

  it("requires viewer access on the scope for resolve and assemble", async () => {
    const stranger = await principal("Stranger");
    await expect(
      resolveKickoffAnswers(db, { scopePath, questions: [{ key: "x", question: "?" }] }, stranger)
    ).rejects.toThrow();
    await expect(
      assembleKickoffArtifact(db, { scopePath, goal: "g", connectivity: "checklist" }, stranger)
    ).rejects.toThrow();
    await expect(
      assembleKickoffArtifact(db, { scopePath: `no-such-scope-${Date.now()}`, goal: "g", connectivity: "full" }, actorPrincipalId)
    ).rejects.toThrow();
  });

  it("skips the write and emits nothing when no non-blank answers are provided", async () => {
    const before = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.type, "kickoff.answers_recorded"), eq(schema.events.principalId, actorPrincipalId)));
    const res = await recordKickoffAnswers(db, { scopePath, target: "scope", answers: { a: "   ", b: "" } }, actorPrincipalId);
    const after = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.type, "kickoff.answers_recorded"), eq(schema.events.principalId, actorPrincipalId)));

    expect(res.written).toEqual([]);
    expect(after.length).toBe(before.length);
    expect(await getDoc(db, { scopePath, slug: "kickoff-defaults" }, actorPrincipalId)).toBeNull();
  });
});
