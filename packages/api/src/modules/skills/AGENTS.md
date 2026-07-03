# skills module - AGENTS.md

Cached index for the central skills repository. Git is the source of truth; `skills_index` is the query cache used by API and MCP reads.

## Purpose
Expose agentskills.io-style `SKILL.md` playbooks through CompanyOS. Sync reads every `SKILL.md` file from the configured GitHub repo, caches frontmatter plus the full markdown body, and lets agents list scope-relevant skills or fetch a full skill by name.

## Contract
- Service functions live in `service.ts` and are exported from `@companyos/api`.
- Scope matching lives in `match.ts` and has no database dependency.
- The shared GitHub client lives in `packages/api/src/lib/github-client.ts`; skills must not import from provisioning.
- Every sync mutation emits exactly one `skills.synced` event.

## Table
- `skills_index`: `id`, `name`, `scope_pattern`, `domains`, `path`, `description`, `body`, `sha`, `synced_at`, `created_at`, `updated_at`.
- `name` is globally unique because the central skills repo is the single source of truth.
- `body` stores the complete `SKILL.md` markdown, including frontmatter, so `getSkill` is DB-only.

## Gating
- `syncSkills` requires `admin` on the root scope. It is a global cache refresh, so the service resolves the `type = 'root'` scope and gates there. If no root scope exists, sync fails clearly.
- `listSkills` requires `viewer` on the requested scope because the result is scope-context material.
- `getSkill` requires only a valid principal. Skills are shared playbooks cached from a repo agents could already read; they are not per-scope secrets.

## Scope Matching
- Segments are slash-delimited.
- `*` matches exactly one segment.
- `**` matches zero or more segments.
- A pattern with no wildcard uses branch semantics: `indya` matches `indya` and all descendants.
- `indya/*` matches one child segment only.
- `indya/**` matches `indya` and all descendants.
- Omitted `scope_pattern` defaults to `**`, which is the global skill pattern.

## Sync
- `syncSkills(db, client, { repo }, actorPrincipalId)` lists GitHub blobs, reads files named exactly `SKILL.md`, parses minimal YAML frontmatter, and upserts by `name`.
- Required frontmatter: `name`, matching `^[a-z0-9-]+$`.
- Optional frontmatter: `description`, `scope_pattern`, `domains`.
- Invalid or missing names are skipped and reported in the result and event payload.
- Rows whose names no longer exist in the repo are removed.

## Domains
Domains are stored, returned, and available as an optional `listSkills` filter. Domain-based automatic resolution is deferred.

## Events
- `skills.synced`: payload `{ repo, added, updated, removed, skipped }`

## Tests
- `match.test.ts` covers branch semantics and wildcard matching.
- `skills.test.ts` covers root-admin sync gating, upsert/removal/skip/idempotency, event emission, viewer-gated listing, domain filtering, no-body list results, and `SkillNotFoundError`.
