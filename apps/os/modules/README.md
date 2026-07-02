# OS Modules

Each vertical feature lives in `apps/os/modules/<name>/` as a self-contained unit: DB tables, service calls into `packages/api`, API routes, MCP tools, UI, tests, and its own `AGENTS.md`.

## Rules

- **No cross-module imports.** Modules communicate through kernel events or shared packages only.
- **Compose UI from `packages/ui` primitives** — no hardcoded colors, spacing, or fonts.
- **Business logic stays in `packages/api`** — module routes are thin clients.

## Boundary lint

Sibling module imports are blocked by `eslint-plugin-boundaries`. To verify the rule is active, see the commented example in `module-a/index.ts` or run `pnpm test` (root `tests/eslint-boundaries.test.ts` lints `module-a/boundary-violation.fixture.ts`).

## Adding a module

1. Create `apps/os/modules/<name>/` with `AGENTS.md`, routes, and components.
2. Register API routes under `src/app/api/` that delegate to `packages/api`.
3. Add module-specific tests; do not import from sibling `modules/*` folders.