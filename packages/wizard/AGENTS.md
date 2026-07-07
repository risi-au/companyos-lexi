# packages/wizard - AGENTS.md

Creation wizard contract package. It owns reusable parsing, validation, packet schema
rendering, template parsing, and external pack assembly helpers. It does not touch the
database, HTTP, MCP transports, or app UI.

## Purpose
- Parse paste-back packets from external interview agents.
- Validate the canonical intake packet JSON shape.
- Parse wizard template markdown from the central skills repo.
- Assemble copyable external interview packs without LLM calls.

## Contract
- Pure TypeScript only. No DB imports and no service-layer side effects.
- Business logic and permissions live in `packages/api`.
- UI and MCP call `@companyos/api`; they should not reimplement state transitions.

## How to test
- `pnpm --filter @companyos/wizard test`
- `pnpm --filter @companyos/wizard typecheck`
- Full repo: `pnpm test`, `pnpm typecheck`, `pnpm lint`
