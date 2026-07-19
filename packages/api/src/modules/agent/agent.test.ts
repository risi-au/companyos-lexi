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
  createAttentionItem,
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

  async function seedWikiQuestion() {
    await saveDoc(db, {
      scopePath: demoScopePath,
      slug: "pricing",
      title: "Pricing",
      bodyMd: "The current launch price is $20 per seat.",
    }, actorId);
    await saveDoc(db, {
      scopePath: demoScopePath,
      slug: "sales",
      title: "Sales Notes",
      bodyMd: "The current launch price is $30 per seat.",
    }, actorId);

    return createAttentionItem(db, {
      scopePath: demoScopePath,
      kind: "lint_finding",
      title: "Wiki lint: contradiction",
      summary: "Two wiki pages disagree about launch price.",
      payload: {
        version: 2,
        type: "contradiction",
        relation: "scalar-mismatch",
        subject: { entity: "Launch plan", property: "price", timeframe: "current" },
        explanation: "Two wiki pages disagree about the current launch price.",
        claims: [
          { slug: "pricing", title: "Pricing", quote: "The current launch price is $20 per seat.", normalizedValue: "$20 per seat" },
          { slug: "sales", title: "Sales Notes", quote: "The current launch price is $30 per seat.", normalizedValue: "$30 per seat" },
        ],
        choices: [
          {
            id: "first",
            label: "Use $20 per seat",
            repair: {
              slug: "sales",
              title: "Sales Notes",
              currentMd: "The current launch price is $30 per seat.",
              proposedMd: "The current launch price is $20 per seat.",
            },
          },
          {
            id: "second",
            label: "Use $30 per seat",
            repair: {
              slug: "pricing",
              title: "Pricing",
              currentMd: "The current launch price is $20 per seat.",
              proposedMd: "The current launch price is $30 per seat.",
            },
          },
        ],
        scopePath: demoScopePath,
      },
    }, actorId);
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
    const assistant = msgs.find((message: any) => message.role === "assistant");
    expect(Object.prototype.hasOwnProperty.call((assistant as any)?.content ?? {}, "citations")).toBe(false);
  });

  it("persists deduped recall citations on the final assistant message and turn result", async () => {
    const doc = await saveDoc(db, {
      scopePath: demoScopePath,
      slug: "citation-source",
      title: "Citation Source",
      bodyMd: "Citation alpha source material for the resident agent.",
    }, actorId);
    const [revision] = await db
      .select()
      .from(schema.documentRevisions)
      .where(eq(schema.documentRevisions.documentId, doc.id))
      .limit(1);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeToolCallsResponse([
          { id: "call_recall_1", name: "recall_memory", args: { query: "citation alpha", limit: 5 } },
          { id: "call_recall_2", name: "recall_memory", args: { query: "citation alpha", limit: 5 } },
        ]),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Cited answer.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "answer with memory" }, actorId, llm);

    expect(res.citations).toEqual([{
      slug: "citation-source",
      scopePath: demoScopePath,
      revisionId: revision?.id,
      source: "scope",
      title: "Citation Source",
    }]);

    const msgs = await getConversationMessages(db, { conversationId: res.conversationId }, actorId);
    const finalAssistant = msgs
      .filter((message: any) => message.role === "assistant")
      .find((message: any) => (message.content as any)?.text === "Cited answer.");
    expect((finalAssistant?.content as any)?.citations).toEqual(res.citations);

    const evs = await listEvents(db, { scopePath: demoScopePath, type: "agent.turn_completed", limit: 3 });
    expect(evs[0]!.payload.citationCount).toBe(1);
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

  it("lists once, inspects the selected Wiki question with both current page snapshots, then answers within three model responses", async () => {
    const item = await seedWikiQuestion();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("list_things_to_resolve", { limit: 10 }, "call_list") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("inspect_thing_to_resolve", { id: item.id }, "call_inspect") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Two wiki pages disagree: Pricing says $20 and Sales Notes says $30. Use one of the offered actions to apply the matching Suggested wiki update.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "What is this Things to resolve Wiki question about?" }, actorId, llm);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.finalText).toContain("Two wiki pages disagree");
    expect(res.toolTrace.map((tool) => tool.name)).toEqual(["list_things_to_resolve", "inspect_thing_to_resolve"]);
    expect(res.toolTrace.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["search", "recall_memory"]));
    expect(res.toolTrace[0]!.result).toEqual([expect.objectContaining({
      id: item.id,
      label: "Two wiki pages disagree",
      title: "Wiki question",
    })]);
    expect(res.toolTrace[1]!.result.referencedPages).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "pricing", title: "Pricing", bodyMd: "The current launch price is $20 per seat.", scopePath: demoScopePath }),
      expect.objectContaining({ slug: "sales", title: "Sales Notes", bodyMd: "The current launch price is $30 per seat.", scopePath: demoScopePath }),
    ]));
    expect(res.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "pricing", title: "Pricing", scopePath: demoScopePath, source: "scope" }),
      expect.objectContaining({ slug: "sales", title: "Sales Notes", scopePath: demoScopePath, source: "scope" }),
    ]));
  });

  it("directly inspects a Wiki question when the id is supplied", async () => {
    const item = await seedWikiQuestion();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("inspect_thing_to_resolve", { id: item.id }, "call_inspect") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Inspected the Wiki question.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: `Explain Things to resolve item ${item.id}` }, actorId, llm);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.toolTrace.map((tool) => tool.name)).toEqual(["inspect_thing_to_resolve"]);
    expect(res.toolTrace[0]!.result.structuredItem.id).toBe(item.id);
    expect(res.toolTrace[0]!.result.referencedPages).toHaveLength(2);
    expect(res.citations).toHaveLength(2);
  });

  it("captures get_doc citations and refuses reserved Wiki health history pages through Ask OS", async () => {
    await saveDoc(db, {
      scopePath: demoScopePath,
      slug: "operating-plan",
      title: "Operating Plan",
      bodyMd: "The operating plan is current.",
    }, actorId);
    await saveDoc(db, {
      scopePath: demoScopePath,
      slug: "lint-report-2026-07-19",
      title: "Wiki health history",
      bodyMd: "Operational history.",
    }, actorId);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeToolCallsResponse([
          { id: "call_doc", name: "get_doc", args: { slug: "operating-plan" } },
          { id: "call_reserved", name: "get_doc", args: { slug: "lint-report-2026-07-19" } },
        ]),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Cited the operating plan and skipped the reserved page.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "Read the operating plan and the report" }, actorId, llm);

    expect(res.toolTrace[0]!.result.slug).toBe("operating-plan");
    expect(res.toolTrace[1]!.error).toContain("Reserved Wiki health history pages");
    expect(res.citations).toEqual([{
      slug: "operating-plan",
      scopePath: demoScopePath,
      source: "scope",
      title: "Operating Plan",
    }]);
  });

  it("does not run broad search or recall on the Wiki-question path", async () => {
    const item = await seedWikiQuestion();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("inspect_thing_to_resolve", { id: item.id }, "call_inspect") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Answered from the inspected Wiki question.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: `What should I do with notification ${item.id}?` }, actorId, llm);

    expect(res.toolTrace.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["search", "recall_memory"]));
    const firstRequest = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(firstRequest.messages[0].content).toContain("inspect that item first");
    expect(firstRequest.messages[0].content).toContain("Do not begin that path with broad search or recall_memory");
  });

  it("blocks a broad lookup until the requested Wiki question has been inspected", async () => {
    const item = await seedWikiQuestion();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("search", { query: "launch price" }, "call_search") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("inspect_thing_to_resolve", { id: item.id }, "call_inspect") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Answered from the inspected Wiki question.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: `Explain Wiki question ${item.id}` }, actorId, llm);

    expect(res.toolTrace[0]!.error).toContain("Inspect the relevant Wiki question first");
    expect(res.toolTrace[1]!.result.found).toBe(true);
  });

  it("recognizes the old Wiki health wording and blocks broad lookup until inspection", async () => {
    const item = await seedWikiQuestion();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("search", { query: "intake workflow completed" }, "call_search") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("inspect_thing_to_resolve", { id: item.id }, "call_inspect") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("The cited pages are the source for this question.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, {
      scopePath: demoScopePath,
      userMessage: `Explain this lint finding: Wiki lint: contradiction. Item ${item.id}`,
    }, actorId, llm);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.toolTrace[0]!.error).toContain("Inspect the relevant Wiki question first");
    expect(res.toolTrace[1]!.result.found).toBe(true);
    expect(res.toolTrace.map((tool) => tool.name)).not.toContain("recall_memory");
  });

  it("does not execute an identical repeated tool call twice", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeToolCallsResponse([
          { id: "call_context_1", name: "get_context", args: {} },
          { id: "call_context_2", name: "get_context", args: {} },
        ]),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Used the earlier result.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "repeat context" }, actorId, llm);

    expect(res.toolTrace).toHaveLength(2);
    expect(res.toolTrace[1]!.result).toMatchObject({
      repeatedCall: true,
      message: expect.stringContaining("already ran"),
    });
  });

  it("allows ordinary requests to use more than three model responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", { step: 1 }, "call_1") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", { step: 2 }, "call_2") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", { step: 3 }, "call_3") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", { step: 4 }, "call_4") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeFinalResponse("Finished the ordinary multi-step request.") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "work through this ordinary multi-step request" }, actorId, llm);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(res.finalText).toBe("Finished the ordinary multi-step request.");
  });

  it("returns a friendly fallback after three Wiki-question responses instead of a max-iterations placeholder", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", {}, "call_1") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", {}, "call_2") })
      .mockResolvedValueOnce({ ok: true, json: async () => makeToolCallResponse("get_context", {}, "call_3") });
    (globalThis as any).fetch = fetchMock;

    const res = await runTurn(db, { scopePath: demoScopePath, userMessage: "keep looping on this Wiki question" }, actorId, llm);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.finalText).toContain("could not finish a complete answer");
    expect(res.finalText).not.toContain("max iterations");
  });
});
