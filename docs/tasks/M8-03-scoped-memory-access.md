# M8-03: Scoped memory access (recall_memory + critical-facts in get_context)

status: done
module: packages/api (new memory service in brain or api) + packages/mcp + connect panel
+ provisioning managed-AGENTS.md template
branch: task/M8-03

## Goal

Every agent working a scope can draw on the brain without seeing beyond its walls: a
`recall_memory` MCP tool returns distilled memory relevant to the token's subtree — its
own wiki plus generalized root pattern pages — and `get_context` carries the instance
critical-facts block. Token minting in the Connect panel includes this access.

## Context

- M8-02 maintains the content this reads: scope wikis, root `pattern-*`,
  `critical-facts`.
- Hybrid search + doc_links (M8-01) do the retrieval; this brief is mediation + surface.
- Root wiki is above non-root tokens' grants — recall must be a mediated read (system
  evaluates, filtered result returned), not a grant widening.
- get_context has context profiles (M7-03 lean/standard/deep) — critical-facts must be
  cheap enough to include everywhere.
- Managed AGENTS.md playbook (M6-05, provisioning/agents-md.ts) defines the session
  ritual agents follow.

## Pre-implementation analysis gate

Write docs/tasks/M8-03-scoped-memory-access.analysis.md covering:

1. Raw hits vs LLM-synthesized answers from recall_memory (recommend raw pages/snippets:
   deterministic, cheap; synthesis is the caller's job).
2. Exactly which root pages are recallable by non-root tokens (`pattern-*`,
   `critical-facts` only?) and how that allowlist is enforced structurally.
3. Whether memory access is a token flag or default-on for all agent tokens.

## Do

1. **Service** `recallMemory(db, { query, scopePath? }, actor)`: resolves the effective
   scope (token's scope if narrower), retrieves via hybrid search restricted to: the
   scope subtree's wiki pages + nearest-ancestor wiki (existing walk) + the root
   allowlist (`pattern-*`, `critical-facts`). Returns typed hits (page, scope, snippet,
   confidence/frontmatter surfaced). Root allowlist reads run mediated as system —
   never by widening the caller's grants — and are structurally limited to the
   allowlisted slugs. Usage-logged with redaction like search.
2. **MCP tool** `recall_memory` with an agent-facing description: "query the OS's
   distilled memory before trawling records; returns wiki knowledge for your scope plus
   company-wide patterns." Registered in packages/mcp alongside search/get_context.
3. **Connect panel**: token minting includes memory access (per the analysis decision:
   flag or default-on), shown in the connections table; MCP Manager reflects it.
4. **get_context**: include the root `critical-facts` body (verbatim, it is tiny) in all
   profiles; lean profile may truncate but never drops it. Section estimates (M7-03)
   account for it.
5. **Managed AGENTS.md template**: session-start ritual gains "recall_memory before
   external research or record trawling"; regeneration only touches the managed block,
   as always.
6. **Tests**: subtree restriction (client A token never receives client B pages even on
   semantic match), root allowlist enforcement (a non-allowlisted root page never
   returned), ancestor-walk correctness, critical-facts present in every profile,
   Connect minting + table display, MCP tool wiring, usage redaction.

## Don't

- Don't widen any token's actual grants — mediation only, allowlist structural.
- Don't return raw records or non-wiki docs through recall_memory (search exists for
  that, under normal grants).
- Don't make recall_memory call an LLM.
- Don't let critical-facts grow unbounded — enforce/truncate at a token ceiling.
- Don't break existing get_context consumers or profile estimates.

## Acceptance criteria

- [ ] Agent token scoped to `clientA/**` recalls its wiki + root patterns; assertions
      prove zero cross-client page leakage and zero non-allowlisted root reads
- [ ] recall_memory listed and callable over MCP with the given description
- [ ] get_context includes critical-facts in lean, standard, and deep profiles within
      the token budget
- [ ] Connect panel mints tokens with memory access; connections table shows it
- [ ] Managed AGENTS.md template mentions recall_memory; regeneration preserves human
      content byte-for-byte outside the managed block
- [ ] Usage events logged redacted; all suites green
