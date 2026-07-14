# packages/api/src/modules/attention - AGENTS.md

Generic attention and approval primitive for CompanyOS. User-facing surfaces call this
"Things to resolve"; internal schema and events use `attention`.

## Purpose

Stores human-resolvable items such as wiki edit proposals, brain lint findings,
graduation suggestions, external gates, open questions, and targeted followed-page updates. The
primitive is generic, with typed JSON payloads per `kind`. Wiki proposals can be
approved into docs; followed-page updates are dismiss-only notifications for exactly
one principal.

## Tables

- `attention_items`
  - `id`, `scope_id`
  - `kind`: `wiki_proposal | lint_finding | graduation | external_gate | page_update | open_question`
  - `status`: `open | approved | rejected | dismissed`
  - `title`, `summary`, `payload`
  - `created_by`, nullable `target_principal_id`, `resolved_by`, `resolved_at`, `resolution_note`
  - `created_at`, `updated_at`
  - indexes: `(scope_id, status, created_at)`, `(kind, status)`, `(target_principal_id, status)`

## Contract

- `createAttentionItem(db, input, actor)`: requires editor/agent on the scope, inserts
  an open item, optionally scoped to `targetPrincipalId`, emits `attention.created`.
- `listAttentionItems(db, input, actor)`: requires viewer for scoped lists. Root
  aggregate lists use the actor's visible tree so non-root users see only granted
  scopes. Targeted items are visible only when `target_principal_id` is null or equals
  the viewing principal.
- `countOpenAttentionItems(db, input, actor)`: count-only helper for context banners
  with the same target-principal visibility filter as list.
- `resolveAttentionItem(db, input, actor)`: requires admin/owner for approval items,
  only resolves open items. Approval of `wiki_proposal` calls `saveDoc` as the
  approving human; approval of `graduation` applies the embedded target wiki proposal
  the same way. `open_question` approval requires a non-empty resolution note; the
  note is the answer and is included in the decision record. `page_update` items are
  target-principal-only and may only be dismissed by that principal with viewer access;
  they emit `attention.resolved` but do not create decision records. Other resolutions
  emit `attention.resolved` and create a `decision` record.

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

`open_question` payload:

```ts
{ question: string; tag: "decision" | "unknown" | null; source: "intake"; intakeId: string; ordinal: number }
```

Open-question payloads are normalized at creation. `question` must be non-empty and
`ordinal` must be a non-negative integer; invalid tags become null. Intake ordinals
are unique per scope and intake for retry-safe provisioning.

`page_update` payload:

```ts
{ documentId: string; slug: string; scopePath: string; title: string; lastEventType: string; lastActorId: string; lastActorName?: string; changeCount: number }
```

One open `page_update` exists per followed page and follower. Dismissal clears it; the
next page change creates a fresh item.

## Tests

Run from the repo root without pnpm wrappers:

```powershell
node_modules/.bin/vitest.cmd run packages/api/src/modules/attention/attention.test.ts
```

## Do Not

- Do not add chat, comments, threads, or server-push behavior.
- Do not inline attention item bodies into `get_context`; use count banners only.
- Do not bypass docs/records services when applying wiki proposals or logging decisions.
