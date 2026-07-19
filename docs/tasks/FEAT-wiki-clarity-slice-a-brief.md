# FEAT-wiki-clarity Slice A: trustworthy Wiki health output

Role: Codex medium implementer. Work in the current Orca worktree. Do not commit.
Use `apply_patch` for every source/document edit. If `apply_patch` is blocked, stop and report the blocker; do not switch to PowerShell, Python, shell redirection, or another scripted write path.

Read first:

1. `AGENTS.md`, `ONBOARDING.md`, `docs/CONSTITUTION.md`
2. `packages/brain/AGENTS.md`
3. `docs/tasks/FEAT-wiki-clarity.contract.md`
4. `docs/tasks/FEAT-wiki-clarity.plan.md`, especially Slice A and sections 2.1-2.4
5. Current `packages/brain/src/engine.ts`, `packages/brain/src/engine.test.ts`, and `docs/patterns/WIKI.md`

## Scope

Own only:

- `packages/brain/src/engine.ts`
- `packages/brain/src/engine.test.ts`
- `packages/brain/AGENTS.md`
- `docs/patterns/WIKI.md`

Do not edit the approved contract/plan, other modules, schema, migrations, lockfiles, `.env*`, `USER DATA/`, or `legacy/`.

## Implement

1. Keep all internal identifiers stable: `lint`, `lint-scope`, `lint_finding`, `LintFinding`, and existing run mode/API values remain.
2. Replace the contradiction LLM output contract with the approved V2 evidence contract:
   - relation is exactly `scalar-mismatch | opposite-boolean | exclusive-status`;
   - normalized subject has non-empty entity/property/timeframe;
   - exactly two claims from different existing pages, each with title, exact quote, normalized value;
   - exactly two choices, one for each claim, each with a one-page repair `{slug,title,currentMd,proposedMd}`;
   - plain-language explanation and stable version `2`.
3. Add deterministic pure validation against the already-loaded current docs:
   - referenced pages exist and titles/current bodies match current state;
   - exact non-empty quote occurs in the named page;
   - both claims describe the same normalized entity/property/timeframe;
   - normalized values occur in the quotes;
   - scalar mismatch accepts different scalar values only when units match;
   - opposite boolean accepts true/false polarity only;
   - exclusive status accepts different members of one explicit status family only;
   - process completion is never equivalent to approved/accepted/successful. The exact issue regression `intake workflow completed` versus `intake dismissed` must be dropped;
   - each choice changes exactly one cited page, targets the other/losing claim as appropriate, has currentMd byte-equal to that page, and proposedMd differs;
   - unsupported or multi-page repairs never create attention items.
4. Invalid/weak output increments the existing output-failure diagnostics with a useful reason/excerpt and is retained only in structured capability-run diagnostics. Prefer false negatives.
5. Use a versioned dedupe fingerprint containing scope, relation, normalized subject/timeframe, slugs, and quotes. Legacy weak items must not suppress a corrected V2 item.
6. Create V2 stale payloads from deterministic frontmatter only: `version:2`, `type:"stale"`, slug, title, currentMd snapshot, and `reviewDueAt` copied from a valid elapsed `stale_after` value.
7. Stop calling/removing the `saveLintReport` path. A Wiki health run must not create or update `lint-report` documents. Capability-run payload and attention items remain the system history.
8. Keep deterministic safe maintenance behavior for index links and exact duplicates, but rewrite their messages in calm plain language suitable for the later Wiki health history UI. No raw user-facing `orphan`, `duplicate`, `stale`, `flagged`, or `auto-fixed` wording in these messages.
9. Add page-purpose guidance to Brain prompts/output instructions so new/updated topic markdown carries frontmatter category values `current-work | decisions-policies | guides-processes | reference`. Reserved pages keep deterministic placement documented in the approved plan. Do not implement the docs UI or parser here.
10. Update `docs/patterns/WIKI.md` and `packages/brain/AGENTS.md` with the structured evidence contract, supported conflict classes, page-purpose taxonomy, operational-data boundary, and no-report behavior. Use plain user terminology but document stable internal names where needed.

## Tests

Add focused regression coverage for:

- valid exact-quote V2 conflict creates one structured attention item and appears in capability-run payload;
- missing quote/page, same slug, mismatched subject/timeframe, invalid relation/value pair, unsafe currentMd, no-op repair, and multi-page repair are rejected;
- completion-versus-dismissal fixture is rejected and creates no attention item;
- legacy weak finding does not suppress a later valid V2 item;
- valid elapsed `stale_after` creates a V2 stale payload with the exact date/currentMd; invalid/future dates do not;
- no `lint-report` document is created or changed;
- existing safe index-link and exact-duplicate maintenance remains;
- mandatory JSON envelope tests reflect V2;
- page-purpose instruction is present.

Run the focused Brain test suite and feasible package typecheck/lint commands. The coordinator owns the root gate.

## Done report

Report every changed file, tests/commands and results, any deviations, and any follow-up needed by later slices. On a rate or usage limit, print a line beginning `LIMIT-ALERT:` and stop. Do not commit.
