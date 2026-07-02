# M1-01: Monorepo scaffold
status: todo
module: infra
branch: task/M1-01

## Goal
A clean TypeScript monorepo that installs, builds, lints, and tests with single commands, matching the layout in AGENTS.md — so every later task lands in a prepared slot.

## Context
- `docs/DESIGN.md` §4 (stack), `AGENTS.md` (layout)
- Empty repo except docs/ and legacy/

## Do
1. pnpm workspaces + turborepo. Root scripts: `dev`, `build`, `lint`, `test`, `typecheck`.
2. `apps/os`: Next.js 15+ (App Router, TS strict, src/ layout) with Tailwind v4 + shadcn/ui initialized; a placeholder home page rendering "CompanyOS" using a `packages/ui` component; `modules/` directory with a `README.md` stub explaining the module pattern.
3. `apps/control-plane`: minimal Next.js app, placeholder page only.
4. `packages/ui`: design tokens file implementing `docs/DESIGN-SYSTEM.md` exactly (CSS variables, primitive + semantic layers, light + dark; Inter + JetBrains Mono via next/font) + one Button primitive consuming tokens; exported for both apps.
5. `packages/db`: Drizzle + postgres-js wired, empty schema dir, `drizzle.config.ts`, migration + seed script stubs reading `DATABASE_URL` from env.
6. `packages/api`: empty service-layer package with one example function `health(): { ok: true }` and a vitest test.
7. `packages/mcp`: stub package depending on `@modelcontextprotocol/sdk`, exporting a `createServer()` that registers a single `ping` tool returning "pong". No transport wiring yet.
8. Shared `tsconfig` base (strict), ESLint flat config with `eslint-plugin-boundaries` (or import-x rules) configured so `apps/os/modules/*` cannot import from sibling modules — rule active even though no modules exist yet.
9. Vitest at root (projects mode). GitHub Actions workflow: install → typecheck → lint → test on push/PR.
10. `.gitignore` (node, next, env), `.env.example` (DATABASE_URL placeholder), root `package.json` metadata (private, name `companyos`).

## Don't
- No database schema content, no auth, no Docker, no real pages/features.
- Do not modify anything in `docs/` or `legacy/`, or the root `AGENTS.md`/`README.md`.
- Do not add dependencies beyond what the steps require.

## Acceptance criteria
- [ ] `pnpm install && pnpm build` succeeds from a fresh clone (Node 22)
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass; the `packages/api` health test and a `packages/mcp` ping test exist and run
- [ ] Both apps `next build` successfully; os home page renders the ui Button
- [ ] Boundary lint rule demonstrably fires (include a commented-out violating import + a test or note proving the rule triggers)
- [ ] CI workflow file present and correct
