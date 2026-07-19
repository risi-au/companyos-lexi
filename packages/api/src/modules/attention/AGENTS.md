# packages/api/src/modules/attention - AGENTS.md

Generic attention and approval primitive for CompanyOS. User-facing surfaces call this
"Things to resolve"; internal schema and events use `attention`. It also provides internal system helpers for module-owned notification rows that must emit attention events without a human actor grant check.

## Purpose

Stores human-resolvable items such as wiki edit proposals, brain lint findings,
graduation suggestions, external gates, open questions, and targeted followed-page updates. The
primitive is generic, with typed JSON payloads per `kind`. Wiki proposals can be
approved into docs; wiki-health findings require the dedicated wiki-question resolver;
followed-page updates are dismiss-only notifications for exactly one principal.

## Tables

- `attention_items`
  - `id`, `scope_id`
  - `kind`: `wiki_proposal | lint_finding | graduation | external_gate | page_update | open_question | connection_expiry`
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
- `getAttentionItem(db, { id }, actor)`: exact authorized lookup for one item. Returns
  null for a missing item or an item targeted to another principal.
- `countOpenAttentionItems(db, input, actor)`: count-only helper for context banners
  with the same target-principal visibility filter as list.
- `createSystemAttentionItem(db, input)`: internal helper for system-created rows. Inserts without grant checks using the provided `createdBy` principal and emits `attention.created`.
- `dismissAttentionItemsInternal(db, input)`: internal helper for dismissing open rows by kind and `payload.tokenId`. Uses each item's `created_by` as `resolved_by`, emits `attention.resolved`, and creates no decision records.
- `resolveAttentionItem(db, input, actor)`: requires admin/owner for approval items,
  only resolves open items. Approval of `wiki_proposal` calls `saveDoc` as the
  approving human; approval of `graduation` applies the embedded target wiki proposal
  the same way. `open_question` approval requires a non-empty resolution note; the
  note is the answer and is included in the decision record. `connection_expiry` items are admin/owner dismiss-only and create no decision records. `page_update` items are
  target-principal-only and may only be dismissed by that principal with viewer access;
  they emit `attention.resolved` but do not create decision records. Every
  `lint_finding` is hard-blocked here and must use `resolveWikiQuestionAttentionItem`.
  Other resolutions
  emit `attention.resolved` and create a `decision` record.
- `resolveWikiQuestionAttentionItem(db, input, actor)`: requires a human administrator and
  resolves `lint_finding` rows only. V2 contradictions can choose `first`/`second` to
  apply one exact quoted repair, or `not-a-conflict` to resolve without changing a page.
  V2 stale checks can `mark-current` with a caller-supplied future `nextReviewAt`.
  A date-only value means the end of that named UTC calendar day.
  Legacy or malformed findings can only `close-unclear`. Page saves/verifications,
  doc events, attention status, resolution events, and decision records are written in
  one transaction with compare-before-write checks and audit hashes.

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

`connection_expiry` payload:

```ts
{ tokenId: string; name: string; scopePath: string; state: "expiring" | "expired"; expiresAt: string }
```

Connection expiry items are created by the connect service sweep for worker tokens only.
`page_update` payload:

```ts
{ documentId: string; slug: string; scopePath: string; title: string; lastEventType: string; lastActorId: string; lastActorName?: string; changeCount: number }
```

One open `page_update` exists per followed page and follower. Dismissal clears it; the
next page change creates a fresh item.

`lint_finding` wiki-question payloads:

- V2 contradiction: `{ version: 2, type: "contradiction", relation, subject, explanation, claims: [..2], choices: [{ id: "first"|"second", label, repair }] }`
- V2 stale: `{ version: 2, type: "stale", slug, title, currentMd, reviewDueAt }`
- Anything else is legacy or insufficient evidence and can only close as unclear.

## Tests

Run from the repo root without pnpm wrappers:

```powershell
node_modules/.bin/vitest.cmd run packages/api/src/modules/attention/attention.test.ts
```

## Do Not

- Do not add chat, comments, threads, or server-push behavior.
- Do not inline attention item bodies into `get_context`; use count banners only.
- Do not bypass docs/records services when applying wiki proposals or logging decisions.
