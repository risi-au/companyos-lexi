# packages/api/src/modules/usage - AGENTS.md

Usage module (M7-03): privacy-preserving observability for CompanyOS MCP/context overhead and admin-controlled context profiles.

## Purpose
- Persist `usage_events` rows for remote MCP calls, `get_context` section totals, search result/snippet totals, and future model-provider actual token/cost data.
- Provide admin-gated summaries through `queryUsage`.
- Store context profile presets/config so admins can tune context size at root or per subtree.

## Tables
- `usage_events`: ids for scope/principal/token/session/connection, source, engine/model, operation, estimated/actual token fields, byte counts, latency, success/error, compact metadata, created_at.
- `context_profiles`: scope-owned named jsonb config, default flag, creator, timestamps.

## Contract
- `logUsageEvent` writes one redacted row. `logUsageEventSafely` must be used on request paths where observability failure must not break the underlying operation.
- Metadata is shape/count/id only. Never store raw prompts, raw responses, markdown/document bodies, search queries, bearer tokens, plaintext secrets, or full JSON-RPC payloads.
- `queryUsage`, `getContextProfile`, and `setContextProfile` require `admin` on the requested scope.
- `setContextProfile` emits `usage.profile_updated` for every create/update.
- Token estimates are approximate, provider-agnostic, and labelled as estimated by API/UI callers. They are not billing-grade.

## Files
- `service.ts`
- `usage.test.ts`
- DB schema: `packages/db/src/schema/usage.ts`
- Migration: `packages/db/drizzle/0017_usage_observability.sql`

## How to test
- `npx.cmd vitest run packages/api/src/modules/usage/usage.test.ts`
- Context integration is covered from `agent.test.ts` / MCP tests when touched.

## Do / Don't
- Do keep schema extensible with jsonb config/metadata.
- Do wrap non-critical logging with `logUsageEventSafely`.
- Do not persist raw agent/client payloads, plaintext tokens, prompts, responses, or markdown bodies.
- Do not turn estimates into billing records without an amended design.
