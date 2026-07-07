# M8-06: Codebase documentation (workbench repos → technical wiki pages)

status: done
module: packages/brain extension (no new package)
branch: task/M8-06

## Goal

The engine also documents code: for every scope with a workbench, maintain a small set of
technical topic pages in that scope's wiki (architecture, stack, integrations,
deploy/ops) distilled from the repo — openwiki's job, done natively through the same
brain loop, delta-driven by workbench events.

## Context

- Workbenches map one repo per top-level scope (provisioning module); `GitHubClient`
  (packages/api/lib) is the only GitHub access path.
- Workbench events (M7-02) already deliver push signals with changed paths — the delta
  source, so runs only read what changed.
- WIKI.md placement rules apply: these are wiki topic pages (`code-architecture`,
  `code-stack`, `code-integrations`, `code-ops` — stable slugs, update-in-place,
  Sources cite commit SHAs/paths instead of record ids).
- In-repo AGENTS.md files remain the coding agents' in-context contract — the wiki pages
  are the OS-side view for humans, the wizard, and cross-scope reasoning, not a
  replacement.

## Pre-implementation analysis gate

Write docs/tasks/M8-06-codebase-documentation.analysis.md covering:

1. What the first full-repo pass reads (tree + key files, size caps) vs what delta
   passes read (changed paths only) — token budget for each.
2. Which repo files are authoritative inputs (README, AGENTS.md, manifests, workflows,
   compose) vs sampled source.
3. How pattern distillation (M8-02 root pass) should use these pages ("our shopify
   builds use stack X") without copying client code details into root pages.

## Do

1. **Engine extension**: a `code-docs` pass in packages/brain, per scope with a
   workbench: initial bootstrap (repo tree + authoritative files → seed the four topic
   pages) then delta runs triggered by workbench push events (changed paths → update
   only affected pages). Same principal, budget key, report_run, and update-in-place
   rules as every other engine pass.
2. **Page contract**: stable `code-*` slugs; frontmatter carries `repo`, `last_commit`
   (SHA the page reflects), plus the standard bi-temporal fields; Sources cite commit
   SHAs and file paths; wikilinks connect to the scope's business pages (e.g.
   `code-integrations` ↔ `meta-ads-strategy`).
3. **Budget discipline**: per-run file-read and token ceilings; oversized repos get
   summarized shallowly rather than blowing the cap; skipped-due-to-budget is reported,
   not silent.
4. **Config**: per-scope opt-out flag (some workbenches are trivial); default on.
5. **Tests**: mocked GitHubClient fixtures — bootstrap seeds the pages, a push event
   updates only affected pages, `last_commit` advances, budget cap truncates cleanly
   with a report, opt-out respected, no-change push is a cheap no-op.

## Don't

- Don't clone repos or shell out to git — GitHubClient reads only.
- Don't copy file contents wholesale into pages — distill; link paths/SHAs.
- Don't write into the repo (this pass is read-only toward GitHub; managed AGENTS.md
  writing stays in provisioning).
- Don't document the companyos repo itself into a client wiki (root/system scopes
  excluded unless explicitly configured).
- Don't let code pages drift from the update-in-place rule (no changelog-style appends —
  that's what records/workbench events are for).

## Acceptance criteria

- [ ] Bootstrap on a fixture repo produces the four `code-*` pages with frontmatter,
      SHA-cited Sources, and index links
- [ ] A push event touching one area updates only the affected page(s); `last_commit`
      advances; unrelated pages untouched
- [ ] Budget cap: oversized fixture repo yields shallow pages + a reported truncation,
      never a failed run
- [ ] Opt-out flag suppresses the pass for that scope
- [ ] Root pattern pages (M8-02) can reference these pages without client code details
      leaking into root (covered by a distillation fixture test)
- [ ] All suites green
