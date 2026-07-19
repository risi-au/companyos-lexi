# Slice E Brief: Brain admin becomes Wiki health

Implement Slice E from the owner-approved `FEAT-wiki-clarity.plan.md` in the current worktree. Build on accepted Slices A-C and the current Slice D work. Use `apply_patch` for every source/document edit. Do not commit.

## Owned files

- `packages/api/src/modules/brain-surfaces/service.ts`
- `packages/api/src/modules/brain-surfaces/brain-surfaces.test.ts`
- `packages/api/src/modules/brain-surfaces/AGENTS.md`
- `apps/os/src/app/(app)/brain/engine/page.tsx`
- `apps/os/src/modules/brain/AGENTS.md`

Do not edit any other file. Do not change schemas, migrations, lockfiles, environment files, Brain engine internals, action form values, routes, or graph UI components.

## Required data behavior

1. Stop parsing `lint-report*` markdown for graph flags or engine history.
2. Consume the shared `notReservedOperationalWikiReportSlug` / `isReservedOperationalWikiReportSlug` helpers from `@companyos/db` so no `lint-report*` document becomes a normal graph node or unresolved graph target.
3. Build graph flags only from structured open `attention_items` whose kind is `lint_finding`. Read the V2 contradiction claims, V2 stale page, and safe legacy slug fields without inventing page references. Closed questions do not flag graph pages.
4. Build the Wiki-question history from structured `lint_finding` attention rows joined to scopes, not from report documents. Include a plain title/message, status, relevant page link when safely available, and dates. Keep internal API identifiers stable when practical, but never expose raw stored titles such as `Wiki lint: contradiction` as the display title.
5. Keep engine run history based on structured `capability_runs.payload`, including the internal `mode: "lint"` value. Do not parse run summary text for counts.
6. Preserve root-admin gating, bounded results, usage accounting, graph limits, existing routes, and internal manual-trigger values.

## Plain-language page

1. The page heading is `Wiki health`, with a short description a business owner can understand.
2. Replace visible terms such as Brain Engine, lint, findings, manual triggers, modes, run history, nodes/ids, and raw statuses with plain labels. Required concepts include `Open Wiki questions`, `Check Wiki health`, and `Wiki maintenance history`.
3. Map internal activities visibly:
   - `ingest` -> `Update Wiki knowledge`
   - `lint` -> `Check Wiki health`
   - `backfill` -> `Review older records`
4. Map statuses and severity to calm human labels such as Completed, In progress, Needs attention, Urgent, and For review. Do not render raw `Wiki lint:*` titles, record ids, report slugs, or raw principal ids.
5. Manual runs can spend AI tokens. Give every action a concise explanation and a confirmation before submission, using an existing CompanyOS confirmation component if available. Keep the internal hidden form value unchanged.
6. Use design tokens and preserve keyboard/focus/pending accessibility.

## Tests

Update focused tests to prove:

- an open structured contradiction/stale attention item flags its real page(s);
- a closed item does not flag pages;
- `lint-report*` documents neither flag nor appear in the graph, even when linked;
- Wiki-question history comes from attention rows and includes status/plain summaries without any report dependency;
- structured capability payloads still drive run counts/modes;
- plain display source contains `Wiki health`, `Open Wiki questions`, `Check Wiki health`, and no visible `Lint findings`/`Open lint findings`/raw mode button copy;
- root-admin gating still holds.

Run focused brain-surfaces tests, relevant app source/helper tests, API/app typecheck, and API/app lint. Report changed files, checks, and deviations. Do not commit.
