# M4-06: Skills integration (skills_index + list_skills/get_skill/sync_skills)

status: done
module: skills (new) + db + mcp
branch: task/M4-06

## Goal

The central skills repo becomes queryable through the OS: a `skills_index` table caches the
repo's `SKILL.md` files (git stays the source of truth), an admin-gated `sync_skills` MCP tool
refreshes the cache from GitHub, `list_skills(scope)` resolves which skills apply to a scope via
scope-pattern matching, `get_skill(name)` returns a skill's full body, and `get_context`'s bundle
gains a Skills section — fulfilling the DESIGN §6 promise that context includes a skills index.

## Context

- DESIGN.md §2.10 (skills principle: one central git repo, agentskills.io `SKILL.md` format,
  frontmatter declares scope pattern + domain tags), §5 line "skills_index — cache of skills
  repo: name, scope_pattern, domains, path (git = source of truth)", §6 tools
  `list_skills(scope)` / `get_skill(name)` and `get_context(...)` "+ skills index".
- Closest module pattern: `packages/api/src/modules/capabilities/` (M4-05) — service fns doing
  `requireAccess → db op → emitEvent`, typed errors in `packages/api/src/errors.ts`, colocated
  tests, module `AGENTS.md`.
- Git-sync precedent: `packages/api/src/modules/provisioning/service.ts` (`syncAgentsFile`) using
  `packages/api/src/modules/provisioning/github-client.ts` (`GitHubClient`, built from
  `GITHUB_TOKEN`/`GITHUB_ORG` via `createGitHubClientFromEnv` in `packages/mcp/src/server.ts`).
- Scope semantics: slash-delimited paths, slug segments `^[a-z0-9-]+$`, root scope's children
  carry no `root/` prefix (`packages/api/src/kernel/scopes.ts`). Grants on the root scope cover
  the whole tree. Role gate helper: `requireAccess(db, principalId, scopePath, minRole)` in
  `packages/api/src/kernel/grants.ts` (agent ranks with editor).
- Migrations are Drizzle-generated: schema in `packages/db/src/schema/`, then
  `pnpm --filter @companyos/db db:generate`. Never hand-edit `packages/db/drizzle/meta/_journal.json`.
- Tests: Vitest, colocated, DB-backed via in-memory PGlite migrated from `packages/db/drizzle`
  (see `packages/api/src/modules/capabilities/capabilities.test.ts` for the setup pattern).

## Architect decisions (do not relitigate)

1. **Body is cached.** `skills_index` stores the full `SKILL.md` markdown body (plus
   description/sha/synced_at) so `list_skills`/`get_skill` are DB-only and fast. Git remains
   the source of truth; `sync_skills` refreshes the cache.
2. **Gating:** `sync_skills` = **admin on the root scope** (global operation; resolve the scope
   row with `type = 'root'` and `requireAccess(..., root.path, "admin")`; throw a clear error if
   no root scope exists). `list_skills` = **viewer on the requested scope**. `get_skill` = **any
   valid principal** (skills are shared playbooks cached from a repo agents could read anyway,
   not per-scope secrets). Document this rationale in the module AGENTS.md.
3. **scope_pattern semantics v1** (segments are slash-delimited):
   - `*` matches exactly one segment; `**` matches zero or more segments.
   - A pattern **without** a trailing wildcard uses branch semantics: it matches that scope AND
     all its descendants (e.g. pattern `indya` matches `indya`, `indya/marketing/seo`).
   - Wildcards elsewhere behave positionally: `indya/*` matches `indya/marketing` but NOT
     `indya/marketing/seo` and NOT `indya`; `indya/**` matches `indya` and everything under it.
   - Global skill = scope_pattern `**` (also the default when frontmatter omits it).
4. **Domains are informational for now:** stored, returned, and usable as an optional filter
   param on `list_skills`; domain-based auto-resolution (DESIGN "matching domains") is deferred —
   note the deferral in the module AGENTS.md.
5. **`GitHubClient` moves to a shared location:** `packages/api/src/lib/github-client.ts`
   (skills must not import from the provisioning module). Pure move + import updates in
   provisioning; no behavior change to existing methods.
6. **No new npm dependencies** (implementer sandbox cannot run pnpm install). Hand-roll a minimal
   YAML frontmatter parser for the keys needed (`name`, `description`, `scope_pattern`,
   `domains` — scalar strings plus string lists in both `[a, b]` and `- item` forms).

## Do

1. **Schema** — `packages/db/src/schema/skills.ts`: `skills_index` table:
   `id` uuid PK default gen_random_uuid(), `name` text NOT NULL **unique**, `scope_pattern` text
   NOT NULL, `domains` jsonb NOT NULL default `[]` (string[]), `path` text NOT NULL (file path in
   the skills repo), `description` text NULL, `body` text NOT NULL, `sha` text NULL,
   `synced_at` timestamptz NOT NULL, `created_at`/`updated_at` timestamptz — follow
   `packages/db/src/schema/capabilities.ts` conventions (snake_case columns, hand-written
   `SkillIndexRow`/`NewSkillIndexRow` interfaces). Export from `packages/db/src/schema/index.ts`.
   Generate migration 0013 with `pnpm --filter @companyos/db db:generate` — if pnpm is
   unavailable in your sandbox, write the migration SQL + journal entry EXACTLY in the style
   drizzle-kit produces for 0012 (`0012_watery_jetstream.sql` + its `meta/_journal.json` entry +
   `meta/0013_snapshot.json`) and flag it in your final summary so the architect can regenerate.
2. **Move `GitHubClient`** to `packages/api/src/lib/github-client.ts`; update provisioning
   imports (and any re-export needed by `packages/mcp/src/server.ts`). Add a method
   `listFiles(repo, options?): Promise<{ path: string; sha: string }[]>` using the GitHub git
   trees API (`GET /repos/{org}/{repo}/git/trees/HEAD?recursive=1`), returning blob entries only.
3. **Matcher** — `packages/api/src/modules/skills/match.ts`: pure
   `matchesScope(pattern: string, scopePath: string): boolean` implementing decision 3. No deps.
4. **Service** — `packages/api/src/modules/skills/service.ts`:
   - `syncSkills(db, client: GitHubClient, opts: { repo: string }, actorPrincipalId)` — admin on
     root (decision 2). List repo files, take every file named `SKILL.md` (any depth), fetch each
     body, parse frontmatter: `name` (required, must match `^[a-z0-9-]+$`; skip + report files
     with missing/invalid name), `description` (optional), `scope_pattern` (default `**`),
     `domains` (default `[]`). Upsert rows by `name` (update wins for path/body/etc.; refresh
     `synced_at`, `sha`, `updated_at`), delete index rows whose name no longer exists in the
     repo. Emit ONE `skills.synced` event with `{ repo, added, updated, removed, skipped }`.
     Idempotent: an immediate second run against an unchanged repo removes/adds nothing.
   - `listSkills(db, { scope, domain? }, actorPrincipalId)` — viewer on `scope`; return skills
     whose `scope_pattern` matches the scope (matcher), optionally filtered to rows whose
     `domains` include `domain`; ordered by name; fields: name, description, domains,
     scope_pattern, path, synced_at — **no body**.
   - `getSkill(db, { name }, actorPrincipalId)` — any valid principal (verify the principal
     exists, mirroring how other services resolve the actor); return the full row including
     body; throw new typed `SkillNotFoundError` (add to `packages/api/src/errors.ts`).
   - `skillsContextSection(db, scope): Promise<string>` — helper producing the get_context
     Skills section: matching skills as `- <name> — <description>` lines (cap 20, note when
     truncated), plus a one-line pointer to `get_skill(name)`; empty-index case returns a short
     "no skills synced" line. No access check here (callers gate).
   - Re-export the service (and anything MCP needs) from `@companyos/api`'s public surface the
     same way capabilities does.
5. **MCP tools** — in `packages/mcp/src/server.ts`, following the existing registerTool pattern
   (thin handler, `ensurePrincipal`, try/catch → `formatError`; add `SkillNotFoundError` to
   `formatError`):
   - `sync_skills({})` — repo comes from env `SKILLS_REPO` (throw a clear error naming the env
     var if unset); client via `createGitHubClientFromEnv`.
   - `list_skills({ scope, domain? })`, `get_skill({ name })`.
6. **get_context** — append the Skills section via `skillsContextSection` in BOTH
   implementations: the `get_context` tool in `packages/mcp/src/server.ts` and
   `getContextBundle` in `packages/api/src/agent.ts`.
7. **Tests** (colocated, PGlite pattern):
   - `match.test.ts` — table-driven: `**` matches root-level and nested; `indya` matches itself
     and descendants but not `indyafoo`; `indya/*` matches exactly one extra segment; `indya/**`
     matches `indya` and all descendants; non-matches.
   - `skills.test.ts` — fake in-memory client implementing the `GitHubClient` surface used by
     sync; cover: sync gating (non-admin → AccessDeniedError; root-admin passes), upsert +
     removal + skip-invalid, idempotent second run, `skills.synced` event emitted;
     `list_skills` viewer gating + pattern matching + domain filter + no body; `get_skill`
     happy path + `SkillNotFoundError`.
   - MCP roundtrip smoke for `list_skills`/`get_skill` in the style of `packages/mcp/src/ping.test.ts`.
8. **Docs** — new `packages/api/src/modules/skills/AGENTS.md` (table, gating rationale from
   decision 2, matcher semantics, sync contract + events, deferred domain resolution); update
   provisioning `AGENTS.md` (github-client moved) and `packages/mcp/AGENTS.md` tool list if it
   enumerates tools; add `SKILLS_REPO` to `.env.example` with a comment.

## Don't

- Don't modify `docs/DESIGN.md`, `docs/CONSTITUTION.md`, existing MCP tool signatures, or any
  existing kernel/schema table.
- Don't hand-edit `packages/db/drizzle/meta/_journal.json` except as the exact-drizzle-style
  fallback in Do #1 (and flag it if you do).
- Don't add npm dependencies or touch lockfiles.
- Don't build scheduled/automatic sync, workbench skill-file sync, or domain auto-resolution.
- Don't touch capabilities, metrics, dashboards, records, docs, canvas, or tasks modules.
- Don't attempt to commit — the sandbox blocks `.git`; leave completed work in the tree.

## Acceptance criteria

- [ ] Migration 0013 creates `skills_index` with `unique(name)`; applies cleanly on PGlite in tests.
- [ ] `matchesScope` passes the table-driven cases in Do #7 (branch semantics, `*`, `**`).
- [ ] `sync_skills` is admin-on-root gated; non-admin gets AccessDenied; upserts, removes
      stale rows, skips invalid frontmatter with a report, is idempotent on unchanged repo, and
      emits one `skills.synced` event with counts.
- [ ] `list_skills` is viewer-gated, returns only pattern-matching skills, supports the domain
      filter, and never returns `body`.
- [ ] `get_skill` returns the body; unknown name surfaces `SkillNotFoundError` through
      `formatError`.
- [ ] `get_context` (MCP tool AND `getContextBundle`) includes the Skills section from the
      shared helper.
- [ ] `GitHubClient` lives in `packages/api/src/lib/github-client.ts`; provisioning still
      typechecks and its tests pass unchanged.
- [ ] Root `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (in-sandbox: verify with `tsc -b`,
      `eslint`, `vitest` directly; the orchestrator re-runs the real gate).
- [ ] Module `AGENTS.md` files updated per Do #8 in the same change set.
