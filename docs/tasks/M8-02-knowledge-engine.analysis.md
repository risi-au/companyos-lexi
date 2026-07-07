# M8-02 pre-implementation analysis

## 1. Scheduling mechanism

Use a protected/manual trigger surface first, with compose-level cron calling the same route for schedules. Do not use an in-process interval.

Rationale: the engine can run longer than a request-scale UI action and must remain single-path whether started by a human, cron, or future ops UI. A cron caller hitting an agent-token protected route works with the existing capability/report-run pattern, survives app restarts, avoids duplicate timers in horizontally scaled Next processes, and keeps manual ingest/lint/backfill first-class. The route will stay thin: authenticate, parse mode/scope, inject env-bound LiteLLM config, and call `packages/brain`.

## 2. Ingest batching

Run ingest as per top-level scope passes, followed by one root distillation pass. Each top-level pass reads records/events/sessions for that scope subtree since the last successful `brain-engine` ingest report for that scope. Root distillation reads the refreshed scope wiki summaries and updates root reserved pages.

Token budget is enforced per engine execution with a default from `BRAIN_RUN_TOKEN_CEILING` and an explicit per-call override for tests/manual runs. Each LLM fixture/client call receives a remaining budget and reports estimated or actual token usage. When the next call would exceed the remaining ceiling, the engine stops cleanly, writes a partial `report_run`, logs usage, and leaves remaining scopes for the next run.

## 3. Merge safety around human edits

The engine updates in place through `saveDoc`, never direct table writes. Before a merge prompt, it reads the current document body and asks the LLM for a complete updated page that preserves human-authored sections unless the new source explicitly supersedes a claim. The prompt includes the WIKI.md contract, current page, relevant records/events, and the instruction skill loaded at run time.

The flow avoids clobbering fresh human edits by treating current document content as authoritative context, preserving headings not touched by sources, and requiring provenance tags for every changed claim. If the page was updated after the run started, the engine re-reads it immediately before saving and re-runs the merge against that fresh body. Revisions remain the audit and rollback layer.

## 4. Lint auto-fix vs flag-only

Auto-fix:
- missing index links for existing topic pages
- missing wikilinks suggested by exact page-title/slug mentions
- exact duplicate topic pages with equivalent normalized body; archive the loser and keep the older/stabler slug

Flag-only:
- contradictions or near-duplicates asserting different truths
- stale claims where `stale_after` has elapsed
- ambiguous provenance or low-confidence claims that need a human
- any merge where the engine cannot prove exact duplication

Flag-only findings are written to a `lint-report` doc in the affected wiki and emitted as a warning alert through `report_run`.

## 5. Frontmatter schema

Every maintained wiki page uses YAML frontmatter:

```yaml
---
learned_at: "2026-07-07T00:00:00.000Z"
verified_at: "2026-07-07T00:00:00.000Z"
stale_after: "2026-10-07T00:00:00.000Z" # optional, omit when unknown
confidence: high # high | medium | low
---
```

`learned_at` is the earliest source timestamp represented on the page. `verified_at` is the latest engine or human verification timestamp. `stale_after` is optional and marks claims that need review after a known expiry. `confidence` is page-level synthesis confidence; claim-level nuance belongs in the Sources section using `extracted`, `inferred`, or `ambiguous` tags with record ids.
