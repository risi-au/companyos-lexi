# M7-03 Pre-implementation Analysis

1. Minimum useful v1 events:
   - One `usage_events` row per remote MCP JSON-RPC request at `/api/mcp`, with authenticated principal, token id when known, operation/tool name, inferred scope/session ids from safe argument keys, latency, success, byte counts, and estimated tokens.
   - Additional usage rows for `get_context` section totals and `search` result/snippet totals, because those are the most likely CompanyOS-controlled context bloat sources.
   - Managed `AGENTS.md` rendering exposes an estimate so provisioning tests can catch template growth.
   - Deferred: full spend attribution charts, source document ranking beyond section/search metadata, LiteLLM cost reconciliation, weekly scheduled digests, and stdio logging by default.

2. Token estimate method:
   - v1 uses a provider-agnostic heuristic: UTF-8 bytes and rough token counts from mixed word/punctuation/chunk segmentation, capped at at least `ceil(bytes / 4)`.
   - Expected error is roughly +/-20-40% for English markdown and JSON payloads, worse for code-heavy or non-English text. It is explicitly not billing-grade.
   - UI/API labels use `estimated*` fields and show actual model token/cost columns only when supplied by a caller or provider integration.

3. Safe metadata:
   - Store operation, source, principal/token/session/connection ids, scope id, engine/model strings, counts, booleans, status/error class, section names, section token totals, result counts, snippet budget, and request method.
   - Do not store raw prompts, raw responses, markdown bodies, search queries, bearer tokens, plaintext secrets, or full JSON-RPC payloads.
   - Request metadata is compact and shape-only, e.g. argument keys and counts, never values except whitelisted ids/scope paths needed for joins.

4. Logging isolation:
   - All usage writes are wrapped in `try/catch` and run after the underlying operation has a response or error response.
   - A usage logging failure is written to stderr only when debug logging is enabled and never changes the MCP response status/body.

5. Context profile knobs:
   - Highest leverage: recent record count/preview chars, wiki index depth/result count, child count, task count, search result limit/snippet word budget, skill inclusion, workbench section inclusion, and optional section toggles.
   - v1 implements conservative `lean`, `standard`, and `deep` presets in extensible jsonb `config`; `lean` measurably reduces `get_context` output by lowering records, wiki docs, children, and optional sections.
