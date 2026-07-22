/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
  createScope,
  getScope,
  grantRole,
  registerSession,
  updateSession,
  completeSession,
  createAttentionItem,
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

describe("digest module", () => {
  let client: PGlite;
  let db: any;
  let rootPrincipalId: string;
  let editorId: string;
  let viewerId: string;
  let scopePath: string;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    if (!(await getScope(db, "root"))) {
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
      .values({ kind, name: `${name} ${Date.now()} ${Math.random()}`, status: "active" })
      .returning();
    return row.id as string;
  }

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    rootPrincipalId = await principal("Root Admin");
    await grantRole(
      db,
      { principalId: rootPrincipalId, scopePath: "root", role: "admin" },
      rootPrincipalId
    );

    scopePath = `digest-test-${suffix}`;
    await createScope(
      db,
      { slug: scopePath, name: "Digest Test", type: "project" },
      rootPrincipalId
    );

    editorId = await principal("Editor");
    viewerId = await principal("Viewer");

    await grantRole(db, { principalId: editorId, scopePath, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerId, scopePath, role: "viewer" }, rootPrincipalId);
  });

  it("returns a digest with all 5 lanes in correct order and explainability fields", async () => {
    // Seed: one waiting session, one completed session, one open attention item
    const waitingSession = await registerSession(
      db,
      { scopePath, title: "Waiting session", engine: "codex" },
      editorId
    );
    await updateSession(db, { sessionId: waitingSession.id, status: "waiting" }, editorId);

    const completedSession = await registerSession(
      db,
      { scopePath, title: "Completed session", engine: "codex" },
      editorId
    );
    await completeSession(
      db,
      { sessionId: completedSession.id, structuredReturn: { outcome: "Done" } },
      editorId
    );

    await createAttentionItem(
      db,
      {
        scopePath,
        kind: "wiki_proposal",
        title: "Update wiki",
        summary: "Agent proposed a wiki edit",
        payload: { slug: "test-wiki", title: "Test Wiki", currentMd: "Old content", proposedMd: "New content" },
      },
      editorId
    );

    // Call getDigest with null planeClient
    const { getDigest } = await import("../../index");
    const digest = await getDigest(db, null, { scopePath, includeDescendants: true }, viewerId);

    // Assert: 5 lanes in correct order
    expect(digest.lanes).toHaveLength(5);
    expect(digest.lanes[0]?.key).toBe("waiting_for_feedback");
    expect(digest.lanes[1]?.key).toBe("waiting_for_approval");
    expect(digest.lanes[2]?.key).toBe("completed_to_review");
    expect(digest.lanes[3]?.key).toBe("automation_candidates");
    expect(digest.lanes[4]?.key).toBe("ready_to_start");

    // Assert: waiting_for_feedback has >= 1 item with explainability
    expect(digest.lanes[0]?.items.length).toBeGreaterThanOrEqual(1);
    const waitingItem = digest.lanes[0]?.items[0];
    expect(waitingItem).toBeDefined();
    expect(waitingItem?.whyItNeedsYou).toBeTruthy();
    expect(waitingItem?.whyItNeedsYou!.length).toBeGreaterThan(0);
    expect(waitingItem?.whatHappensAfter).toBeTruthy();
    expect(waitingItem?.whatHappensAfter!.length).toBeGreaterThan(0);

    // Assert: waiting_for_approval has >= 1 item
    expect(digest.lanes[1]?.items.length).toBeGreaterThanOrEqual(1);
    const approvalItem = digest.lanes[1]?.items[0];
    expect(approvalItem).toBeDefined();
    expect(approvalItem?.whyItNeedsYou).toBeTruthy();
    expect(approvalItem?.whatHappensAfter).toBeTruthy();

    // Assert: completed_to_review has >= 1 item
    expect(digest.lanes[2]?.items.length).toBeGreaterThanOrEqual(1);
    const reviewItem = digest.lanes[2]?.items[0];
    expect(reviewItem).toBeDefined();
    expect(reviewItem?.whyItNeedsYou).toBeTruthy();
    expect(reviewItem?.whatHappensAfter).toBeTruthy();

    // Assert: automation_candidates is empty with a note
    expect(digest.lanes[3]?.items).toHaveLength(0);
    expect(digest.lanes[3]?.note).toBeTruthy();
    expect(digest.lanes[3]?.note!.length).toBeGreaterThan(0);

    // Assert: ready_to_start (planeClient null) is empty with a note
    expect(digest.lanes[4]?.items).toHaveLength(0);
    expect(digest.lanes[4]?.note).toBeTruthy();
    expect(digest.lanes[4]?.note!.length).toBeGreaterThan(0);
  });
});
