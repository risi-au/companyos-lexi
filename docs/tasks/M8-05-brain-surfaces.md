# M8-05: Brain surfaces (root-admin graph app + engine ops + brain-aware Ask OS)

status: todo (blocked on: M8-02; graph data from M8-01)
module: apps/os (new root-admin surface) + agent module tool additions
branch: task/M8-05

## Goal

Make the second brain visible and steerable. A root-admin-only surface with an
interactive global graph of the instance's knowledge (obsidian-graph-style, built
natively), engine operations (runs, lint findings, spend), and a brain-aware Ask OS so
the root admin can converse with full instance context.

## Context

- doc_links + getLinkGraph (M8-01) provide edges; scopes tree + wiki pages provide
  nodes; lint reports + capability runs (M8-02) provide ops data; usage module (M7-03)
  provides spend.
- Ask OS (agent module, M3-04) is the existing tool-loop chat on every scope, using the
  caller's grants — extend it, don't build a new chat.
- Reference for feel only: Obsidian's global graph (force-directed, tint by type,
  click-through). We build our own renderer; no external service.

## Pre-implementation analysis gate

Write docs/tasks/M8-05-brain-surfaces.analysis.md covering:

1. Graph rendering approach (canvas force-graph lib vs hand-rolled d3/webgl) sized for a
   few thousand nodes; SSR/CSR split in Next.js.
2. Graph data shaping: node types (scope, wiki page, pattern page, workbench),
   edge types (wikilink, source-record link, scope hierarchy), and payload size limits.
3. Where the surface lives (`/brain` route group, root-admin gated) and nav placement.

## Do

1. **Graph view** (`/brain`): force-directed global graph — nodes tinted by type
   (scope / wiki page / root pattern / lint-flagged), edges from doc_links + scope
   hierarchy; hover shows title + scope; click opens the doc/scope; filters by scope
   subtree, node type, and "flagged only"; search-to-focus. Handles the current
   instance size smoothly and degrades gracefully (cluster/limit) beyond it.
2. **Engine ops** (`/brain/engine`): run history from capability runs (status, duration,
   pages touched, records distilled, tokens), lint findings surfaced from lint-report
   docs with links to the flagged pages, manual triggers (ingest / lint / backfill —
   wired to M8-02's trigger surface), and brain token spend from usage data.
3. **Brain-aware Ask OS**: agent module gains `recall_memory` and `search` as loop tools;
   when the conversation scope is root, prefetch `critical-facts` into the system
   context. Root admin asking "what happened across the OS this week?" gets a grounded
   answer through existing tools (records rollup, search, recall).
4. **Access**: everything under `/brain` requires root admin (owner/admin on root
   scope); nav entry hidden otherwise. Ask OS changes respect existing grants
   everywhere (non-root users simply get recall_memory scoped to their subtree).
5. **Tests**: graph data endpoint shape + gating (non-root denied), ops page data
   assembly, manual trigger gating, agent-loop tool additions with fixture LLM (tool
   available, root prefetch present, non-root scoping respected).

## Don't

- No separate deployable or external graph/visualization service.
- No new chat UI — Ask OS is the conversational surface.
- Don't expose `/brain` data through any non-root path or widen any grants.
- Don't block page render on graph size — stream/limit.
- Don't add write actions to the graph view (read/navigate only; ops actions live on
  the engine page).

## Acceptance criteria

- [ ] `/brain` renders the global graph from fixture data: correct nodes/edges/tints,
      filters and search-to-focus work, click-through opens the doc
- [ ] Non-root users: no nav entry, direct access denied (page + data endpoints)
- [ ] `/brain/engine` shows run history, lint findings with page links, spend; manual
      ingest/lint triggers fire and are gated
- [ ] Ask OS at root answers an instance-wide question via recall/search tools in the
      fixture loop, with critical-facts prefetched
- [ ] Ask OS on a client scope uses recall_memory scoped to that subtree only
- [ ] All suites green
