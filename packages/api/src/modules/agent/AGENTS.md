# packages/api/src/modules/agent — AGENTS.md

Resident agent module (M3-04): server-side tool-use loop over LiteLLM (plain OpenAI wire via fetch) with OS services as tools. Persisted conversations + messages per scope. Emits agent.turn_completed. UI + HTTP surface for every scope. All tests use injected LLM fixture (no live, no .env reads in tests).

## Purpose
Always-on chat agent reachable from any scope ("Ask OS"). Tool loop executes against our services (context, records, tasks, metrics, dashboards, docs) using the caller's grants. Durable writes go through records/docs. Chat is session UI surface, not the source of truth.

## Tables (in packages/db)
- `agent_conversations`
  - id (uuid pk), scope_id (fk cascade), title (text), created_by (fk), created_at
  - idx: agent_conversations_scope_created_idx
- `agent_messages`
  - id, conversation_id (fk cascade), role (enum: user|assistant|tool), content (jsonb), model (text alias), created_at
  - idx: agent_messages_conv_created_idx
- Exports: agentConversations, agentMessages, AgentConversation, AgentMessage, New*, agentMessageRoleEnum

## Contract / Functions (re-exported from @companyos/api)
All take db first + actor for authz.

- `runTurn(db, {conversationId?, scopePath?, userMessage, model?}, actor, llmConfig: {baseUrl, apiKey}, planeClient?)`: executes up to 8-iter tool loop. Persists user+assistant+tool messages. Auto-creates conv if needed (title from msg). Prefetches get_context for system. Returns {finalText, toolTrace, conversationId}. Emits `agent.turn_completed` {model, toolCallCount, usage}.
- `listConversations(db, {scopePath}, actor)`: viewer. Returns recent [{id,title,createdAt}]
- `getConversationMessages(db, {conversationId}, actor)`: viewer. Returns full AgentMessage[] ordered.

Model aliases passed through: "cheap" | "analysis" | "reasoning" | "code" (default analysis).

Tools (curated, zod->jsonSchema):
get_context, list_records, log_change/log_decision/save_report (via createRecord), list_tasks/create_task/complete_task (plane injected), query_metrics/list_metric_names, get_dashboard/save_dashboard/list_widget_types, list_docs/get_doc/save_doc.

Access: services enforce via requireAccess (viewer read, editor for writes). Tool errors (e.g. access denied) are returned into the loop as tool results; agent reports gracefully.

LLM: plain fetch to ${base}/v1/chat/completions. No SDK. Config injected by boundary (env at HTTP/server-action; mock fixture in tests).

System prompt: concise identity + scope context + durable-in-records rule. Prefetched context may include nearest workbench repo/folder and MCP public URL when the boundary injects it.

Streaming: not in v1.

## Files
- `src/modules/agent/service.ts`
- `src/modules/agent/AGENTS.md`
- `src/modules/agent` (tests co-located or top-level agent.test.ts extensions)
- Schema + migration added in db (agent.ts + 0008)
- Updated: `packages/db/src/schema/index.ts`, `packages/api/src/index.ts`, `packages/api/AGENTS.md`, `apps/os/src/lib/api.ts`, HTTP route, UI chat panel + "Ask OS" in scope header, apps/os/modules/agent/* (if created)

## How to test
- NEVER call live LiteLLM or read .env inside test files.
- Use mocked fixture: stub fetch or pass dummy llmConfig + vi.stubGlobal('fetch', ...) returning OpenAI-shaped {choices:[{message:{...}}], usage}
- `pnpm --filter @companyos/api test`
- `pnpm test`
- `pnpm typecheck && pnpm lint`
- Acceptance: multi-turn tool loop persists messages; events; access denial surfaces in results; model switch; list convs.

## Key behaviors
- Tool loop: send + if tool_calls execute (direct service calls, not MCP) → append tool msg → repeat.
- Conversation scoped + owned by creator; re-read history for continuity.
- Events always on turn end with usage.
- No god mode: agent == principal grants.
- Content jsonb: {text} for user/assistant; {tool_call_id, name, result} for tool.
- Max 8 iters safety.

## Do not
- No streaming, no file, no cross-module direct schema access, no MCP inside loop.
- Do not touch other modules' schemas.
- Never read .env or hit real gateway in tests (mocked fixture only).
- Update this AGENTS.md on changes.

## Usage (server)
```ts
import { runTurn, listConversations, getConversationMessages, type LLMConfig } from "@companyos/api";
const llm: LLMConfig = { baseUrl: process.env.LITELLM_BASE_URL || "http://localhost:4000", apiKey: process.env.LITELLM_MASTER_KEY || "" };
const out = await runTurn(db, { scopePath: "airbuddy", userMessage: "how did meta spend last week?" }, principal, llm, plane);
```
