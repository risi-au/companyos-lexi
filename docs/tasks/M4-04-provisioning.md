# M4-04: Provisioning automation (provision_scope v1)
status: done
module: provisioning (packages/api) + workbenches schema (packages/db)
branch: task/M4-04

## Goal
The deterministic 80% of onboarding (DESIGN.md §2.12) exists as one idempotent call: `provisionScope(spec)` ensures scopes, module instances, an agent principal + token, Plane workspace adoption, a GitHub repo skeleton with OS-generated AGENTS.md files, and returns a checklist of the manual steps it could not do (create Plane workspace, register Plane webhook, create GitHub org). Exposed as the admin-gated `provision_scope` MCP tool. "Add SEO to indya" is the same call as onboarding a new client.

## Context
- DESIGN.md §2.8 (workbenches, MD generation between markers), §2.12 (onboarding split), §5 (`workbenches` table), §6 (`provision_scope` admin-gated MCP tool), "Structure ratification" §2/§4 (repo per project, org per instance, org creation manual).
- Existing building blocks to call, not reimplement: `createScope`/`getScope`/`getSubtree` (packages/api/src/kernel/scopes.ts), `grantRole`/`requireAccess` (kernel/grants.ts), `issueToken` (kernel/tokens.ts), `emitEvent` (kernel/events.ts), `setProjectWorkspace` + `PlaneClient` (modules/tasks). Follow `PlaneClient` (modules/tasks/plane-client.ts) as the pattern for an injectable-fetch HTTP client.
- M4-03 deferred per-workspace Plane webhook registration to this task (see modules/tasks/AGENTS.md "Webhook registration is per Plane workspace and manual for now"). The OS webhook receiver already exists at `/api/v1/webhooks/plane` (apps/os/src/app/api/v1/webhooks/plane/route.ts, secret env `PLANE_WEBHOOK_SECRET`).
- Migration journal note: the fake-future-timestamp problem is fixed on main (commit 0bb9849). Generate migration 0011 with `pnpm --filter @companyos/db db:generate` normally; do NOT hand-edit `drizzle/meta/_journal.json`.

## Do

1. **Schema (packages/db):** new module table `workbenches` in `src/schema/workbenches.ts`, exported from `src/schema/index.ts`:
   - `id` uuid pk, `scopeId` uuid not null → scopes.id (cascade), unique
   - `repo` text not null (repo name within the org, e.g. `indya`), `path` text not null default `""` (folder within the repo; `""` = repo root)
   - `createdAt`/`updatedAt` timestamptz defaults
   - Generate migration 0011 via drizzle-kit.
2. **GitHubClient (packages/api/src/modules/provisioning/github-client.ts):** REST v3 client mirroring PlaneClient's shape — `GitHubConfig { baseUrl (default https://api.github.com), token, org, fetch?: FetchLike }`. Methods (all org-relative):
   - `getRepo(repo)` → repo | null (404 → null)
   - `createRepo(repo, { private: true })` → POST /orgs/{org}/repos; a 404 here means the org doesn't exist — surface as a typed `OrgNotFoundError` so provisioning can convert it to a manual step
   - `getFile(repo, path)` → { sha, contentUtf8 } | null (contents API, base64 decode)
   - `putFile(repo, path, contentUtf8, message)` → PUT contents; pass the existing sha when updating; **skip the write entirely if existing content is byte-identical** (idempotency)
   - No callsite outside this client builds GitHub URLs.
3. **AGENTS.md generation (provisioning/agents-md.ts):** `renderManagedSection(input)` + `applyManagedSection(existingContent | null, section)`.
   - Managed block delimited by exactly `<!-- companyos:managed:start -->` / `<!-- companyos:managed:end -->`.
   - Section contains: scope path (the scope key), OS MCP/HTTP endpoint hint (from env `COMPANYOS_URL`, default `http://localhost:3000`), the token env var name the agent should use (`COMPANYOS_TOKEN`), and the scope's direct children as a folder map.
   - `applyManagedSection` replaces only the block if markers exist, appends the block to existing content otherwise, or produces a fresh file (heading + block) when the file doesn't exist. Human content outside the markers must survive regeneration byte-for-byte.
4. **provisionScope (provisioning/service.ts):**
   ```ts
   interface ProvisionSpec {
     scopePath: string;                      // target scope; may be nested ("indya/marketing/seo")
     name?: string;                          // display name for the target scope if it must be created
     subprojects?: { slug: string; name: string }[];  // direct children to ensure under the target
     modules?: string[];                     // module types to ensure on the target scope
     agent?: { name: string; tokenName?: string };    // ensure agent principal + grant + token
     planeWorkspaceSlug?: string;            // adopt Plane workspace (top-level target only)
     workbench?: { repo?: string };          // ensure GitHub repo + skeleton; repo defaults to project slug
   }
   provisionScope(db, deps: { plane: PlaneClient; github: GitHubClient | null }, spec: ProvisionSpec, actorPrincipalId: string): Promise<ProvisionResult>
   ```
   - **Auth:** `requireAccess(..., "admin")` on the target's top-level project if it exists, else on root (creating a new project needs root admin).
   - **Idempotent steps, each reported in the result as `created` | `existing` | `skipped` | `manual`:**
     a. Ensure every missing segment of `scopePath` exists (`project` for the first segment, `subproject` below; `name` applies to the target, missing intermediates title-case their slug). Then ensure `subprojects`.
     b. Ensure `module_instances` rows for `modules` on the target scope (unique(scope, module_type) already guards duplicates — insert only what's missing).
     c. If `agent` given: find agent principal by exact name or create it, grant `agent` role on the top-level project (no-op if granted), issue a token **only if the principal has no token yet** (list by principalId); return the plaintext token in the result once, flagged `storeNow: true`.
     d. If `planeWorkspaceSlug` given: call `setProjectWorkspace` (top-level target only; reject otherwise). If not given and the project has no registered workspace, add manual step "create a Plane workspace in the UI, then re-run with planeWorkspaceSlug".
     e. **Plane webhook (the M4-03 deferral):** if the project has a registered workspace and env `PLANE_WEBHOOK_URL` is set, ensure a webhook exists in that workspace via new PlaneClient methods `listWebhooks()` / `createWebhook({ url, secret })` (`/api/v1/workspaces/{slug}/webhooks/`; secret from `PLANE_WEBHOOK_SECRET`). Match by URL for idempotency. If Plane CE answers 404/405 (endpoint may not exist in CE, same class of gap as workspace creation — M4-03 brief §Hard constraint), degrade to manual step "register webhook {url} in Plane workspace settings". Never fail the whole provision over the webhook.
     f. If `workbench` given and `github` dep is non-null: ensure the repo exists (create private if missing; `OrgNotFoundError` → manual step "create GitHub org {org} manually"), ensure a `workbenches` row for the target scope (repo, path = scope path below the project, `""` for the project itself) and for each ensured subproject, and put/refresh AGENTS.md at the repo root and in each subproject folder via `applyManagedSection` (read existing file first; commit message `companyos: sync managed AGENTS.md`). If `github` is null (no `GITHUB_TOKEN` configured), every workbench step degrades to `manual`.
   - Emit one summary event `provisioning.scope_provisioned` with the step outcomes in the payload (sub-services already emit their own events).
   - Export `provisionScope`, `GitHubClient`, types from packages/api index.
5. **MCP tool (packages/mcp/src/server.ts):** register `provision_scope` following the existing tool pattern; input mirrors ProvisionSpec; construct GitHubClient from env (`GITHUB_TOKEN`, `GITHUB_ORG`, optional `GITHUB_API_URL`) or pass null when unset; return the ProvisionResult JSON. Admin gating stays in the service (like every other tool).
6. **Env:** add `GITHUB_TOKEN`, `GITHUB_ORG`, `PLANE_WEBHOOK_URL`, `COMPANYOS_URL` to `.env.example` with comments (PLANE_WEBHOOK_SECRET is already there — verify, add if not).
7. **Docs:** new `packages/api/src/modules/provisioning/AGENTS.md` (module contract, spec/result shapes, idempotency + manual-step semantics). Update `packages/api/src/modules/tasks/AGENTS.md`: webhook registration is now attempted by provisioning with manual fallback. Update tasks module AGENTS.md only in those lines; same commit.
8. **Tests (provisioning/provisioning.test.ts):** mock fetch for GitHub (in-memory repo/file store) + reuse/extend the workspace-aware mock Plane from tasks tests. Cover:
   - fresh provision of a new project with subprojects, modules, agent, workspace, workbench → all steps `created`, token returned, AGENTS.md files written with markers
   - **second identical run → every step `existing`/`skipped`, zero GitHub writes (assert via mock write counter), no duplicate module_instances/grants/tokens**
   - AGENTS.md regen preserves human content outside markers
   - nested `scopePath` on an existing project ("add SEO to indya"): creates only the missing chain, requires project admin (root admin not needed)
   - non-admin actor rejected; `planeWorkspaceSlug` on nested target rejected
   - org missing → manual step, provision still succeeds; webhook endpoint 404 → manual step, provision still succeeds; `github: null` → workbench steps manual
   - MCP: `provision_scope` happy path in ping.test.ts style (or a focused test) with mocked deps

## Don't
- No UI. No n8n/capabilities registry (M4-05), no skills sync (M4-06), no drift detection between repo and registry (later M4 task).
- Don't create GitHub orgs or Plane workspaces — adopt/report only (DESIGN ratification §3/§4).
- Don't touch kernel schema beyond adding the `workbenches` table; don't modify existing task_links columns or tasks service behavior other than the two additive PlaneClient webhook methods.
- Don't hand-edit `drizzle/meta/_journal.json` (root cause fixed on main).
- Never store the plaintext agent token anywhere server-side; it appears once in the ProvisionResult.

## Acceptance criteria
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root; migration 0011 applies via `pnpm --filter @companyos/db db:migrate` with no journal edits (verified by architect, journal root fix 0bb9849 proven live)
- [x] Running the same ProvisionSpec twice is a no-op the second time (asserted in tests, including zero GitHub file writes)
- [x] AGENTS.md managed-marker regeneration preserves human-authored content
- [x] Manual steps are reported (not thrown) for: missing GitHub org, missing Plane workspace, unavailable webhook API, unset GITHUB_TOKEN
- [x] `provision_scope` MCP tool works end-to-end against mocked deps in tests
- [x] Architect live check post-merge (2026-07-03): provisioned `provision-livetest` against real org `Brissie-Digital-PTY-LTD` — private repo created, root + `alpha/` AGENTS.md synced with managed markers, workbench rows written, Plane workspace correctly reported as a manual step, second run fully idempotent. (Fine-grained PAT needs Administration + Contents read/write, resource owner = the org.)
