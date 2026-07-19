# FEAT-wiki-clarity Slice C: safe actions for Wiki questions

Role: Codex medium implementer. Work in the current Orca worktree. Do not commit.
Use `apply_patch` for every source/document edit. If `apply_patch` is blocked, stop and report the blocker; do not switch to PowerShell, Python, shell redirection, or another scripted write path.

Build on the existing uncommitted approved Slice A and Slice B changes. Do not revert, reformat, or edit their files except where this brief explicitly owns a shared API surface.

Read first:

1. `AGENTS.md`, `ONBOARDING.md`, `docs/CONSTITUTION.md`
2. `docs/tasks/FEAT-wiki-clarity.contract.md`
3. `docs/tasks/FEAT-wiki-clarity.plan.md`, especially sections 2.3, 2.4 and Slice C
4. `packages/api/src/modules/attention/AGENTS.md`, `apps/os/src/modules/attention/AGENTS.md`, `packages/mcp/AGENTS.md`, and the app-level instructions governing the notification bell
5. Current owned implementation/tests and the docs service public contract needed for the transaction

## Owned files

- `packages/api/src/modules/attention/service.ts`
- `packages/api/src/modules/attention/attention.test.ts`
- `packages/api/src/modules/attention/AGENTS.md`
- `apps/os/src/modules/attention/AttentionCard.tsx`
- new focused wiki-question form/helper/test files under `apps/os/src/modules/attention/`
- `apps/os/src/modules/attention/AGENTS.md`
- `apps/os/src/app/(app)/_components/NotificationBell.tsx`
- `packages/mcp/src/server.ts`
- `packages/mcp/src/ping.test.ts`
- `packages/mcp/AGENTS.md`

If an existing directly-related API export or app server-action wrapper must change to expose the dedicated operation, keep it minimal and report it. The approved plan also permits the existing docs service primitives required inside the transaction; do not refactor unrelated docs behavior. Do not edit Brain, agent/Ask OS, search, memory, Brain admin, schema migrations, lockfiles, `.env*`, `USER DATA/`, or `legacy/`.

## Service contract

1. Add strict typed parsers for the exact V2 contradiction and stale payloads produced by Slice A. Treat everything else, including old `lint_finding` rows, as legacy/insufficient evidence.
2. The generic `resolveAttentionItem` must reject every resolution attempt for every `lint_finding`, regardless of version or subtype. This hard block must also protect the existing generic MCP resolver.
3. Add one dedicated wiki-question resolution operation with explicit actions:
   - contradiction choice `first` or `second`;
   - contradiction `not-a-conflict`;
   - stale `mark-current` with a human-selected `nextReviewAt` that is a real future date;
   - legacy/malformed `close-unclear` only.
4. Authorization: require a human editor for mutations. Viewers cannot resolve. Validate action/payload compatibility before any write.
5. For a contradiction choice, use one database transaction to:
   - lock/re-read the still-open attention row;
   - parse V2 again;
   - re-read both current source pages;
   - prove titles, exact quotes, and the selected repair `currentMd` still match;
   - write exactly the selected one-page `proposedMd` through the docs service transaction-safe primitive;
   - append the revision, emit the normal doc event, resolve the attention item, emit the resolution event, and create the durable decision record;
   - store exact audit fields in attention resolution metadata, event payload, and decision body: selected choice id, selected label/value, both source claims, changed slug, and before/after content hashes.
6. If any validation or injected step fails, roll back the page, revision, attention status, events, and decision together. A concurrent/stale body must leave the item open with a calm retry error.
7. `not-a-conflict` resolves the item and records the decision/audit trail without changing either page.
8. V2 stale `mark-current` uses the same transaction and compare-before-write rules. It must require a future `nextReviewAt`, confirm slug/title/currentMd/reviewDueAt still match, update `verified_at`, `verified_by`, and `stale_after`, append revision, resolve the item, emit both required events, and create the decision atomically. Do not hardcode a review period.
9. Legacy/malformed contradiction or stale items may only close as unclear through the dedicated operation. They never mutate a page and never expose generic Approve/Reject.
10. Keep internal identifiers and existing tool names stable; additions must be backward compatible.

## User experience

1. Never show raw titles such as `Wiki lint: contradiction`, raw slugs, internal record ids, hashes, `lint`, `flagged`, or generic Approve/Reject for Wiki questions.
2. V2 contradiction cards say “Wiki question” / “Two wiki pages disagree” and show:
   - two readable claim panels with current page titles and exact quotes;
   - “Why this matters” with the plain explanation;
   - outcome labels and one-page before/after previews;
   - “Apply this correction,” “Open pages to compare,” and “Not a conflict.”
3. V2 stale cards say “This page may be out of date,” show page title and due date, and offer “Open page,” a properly labelled next-review date input, and “Mark as current.”
4. Legacy/malformed cards say “This older check does not include enough evidence.” Show page links by title when possible and only “Close as unclear.”
5. Wiki proposals use “Suggested wiki update,” with “Apply update” and “Keep current page.”
6. Map wiki-related kind/status labels to plain language in both AttentionCard and NotificationBell. Preserve accessible labels, keyboard operation, focus visibility, disabled/busy states, and status/error announcements.

## MCP

1. Expand list output additively with summary and structured detail sufficient for automated clients to understand Wiki questions.
2. Keep current tool names/signatures stable unless adding optional fields or a new dedicated tool.
3. Generic resolution must surface the service hard block for every `lint_finding`. If exposing dedicated resolution, document the kind-specific action contract plainly.

## Tests

Add focused coverage for:

- selected repair commits page revision, doc event, attention resolution, resolution event, and decision together;
- an injected mid-transaction failure rolls all of them back;
- concurrent/stale body keeps the item open and changes nothing;
- audit data maps the exact choice, label/value, claims, changed page, and before/after hashes;
- not-a-conflict changes no page but records/resolves correctly;
- stale Mark as current updates verification/review frontmatter and the whole audit trail atomically;
- invalid/past review dates fail and leave the item open;
- legacy contradiction and legacy stale can close only as unclear;
- viewers are denied;
- no `lint_finding` can resolve through the generic resolver, including via MCP;
- rendered controls/copy are subtype-specific and no raw finding title/internal id appears;
- wiki proposal controls use Apply update / Keep current page;
- notification labels use plain terms.

Run focused attention, app, and MCP tests plus feasible package/app typecheck and lint. The coordinator owns the root gate.

## Done report

Report every changed file, tests/commands and results, deviations, and follow-up needed by later slices. On a rate or usage limit, print a line beginning `LIMIT-ALERT:` and stop. Do not commit.
