# packages/api — AGENTS.md

Kernel service layer for CompanyOS. All business logic lives here. UI (apps/os), MCP (packages/mcp) and future clients consume these functions exclusively.

## Purpose
Implements the kernel: scope tree ops, grants/authz, token issuance+auth, event emission. Every write emits an event. Services are pure (injected Drizzle handle).

## Contract
- All functions: `async fn(db: DrizzleInstance, ...)` — first arg always the db handle. No module-level or global DB.
- Exports from `@companyos/api`
- Typed errors in `errors.ts`
- Role hierarchy (highest wins on ancestor walk): owner > admin > editor > viewer (agent special for subtree-only)

## Files
- `src/index.ts` — re-exports health + kernel + errors
- `src/errors.ts` — AccessDeniedError, ScopeNotFoundError, DuplicatePathError, InvalidSlugError, ParentNotFoundError, TokenNotFoundError, CapabilityNotFoundError, KernelError
- `src/kernel/`
  - `events.ts` — emitEvent, listEvents
  - `scopes.ts` — createScope (enforces project/subproject), getScope, getChildren, getSubtree, getVisibleTree, archiveScope, listModules
  - `grants.ts` — grantRole, resolveAccess, requireAccess, listGrants, revokeGrant (emits grant.revoked)
  - `auth-link.ts` — getPrincipalByEmail (for member assignment)
  - `tokens.ts` — issueToken (returns plaintext once), authenticateToken (updates lastUsedAt), revokeToken
  - `index.ts` — barrel
- `src/kernel.test.ts` — full PGlite coverage of contracts + acceptance criteria
- `src/health.test.ts` — basic

## Key behaviors (per M1-03)
- createScope: top-level (direct under root) must be "project"; nested must be "subproject". Computes path, slug `[a-z0-9-]+`. Rejects dups/missing/invalid type.
- getVisibleTree(principalId): returns only visible subtrees per grants (root grant => full; else only granted top projects + subs). No root row for limited users.
- revokeGrant: deletes grant row + emits "grant.revoked". Idempotent.
- resolveAccess: walks scope ancestors (self → root) for principal's grants, returns highest role or null.
- agent grant covers subtree only (walk-up semantics).
- Tokens: only hash stored (sha256 hex); plaintext `cos_` + base64url(32 bytes). Revoked/expired never auth.
- Every mutating service calls emitEvent (scope.created, scope.archived, grant.created, token.issued, token.revoked).
- listEvents supports scopePath (resolved to id), type, since, limit. Desc createdAt.
- listModules(scopePath, actor): requires viewer; returns attached moduleTypes + config for the scope (used by get_context).
- (M2-05/M4-05/M6-04/M6-06) Agent HTTP helpers: getContextBundle (same md as MCP; includes nearest workbench repo/folder and injected MCP public URL when available), findNearestWorkbench/verifyWorkbench (workbench resolution and cwd warning check), reportCapabilityRun (legacy event-only `capability.run_reported` fallback behind the capabilities module), findScopeByPlaneProject (reverse task link lookup for webhooks). Re-exported; used by thin routes only.
- (M3-03) Canvas: saveCanvas/getCanvas/listCanvases/archiveCanvas + size cap + events; exported for MCP/HTTP/UI.
- (M3-04) Resident agent: runTurn (tool loop over LiteLLM + services), listConversations, getConversationMessages; agent_conversations + agent_messages tables. Injected LLM config; mocked in tests. Events: agent.turn_completed.
- (M4-05) Capabilities: registerCapability/reportRun/listCapabilities/listCapabilityRuns; persisted `capabilities` + `capability_runs`; admin-gated registration, editor/agent run reporting, viewer listing. Events: capability.registered, capability.run_reported.

## How to test
From repo root:
- pnpm --filter @companyos/api test
- or full: pnpm test (vitest runs per package projects)
- pnpm typecheck
- pnpm lint

Uses PGlite + drizzle migrator (copied pattern from packages/db/src/kernel.test.ts). Migrations auto-resolved.

## Do not
- Do not add HTTP, MCP tools, UI here (M1-04+).
- Never import from other vertical modules.
- No hardcoded DB connections.
- Do not change schema (in packages/db).

## Usage example
```ts
import { createScope, grantRole, issueToken, requireAccess } from "@companyos/api";
const db = ...; // from @companyos/db or pglite
const scope = await createScope(db, { slug: "acme", name: "Acme", type: "project" }, principalId);
await grantRole(db, { principalId, scopePath: "acme", role: "owner" });
const token = await issueToken(db, { principalId, name: "agent-1" });
await requireAccess(db, principalId, "acme", "viewer");
```
