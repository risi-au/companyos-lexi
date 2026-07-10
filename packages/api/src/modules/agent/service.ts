/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { eq, desc } from "drizzle-orm";
import {
  agentConversations,
  agentMessages,
  scopes,
  type AgentConversation,
  type AgentMessage,
} from "@companyos/db";
import {
  getScope,
  requireAccess,
  emitEvent,
  type DB,
} from "../../kernel";
import { getContextBundle } from "../../agent";
import {
  listRecords,
  createRecord,
  listTasks,
  createTask,
  completeTask,
  queryMetrics,
  listMetricNames,
  getDashboard,
  saveDashboard,
  getWidgetVocabulary,
  listDocs,
  getDoc,
  saveDoc,
  createAttentionItem,
  search,
  recallMemory,
  getRootCriticalFacts,
  type Citation,
  type RecallMemoryHit,
  type SearchHit,
} from "../..";
import { PlaneClient } from "../tasks/plane-client";
import { AccessDeniedError, ScopeNotFoundError } from "../../errors";

// Zod schemas for tools (reused for JSON schema)
const GetContextSchema = z.object({});
const ListRecordsSchema = z.object({
  kind: z.enum(["changelog", "decision", "report", "note"]).optional(),
  limit: z.number().min(1).max(50).optional(),
});
const LogChangeSchema = z.object({
  title: z.string().min(1),
  bodyMd: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});
const LogDecisionSchema = z.object({
  title: z.string().min(1),
  bodyMd: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});
const SaveReportSchema = z.object({
  title: z.string().min(1),
  bodyMd: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});
const ListTasksSchema = z.object({
  state: z.enum(["all", "open", "completed"]).optional(),
  limit: z.number().min(1).max(100).optional(),
});
const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
  dueDate: z.string().optional(),
});
const CompleteTaskSchema = z.object({
  issueId: z.string().min(1),
  note: z.string().optional(),
});
const QueryMetricsSchema = z.object({
  metrics: z.array(z.string()).min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  groupBy: z.enum(["date", "metric"]).optional(),
  filters: z.record(z.string().nullable()).optional(),
  agg: z.enum(["sum", "avg", "min", "max"]).optional(),
});
const GetDashboardSchema = z.object({ name: z.string().optional() });
const SaveDashboardSchema = z.object({
  name: z.string().default("main"),
  spec: z.record(z.unknown()),
});
const ListWidgetTypesSchema = z.object({});
const ListDocsSchema = z.object({ includeArchived: z.boolean().optional() });
const GetDocSchema = z.object({ slug: z.string().min(1) });
const SaveDocSchema = z.object({
  slug: z.string().optional(),
  title: z.string().min(1),
  bodyMd: z.string().optional(),
});
const SearchSchema = z.object({
  query: z.string().min(1),
  kinds: z.array(z.enum(["record", "doc"])).optional(),
  limit: z.number().min(1).max(25).optional(),
  mode: z.enum(["keyword", "semantic", "hybrid"]).optional(),
});
const RecallMemorySchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(25).optional(),
});

// Convert zod to OpenAI tool params
function zodToOpenAIParams(schema: z.ZodTypeAny) {
  return zodToJsonSchema(schema, { target: "openApi3" }) as any;
}

function makeTool(name: string, description: string, schema: z.ZodTypeAny) {
  return {
    type: "function" as const,
    function: {
      name,
      description,
      parameters: zodToOpenAIParams(schema),
    },
  };
}

const ALL_TOOLS = [
  makeTool("get_context", "Get rich markdown context for the current scope (identity, modules, recent records). Call first for grounding.", GetContextSchema),
  makeTool("list_records", "List records (changelog/decision/report/note) for the scope.", ListRecordsSchema),
  makeTool("log_change", "Log a changelog record (durable outcome).", LogChangeSchema),
  makeTool("log_decision", "Log a decision record (durable outcome).", LogDecisionSchema),
  makeTool("save_report", "Save a report record (durable outcome).", SaveReportSchema),
  makeTool("list_tasks", "List Plane tasks for the scope (open/completed).", ListTasksSchema),
  makeTool("create_task", "Create a new task via Plane.", CreateTaskSchema),
  makeTool("complete_task", "Mark a task completed in Plane (optionally with note logged to changelog).", CompleteTaskSchema),
  makeTool("query_metrics", "Query time-series metrics with aggregation/filtering for the scope.", QueryMetricsSchema),
  makeTool("list_metric_names", "List known metric names for the scope.", z.object({})),
  makeTool("get_dashboard", "Get saved dashboard spec for the scope.", GetDashboardSchema),
  makeTool("save_dashboard", "Save (upsert) a dashboard spec.", SaveDashboardSchema),
  makeTool("list_widget_types", "List supported dashboard widget types.", ListWidgetTypesSchema),
  makeTool("list_docs", "List documents in the scope KB.", ListDocsSchema),
  makeTool("get_doc", "Fetch full document by slug.", GetDocSchema),
  makeTool("save_doc", "Save (create or update) a markdown doc by slug or title.", SaveDocSchema),
  makeTool("search", "Search records and docs in the current scope subtree. Use this for grounded answers about recent or historical OS facts.", SearchSchema),
  makeTool("recall_memory", "Recall distilled second-brain memory scoped to the current subtree, plus allowed root critical facts and root patterns.", RecallMemorySchema),
];

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
}

export interface RunTurnInput {
  conversationId?: string;
  scopePath?: string;
  userMessage: string;
  model?: string; // alias: cheap | analysis | reasoning | code
}

export interface RunTurnResult {
  finalText: string;
  toolTrace: Array<{ name: string; args: any; result?: any; error?: string }>;
  conversationId: string;
  citations: Citation[];
}

function formatError(e: unknown): string {
  if (e instanceof AccessDeniedError) {
    return `Access denied: requires ${e.requiredRole} on ${e.scopePath}`;
  }
  if (e instanceof ScopeNotFoundError) {
    return `Scope not found: ${e.path}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

function addCitation(citations: Citation[], seen: Set<string>, citation: Citation): void {
  const key = `${citation.scopePath}\t${citation.slug}`;
  if (seen.has(key)) return;
  seen.add(key);
  citations.push(citation);
}

function citationFromRecallHit(hit: RecallMemoryHit): Citation {
  return {
    slug: hit.slug,
    scopePath: hit.scopePath,
    ...(hit.revisionId ? { revisionId: hit.revisionId } : {}),
    source: hit.source,
    title: hit.title,
  };
}

function collectCitationsFromToolResult(
  name: string,
  structuredResult: unknown,
  citations: Citation[],
  seenCitations: Set<string>
): void {
  if (!Array.isArray(structuredResult)) return;

  if (name === "recall_memory") {
    for (const hit of structuredResult as RecallMemoryHit[]) {
      if (!hit?.slug || !hit?.scopePath) continue;
      addCitation(citations, seenCitations, citationFromRecallHit(hit));
    }
    return;
  }

  if (name === "search") {
    for (const hit of structuredResult as SearchHit[]) {
      if (hit?.type !== "doc" || !hit.slug || !hit.scopePath) continue;
      addCitation(citations, seenCitations, {
        slug: hit.slug,
        scopePath: hit.scopePath,
        source: "scope",
        title: hit.title,
      });
    }
  }
}

async function callLiteLLM(
  messages: any[],
  tools: any[],
  model: string,
  llm: LLMConfig
): Promise<any> {
  const base = llm.baseUrl.replace(/\/$/, "");
  const resp = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llm.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: "auto",
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LiteLLM ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function persistMessage(
  db: DB,
  conversationId: string,
  role: "user" | "assistant" | "tool",
  content: Record<string, unknown>,
  model?: string | null
): Promise<AgentMessage> {
  const [row] = (await db
    .insert(agentMessages)
    .values({
      conversationId,
      role,
      content,
      model: model ?? null,
    })
    .returning()) as AgentMessage[];
  if (!row) throw new Error("Failed to persist agent message");
  return row;
}

async function getOrCreateConversation(
  db: DB,
  input: RunTurnInput,
  actorPrincipalId: string
): Promise<{ conversationId: string; scopePath: string }> {
  if (input.conversationId) {
    const [conv] = (await db
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.id, input.conversationId))
      .limit(1)) as AgentConversation[];
    if (!conv) throw new Error("Conversation not found");
    const [scopeRow] = (await db
      .select({ path: scopes.path })
      .from(scopes)
      .where(eq(scopes.id, conv.scopeId))
      .limit(1)) as { path: string }[];
    const scopePath = scopeRow?.path;
    if (!scopePath) throw new Error("Conversation scope missing");
    await requireAccess(db, actorPrincipalId, scopePath, "viewer");
    return { conversationId: conv.id, scopePath };
  }
  if (!input.scopePath) throw new Error("scopePath required for new conversation");
  const scope = await getScope(db, input.scopePath);
  if (!scope) throw new ScopeNotFoundError(input.scopePath);
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");
  const title = (input.userMessage || "New chat").slice(0, 80);
  const [conv] = (await db
    .insert(agentConversations)
    .values({
      scopeId: scope.id,
      title,
      createdBy: actorPrincipalId,
    })
    .returning()) as AgentConversation[];
  if (!conv) throw new Error("Failed to create conversation");
  return { conversationId: conv.id, scopePath: input.scopePath };
}

async function loadHistory(db: DB, conversationId: string): Promise<any[]> {
  const rows = (await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(40)) as AgentMessage[]; // recent first, reverse below
  const ordered = rows.reverse();
  return ordered.map((m) => {
    if (m.role === "user") {
      return { role: "user", content: (m.content as any)?.text || JSON.stringify(m.content) };
    }
    if (m.role === "assistant") {
      const c = m.content as any;
      if (c.tool_calls) {
        return { role: "assistant", content: c.text || "", tool_calls: c.tool_calls };
      }
      return { role: "assistant", content: c.text || "" };
    }
    if (m.role === "tool") {
      const c = m.content as any;
      return {
        role: "tool",
        tool_call_id: c.tool_call_id,
        content: JSON.stringify(c.result ?? c),
      };
    }
    return { role: m.role, content: JSON.stringify(m.content) };
  });
}

async function executeToolCall(
  name: string,
  args: any,
  db: DB,
  scopePath: string,
  actorPrincipalId: string,
  planeClient?: PlaneClient | null
): Promise<any> {
  try {
    if (name === "get_context") {
      const md = await getContextBundle(db, scopePath, actorPrincipalId);
      return { result: md };
    }
    if (name === "list_records") {
      const res = await listRecords(db, { scopePath, ...args }, actorPrincipalId);
      return { result: res };
    }
    if (name === "log_change") {
      const res = await createRecord(
        db,
        { scopePath, kind: "changelog", title: args.title, bodyMd: args.bodyMd || "", data: args.data || {} },
        actorPrincipalId
      );
      return { result: { id: res.id, kind: "changelog", title: res.title } };
    }
    if (name === "log_decision") {
      const res = await createRecord(
        db,
        { scopePath, kind: "decision", title: args.title, bodyMd: args.bodyMd || "", data: args.data || {} },
        actorPrincipalId
      );
      return { result: { id: res.id, kind: "decision", title: res.title } };
    }
    if (name === "save_report") {
      const res = await createRecord(
        db,
        { scopePath, kind: "report", title: args.title, bodyMd: args.bodyMd || "", data: args.data || {} },
        actorPrincipalId
      );
      return { result: { id: res.id, kind: "report", title: res.title } };
    }
    if (name === "list_tasks") {
      const pc = planeClient || ({} as any);
      const res = await listTasks(db, pc, { scopePath, ...args }, actorPrincipalId);
      return { result: res };
    }
    if (name === "create_task") {
      const pc = planeClient || ({} as any);
      const res = await createTask(db, pc, { scopePath, ...args }, actorPrincipalId);
      return { result: res };
    }
    if (name === "complete_task") {
      const pc = planeClient || ({} as any);
      await completeTask(db, pc, { scopePath, issueId: args.issueId, note: args.note }, actorPrincipalId);
      return { result: { ok: true } };
    }
    if (name === "query_metrics") {
      const res = await queryMetrics(db, { scopePath, ...args }, actorPrincipalId);
      return { result: res };
    }
    if (name === "list_metric_names") {
      const res = await listMetricNames(db, { scopePath }, actorPrincipalId);
      return { result: res };
    }
    if (name === "get_dashboard") {
      const res = await getDashboard(db, { scopePath, name: args.name }, actorPrincipalId);
      return { result: res };
    }
    if (name === "save_dashboard") {
      const res = await saveDashboard(db, { scopePath, name: args.name || "main", spec: args.spec }, actorPrincipalId);
      return { result: { id: res?.id, name: res?.name } };
    }
    if (name === "list_widget_types") {
      const res = getWidgetVocabulary();
      return { result: res };
    }
    if (name === "list_docs") {
      const res = await listDocs(db, { scopePath, includeArchived: args.includeArchived }, actorPrincipalId);
      return { result: res };
    }
    if (name === "get_doc") {
      const res = await getDoc(db, { scopePath, slug: args.slug }, actorPrincipalId);
      return { result: res };
    }
    if (name === "save_doc") {
      const existing = args.slug
        ? await getDoc(db, { scopePath, slug: args.slug }, actorPrincipalId)
        : null;
      if (existing) {
        const item = await createAttentionItem(db, {
          scopePath,
          kind: "wiki_proposal",
          title: `Update ${existing.title}`,
          summary: `Proposed edit to [[${existing.slug}]] filed for human approval.`,
          payload: {
            slug: existing.slug,
            title: args.title || existing.title,
            currentMd: existing.bodyMd,
            proposedMd: args.bodyMd || "",
          },
        }, actorPrincipalId);
        return {
          result: {
            attentionItemId: item.id,
            status: "filed_for_approval",
            message: `Proposed edit to ${existing.slug} was filed for human approval as attention item ${item.id}.`,
          },
        };
      }
      const res = await saveDoc(db, { scopePath, slug: args.slug, title: args.title, bodyMd: args.bodyMd || "" }, actorPrincipalId);
      return { result: { id: res.id, slug: res.slug, title: res.title } };
    }
    if (name === "search") {
      const res = await search(
        db,
        {
          scopePath,
          query: args.query,
          kinds: Array.isArray(args.kinds) ? args.kinds : undefined,
          limit: args.limit,
          mode: args.mode,
        },
        actorPrincipalId
      );
      return { result: res };
    }
    if (name === "recall_memory") {
      const res = await recallMemory(db, { scopePath, query: args.query, limit: args.limit }, actorPrincipalId);
      return { result: res };
    }
    return { error: `Unknown tool: ${name}` };
  } catch (e) {
    return { error: formatError(e) };
  }
}

export async function runTurn(
  db: DB,
  input: RunTurnInput,
  actorPrincipalId: string,
  llm: LLMConfig,
  planeClient?: PlaneClient | null
): Promise<RunTurnResult> {
  const { conversationId: existingConv, userMessage, model = "analysis" } = input;

  const { conversationId, scopePath } = await getOrCreateConversation(
    db,
    { conversationId: existingConv, scopePath: input.scopePath, userMessage },
    actorPrincipalId
  );

  // Prefetch context for system
  let contextMd = "";
  try {
    contextMd = await getContextBundle(db, scopePath, actorPrincipalId);
    if (scopePath === "root") {
      const criticalFacts = await getRootCriticalFacts(db);
      if (criticalFacts) {
        contextMd = `${contextMd}\n\n## Root critical facts\n\n${criticalFacts}`;
      }
    }
  } catch {
    contextMd = "(context unavailable)";
  }

  const systemPrompt = `You are the CompanyOS resident agent — always-on OS copilot.
Scope: ${scopePath}
You have full access to the scope's data via tools (same as the signed-in user).

Current context:
${contextMd}

Rules:
- Use tools to fetch live data (metrics, tasks, records, docs, dashboards, search, and scoped memory).
- Durable outcomes (changes, decisions, reports) MUST be logged via log_change / log_decision / save_report / save_doc — do not rely on chat history for records.
- Be concise and factual. Report tool results clearly.
- If a write tool fails with access error, surface the error gracefully to the user.
- Stop after at most 8 tool rounds.

Available tools: get_context, list_records, log_change, log_decision, save_report, list_tasks, create_task, complete_task, query_metrics, list_metric_names, get_dashboard, save_dashboard, list_widget_types, list_docs, get_doc, save_doc, search, recall_memory.`;

  // Load prior + add current user turn
  const history = await loadHistory(db, conversationId);
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  // Persist the incoming user message
  await persistMessage(db, conversationId, "user", { text: userMessage });

  const toolTrace: Array<{ name: string; args: any; result?: any; error?: string }> = [];
  const citations: Citation[] = [];
  const seenCitations = new Set<string>();
  let iterations = 0;
  let finalText = "";
  let lastUsage: any = {};
  let finalPersisted = false;

  const MAX_ITERS = 8;

  while (iterations < MAX_ITERS) {
    iterations += 1;
    const resp = await callLiteLLM(messages, ALL_TOOLS, model, llm);
    const msg = resp.choices?.[0]?.message || {};
    const usage = resp.usage || {};
    lastUsage = usage;

    if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // persist assistant tool_calls turn
      await persistMessage(db, conversationId, "assistant", {
        text: msg.content || null,
        tool_calls: msg.tool_calls,
      }, model);

      messages.push({
        role: "assistant",
        content: msg.content || "",
        tool_calls: msg.tool_calls,
      });

      for (const tc of msg.tool_calls) {
        const name = tc.function?.name;
        let args: any = {};
        try {
          args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = {};
        }
        toolTrace.push({ name, args });
        const toolRes = await executeToolCall(name, args, db, scopePath, actorPrincipalId, planeClient);
        const traceEntry = toolTrace[toolTrace.length - 1]!;
        if (toolRes.error) traceEntry.error = toolRes.error;
        else {
          traceEntry.result = toolRes.result ?? toolRes;
          collectCitationsFromToolResult(name, toolRes.result ?? toolRes, citations, seenCitations);
        }
        // persist tool result
        await persistMessage(db, conversationId, "tool", {
          tool_call_id: tc.id,
          name,
          result: toolRes,
        }, model);

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(toolRes),
        });
      }
      continue;
    }

    // final text
    finalText = msg.content || "";
    await persistMessage(
      db,
      conversationId,
      "assistant",
      citations.length > 0 ? { text: finalText, citations } : { text: finalText },
      model
    );
    finalPersisted = true;
    break;
  }

  if (!finalText && iterations >= MAX_ITERS) {
    finalText = "(max iterations reached)";
  }
  if (finalText && !finalPersisted) {
    await persistMessage(
      db,
      conversationId,
      "assistant",
      citations.length > 0 ? { text: finalText, citations } : { text: finalText },
      model
    );
  }

  // Emit event
  await emitEvent(db, {
    type: "agent.turn_completed",
    scopePath,
    principalId: actorPrincipalId,
    payload: {
      model,
      toolCallCount: toolTrace.length,
      citationCount: citations.length,
      usage: {
        promptTokens: (lastUsage as any).prompt_tokens ?? null,
        completionTokens: (lastUsage as any).completion_tokens ?? null,
        totalTokens: (lastUsage as any).total_tokens ?? null,
      },
    },
  });

  return { finalText, toolTrace, conversationId, citations };
}

export interface ListConversationsInput {
  scopePath: string;
}

export async function listConversations(
  db: DB,
  input: ListConversationsInput,
  actorPrincipalId: string
): Promise<Array<{ id: string; title: string; createdAt: Date }>> {
  const scope = await getScope(db, input.scopePath);
  if (!scope) return [];
  await requireAccess(db, actorPrincipalId, input.scopePath, "viewer");

  const rows = (await db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      createdAt: agentConversations.createdAt,
    })
    .from(agentConversations)
    .where(eq(agentConversations.scopeId, scope.id))
    .orderBy(desc(agentConversations.createdAt))
    .limit(50)) as Array<{ id: string; title: string; createdAt: Date }>;
  return rows;
}

export interface GetMessagesInput {
  conversationId: string;
}

export async function getConversationMessages(
  db: DB,
  input: GetMessagesInput,
  actorPrincipalId: string
): Promise<AgentMessage[]> {
  const [conv] = (await db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.id, input.conversationId))
    .limit(1)) as AgentConversation[];
  if (!conv) return [];
  // access via scope
  const [sc] = (await db
    .select({ path: scopes.path })
    .from(scopes)
    .where(eq(scopes.id, conv.scopeId))
    .limit(1)) as { path: string | null }[];
  const sp = sc?.path;
  if (sp) await requireAccess(db, actorPrincipalId, sp, "viewer");

  const rows = (await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, input.conversationId))
    .orderBy(agentMessages.createdAt)) as AgentMessage[];
  return rows;
}
