# M7-03: Token/context observability and tuning console

status: done — implemented 2026-07-07 by codex (scaled-down v1 per the analysis gate;
review passed with one architect-applied isolation fix in mcp http logging — see
.review.md + docs/tasks/M7-03-analysis.md). usage_events + context_profiles (migration
0017), MCP HTTP instrumentation, get_context/search/AGENTS.md estimates, admin usage
dashboard in /admin/mcp, query_usage/get_context_profile/set_context_profile tools.
Gates green (246 tests). Staging env knobs USAGE_LOG_MCP_HTTP / USAGE_SAMPLE_RATE
documented in review notes; deploy pending origin push.
module: packages/api (new module `usage`) + packages/mcp + apps/os admin
branch: task/M7-03

## Goal

Admins can see and tune the real token/context overhead of CompanyOS-driven agent work:
how much `AGENTS.md`, `get_context`, `search`, wiki surfacing, session lifecycle calls,
and write-back rituals cost by scope, tool, principal, model/engine, and session. The OS
should make the agent workflow cheaper and sharper over time without relying on guesswork.

## Context

- DESIGN.md already calls for tenant admin observability: API usage + token spend by
  scope/capability/model/principal, and admin-gated `query_usage`.
- M6-01: all remote MCP traffic flows through `/api/mcp` with per-request auth, so the OS
  can record tool name, principal, token, request timing, response size, and failures at
  the transport boundary.
- M6-04/M6-09: `get_context` gains workbench + wiki/search surfacing. This is the highest
  risk area for context bloat and needs measurement.
- M6-05: managed AGENTS.md becomes a session playbook. Its rendered size should be
  measurable so template changes do not silently tax every session.
- M6-07: sessions provide the join key for "this Grok/Claude/Codex run consumed this much
  CompanyOS context overhead".
- LiteLLM already tracks model-provider spend for OS-managed API calls, but vendor
  subscription tools may not report model tokens back. This task measures CompanyOS MCP
  overhead reliably and accepts partial model-cost data when clients provide it.

## Pre-implementation analysis gate

Do not blindly implement this brief as a giant analytics system. Before coding, write a
short analysis note in the PR/commit body covering:

1. The minimum useful usage events for v1, and which metrics can be deferred.
2. How token estimates are calculated, their expected error bounds, and how the UI labels
   estimated vs actual values.
3. What metadata is safe to store without leaking prompts, client secrets, or private
   document contents.
4. How logging failure is isolated from the MCP request path.
5. Which context-profile knobs are likely to reduce real token use without making agents
   worse.

If the analysis shows a simpler v1 would answer the tuning questions, build that smaller
version. If the implementation needs raw prompt/response storage, stop and ask for an
amended privacy design instead.

## Do

1. **Schema** (`packages/db`, new `usage.ts` + migration)
   - `usage_events`: id, scope_id nullable, principal_id, token_id nullable,
     session_id nullable, connection_id nullable, source, engine nullable, model nullable,
     operation, input_tokens_est nullable, output_tokens_est nullable,
     total_tokens_est nullable, actual_input_tokens nullable, actual_output_tokens nullable,
     actual_cost_usd nullable, byte_in, byte_out, latency_ms, success, error_code nullable,
     metadata jsonb, created_at.
   - `context_profiles`: id, scope_id nullable, name, config jsonb, is_default,
     created_by, created_at, updated_at. Profiles control caps such as recent-record count,
     wiki index depth, task count, search result limit, and whether to include optional
     sections.
2. **Counting strategy**
   - Add a lightweight tokenizer/estimator utility with provider-agnostic defaults.
   - Count exact bytes for every MCP request/response.
   - Estimate tokens for MCP payloads and rendered markdown. Exact provider token counts
     are optional and accepted when available from LiteLLM/client metadata.
   - Never store full prompts, full responses, bearer tokens, or sensitive payload bodies
     in `usage_events`.
3. **MCP instrumentation**
   - At the HTTP transport boundary, log one `usage_event` per MCP tool call:
     tool name, authenticated principal/token, inferred scope if the tool has one,
     linked session id when provided or inferable, latency, success/error, byte counts,
     token estimates, and compact metadata.
   - Instrument stdio only when explicitly enabled by env for local/dev measurement.
   - Add opt-out/env sampling knobs for noisy development environments; production default
     logs all remote MCP calls.
4. **Context instrumentation**
   - `get_context` emits section-level measurements: identity, workbench, tasks, recent
     records, wiki/knowledge, skills, modules, etc.
   - Managed `AGENTS.md` rendering exposes/reportable token estimate for the managed block.
   - `search` logs result count, snippet budget, and estimated returned tokens.
5. **Admin console** (`apps/os`, inside `/admin`)
   - Usage dashboard with filters: date range, scope subtree, principal/token/connection,
     session, tool/operation, engine/model, success/error.
   - Charts/tables:
     - MCP calls by tool and scope.
     - Estimated CompanyOS context tokens by session.
     - `get_context` section breakdown over time.
     - Top bloated scopes/docs/sections.
     - Error/401/revocation/rate-limit trends.
     - Estimated vs actual model tokens where actual data exists.
   - Drill-down from a session row to its usage events and from a connection row to its
     token overhead.
6. **Tuning controls**
   - Admin-editable context profiles, at root and optionally overridden per scope subtree.
   - Default profile stays conservative: small recent-record cap, wiki index titles only,
     no full docs unless explicitly requested by a tool.
   - Safe presets: `lean`, `standard`, `deep`. Show estimated token impact before saving.
   - Every profile change emits `usage.profile_updated`.
7. **MCP/admin tools**
   - Add admin-gated `query_usage({ scope?, since?, group_by?, operation?, session_id? })`.
   - Add admin-gated `get_context_profile(scope)` and `set_context_profile(...)`.
   - Tools must require admin on the requested scope/root as appropriate.
8. **Feedback loop**
   - Weekly admin view highlights recommended trims, e.g. "wiki index contributes 42% of
     get_context tokens on airbuddy; consider lowering depth" or "search snippets are
     routinely capped".
   - Recommendations are deterministic heuristics in v1, not an LLM requirement.

## Don't

- Don't store raw prompt/response bodies or plaintext tokens.
- Don't make token estimates a billing system of record; mark estimated vs actual clearly.
- Don't block MCP calls if usage logging fails; log failure internally and continue.
- Don't add provider-specific tokenizer dependencies unless they are lightweight and
  optional.
- Don't put tuning controls in generated AGENTS.md; AGENTS.md describes behavior, admin
  profiles control budgets.
- Don't change existing MCP tool signatures except additive optional metadata/session
  fields if absolutely needed for linking.

## Acceptance criteria

- [ ] Remote MCP tool calls create `usage_events` with principal/token, operation, success,
      latency, byte counts, and token estimates
- [ ] `get_context` records section-level token estimates and total returned estimate
- [ ] Managed AGENTS.md block has a test-covered token estimate/reporting path
- [ ] No usage row contains bearer tokens, plaintext secrets, or raw full prompt/response
      bodies
- [ ] Admin dashboard filters by scope subtree, principal/connection, session, operation,
      and date range
- [ ] Session drill-down shows CompanyOS MCP/context overhead for that session
- [ ] Context profiles can be created/updated at root and overridden per scope, with events
      emitted and access checks enforced
- [ ] `lean` profile measurably reduces `get_context` returned token estimate in tests
- [ ] `query_usage` MCP tool is admin-gated and returns grouped summaries without leaking
      cross-client data
- [ ] Logging failure does not fail the underlying MCP tool call
