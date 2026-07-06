# M7-02 review — fix cycle 1

Reviewer: architect. Overall: strong implementation — analysis note is sound, module
layout/tests/AGENTS.md all present, signature verification correct, idempotency via
delivery id works, path resolution matches deepest-prefix-wins. Three fixes required
before merge.

## Fix 0 (test break): provisioning.test.ts still expects the old managed-section text

Full `pnpm test` fails: `packages/api/src/modules/provisioning/provisioning.test.ts:266`
expects the pre-change `Use \`log_change\` incrementally during work.` line, which this
task reworded. Update the expectation to the new text (and check line 267+ neighbors).
Run the provisioning test file, not just the three you ran.

## Fix 1 (bug): blanket suppression kills all future stubs in a scope

`packages/api/src/modules/workbench-events/service.ts`, `hasRecentRecordReference`:

```ts
if (record.authorId === githubPrincipalId && (record.data as any)?.source === "github") return true;
```

Any github-sourced changelog in the scope within the 14-day window suppresses **every**
subsequent stub — two different PRs merged a week apart means the second merge gets no
stub, defeating the safety net. Delete this branch. Same-PR/same-range suppression is
already handled correctly by the needle check (github stubs carry prUrl/prNumber/
commitShas in `data`, which the JSON haystack matches), and actual GitHub retries are
handled by delivery-id dedup. Note this also preserves the nice property that a PR-merge
delivery and its companion push-to-main delivery suppress each other via the shared
merge commit SHA regardless of arrival order — add a test asserting exactly one stub
when both deliveries arrive (either order).

Add a regression test: two different merged PRs (no agent wrap-up) in the same scope →
two stubs.

## Fix 2 (bug): linkRecentSessions fabricates links

`linkRecentSessions` falls back to `rows.slice(0, 3)` when neither branch nor author
matches — the event payload then claims `linkedSessionIds` for sessions that had nothing
to do with the push. "Best-effort, do not require a match" means absence of a match must
not block ingestion, not that arbitrary recent sessions get linked. Return only matched
sessions; empty array is the correct answer when nothing matches. Adjust/extend tests
accordingly.

## Fix 3 (boundary): direct insert into the records table

`createGithubChangelogStub` inserts into `records` and hand-rolls a `record.created`
event. The accepted cross-module pattern in packages/api is "via the other module's
public service" (see tasks → records `createRecord` for completeTask notes). Bypassing it
duplicates the records module's invariants and event shape in a second place.

Fix: add a small exported system-writer to `packages/api/src/modules/records/service.ts`
— e.g. `createSystemRecord(db, input, systemPrincipalId)` — that skips `requireAccess`
(documented: for internal system writers like webhook ingestion that act under a
system/agent principal without scope grants) but shares the same insert + validation +
`record.created` emission as `createRecord` (extract a common helper; do not fork the
logic). Call it from workbench-events. The github-specific detail (deliveryId, source)
already lives in `record.data` and in the `workbench.*` event payload, so losing the
extra fields on `record.created` is fine. Update records module AGENTS.md in the same
change.

## Advisory (no change required)

- `repoMatches` short-name fallback means two different orgs sharing a repo short name
  would both match. Acceptable for single-org instances (webhooks are owner-registered
  and HMAC-signed); document the assumption in the module AGENTS.md.
- `hasProcessedDelivery` does a seq scan on `events.payload->>'deliveryId'`. Fine at
  webhook volume; revisit with an index if it shows up in M7-03 observability.

## Process

- Work on branch task/M7-02 (already checked out); build on the existing uncommitted
  changes, do NOT revert or redo them.
- Re-run typecheck + module tests after fixing. Architect runs full gates and commits.
