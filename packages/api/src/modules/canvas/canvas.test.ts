/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  grantRole,
  saveCanvas,
  getCanvas,
  listCanvases,
  archiveCanvas,
  listEvents,
} from "../../index";
import {
  AccessDeniedError,
  CanvasNotFoundError,
  CanvasSizeError,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let migrationsFolder = "";
const candidates = [
  path.resolve(process.cwd(), "packages/db/drizzle"),
  path.resolve(__dirname, "../../../../packages/db/drizzle"),
  path.resolve(__dirname, "../../../../../packages/db/drizzle"),
  path.resolve("packages/db/drizzle"),
  path.resolve(__dirname, "../drizzle"),
];
for (const c of candidates) {
  if (fs.existsSync(path.join(c, "meta", "_journal.json"))) {
    migrationsFolder = c;
    break;
  }
}
if (!migrationsFolder) {
  migrationsFolder = path.resolve(process.cwd(), "packages/db/drizzle");
}
console.log("[canvas.test] using migrationsFolder:", migrationsFolder);

describe("canvas module (PGlite + migrations)", () => {
  let client: PGlite;
  let db: any;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") {
      await client.close();
    }
  });

  let rootPrincipalId: string;
  let agentPrincipalId: string;
  let viewerPrincipalId: string;
  let noAccessPrincipalId: string;
  let testScopePath: string;

  beforeEach(async () => {
    const now = Date.now();
    const pRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "Root Principal " + now,
      status: "active",
    }).returning()) as any[];
    rootPrincipalId = pRes[0]?.id;

    const aRes = (await db.insert(schema.principals).values({
      kind: "agent",
      name: "Agent " + now,
      status: "active",
    }).returning()) as any[];
    agentPrincipalId = aRes[0]?.id;

    const vRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "Viewer " + now,
      status: "active",
    }).returning()) as any[];
    viewerPrincipalId = vRes[0]?.id;

    const nRes = (await db.insert(schema.principals).values({
      kind: "human",
      name: "NoAccess " + now,
      status: "active",
    }).returning()) as any[];
    noAccessPrincipalId = nRes[0]?.id;

    // ensure a scope
    testScopePath = `test-canvas-${now}`;
    await createScope(db, { slug: testScopePath, name: "Test Canvas Scope", type: "project" }, rootPrincipalId);
    await grantRole(db, { principalId: rootPrincipalId, scopePath: testScopePath, role: "owner" }, rootPrincipalId);
    await grantRole(db, { principalId: agentPrincipalId, scopePath: testScopePath, role: "editor" }, rootPrincipalId);
    await grantRole(db, { principalId: viewerPrincipalId, scopePath: testScopePath, role: "viewer" }, rootPrincipalId);
  });

  it("save/get/list roundtrips scene jsonb intact and emits canvas.saved", async () => {
    const scene = { elements: [{ id: "e1", type: "rectangle", x: 10, y: 10, width: 100, height: 50 }], appState: { viewBackgroundColor: "#f4f4f4" } };
    const saved = await saveCanvas(db, { scopePath: testScopePath, name: "Process Map", scene }, rootPrincipalId);
    expect(saved.name).toBe("Process Map");
    expect(saved.slug).toBe("process-map");
    expect(saved.scene).toEqual(scene);

    const got = await getCanvas(db, { scopePath: testScopePath, slug: saved.slug }, viewerPrincipalId);
    expect(got).not.toBeNull();
    expect(got!.scene).toEqual(scene);
    expect(got!.name).toBe("Process Map");

    const list = await listCanvases(db, { scopePath: testScopePath }, viewerPrincipalId);
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("Process Map");

    const events = await listEvents(db, { scopePath: testScopePath, type: "canvas.saved" });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.payload?.slug).toBe(saved.slug);
  });

  it("auto-slug + collision suffix works", async () => {
    await saveCanvas(db, { scopePath: testScopePath, name: "Map" }, rootPrincipalId);
    const s2 = await saveCanvas(db, { scopePath: testScopePath, name: "Map" }, rootPrincipalId);
    expect(s2.slug).toBe("map-2");
  });

  it("archive hides from default list; get still works; emits archived", async () => {
    const saved = await saveCanvas(db, { scopePath: testScopePath, name: "Temp" }, rootPrincipalId);
    await archiveCanvas(db, { scopePath: testScopePath, slug: saved.slug }, rootPrincipalId);
    const list = await listCanvases(db, { scopePath: testScopePath }, viewerPrincipalId);
    expect(list.find((c: any) => c.slug === saved.slug)).toBeUndefined();
    const got = await getCanvas(db, { scopePath: testScopePath, slug: saved.slug }, viewerPrincipalId);
    expect(got?.archivedAt).not.toBeNull();

    const evs = await listEvents(db, { scopePath: testScopePath, type: "canvas.archived" });
    expect(evs.length).toBeGreaterThan(0);
  });

  it("size cap: >2MB throws CanvasSizeError", async () => {
    const big = "x".repeat(3 * 1024 * 1024);
    const hugeScene = { elements: [{ id: "big", data: big }] };
    await expect(
      saveCanvas(db, { scopePath: testScopePath, name: "Huge", scene: hugeScene }, rootPrincipalId)
    ).rejects.toThrow(CanvasSizeError);
  });

  it("access: viewer cannot save/archive; editor can; no-access denied", async () => {
    await expect(
      saveCanvas(db, { scopePath: testScopePath, name: "V", scene: {} }, viewerPrincipalId)
    ).rejects.toThrow(AccessDeniedError);

    const saved = await saveCanvas(db, { scopePath: testScopePath, name: "E", scene: {} }, agentPrincipalId);
    expect(saved).toBeTruthy();

    await expect(
      archiveCanvas(db, { scopePath: testScopePath, slug: saved.slug }, viewerPrincipalId)
    ).rejects.toThrow(AccessDeniedError);

    await expect(
      getCanvas(db, { scopePath: testScopePath, slug: saved.slug }, noAccessPrincipalId)
    ).rejects.toThrow(AccessDeniedError);
  });

  it("get non-existent returns null; archive missing throws", async () => {
    const got = await getCanvas(db, { scopePath: testScopePath, slug: "nope" }, viewerPrincipalId);
    expect(got).toBeNull();

    await expect(
      archiveCanvas(db, { scopePath: testScopePath, slug: "nope" }, rootPrincipalId)
    ).rejects.toThrow(CanvasNotFoundError);
  });
});
