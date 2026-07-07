# Wiki Pattern

The wiki is not a module. It is a convention on top of the docs module (KB): a curated,
updated-in-place knowledge layer that agents maintain, humans correct, and every session
reads before working. Records are what happened; the wiki is what is true now.

## One wiki per top-level scope

- The wiki lives at the **top-level scope** (client/project) and covers its whole subtree.
  Same consolidation rule as workbenches (one repo per top-level scope) and Plane
  workspaces.
- Deep scopes do NOT get their own wikis by default. Their sessions and Docs UI resolve
  the **nearest ancestor wiki** (ancestor walk — same idiom as workbench resolution).
- **Graduation exception**: a sub-scope that becomes its own world may graduate to its own
  wiki. This is a deliberate act — log a `decision` record when it happens. The graduated
  wiki covers its subtree; the ancestor walk stops there.

## Placement rules (the two attachment rules)

1. **Records attach to the exact scope where the work happened.** Precise, append-only.
2. **Knowledge attaches to the highest scope where it is true.** "Checkout uses plugin X"
   is client-level truth even if a meta-ads session discovered it — it goes in the
   client wiki, not a sub-scope doc.

## Page structure

- **Index page**: slug `wiki`, title "Wiki". What this scope is + a linked map of every
  topic page. The index is the front door; if a page isn't linked from the index
  (directly or via another linked page), it's orphaned — fix it.
- **Topic pages**: one durable topic = one page with a stable slug (`website`,
  `checkout`, `meta-ads-strategy`). Namespace by area when needed (`meta-ads-strategy`,
  not `strategy`).
- **Update in place.** Never create `website-2`. The docs module keeps revisions
  automatically (`saved_by` per revision records who wrote what) — history is free,
  so pages stay current without losing the past.
- Each topic page ends with a **Sources** section: record ids + dates it was distilled
  from, and links to related pages. This is the backlink graph, in plain markdown.

## Links and backlinks

- Link to another page in the same wiki with `[[slug]]`, for example `[[checkout]]`.
- Link across wikis with `[[scope-path:slug]]`, for example
  `[[airbuddy/marketing:meta-ads-strategy]]`.
- Slugs use the docs module slug format: lowercase letters, numbers, and hyphens.
- The docs service extracts these links on save into `doc_links`. Targets may be
  unresolved until the linked page exists; backlink and graph queries resolve them when
  possible.
- Do not rely on UI rendering for wikilinks in M8-01. They are a markdown convention and
  a data contract for the semantic graph.

## What goes where

| Content                                  | Home                          |
|------------------------------------------|-------------------------------|
| Durable truth (architecture, strategy, decisions in force) | Wiki topic pages |
| What happened (work done, changes, findings) | Records: changelog / report |
| Choices and their rationale at a moment in time | Records: decision       |
| Scratch, working notes, session thinking | Records: note                 |
| Human free-form docs (briefs, contracts notes) | Docs, outside the wiki slugs — same tab, same store |

## Who writes the wiki

1. **Sessions at wrap-up** (managed AGENTS.md ritual, M6-05): when work changes standing
   truth, update the affected topic page — not just log the change.
2. **The gardener** (registered capability, post-M6): scheduled job that reads new
   records across the subtree and distills them upward into topic pages; repairs
   structure — merges duplicates, fixes links, updates the index. Its prompt IS this
   contract. Pilot on one client before fleet-wide.
3. **Humans**: read and correct the same pages in the Docs tab. No separate human
   section — authorship lives in revision history, not in the tree.

## Surfacing and retrieval

- `get_context` includes the doc index for the scope, resolved via ancestor walk to the
  nearest wiki (M6-09) — every session starts knowing the wiki exists.
- `search(scope, query)` (M6-09) spans records + docs in the subtree — the wiki is how
  agents connect today's work to what happened months ago without trawling records.
- Docs tab UI pins the `wiki` index first; sub-scopes show an "Inherited wiki" section
  pointing at the ancestor's pages (M6-09).

## Anti-patterns

- A wiki per nested scope (fragmentation — the tree gives addressing, the wiki gives
  consolidation).
- Author-split sections (human docs vs agent docs) — one shared wiki; revisions carry
  authorship.
- Append-only wiki pages ("Update 2026-07-06: ...") — that's a record's job; pages state
  current truth.
- Duplicating git history or commit detail into pages — link the record, which links the
  work.
