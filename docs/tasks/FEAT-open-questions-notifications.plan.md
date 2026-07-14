# Open-Questions Afterlife + Attention Notifications — Implementation Plan

> TRIP plan (adapted to CompanyOS conventions: plan lives in `docs/tasks/`, architecture
> sources are root `AGENTS.md`, `docs/DESIGN.md`, and per-module `AGENTS.md` files).
> Owner approval: Rishi, 2026-07-14 (this session).

## Overview

Intake open questions are currently write-only: the external interview agent records them,
the Review step shows cosmetic checkboxes, and `provisionFromIntakePacket` never reads them
again. This feature gives open questions an afterlife (unresolved ones become attention
items whose resolution writes decision records the brain distills), captures answers at
review time, fixes the Interview step not noticing MCP-submitted results, and surfaces open
attention items ("Things to resolve") as a global notification bell in the app header next
to the font-resize control.

## Problem Statement

1. `packages/api/src/modules/intake/service.ts` `provisionFromIntakePacket` (:889-980) seeds
   docs/wiki/tasks/report from the packet but never reads `openQuestions`.
2. Review-step checkboxes (`apps/os/src/modules/intake/IntakePanel.tsx:512` `toggleQuestion`)
   flip local state only; answers have nowhere to land.
3. The Interview step (`IntakePanel.tsx:842-910`) only advances via `submitPasteAction`; an
   MCP `submit_intake_packet` flips the DB to `needs_review` but the open page never notices.
4. Attention items are only visible on scope overview pages; nothing global tells a user
   they have things to resolve.

## Solution Architecture

- New attention kind `open_question` reuses the existing resolution machinery: resolving
  with a note (= the answer) already writes a decision record + `attention.resolved` event,
  which the brain distills into the wiki. No new retrieval or notification tables.
- At provision, unresolved open questions convert to `open_question` attention items on the
  scope; answered ones are folded into the provision report record.
- The interview skill prompts now require tagging each open question `decision` (a reviewer
  can answer at review time) or `unknown` (nobody can answer yet), and require asking once
  before recording.
- The notification bell is a client component in the app-shell header fed by an initial
  server fetch plus a server action it re-polls (60s interval + window focus). It lists open
  attention items across all scopes visible to the actor via the existing
  `listAttentionItems` (already grant-filtered and targeted-item-aware).

## Implementation Details

### 1. DB schema: new attention kind

**File**: `packages/db/src/schema/attention.ts`

- Add `"open_question"` to `attentionKindEnum` (:13-19), to the `AttentionItem["kind"]`
  union (:60), and thereby `NewAttentionItem`.
- Generate migration with drizzle-kit (plain `ALTER TYPE "attention_kind" ADD VALUE
  'open_question';`). The same migration also creates the partial unique index for
  provision idempotency (definition in §3) — its predicate deliberately avoids the new
  enum value because the programmatic migrator (`packages/db/scripts/migrate.mjs:40`)
  runs all pending migrations in one transaction and Postgres rejects a same-transaction
  use of a new enum value. NEVER hand-edit `drizzle/meta/_journal.json`; do NOT run
  migrations against the dev DB (M10-02 pattern).

### 2. Attention service: payload + resolution semantics

**File**: `packages/api/src/modules/attention/service.ts`

- New `OpenQuestionPayload { question: string; tag: "decision" | "unknown" | null;
  source: "intake"; intakeId: string; ordinal: number }` + validator
  `openQuestionPayload(value)` following `wikiProposalPayload` (:52-66): require non-empty
  `question` and a non-negative integer `ordinal` (the provision idempotency key);
  normalize bad/missing `tag` to `null`.
- `resolveAttentionItem` (:288): for kind `open_question`, resolution `"approved"` REQUIRES
  a non-empty `note` (the answer) — throw `AttentionStateError("open_question approval
  requires a resolution note containing the answer")` otherwise. `rejected`/`dismissed`
  need no note. Access stays admin (same as other decision kinds; the existing
  `requireAccess(..., "admin")` at :306 already covers it — no code change needed there).
- `decisionBody` (:255): for `open_question`, include `Question: <payload.question>` and,
  when approved, `Answer: <note>` lines so the decision record is self-contained.
- No changes to `listAttentionItems` / `countOpenAttentionItems` (kind-agnostic).

### 2b. MCP: resolve tool contract

**File**: `packages/mcp/src/server.ts`

- `resolve_attention_item` (:313-338): update the tool `description` and the `note` field
  description to state that approving an `open_question` REQUIRES `note` (the note is the
  answer and becomes the decision record). Schema keeps `note` optional (other kinds don't
  need it); the service enforces the gate. Add/extend the MCP contract test covering
  approve-without-note → error, approve-with-note → resolved.

### 3. Intake service: normalize, convert at provision, skill prompts

**File**: `packages/api/src/modules/intake/service.ts`

- New exported helper `normalizeOpenQuestions(value: unknown): Array<{ t: string;
  tag: "decision" | "unknown" | null; done: boolean; answer: string | null }>` — accepts
  the wild shapes agents produce (plain strings; objects keyed `t`/`question`/`title`/
  `text`; optional `tag`/`done`/`answer`), drops empties. Lives next to the other packet
  helpers so the UI and provision path share one truth (UI imports it via the API package?
  NO — apps must not import service internals; mirror-light: the UI keeps its own parse in
  `apps/os/src/modules/intake/open-questions.ts` (see §5) and the service helper is used
  by provision + tests. The two accept the same shapes; the shared shape is documented in
  both AGENTS.md files.)
- `provisionFromIntakePacket` (:889): before `createSystemRecord` (:954):
  - `const questions = normalizeOpenQuestions(intake.openQuestions)`.
  - Answered (`answer` non-empty): append a `## Open questions answered during review`
    section (question + answer lines) to the report record `bodyMd`.
  - Unresolved (`!done && !answer`): `createAttentionItem` kind `open_question`, title =
    question text (truncate ~140 chars), summary = `Unanswered from the setup interview
    for <scopePath>`, payload `{ question, tag, source: "intake", intakeId: intake.id,
    ordinal }`, createdBy = actor. Items land on the provisioned scope.
  - **Idempotency (retry + concurrency safety, enforced at the DB boundary)**: the intake
    stays `approved` until provisioning completes, so a failure after item creation
    followed by a retry would duplicate — and a list-then-insert check alone is not
    atomic under concurrent provision calls. The migration (§1) therefore also adds a
    partial unique expression index. IMPORTANT: the predicate must NOT reference the new
    enum value — `packages/db/scripts/migrate.mjs:40` wraps all pending migrations in ONE
    transaction, and Postgres rejects using an enum value added in the same transaction
    (breaks fresh installs). Use the enum-independent payload keys instead (only
    intake-sourced open questions carry them):
    `CREATE UNIQUE INDEX attention_items_intake_ordinal_idx ON attention_items
    (scope_id, ((payload->>'intakeId')), ((payload->>'ordinal')))
    WHERE (payload->>'source') = 'intake' AND (payload->>'ordinal') IS NOT NULL;`
    The conversion is factored into an exported helper
    `convertOpenQuestionsToAttention(db, intake, actorPrincipalId)` (called by
    `provisionFromIntakePacket`) that creates each item via `createAttentionItem` and
    swallows Postgres unique-violation errors (code 23505) for already-converted
    ordinals (skip + count as existing; no event emitted for skips). Tests call the
    helper directly: run twice for the same intake → item count unchanged; duplicate
    (intakeId, ordinal) insert → second one no-ops via the index.
  - Questions with `done && !answer` (checked without an answer) count as acknowledged:
    skip them (reviewer explicitly waved them off), but list them in the report section as
    `Acknowledged without an answer`.
  - `artifacts.openQuestions = { converted, answered, acknowledged }`.
- Skill prompt updates (both the shipped defaults and the template file bodies):
  - `DEFAULT_SCOPE_INTAKE_SKILL` (:1084) `open_questions` guidance: ask the interviewee
    once before recording; each entry is `{ "question": "...", "tag": "decision" |
    "unknown" }` — `decision` = a CompanyOS reviewer/admin can answer it at review time;
    `unknown` = nobody can answer yet; phrase each so a human can act on it.
  - `DEFAULT_INTERVIEW_TEMPLATE` (:1086) and `DEFAULT_TEMPLATE_FILES[...]interview.md`
    (:1103) packet instructions: same tagging rule, one line.
  - Note: live instances sync their own template copies from GitHub; defaults only seed
    new instances. Call this out in the PR description (re-seed or hand-edit synced
    templates to pick up the change).

### 4. Intake UI: persistent checkboxes, answer capture, MCP live refresh

**Files**: `apps/os/src/modules/intake/IntakePanel.tsx`, new
`apps/os/src/modules/intake/open-questions.ts`, `apps/os/src/modules/intake/actions.ts`

- New `open-questions.ts` module (mirrors `sidebar-state.ts` pattern: pure, unit-tested):
  `parseOpenQuestionEntries(value: unknown): OpenQuestionEntry[]` (same accepted shapes as
  the service helper), `serializeOpenQuestionEntries(entries): string` (JSON the service
  helper accepts), `OpenQuestionEntry { t, tag, done, answer }`. Move/absorb the existing
  `openQuestionText`/`parseOpenQuestions`/`deriveCheckedQuestions` logic (:158-189) into it.
- Review step:
  - Replace `checkedQuestions: boolean[]` state with `OpenQuestionEntry[]` derived state.
  - New dedicated `saveOpenQuestionsAction({ intakeId, scopePath, openQuestions:
    OpenQuestionEntry[] })` in `actions.ts` calling `api.updateIntakePacket` with ONLY the
    `openQuestions` field — no JSON-textarea parsing, so a temporarily invalid sibling
    textarea can never fail or clobber a toggle. (`saveReviewAction` stays as-is for the
    explicit Save review button.)
  - Toggling a checkbox / saving an answer sets `done`/`answer` locally, syncs the
    `questions` JSON textarea state, and persists via `saveOpenQuestionsAction` through a
    single serialized in-flight queue (latest state wins; one save at a time). Failures
    surface as a toast and revert the toggle. The Approve button awaits the pending queue
    before calling `approveIntakeAction`. Keep the completion-reward animation.
    Approved/provisioned intakes stay all-checked and read-only as today.
  - Each unresolved question row gains an inline expand with an answer input +
    "Mark answered" button: sets `answer`, `done: true`, persists the same way. Answered
    rows render the answer text under the question (muted).
  - Tag chips next to the question text: `decision` (warn tone) / `unknown` (muted); no
    chip when tag is null.
  - A one-line hint under the list: unresolved questions become "Things to resolve" items
    on the scope at provision. Approve stays UNGATED by open questions (deliberate:
    deferring unknowns is the feature).
- Interview step live refresh:
  - New `getIntakeAction({ intakeId, scopePath })` in `actions.ts` wrapping the existing
    `api.getIntakePacket` read (same shape the other actions return).
  - **Status-sync prerequisite**: `externalPackAction` (`actions.ts:57`) currently returns
    only the pack, so the client's `intake.status` stays `draft` after the DB moves to
    `awaiting_external` and a status-gated poll would never start. Change it to return
    `{ pack, intake }` (re-read the packet after assembling) and have the Interview step
    `mergeIntake` the fresh status before gating the poll.
  - In the wizard workspace, while the active intake has `status === "awaiting_external"`,
    poll `getIntakeAction` every 5s (skip when `document.visibilityState === "hidden"`).
    When the returned status is `needs_review`: run the same hydration as the paste path
    (:894-904 — setSpec/setDocs/setTasks/setWiki/setQuestions/setRisks + mergeIntake +
    onReviewed), toast "Interview results received via MCP.", stop polling. Clear the
    interval on unmount/step change.

### 5. Notification bell in the app-shell header

**Files**: new `apps/os/src/app/(app)/_components/NotificationBell.tsx`, new
`apps/os/src/app/(app)/_components/notification-actions.ts`,
`apps/os/src/app/(app)/_components/AppShellChrome.tsx`, `apps/os/src/app/(app)/layout.tsx`

- `notification-actions.ts` ("use server"): `refreshNotificationsAction(): Promise<{
  items: NotificationItem[]; total: number }>` — resolves the actor via
  `getCurrentActorPrincipalId`, calls the existing `api.listAttentionItems({ status:
  "open", limit: 15 })` (no scopePath → grant-filtered across all visible scopes,
  targeted-item filtering included) and `api.countOpenAttentionItems({ scopePath: "root",
  includeDescendants: true })`. `NotificationItem` = `{ id, title, kind, scopePath,
  createdAt }` (serializable subset; never ship full payloads to the client). Add thin
  `@/lib/api` wrappers only if `listAttentionItems`/`countOpenAttentionItems` are not
  already exposed there (check `apps/os/src/lib/api.ts`; AttentionCard already reads
  through it).
- `NotificationBell.tsx` (client): lucide `Bell` icon button, count badge (cap display at
  `9+`, hide at 0), `aria-label="Things to resolve"`, `aria-expanded`. Dropdown panel
  (right-aligned absolute, Escape + click-outside close, focus first item on open) listing
  items: title (truncate), kind label (humanized: "Open question", "Wiki proposal",
  "Graduation", "Lint finding", "Page update", "External gate"), scope chip, relative age.
  Each row is a Next `Link` to `/s/${scopePath}?tab=overview` (the scope page defaults to
  Dashboard when one exists — `s/[...path]/page.tsx:154,305` — and AttentionCard renders
  only on the overview tab) and closes the panel. Props: `initialItems`, `initialTotal`.
  Refresh: 60s interval + `window` focus listener → `refreshNotificationsAction`; pause
  the interval while the tab is hidden. Design tokens only; match `FontScaleControl`
  sizing (30px control height).
- `AppShellChrome.tsx`: new optional `notifications?: React.ReactNode` prop rendered
  FIRST in the `ml-auto` header cluster (:256-259), i.e. left of `FontScaleControl`.
- `layout.tsx`: fetch initial items/total server-side (same calls as the action; all
  users, not admin-gated) and pass `notifications={<NotificationBell initialItems={...}
  initialTotal={...} />}`. Keep the existing `alertCount` admin chip untouched.

### 5b. AttentionCard: make open_question resolvable

**Files**: `apps/os/src/modules/attention/AttentionCard.tsx`,
`apps/os/src/modules/attention/actions.ts`

- `kindLabel` (:19-25) falls through to "graduation" for unknown kinds — add an explicit
  `open_question` → "open question" label.
- Approve currently submits no `note` (`ResolveButtons` :56-77), so an `open_question`
  could never be approved from the UI. `AttentionCard` is a SERVER component — a
  statically disabled button can never enable. Add a small client component
  `OpenQuestionResolveForm.tsx` ("use client") in the same module: controlled text input
  named `note` (placeholder "Answer..."), an "Answer" (approve) submit button enabled
  only when the input is non-empty (plus `required` on the input as a fallback), and the
  existing Reject/Dismiss affordances. `AttentionCard` renders it for `open_question`
  items. `resolveAttentionFormAction` in `attention/actions.ts` must read and forward
  the `note` form field (verify — add if missing).
- Other kinds keep the current note-less server-rendered buttons.

### 6. AGENTS.md contract updates

- `apps/os/src/modules/attention/AGENTS.md`: the "Do not add polling/notifications" rule
  gets an explicit carve-out: the header NotificationBell (owner-approved 2026-07-14) is
  the sanctioned notification surface; it links here and this card stays poll-free.
- `apps/os/src/modules/intake/AGENTS.md`: document open-questions persistence, answer
  capture, MCP live refresh.
- `packages/api/src/modules/attention/AGENTS.md` + `packages/api/src/modules/intake/AGENTS.md`:
  `open_question` kind semantics (approve requires answer note), provision conversion,
  normalized open-question shape.
- `packages/db` AGENTS.md if it enumerates enums.

## Technical Considerations

- **Module boundaries**: modules never import each other's service files; business logic
  stays in `packages/api`; UI goes through `@/lib/api` wrappers and server actions.
- **Events**: `createAttentionItem` and `resolveAttentionItem` already emit events; no new
  event types needed.
- **Enum migration**: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction in some
  drizzle setups — keep it a standalone migration file, exactly like M10-02's
  `personal` scope-type migration.
- **Encoding (Windows/codex)**: write ASCII-only source (no smart quotes/em-dashes in new
  string literals); existing files use `—`-style escapes for typography — follow that.
- **Perf**: bell poll is one indexed query (attention_items scope_status_created idx) per
  60s per open tab; acceptable. No websockets.
- **Privacy**: `listAttentionItems` is already grant-filtered via `getVisibleTree` and
  respects `targetPrincipalId`; the bell must not widen visibility (send the serializable
  subset only).
- **Edge cases**: intake with 0 open questions (no report section, no items); malformed
  entries (normalize drops empties); double provision (provision is admin-gated and
  single-shot per approved intake — attention items are created in the same transaction?
  `provisionFromIntakePacket` is NOT wrapped in one transaction today; follow its existing
  sequential style); concurrent resolve (existing status-guard WHERE clause handles it).

## Files to Modify/Create

1. `packages/db/src/schema/attention.ts` (modify) — add enum value + type union.
2. `packages/db/drizzle/<new>.sql` + meta via drizzle-kit (new) — ALTER TYPE.
3. `packages/api/src/modules/attention/service.ts` (modify) — payload validator, resolve
   note requirement, decisionBody lines.
4. `packages/api/src/modules/intake/service.ts` (modify) — normalizeOpenQuestions,
   provision conversion + report section, skill prompt text updates.
5. `packages/api/src/modules/attention/attention.test.ts` (modify) — new kind tests.
6. `packages/api/src/modules/intake/intake.test.ts` (modify) — provision conversion tests.
7. `apps/os/src/modules/intake/open-questions.ts` (new) — pure parse/serialize helpers.
8. `apps/os/src/modules/intake/open-questions.test.ts` (new) — unit tests.
9. `apps/os/src/modules/intake/IntakePanel.tsx` (modify) — persistent checks, answers,
   tag chips, hint, MCP polling.
10. `apps/os/src/modules/intake/actions.ts` (modify) — getIntakeAction.
11. `apps/os/src/app/(app)/_components/NotificationBell.tsx` (new) — bell + panel.
12. `apps/os/src/app/(app)/_components/notification-actions.ts` (new) — refresh action.
13. `apps/os/src/app/(app)/_components/AppShellChrome.tsx` (modify) — notifications slot.
14. `apps/os/src/app/(app)/layout.tsx` (modify) — initial fetch + prop.
15. `apps/os/src/lib/api.ts` (modify, only if wrappers missing) — attention list/count.
16. `apps/os/src/modules/attention/AttentionCard.tsx` (modify) — open_question label +
    answer-input approve row.
17. `apps/os/src/modules/attention/actions.ts` (modify if needed) — forward `note`.
18. `packages/mcp/src/server.ts` (modify) — resolve_attention_item note contract text.
19. `packages/mcp` contract test (modify/new) — open_question approve note gate.
20. Four+ AGENTS.md files (modify) — contracts above.

## Type Definitions

- `OpenQuestionPayload` (attention service) — §2.
- `OpenQuestionEntry { t: string; tag: "decision" | "unknown" | null; done: boolean;
  answer: string | null }` (apps/os intake module) — §4.
- `NotificationItem { id: string; title: string; kind: AttentionKind; scopePath: string;
  createdAt: string }` (notification action) — §5.

## Backward Compatibility

- Existing intakes with string-array openQuestions parse unchanged (normalize accepts
  strings). Existing attention kinds unaffected. Migration is additive enum value only.
- Old synced interview templates keep producing untagged questions → tag null → still
  converted; nothing breaks.

## Test Impact

- `packages/api` intake tests: provision with mixed open questions (unanswered → attention
  items with payload/tag; answered → report section; done-no-answer → acknowledged, no
  item; empty/malformed dropped). Existing provision tests must stay green.
- `packages/api` attention tests: `open_question` approve without note throws; with note
  resolves, decision record body contains Question/Answer; reject/dismiss need no note;
  validator rejects empty question.
- `packages/api` intake tests: provision conversion run twice for the same intake creates
  no duplicate items (ordinal idempotency).
- `packages/mcp` tests: resolve_attention_item approve open_question without note errors;
  with note succeeds.
- `apps/os` new `open-questions.test.ts`: shape tolerance (strings, objects, done/answer
  round-trip, serialize→parse identity).
- UI polling/bell: covered by typecheck + manual verify (drive the app); no jsdom harness
  in repo for these components.

## To-dos

### Phase 1: Backend (db + api + tests)

- [x] attention.ts enum + types + drizzle migration
- [x] attention service: payload validator, resolve note gate, decisionBody
- [x] intake service: normalizeOpenQuestions + provision conversion + report section
- [x] intake service: skill prompt/template tagging text
- [x] attention + intake tests

- [x] MCP resolve_attention_item contract text + test

### Phase 2: Frontend (apps/os)

- [x] open-questions.ts helpers + tests
- [x] IntakePanel: persistent checkboxes via saveOpenQuestionsAction queue, answer
      capture, tag chips, hint
- [x] IntakePanel/actions: externalPackAction status sync + MCP live refresh polling
- [x] AttentionCard: open_question label + answer approve row (+ note forwarding)
- [x] NotificationBell + notification-actions + AppShellChrome slot + layout fetch
      (rows link to ?tab=overview)
- [x] AGENTS.md contract updates
