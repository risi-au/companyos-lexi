# apps/os/src/modules/brain - AGENTS.md

Root-admin second-brain UI components for M8-05.

## Purpose
- `/brain` global graph client renderer and filters.
- `/brain/engine` manual trigger server action.

## Contract
- Components receive data from `@companyos/api` wrappers only.
- Graph view is read-only; node clicks navigate to existing scope/doc pages.
- Manual engine actions are gated through `assertBrainManualTriggerAllowed` before invoking the app-bound `api.runBrainEngine` wrapper.
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
