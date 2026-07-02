# M3-04: Resident agent (chat + tools + model picker)
status: todo
module: agent (apps/os + packages/api)
branch: task/M3-04

## Goal
The always-on OS agent: a chat panel available on every scope, backed by LiteLLM, with the OS's own capabilities as tools (context, records, tasks, metrics, dashboards, docs). The guaranteed-connected surface and universal inbox from DESIGN §2 item 14. Closes M3.

## Context
- LiteLLM gateway is live at `LITELLM_BASE_URL` (default http://localhost:4000) with `LITELLM_MASTER_KEY`; model aliases: `cheap`, `analysis`, `reasoning`, `code`. OpenAI-compatible `/v1/chat/completions` with standard tool-calling. **Chat with the gateway over plain fetch (OpenAI wire format) — no vendor SDK.**
- The agent loop lives server-side in `packages/api/src/modules/agent/`: it is a **tool-use loop**, not a single completion: send messages+tools → if tool_calls, execute against our own services as the session principal → append results → repeat (max 8 iterations) → final text.
- Tools = a curated subset mapped to existing services (do NOT spawn MCP; call services directly): `get_context`, `list_records`/`log_change`/`log_decision`/`save_report`, `list_tasks`/`create_task`/`complete_task`, `query_metrics`/`list_metric_names`, `get_dashboard`/`save_dashboard`/`list_widget_types`, `list_docs`/`get_doc`/`save_doc`. Reuse zod schemas → JSON schema (zod-to-json-schema).
- Permissions: the loop runs as the signed-in principal — services enforce grants; the agent can do exactly what the human can.
- Conversations: persisted per scope (`agent_conversations`: id, scope_id, title, created_by, created_at; `agent_messages`: id, conversation_id, role (user|assistant|tool), content jsonb, model, created_at). Continuity = re-reading the conversation, durable knowledge goes to records/docs — chat history is NOT the record store (DESIGN principle).
- Streaming: v1 may respond non-streaming (simplest robust path); UI shows a working indicator with tool-call trace ("→ query_metrics(airbuddy, meta.spend)…"). Streaming upgrade later.

## Do
1. Schema (above two tables) + migration.
2. `packages/api/src/modules/agent/service.ts`: `runTurn(db, {conversationId|new+scopePath, userMessage, model (alias, default 'analysis')}, actor)` → executes the tool loop against LiteLLM (base/key from params injected by caller — env only at the app boundary), persists messages incl. tool calls/results, emits `agent.turn_completed` (payload: model, tool call count, token usage from response). Returns final text + tool trace. System prompt: concise OS-agent identity, current scope context (auto-prefetched via get_context service), tool usage guidance, "durable outcomes belong in records/docs, not chat".
3. Chat UI: right-side sheet/panel toggleable from any scope page header ("Ask OS" button): conversation list per scope + thread view, message input, **model picker** (cheap/analysis/reasoning/code), tool-call trace rendered as collapsed chips, markdown rendering for replies, error states (gateway down → clear message). Server actions → service.
4. HTTP: `POST /api/v1/agent/turn` (bearer) so external surfaces can use the same resident agent later.
5. Tests: tool loop with a **mocked LiteLLM** (fixture returning tool_calls then final): executes tools, persists messages, respects max iterations, denies tools per grants (viewer principal → write tool returns access error into the loop, agent reports it gracefully), events emitted. Zod→JSON-schema conversion sanity test.

## Don't
- No streaming yet. No file uploads. No memory beyond conversation persistence. No MCP client inside the loop.
- Don't touch other modules' schemas, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Mocked-gateway loop test: multi-tool turn persists user/assistant/tool messages and returns final text
- [ ] Architect live-verifies against real LiteLLM/Kimi: asks the agent on /s/airbuddy "how did meta spend trend last week vs revenue?" → it calls query_metrics and answers with real numbers; and "log a decision that we tested the resident agent" → decision record appears
- [ ] Model picker switches aliases (verified live); viewer-role safety test passes
- [ ] Events emitted with usage payload
