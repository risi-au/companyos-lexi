# packages/wizard - AGENTS.md

Creation wizard contract package. It owns reusable parsing, validation, packet schema
rendering, template parsing, and external pack assembly helpers. It does not touch the
database, HTTP, MCP transports, or app UI.

## Purpose
- Parse paste-back packets from external interview agents.
- Validate the canonical intake packet JSON shape.
- Parse wizard template markdown from the central skills repo.
- Parse framing questions from template sections for UI forms.
- Assemble copyable external interview packs without LLM calls, including briefing,
  structural context, reason/framing, selected history, similar work, and packet
  schema guidance.

## Contract
- Pure TypeScript only. No DB imports and no service-layer side effects.
- Business logic and permissions live in `packages/api`.
- UI and MCP call `@companyos/api`; they should not reimplement state transitions.
- Packet schema defaults `required_credentials` and `external_systems` to empty
  arrays. Credential entries carry names/notes only, not secret values.

## How to test
- `pnpm --filter @companyos/wizard test`
- `pnpm --filter @companyos/wizard typecheck`
- Full repo: `pnpm test`, `pnpm typecheck`, `pnpm lint`
