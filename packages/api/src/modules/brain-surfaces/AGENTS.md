# packages/api/src/modules/brain-surfaces - AGENTS.md

Root-admin Wiki health surface assembly for M8-05.

## Purpose
- Builds the bounded global graph payload for `/brain`.
- Assembles Wiki health ops data for `/brain/engine`.
- Provides the root-admin gate for manual brain run triggers.

## Contract
- Root scope `owner` or `admin` is required for every function.
- Read-only except trigger gating, which only authorizes and validates mode; the app boundary invokes `@companyos/brain`.
- UI and routes must call these services rather than querying tables directly.
- Graph payloads are bounded and include truncation metadata.
- Reserved operational report slugs (`lint-report*`) are not graph pages or unresolved targets.
- Wiki question flags and history come from structured `lint_finding` attention rows, not report markdown.
- Engine counts and activity names come from structured `capability_runs.payload`; summary text is not parsed.

## Files
- `service.ts`
- `brain-surfaces.test.ts`

## Tests
- `pnpm --filter @companyos/api test`
- Full repo: `pnpm test`

## Do / Don't
- Do keep `/brain` data root-admin-only.
- Do preserve compact graph payloads with explicit limits.
- Do not add graph write actions here.
- Do not import `@companyos/brain` into `packages/api`; the brain package already depends on this package.
