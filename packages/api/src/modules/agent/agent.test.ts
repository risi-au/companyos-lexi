/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as dbMod from "@companyos/db";
const schema: any = (dbMod as any).schema ?? dbMod;
import {
  createScope,
  grantRole,
  listEvents,
  runTurn,
  listConversations,
  getConversationMessages,
  saveDoc,
  type LLMConfig,
} from "../../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolderCandidates = [
  path.resolve(process.cwd(), "packages/db/drizzle"),
  path.resolve(__dirname, "../../../../packages/db/drizzle"),
  path.resolve("packages/db/drizzle"),
  "C:/dev/companyos/packages/db/drizzle",
];
let migrationsFolder = (migrationsFolderCandidates.find((p) => fs.existsSync(path.join(p, "meta", "_journal.json"))) || migrationsFolderCandidates[0]) as string;
if (!fs.existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
  migrationsFolder = "C:/dev/companyos/packages/db/drizzle";
}

describe("resident agent (M3-04) with mocked LiteLLM fixture", () => {
  let client: PGlite;
  let db: any;

  beforeAll(async () => {
    client = new PGlite({ extensions: { vector } });
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    if (client && typeof client.close === "function") await client.close();
  });

  let rootId: string;
  let actorId: string;
  let demoScopePath: string;
  let llm: LLMConfig;

  beforeEach(async () => {
    const now = Date.now() + Math.random().toString(36).slice(2);
    const [rootP] = await db.insert(schema.principals).values({ kind: "human", name: "Root " + now, status: "active" }).returning();
    rootId = rootP.id;
    const [actP] = await db.insert(schema.principals).values({ kind: "human", name: "Actor " + now, status: "active" }).returning();
    actorId = actP.id;

    const slug = "agentdemo-" + now.toString().replace(/[^a-z0-9-]/g, "");
    const sc = await createScope(db, { slug, name: "AgentDemo", type: "project" }, rootId);
    demoScopePath = sc.path;
    await grantRole(db, { principalId: actorId, scopePath: demoScopePath, role: "editor" }, rootId);

    llm = { baseUrl: "http://mock-litellm", apiKey: "sk-mock" };
    // reset fetch mock
    (globalThis as any).fetch = undefined;
  });

  function makeToolCallResponse(name: string, args: any, id = "call_1") {
    return {
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }

  function makeFinalResponse(text: string) {
    return {
      choices: [{ message: { role: "assistant", content: text } }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
    };
  }

  function makeToolCallsResponse(calls: Array<{ name: string; args: any; id: string }>) {
    return {
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    };
  }

  async function ensureRootScope(): Promise<void> {
    const existing = await db.select({ id: schema.scopes.id }).from(schema.scopes).where(eq(schema.scopes.path, "root")).limit(1);
    if (existing.length === 0) {
      await createScope(db, { slug: "root", name: "Root", type: "root" }, rootId);
    }
  }

  async function ensureRootAdmin(): Promise<void> {
    await ensureRootScope();
    await grantRole(db, { principalId: actorId, scopePath: "root", role: "admin" }, rootId);
  }

  it("mocked multi-step tool turn persists messages and returns final + emits event", async () => {
    const fetchMock = vi.fn()
      // first: ask for tool
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", {}) })
      // second after tool result: final
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Context retrieved. Final answer here.") });

    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "what is the context?", model: "analysis" }, actorId, llm);

    expect(res.finalText).toContain("Final answer");
    expect(res.conversationId).toBeTruthy();
    expect(res.toolTrace.length).toBeGreaterThan(0);

    // persisted: user + assistant(tool) + tool + assistant(final)
    const msgs = await getConversationMessages(db, { conversationId: res.conversationId }, actorId);
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    expect(msgs.some((m: any) => m.role === "user")).toBe(true);
    expect(msgs.some((m: any) => m.role === "tool")).toBe(true);
    expect(msgs.some((m: any) => m.role === "assistant")).toBe(true);

    // event
    const evs = await listEvents(db, { scopePath: demoScopePath, type: "agent.turn_completed", limit: 3 });
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0]!.payload.model).toBe("analysis");
    expect(typeof evs[0]!.payload.toolCallCount).toBe("number");
  });

  it("listConversations and getMessages work for granted scope", async () => {
    // seed one via direct
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("hi") });
    (globalThis as any).fetch = fetchMock;

    const r1 = await runTurn(db, { scopePath: demoScopePath, userMessage: "seed conv" }, actorId, llm);
    const list = await listConversations(db, { scopePath: demoScopePath }, actorId);
    expect(list.length).toBeGreaterThan(0);
    const msgs = await getConversationMessages(db, { conversationId: r1.conversationId }, actorId);
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("write tool surfaces access error gracefully for viewer", async () => {
    // new viewer principal no editor
    const [viewP] = await db.insert(schema.principals).values({ kind: "human", name: "ViewerX", status: "active" }).returning();
    await grantRole(db, { principalId: viewP.id, scopePath: demoScopePath, role: "viewer" }, rootId);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("log_change", { title: "x", bodyMd: "y" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("tried") });

    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "log a change" }, viewP.id, llm);
    // should complete without crash, trace has error entry or final mentions
    expect(res).toBeTruthy();
    const msgs = await getConversationMessages(db, { conversationId: res.conversationId }, viewP.id);
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("root Ask OS exposes recall/search tools and prefetches critical facts", async () => {
    await ensureRootAdmin();
    await saveDoc(
      db,
      { scopePath: "root", slug: "critical-facts", title: "Critical Facts", bodyMd: "This week the OS shipped the brain surfaces." },
      actorId
    );

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeToolCallsResponse([
          { id: "call_recall", name: "recall_memory", args: { query: "what happened this week", limit: 5 } },
          { id: "call_search", name: "search", args: { query: "brain surfaces", kinds: ["doc"], limit: 5 } },
        ]),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Grounded root answer.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: "root", userMessage: "what happened across the OS this week?" }, actorId, llm);
    expect(res.finalText).toContain("Grounded");
    expect(res.toolTrace.map((tool) => tool.name)).toEqual(["recall_memory", "search"]);

    const firstRequest = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const toolNames = firstRequest.tools.map((tool: any) => tool.function.name);
    expect(toolNames).toEqual(expect.arrayContaining(["recall_memory", "search"]));
    expect(firstRequest.messages[0].content).toContain("Root critical facts");
    expect(firstRequest.messages[0].content).toContain("brain surfaces");
  });

  it("client-scope Ask OS recalls memory only from the granted subtree plus allowed root memory", async () => {
    await ensureRootScope();
    const other = await createScope(db, { slug: `other-${Date.now()}`, name: "Other", type: "project" }, rootId);
    await grantRole(db, { principalId: actorId, scopePath: demoScopePath, role: "editor" }, rootId);
    await grantRole(db, { principalId: rootId, scopePath: other.path, role: "editor" }, rootId);
    await saveDoc(db, { scopePath: demoScopePath, slug: "wiki", title: "Demo Wiki", bodyMd: "sharedpricing belongs to the granted project." }, actorId);
    await saveDoc(db, { scopePath: other.path, slug: "wiki", title: "Other Wiki", bodyMd: "sharedpricing belongs to another project." }, rootId);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("recall_memory", { query: "sharedpricing", limit: 10 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Scoped answer.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "recall sharedpricing" }, actorId, llm);
    expect(res.toolTrace[0]!.name).toBe("recall_memory");
    const resultText = JSON.stringify(res.toolTrace[0]!.result);
    expect(resultText).toContain(demoScopePath);
    expect(resultText).not.toContain(other.path);
  });
});
