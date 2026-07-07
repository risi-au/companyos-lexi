# M8-02: Knowledge engine (`packages/brain`) — the second brain's maintenance loops

status: done
module: new package `packages/brain` + capability registration + small apps/os trigger
surface + docs/patterns/WIKI.md conventions update
branch: task/M8-02

## Goal

The engine that makes every wiki alive. One native subsystem (superseding the M7-01 n8n
gardener design — no pilot client) that runs the Karpathy llm-wiki loop over the whole
instance: delta ingest of new records into per-scope wiki pages, self-rewriting merges,
cross-linking, a lint pass, provenance and bi-temporal conventions, root-level pattern
distillation, and an always-fresh critical-facts block. Conventions absorbed from
karpathy's llm-wiki gist, ar9av/obsidian-wiki, and eugeniughelbur/obsidian-second-brain —
behaviors, not their storage.

## Context

- docs/patterns/WIKI.md is the schema/contract; the engine's prompts restate it. Extend
  it (see Do 1) rather than fork it.
- Raw layer feeds: records (subtree listing with `since`, M6-08), workbench events
  (M7-02), sessions (M6), search + doc_links + embeddings (M8-01).
- Outputs: saveDoc only (revisions preserve everything — safe by construction).
- Capabilities registry + ALERTS.md: register, scoped runs, report_run, alert on failure.
- LiteLLM role aliases (`cheap` for routine distillation, `analysis` for lint/patterns),
  dedicated budget-capped virtual key for the brain. Usage module (M7-03) meters spend.
- docs/tasks/M8-second-brain-overview.md holds the ratified design.

## Pre-implementation analysis gate

Write docs/tasks/M8-02-knowledge-engine.analysis.md covering:

1. Scheduling mechanism inside the deploy (protected trigger route + compose-level cron
   vs in-process interval) — pick one, justify, keep manual trigger first-class.
2. Ingest batching: per top-level scope pass vs global pass; token budget per run.
3. How self-rewriting merges avoid clobbering fresh human edits (revisions exist, but
   design the prompt/flow to update-in-place around human content).
4. What lint can auto-fix vs must only flag.
5. Frontmatter schema for bi-temporal facts + confidence (exact fields).

## Do

1. **Conventions (WIKI.md update)**: wiki page frontmatter gains `learned_at`,
   `verified_at`, `stale_after` (optional), `confidence` (`high|medium|low`); Sources
   entries tag claims `extracted | inferred | ambiguous` with record ids. Root wiki gains
   reserved pages: `critical-facts` (~100–200 tokens, instance vital signs), `scope-map`
   (what exists and how it connects), and `pattern-*` topic pages (client-agnostic
   playbooks distilled from repeated structures across scopes). Root wiki is root-admin
   territory; everyone else keeps normal grant behavior.
2. **Package** `packages/brain`, product-grade boundary: imports `@companyos/api`
   services only (like the agent module) and runs as a dedicated system principal with
   the capability's grants. No direct schema imports from other modules' tables; no UI.
3. **Ingest loop** (nightly + manual): per top-level scope, delta since last successful
   run (capability run timestamps) → new records + workbench events + session wrap-ups →
   LLM pass (skill body + wiki index + affected topic pages) → update-in-place page
   writes via saveDoc, provenance-tagged, cross-links added using doc_links/semantic
   candidates. No new inputs → cheap no-op run, reported.
4. **Root distillation** (after scope passes): maintain `scope-map` and
   `critical-facts`; detect repeated structures across scope wikis (semantic search over
   indexes + pattern candidates) and write/refresh `pattern-*` pages. Pattern pages must
   be client-agnostic: structure, playbook, pitfalls, typical provision spec — sourced
   with scope references but containing no client-confidential specifics.
5. **Lint pass** (weekly + manual): contradictions (semantic near-duplicates asserting
   different truths), orphaned pages (not reachable from index), duplicate topics, stale
   claims (`stale_after` elapsed, or contradicted by newer records). Auto-fix: index
   links, exact-duplicate merges (archive loser), missing cross-links. Flag-only:
   contradictions and stale claims → written to a `lint-report` doc on the affected
   scope's wiki + alert (severity warning) so M8-05 can surface them.
6. **Event hooks**: scope created, intake provisioned/rejected (M8-04 emits these),
   workbench event bursts → targeted immediate ingest for that scope, same code path as
   scheduled runs.
7. **Skill**: replace the planned `wiki-maintenance` skill in the central skills repo —
   the engine's operating instructions (WIKI.md contract + provenance + bi-temporal +
   memory-precedence rule). The engine loads it via the skills module at run time so
   owner edits tune the engine without a deploy.
8. **Registration + budgets**: capability `brain-engine` on root; report_run every
   execution (pages touched, records distilled, tokens); hard monthly budget on the
   virtual key; per-run token ceiling env knob.
9. **Trigger surface**: admin-gated route/server-action to run ingest/lint/backfill
   manually (M8-05 gives it UI; a minimal admin button is fine here).
10. **Tests**: PGlite + injected LLM fixtures (no live calls): delta computation, no-op
    runs, page update-in-place with provenance, root pattern distillation from fixture
    scopes, lint detection matrix (orphan/dupe/contradiction/stale), event-hook targeted
    ingest, budget ceiling stops a run cleanly, report_run + alert emission.

## Don't

- No n8n. No new chat UI. No graph UI (M8-05).
- Never delete docs or records; archive only for exact-duplicate merges.
- Never write client-specific facts into root `pattern-*` pages.
- No vendor-named models; aliases + the brain's virtual key only.
- Don't import other modules' schemas or bypass the service layer.
- Don't block or slow user-facing writes — hooks are async, engine work is background.
- Don't exceed the per-run token ceiling — stop, report partial, continue next run.

## Acceptance criteria

- [ ] Nightly ingest over fixture scopes updates the right topic pages in place, with
      provenance-tagged Sources and bi-temporal frontmatter
- [ ] No-new-records run: success report, zero LLM calls, zero doc writes
- [ ] Root wiki: `critical-facts`, `scope-map`, and at least one distilled `pattern-*`
      page emerge from fixtures with two similar scopes; pattern page is client-agnostic
- [ ] Lint run produces a lint-report doc + warning alert for seeded contradictions and
      orphans; auto-fixes index links and exact dupes only
- [ ] Scope-created and intake events trigger targeted ingest
- [ ] Capability registered; every run visible via report_run with token counts; budget
      ceiling enforced in tests
- [ ] Engine instructions load from the synced skill; editing the skill changes behavior
      without code change
- [ ] WIKI.md updated (frontmatter, provenance, reserved root pages, wikilinks already in
      from M8-01); all suites green
