# apps/os/src/modules/brain - AGENTS.md

Root-admin Wiki health UI components for M8-05.

## Purpose
- `/brain` global Wiki map client renderer and filters.
- `/brain/engine` Wiki health page and manual trigger server action.

## Contract
- Components receive data from `@companyos/api` wrappers only.
- Graph view is read-only; node clicks navigate to existing scope/doc pages.
- Manual engine actions are gated through `assertBrainManualTriggerAllowed` before invoking the app-bound `api.runBrainEngine` wrapper.
- Manual health actions keep the internal `ingest` / `lint` / `backfill` values but label them as `Update Wiki knowledge`, `Check Wiki health`, and `Review older records`.
- User-facing health copy uses plain business language and does not show raw lint titles, internal run modes, record ids, or principal ids.
- Follow design tokens only; no raw DB access.

## Files
- `BrainGraphCanvas.tsx`
- `graph-utils.ts`
- `graph-utils.test.ts`
- `actions.ts`
- `index.ts`

## Tests
- `pnpm --filter @companyos/os test`
- Full repo: `pnpm test`
