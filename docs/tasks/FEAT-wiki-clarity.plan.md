# Plan (full): A clear and trustworthy wiki

status: complete; release authorized; awaiting owner merge
type: feature
issue: #115
module: multi, split into bounded vertical slices
branch: risi-au/wiki-things-to-resolve
size: heavy
triage: orchestrate

Contract: `docs/tasks/FEAT-wiki-clarity.contract.md`
Branch: `risi-au/wiki-things-to-resolve` | Issue: #115
Owner approval: Rishi, 2026-07-19

> TRIP R2 plan. No production code before owner approval. Internal identifiers remain stable; the plain-language changes are display contracts.

## 1. Core product (keep small)

The Wiki becomes a calm knowledge workspace for ordinary business users:

1. Pages are grouped by what they are for, not by whether a person or AI first created them.
2. The Brain runs "Wiki health" checks. Its machine mode remains `lint`, but users never need to know that word.
3. Operational check output stays in structured run and attention data, not in the wiki's current-truth documents.
4. A conflict card proves the conflict with page titles and exact quotes, then offers choices that describe the outcome. A choice can apply one previewed page correction only after a concurrency check.
5. Ask OS reads the actual Things to resolve item first and then reads only its cited pages.

Ratified visible vocabulary for this change:

| Current | New user-facing wording |
|---|---|
| Lint / lint report | Wiki health / Wiki health history |
| Lint finding | Wiki question |
| Wiki lint: contradiction | Two wiki pages disagree |
| orphan (auto-fixed) | Page added to the wiki menu / Fixed automatically |
| duplicate (auto-fixed) | Duplicate page removed / Fixed automatically |
| stale | This page may be out of date |
| flagged | Needs your review |
| AI-maintained | Kept up to date by CompanyOS |
| Backlinks | Links from other pages |
| Unreviewed | Needs a quick check |
| Mark verified | Mark as correct |
| Follow / Following | Notify me / Notifications on |
| Aliases | Also known as |
| Definition | What this is |
| Details | More detail |
| Sections | Page sections |
| Form / Markdown | Simple / Advanced |
| History | Past versions |
| wiki proposal | Suggested wiki update |
| Approve / Reject on a wiki proposal | Apply update / Keep current page |

## 2. Architecture

### 2.1 Structured page purpose, no schema change

- Add a `category` frontmatter value with internal values `current-work | decisions-policies | guides-processes | reference`.
- Reserved pages map deterministically: `wiki` and `overview` to Start here; root `critical-facts` and `scope-map` to Start here; root `pattern-*` to Guides and processes.
- Missing or unknown category maps to Other pages. This is backward compatible and avoids guessing about legacy content.
- The simple editor exposes "Page type". Markdown remains canonical and round-trip safe.
- Brain output instructions require a valid page type for new/updated topic pages. The Brain may improve legacy categories over time through normal revisions; no bulk rewrite runs in this feature.

### 2.2 Operational data is not knowledge

- Stop `saveLintReport`; capability-run payloads remain the durable system history and attention items remain the human action surface.
- Define one reserved-system predicate for legacy `lint-report*` slugs and use it consistently in normal doc listing, search, recall, agent doc tools, and graph nodes.
- Direct `getDoc` remains available to authorized system/admin callers so history is retained. No delete or archive migration.
- Brain Engine ops reads structured findings from capability-run payloads and open attention items instead of parsing markdown list lines.

### 2.3 Evidence-bound wiki questions

Extend the existing JSONB payload for internal `lint_finding` items; no DB migration:

```ts
type WikiConflictPayloadV2 = {
  version: 2;
  type: "contradiction";
  relation: "scalar-mismatch" | "opposite-boolean" | "exclusive-status";
  subject: { entity: string; property: string; timeframe: string };
  explanation: string;
  claims: [
    { slug: string; title: string; quote: string; normalizedValue: string },
    { slug: string; title: string; quote: string; normalizedValue: string }
  ];
  choices: [
    { id: "first"; label: string; repair: SinglePageRepair },
    { id: "second"; label: string; repair: SinglePageRepair }
  ];
  scopePath: string;
};

type SinglePageRepair = {
  slug: string;
  title: string;
  currentMd: string;
  proposedMd: string;
};

type WikiStalePayloadV2 = {
  version: 2;
  type: "stale";
  slug: string;
  title: string;
  currentMd: string;
  reviewDueAt: string;
};
```

The Brain creates the V2 stale payload only from a current page whose `stale_after` frontmatter parses as a real elapsed date. `reviewDueAt` is that exact source value, and `currentMd` is captured from the same loaded page snapshot used to create the item.

Deterministic validation before an item is created:

- exactly two different existing page slugs;
- one of the three supported relation classes and a non-empty normalized entity, property, timeframe, and plain-language explanation;
- each exact quote occurs in its named current page;
- both claims use the same normalized entity/property/timeframe and each normalized value is present in its quote;
- scalar mismatch requires different normalized scalar values with the same unit; opposite boolean requires true/false polarity; exclusive status requires two members of the same explicit status family;
- process state and outcome state are different properties: `completed` is never treated as evidence for `approved`, `accepted`, or `successful`;
- each choice changes exactly one cited page, `currentMd` equals that current page, and `proposedMd` differs;
- no unsupported outcome inference, including treating process completion as successful approval;
- stable versioned fingerprint uses scope, subject, slugs, and quotes so legacy weak rows do not suppress a corrected finding.

Malformed, unverifiable, or weak model output is dropped into the run's output-failure diagnostics and never becomes a human task.

V1 intentionally prefers false negatives to unsafe corrections. If a real conflict does not fit a supported relation or cannot be corrected by one page change for each outcome, record it as a system-only `unsupported-conflict` diagnostic in the capability run. Do not create an actionable attention item. Multi-page correction is deferred.

### 2.4 Resolution semantics

- Add a specific human-admin attention service operation for wiki-question resolution. The generic `resolveAttentionItem` must reject every resolution for every `lint_finding`, including legacy payloads; the MCP generic resolver inherits the same hard block.
- `choose first/second`: open one database transaction, lock/re-read the open item, re-read both cited pages, revalidate both quotes, compare the target body with `repair.currentMd`, save through `saveDoc`, resolve the item, emit events, and create the decision record inside that transaction. Any failure rolls back every write and leaves the item open.
- `not a conflict`: use the same dedicated operation and transaction, require a short explanation, make no doc change, resolve as dismissed, emit the event, and record the decision.
- The event payload, attention resolution metadata, and decision body store `selectedChoiceId`, selected label/value, both source claims, changed slug, and before/after content hashes. Human-facing history states what was chosen and which page changed without exposing raw hashes in primary copy.
- Legacy/invalid `lint_finding` payloads render a compatibility state: "This older check does not include enough evidence." They offer page links when possible and "Close as unclear" only. They never show Approve/Reject and never mutate a page.
- Stale-page checks use the V2 stale payload and render as "This page may be out of date" with the page link, due date, and two non-generic paths: Open page (no resolution) and Mark as current. Mark as current requires a human-selected future `nextReviewAt`, then uses the dedicated operation and the same transaction/compare-before-write rules to call `verifyDoc`, update `verified_at`/`verified_by`/`stale_after`, resolve the item, emit events, and record the decision. No review period is hardcoded.
- Legacy or malformed stale items render the same insufficient-evidence compatibility state as old contradictions and may only use Close as unclear through the dedicated operation. Therefore every `lint_finding` subtype has a defined terminal path despite the generic resolver hard block.

### 2.5 Ask OS grounding

- Add resident-agent read tools `list_things_to_resolve` for disambiguation and `inspect_thing_to_resolve` for a selected id. Inspection returns the authorized item plus current referenced page snapshots in one service call and emits citations for those pages.
- Prompt routing: if the user mentions a notification, wiki question, or Thing to resolve, inspect those items first; fetch only referenced pages; explain the evidence and the exact effect of each action.
- Extend citation capture to `get_doc` and `inspect_thing_to_resolve` so the final explanation links to the pages it read.
- Add a loop guard response for repeated identical tool calls and a useful fallback instead of showing `(max iterations reached)` to the user.
- Keep the MCP's internal tool names additive/stable, but return enough structured detail for bots and update descriptions to explain kind-specific resolution behavior. Generic MCP resolution cannot resolve a wiki-health item.

The three-round budget is concrete: selected item inspection is one tool round, optional parallel follow-up reads are one tool round, and the final answer is the third model response. When no id is available and more than one item plausibly matches, Ask OS lists the choices and asks the user which one; it does not search broadly or spend rounds guessing.

### 2.6 Shared system-document contract

- Put the legacy system-document slug predicate in the shared documents data contract under `packages/db`, which every querying package already depends on. It owns both the pure slug classifier and the reusable Drizzle condition.
- Docs, search, memory, Brain graph/ops, and agent listing consume that one predicate; do not copy `lint-report*` tests across modules.
- The predicate changes visibility only. Authorized direct retrieval remains unchanged, and there is no row mutation or migration.

### 2.7 Module boundary and delivery shape

Issue #115 is an umbrella outcome. To honor `docs/CONSTITUTION.md`, implementation is split into module-bounded Orca tasks and reviewed as ordered slices:

1. Brain knowledge-check contract and structured run output.
2. Docs/search/memory wiki information architecture and system-page filtering.
3. Attention API/UI/MCP resolution experience.
4. Resident-agent Things to resolve grounding.
5. Brain admin surface structured history and wording.

Each worker owns one slice and its module contract/tests. Cross-slice data travels through existing public API types, JSONB payloads, or kernel events; app modules do not import sibling modules. Integration happens only after every slice passes its focused checks.

## 3. Safety invariants + risk triggers

| Trigger | Neutralization |
|---|---|
| LLM proposes a change to current business truth | Exact source quotes, existing-page checks, structured repair validation, and a required human choice |
| Page changes after the check ran | Compare current body with `repair.currentMd`; leave item open on mismatch |
| Partial or concurrent resolution | One target page per outcome, row re-read/lock, and a single DB transaction for save + resolution + events + decision |
| False-positive conflict | Supported relation classes, normalized entity/property/timeframe/value checks, and the explicit completion-is-not-success regression |
| Old malformed attention data | Read-only compatibility card; its Close as unclear action uses the dedicated operation, never the generic resolver |
| Stale checks become unclosable | V2 Mark as current outcome plus dedicated Close as unclear compatibility outcome; generic resolver remains blocked |
| Operational report contaminates retrieval | One shared DB documents-contract predicate consumed by list/search/recall/agent/graph; old data retained |
| User-facing rename breaks contracts | Display labels only; internal mode `lint`, enum `lint_finding`, routes, events, and tool/API contracts remain stable |
| Broad wiki redesign damages markdown | Frontmatter-only page type and existing structured-editor round-trip helpers; no second format |
| Access widening | Existing viewer/admin rules and targeted-item filtering remain; new agent reads run as the signed-in principal |

Owner-gated actions after implementation: staging deployment, any production deployment, and any later cleanup/archive of legacy report pages.

## 4. File-level steps

### Slice A - Brain: trustworthy Wiki health output

**Files:** `packages/brain/src/engine.ts`, `packages/brain/src/engine.test.ts`, `packages/brain/AGENTS.md`, `docs/patterns/WIKI.md`

- Replace the LLM contradiction envelope with the V2 evidence/choice/repair contract while retaining internal `lint-*` identifiers.
- Add pure validators and versioned dedupe fingerprinting.
- Stop saving markdown `lint-report` documents.
- Add page-type guidance to ingest/project/root prompts and document the taxonomy and system-page boundary.
- Rewrite deterministic finding messages in plain language for downstream ops surfaces.
- Tests: valid exact-quote conflict, missing quote rejected, missing page rejected, same slug rejected, unsafe/multi-page repair rejected, completion-versus-dismissal regression rejected, structured conflict persisted in capability run/attention, V2 stale payload copies the validated `stale_after` and current page snapshot, no new `lint-report` doc, dedupe works.

### Slice B - Docs: organized page list and clean retrieval

**Files:** `packages/db/src/schema/documents.ts` or a sibling exported documents-contract file, `packages/db/AGENTS.md`, `packages/api/src/modules/docs/service.ts`, `packages/api/src/modules/docs/docs.test.ts`, `packages/api/src/modules/docs/AGENTS.md`, `packages/api/src/modules/search/service.ts`, `packages/api/src/modules/search/search.test.ts`, `packages/api/src/modules/search/AGENTS.md`, `packages/api/src/modules/memory/service.ts`, `packages/api/src/modules/memory/memory.test.ts`, `packages/api/src/modules/memory/AGENTS.md`, `apps/os/src/modules/docs/DocsView.tsx`, `apps/os/src/modules/docs/DocEditor.tsx`, `apps/os/src/modules/docs/structured-editor.ts`, `apps/os/src/modules/docs/docs.test.ts`, `apps/os/src/modules/docs/AGENTS.md`

- Add pure page-type/frontmatter helpers and return the display category from `listDocs`.
- Extend `verifyDoc` additively with optional `nextReviewAt`; when supplied it must be a future date and updates `stale_after` in the same markdown-safe frontmatter write. Existing callers keep current behavior.
- Add and consume the single shared system-document predicate. Exclude reserved system-report slugs from normal listing, full-text/vector search, memory recall, and later graph/ops reads while preserving direct authorized retrieval.
- Replace author grouping with the ratified page-purpose groups and reserved-page ordering.
- Add Page type to Simple editing without disturbing unknown markdown/frontmatter.
- Apply the complete visible wording table above, including accessible labels/tooltips and empty/loading/error states.
- Remove raw slug display from primary proposal/page copy; keep technical identity in links or secondary details only.
- Tests: frontmatter parse/serialize, legacy fallback, reserved mapping, grouping, system-page exclusion in list/search/vector/recall, direct retrieval retained, plain labels.

### Slice C - Attention: actions that match outcomes

**Files:** `packages/api/src/modules/attention/service.ts`, `packages/api/src/modules/attention/attention.test.ts`, `packages/api/src/modules/attention/AGENTS.md`, `apps/os/src/modules/attention/AttentionCard.tsx`, new focused wiki-question form/helper/tests under `apps/os/src/modules/attention/`, `apps/os/src/modules/attention/AGENTS.md`, `apps/os/src/app/(app)/_components/NotificationBell.tsx`, `packages/mcp/src/server.ts`, `packages/mcp/src/ping.test.ts`, `packages/mcp/AGENTS.md`

- Add typed V2 payload parsing, make the generic resolver reject all `lint_finding` rows, and add the dedicated transactional resolution operation.
- Render evidence as two readable claim panels with page links, exact quotes, a short "Why this matters", choice previews, Apply this correction, Open pages to compare, and Not a conflict. Render V2 stale items with due date, Open page, a labeled next-review date input, and Mark as current.
- Render wiki proposals as Suggested wiki update with Apply update / Keep current page.
- Render legacy findings as non-actionable compatibility cards; map all wiki-related kind labels to plain language in the card and notification bell.
- Expand MCP list output with summary and structured detail while keeping tool names/signatures additive; generic resolution rejects every wiki-health item.
- Tests: chosen repair commits page revision/events/decision/item together; injected failure rolls all of them back; concurrent/stale body keeps item open; audit data maps the exact choice and before/after hashes; not-a-conflict changes no doc; V2 stale Mark as current updates verification/review frontmatter and audit trail atomically; past/invalid next-review dates fail and leave the item open; legacy stale closes only as unclear; viewer denied; no lint finding can resolve through the generic resolver; rendered buttons/copy are kind-specific; no visible raw finding title.

### Slice D - Ask OS: explain the actual notification

**Files:** `packages/api/src/modules/agent/service.ts`, `packages/api/src/modules/agent/agent.test.ts`, `packages/api/src/modules/agent/AGENTS.md`, `apps/os/src/modules/agent/AGENTS.md` only if the display contract changes

- Add list and one-call inspection tools using the existing attention service and principal. Inspection includes current authorized cited pages and citations.
- Add notification-first system guidance, structured tool results, `get_doc` citations, duplicate-call loop protection, and a plain fallback.
- Tests script the issue path: inspect selected item (or list once to disambiguate) -> optional parallel follow-up reads -> answer with evidence/action explanation in no more than three model responses. Assert no broad repeated search, repeated identical call, or max-iterations placeholder.

### Slice E - Brain admin: Wiki health history

**Files:** `packages/api/src/modules/brain-surfaces/service.ts`, `packages/api/src/modules/brain-surfaces/brain-surfaces.test.ts`, `packages/api/src/modules/brain-surfaces/AGENTS.md`, `apps/os/src/app/(app)/brain/engine/page.tsx`, `apps/os/src/modules/brain/AGENTS.md`

- Build graph flags and engine history from structured attention/capability-run payloads, not markdown report parsing.
- Change visible headings, stats, modes, empty states, and actions to Wiki health language. Internal form value remains `lint`.
- Add confirmation/clear descriptions for token-spending manual actions if not already present.
- Consume the shared system-document predicate for graph visibility.
- Tests cover structured history, open-question flags, no `lint-report` dependency, plain display labels, and root-admin gating.

### Documentation-with-contract updates

- Update every touched module `AGENTS.md` in the same slice.
- Update `docs/design/NOMENCLATURE.md` to ratify the new visible vocabulary and explicitly preserve internal identifiers.
- Update `packages/api/src/modules/docs/self-docs.ts` so Ask OS and seeded CompanyOS manual pages teach the new concepts.

## 5. Deployment

No schema migration and no automatic data cleanup.

After all slices are integrated and reviewed:

1. Build the release candidate locally.
2. Deploy to staging through the existing CompanyOS lane.
3. Smoke test as a signed-in non-technical owner on an AirBuddy-like project:
   - page grouping and labels;
   - legacy report absent from normal Wiki/search;
   - legacy contradiction card has no Approve button;
   - valid seeded conflict can be explained and safely corrected;
   - Ask OS explains that item with page links and stops normally;
   - Brain Engine says Wiki health and reads structured history.
4. Obtain owner approval before any production deploy.

## 6. Optional hardening (deferred by default)

- Bulk classify legacy pages with a reviewed proposal queue.
- Archive or export old `lint-report*` pages after owner review.
- Support a correction that intentionally edits more than one page atomically.
- Add configurable review cadences and a guided stale-page renewal form.
- Rename internal `lint` identifiers in a versioned API/schema migration. This is not needed for user clarity.
- Redesign non-wiki admin/developer surfaces outside issue #115.

## 7. Test plan + acceptance

Focused checks per worker:

- package/module typecheck and ESLint for owned files;
- relevant Vitest files listed in each slice;
- pure UI helper/component tests for grouping, copy, payload compatibility, and action availability.

Integrated gate, run by the coordinator:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Additional evidence:

- `rg` audit proves no user-facing wiki strings contain `lint`, `lint finding`, `AI-maintained`, `Backlinks`, `Unreviewed`, or `Mark verified` in owned UI surfaces.
- Encoding sweep stays clean; new source literals are ASCII.
- Browser verification at desktop and narrow widths in light and charcoal themes.
- Keyboard navigation, focus visibility, form labels, radio grouping, and status announcements checked on the conflict flow.
- Gate receipt: `docs/tasks/FEAT-wiki-clarity.gate-receipt.md`, fingerprinted to the final candidate.
- Fresh Grok medium diff review after the testing gate. Any requested changes invalidate the receipt until re-run.

Acceptance is exactly the checklist in `FEAT-wiki-clarity.contract.md`; no substitute completion claims.

## 8. Estimate + checkpoints

- Size: Heavy, R2. Expected five bounded implementation slices plus integration.
- Checkpoint 1: owner approves product contract and this plan.
- Checkpoint 2: Slice A structured contract and false-positive regression green; review before UI depends on it.
- Checkpoint 3: Slices B and C integrated; browser-drive page organization and resolution flow.
- Checkpoint 4: Slices D and E integrated; Ask OS loop regression and Brain ops history green.
- Checkpoint 5: full gate receipt and fresh Grok review APPROVED.
- Checkpoint 6: staging smoke evidence, finish report, owner release decision.

## Don't

- Do not touch `USER DATA/`, `legacy/`, `.env*`, or secrets.
- Do not rename internal enums, routes, schema values, events, or the developer code-quality command.
- Do not add a migration, dependency, background worker, second content format, or broad refactor.
- Do not delete/archive legacy reports or rewrite existing wiki pages in bulk.
- Do not allow a generic approval path for any old or unsupported wiki-health payload.
- Do not commit from implementer workers; the coordinator owns integration commits and PRs.

## 9. Finish report - 2026-07-19

Implementation outcome:

- Replaced technical Wiki wording with the approved plain-language vocabulary while preserving internal identifiers and integration contracts.
- Added page-purpose grouping, safe Wiki health questions, audited human-admin resolution, legacy report isolation, grounded Ask OS inspection, and structured Wiki health history.
- Addressed every P0, P1, and P2 raised by the fresh Grok review. Final Grok verdict: APPROVED.

Gate evidence:

- `pnpm typecheck`: PASS, 14/14 tasks.
- `pnpm lint`: PASS, 14/14 tasks; encoding and design-token checks pass.
- `pnpm test`: PASS, 537 tests across 58 files.
- `pnpm --filter @companyos/os build` with a process-only placeholder `DATABASE_URL`: PASS, 34/34 pages generated.
- `git diff --check`: PASS, with only the existing CRLF normalization warning for the Brain engine file.

Acceptance and deviations:

- Eight functional acceptance checks are complete.
- Authenticated local browser acceptance passed on 2026-07-20 as `verify-bot` with root Owner access. Computer-use checks covered the root Wiki and editor, Things to resolve, and Brain Wiki health at desktop and a narrower 1118 px window in Light and Dark - Charcoal themes. The local data set had no open Wiki question, so the evidence-and-resolution card is supported by focused API/UI tests rather than a seeded browser mutation.
- The documented local password-reset recipe was used with owner authorization. The exact throwaway grant, principal, auth user, and empty personal scope were deleted afterward; `verify-bot` retained its root Owner grant. No business Wiki or attention data was changed.
- The documented end-ritual file `C:\Users\rishi\.agents\rishi-dev-process\core\SELF-IMPROVE.md` was not present, and no alternate ritual file was discoverable under `C:\Users\rishi\.agents`; no ritual mutation was performed.

Release checkpoint:

- Candidate is code-review approved and automated-gate green.
- No commit, push, pull request, staging deploy, production deploy, migration, or environment-file change was performed.
- The owner authorized publishing on 2026-07-20. The coordinator commit and PR proceed in this release step; the required owner merge remains the final repository checkpoint.
