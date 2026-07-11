# packages/api/src/modules/attention - AGENTS.md

Generic attention and approval primitive for CompanyOS. User-facing surfaces call this
"Things to resolve"; internal schema and events use `attention`.

## Purpose

Stores human-resolvable items such as wiki edit proposals, brain lint findings,
graduation suggestions, and external gates. The primitive is generic, with typed JSON
payloads per `kind`. Day-one write application is wiki proposals: approving one applies
the proposed markdown through the docs service, then records the decision trail.

## Tables

- `attention_items`
  - `id`, `scope_id`
  - `kind`: `wiki_proposal | lint_finding | graduation | external_gate`
  - `status`: `open | approved | rejected | dismissed`
  - `title`, `summary`, `payload`
  - `created_by`, `resolved_by`, `resolved_at`, `resolution_note`
  - `created_at`, `updated_at`
  - indexes: `(scope_id, status, created_at)`, `(kind, status)`

## Contract

- `createAttentionItem(db, input, actor)`: requires editor/agent on the scope, inserts
  an open item, emits `attention.created`.
- `listAttentionItems(db, input, actor)`: requires viewer for scoped lists. Root
  aggregate lists use the actor's visible tree so non-root users see only granted
  scopes.
- `countOpenAttentionItems(db, input, actor)`: count-only helper for context banners.
- `resolveAttentionItem(db, input, actor)`: requires admin/owner, only resolves open
  items. Approval of `wiki_proposal` calls `saveDoc` as the approving human; approval
  of `graduation` applies the embedded target wiki proposal the same way. Every
  resolution emits `attention.resolved` and creates a `decision` record.

## Payloads

`wiki_proposal` payload:

```ts
{ slug: string; title: string; proposedMd: string; baseRevisionId?: string; currentMd?: string }
```

The payload stores both current and proposed markdown where available so the attention
item is self-contained.

`graduation` payload:

```ts
{ direction: "personal-to-scope" | "scope-to-personal"; fromScopePath: string; fromSlug: string; proposal: WikiProposalPayload }
```

The item's own scope is the target scope for the embedded proposal.

## Tests

Run from the repo root without pnpm wrappers:

```powershell
node_modules/.bin/vitest.cmd run packages/api/src/modules/attention/attention.test.ts
```

## Do Not

- Do not add chat, comments, threads, or server-push behavior.
- Do not inline attention item bodies into `get_context`; use count banners only.
- Do not bypass docs/records services when applying wiki proposals or logging decisions.
