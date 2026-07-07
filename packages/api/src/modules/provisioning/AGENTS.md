# packages/api/src/modules/provisioning - AGENTS.md

Provisioning module (M4-04): deterministic onboarding through `provisionScope` and the admin-gated MCP tool `provision_scope`.

## Purpose
Create or refresh the deterministic part of onboarding in one idempotent call: scopes, module instances, optional agent principal and token, Plane workspace adoption/webhook attempt, and optional GitHub workbench skeleton.

Manual steps are returned instead of thrown when an external system cannot automate the action, such as creating a GitHub org or Plane workspace.

## Contract
`provisionScope(db, { plane, github }, spec, actorPrincipalId)` accepts `ProvisionSpec` with `scopePath`, optional `name`, `subprojects`, `modules`, `agent`, `planeWorkspaceSlug`, and `workbench`.

Returns `scopePath`, `topLevelScopePath`, `steps`, `manual`, and optional `agentToken` with plaintext token and `storeNow: true`. Never store plaintext server-side.

## Idempotency
Running the same spec twice should produce only `existing` or `skipped` outcomes for already-provisioned resources. Shared `GitHubClient.putFile` reads current content first and skips byte-identical writes.

Managed `AGENTS.md` regeneration replaces only the block between `<!-- companyos:managed:start -->` and `<!-- companyos:managed:end -->`. Human content outside those markers must survive byte-for-byte. `estimateManagedSection` returns the rendered markdown with byte and estimated-token counts so template growth can be tested without storing rendered secrets.

The managed block is an operational playbook. It includes the scope path, CompanyOS HTTP endpoint, `MCP_PUBLIC_URL`, token env var name only, session-start checks (`whoami`, `get_context`, `recall_memory` before external research or broad record trawling, stop on MCP/auth failure), folder guard instructions, session-end handover (`log_change`, `complete_session`, `complete_task`, `log_decision`, wiki `save_doc` updates when standing truth changes), the git worktree naming convention, the child folder map, and the memory precedence policy that makes CompanyOS authoritative over vendor memory. Handover instructions tell agents to include PR URLs, PR numbers, and commit SHAs in `log_change` / `complete_session` so GitHub webhook ingestion can suppress fallback stubs.

## Tables
- `workbenches` in `packages/db`: `scope_id` unique, `repo`, `path`, timestamps.
- Existing kernel tables used: `scopes`, `module_instances`, `principals`, `grants`, `tokens`, `events`.
- Existing tasks table used: `task_links` for registered Plane workspace lookup.

## Files
- `../../lib/github-client.ts` - shared injectable GitHub REST v3 client; no callsite builds GitHub URLs.
- `agents-md.ts` - managed block renderer, token estimate helper, and marker-preserving updater.
- `service.ts` - orchestration service.
- `provisioning.test.ts` - PGlite service tests.

## How To Test
From repo root:
- `pnpm --filter @companyos/api test`
- `pnpm --filter @companyos/mcp test`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

Tests use mocked Plane and GitHub clients. No live GitHub or Plane calls in tests.

## Do Not
- Do not create GitHub orgs or Plane workspaces.
- Do not log or persist plaintext tokens.
- Do not hand-build GitHub URLs outside `GitHubClient`.
- Do not make provisioning depend on UI-only behavior.
