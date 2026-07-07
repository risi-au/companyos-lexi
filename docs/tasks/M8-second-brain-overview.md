# M8: The Second Brain + Creation Wizard (milestone overview)

status: design ratified 2026-07-07 (owner + architect, this session)
supersedes: M7-01 (wiki gardener — absorbed, pilot-client requirement dropped),
M7-04 (external intake packets — rewritten around the wizard)

## Vision

Every OS instance ships with a **second brain**: an alive, self-maintaining knowledge
layer that knows everything happening in the instance — new projects, scopes, repo
updates, Plane tasks, sessions, decisions — and how it's all connected. On top of it, a
**creation wizard** replaces blank scope creation: it consults the brain, recognizes
patterns ("a meta-ads scope already runs for airbuddy — reuse that template?"), and
either provisions from existing knowledge or stages an external deep interview.

The brain follows the Karpathy LLM-wiki pattern (records = immutable raw layer; wiki =
LLM-maintained compounding synthesis; WIKI.md = schema), which our existing wiki
convention already implements structurally. M8 builds the missing 90%: the maintenance
intelligence. References absorbed (conventions, not code): karpathy llm-wiki gist,
ar9av/obsidian-wiki, eugeniughelbur/obsidian-second-brain, langchain-ai/openwiki.

## Ratified decisions

1. **Scope-first only.** Every intake is anchored to a scope that already exists in the
   OS. External agents never propose structure that doesn't exist; they fill packets for
   intakes the wizard opened (correlated by intake id). Paste-back AND MCP return paths
   both supported.
2. **Packaging:** wizard and brain are monorepo packages with a product-grade boundary
   (`packages/brain`, `packages/wizard`); they talk to the OS only through the same
   service/MCP contracts agents use. Same deploy, extractable later.
3. **Substrate:** native docs module — NOT an external vault/tool. The brain's instance-
   level KB is the **root scope's wiki** (placement rule: knowledge attaches to the
   highest scope where it is true; cross-client patterns are root truth). Root admin has
   full read/edit in the Docs tab; everyone else keeps existing grant behavior.
4. **Engine home:** native OS subsystem (scheduled worker inside the deploy, capabilities
   registry, LiteLLM role aliases + budget-capped virtual key), not n8n.
5. **One engine, no pilot:** the per-scope gardener (ex-M7-01) and the brain's learning
   loop are one system. It maintains every scope wiki AND distills upward into root
   pattern pages.
6. **Codebase documentation included:** the engine also reads workbench repos and
   maintains technical topic pages per scope (openwiki's job, done natively).
7. **Semantic layer:** pgvector embeddings (via LiteLLM alias) over wiki pages + records;
   search gains hybrid FTS+vector mode. Supersedes the search module's "no embeddings"
   restriction.
8. **Templates:** wizard framing questions, interview templates, and prompt scaffolds
   live in the central skills repo (beside `scope-intake` SKILL.md), synced via the
   skills module, editable in an in-OS admin editor that commits back and resyncs.
9. **Brain surfaces:** (a) Ask OS at root becomes brain-aware (conversational surface);
   (b) a root-admin-only graph app — interactive global graph of pages/scopes/links,
   obsidian-graph-style — plus engine ops (run history, lint reports, contradiction
   flags, spend); (c) the Docs tab (raw pages).
10. **Scoped memory for agents:** every agent token gets brain access scoped to its
    subtree — a `recall_memory`-style MCP tool returning scope-relevant distilled
    memory (own wiki + generalized root patterns), mediated so unrelated clients never
    leak. Connect panel token minting includes this.
11. **Wizard intelligence:** lives off the brain, not raw history. Similarity detection =
    semantic search over root pattern pages + scope indexes. When the pattern is known,
    the wizard can provision directly from existing knowledge (docs/tasks/wiki seeds +
    provision spec) with owner confirmation; when novel, it stages the external
    interview pack. Infra provisioning (workbench/modules/Plane/agent token) is decided
    from wizard answers + brain knowledge, executed only via `provisionScope`.
12. **Wizard resilience:** intake is a record on the scope, never wizard-local state.
    Skip = blank scope; close = "Setup incomplete — resume" card until provisioned or
    dismissed.

## Engine conventions (from the references)

- **Delta ingest:** new records/events since last successful run (capability run
  timestamps); no-op runs are cheap and reported.
- **Self-rewriting merge:** one input may update many pages; update-in-place per
  WIKI.md; contradictions reconciled, not appended.
- **Cross-linking:** wikilink-style links between pages, extracted to a links table
  (feeds the graph view and backlinks); unlinked-mention discovery.
- **Lint pass:** scheduled health check — contradictions, stale claims, orphans,
  duplicates; auto-fix or flag for review.
- **Provenance:** Sources sections tag claims extracted / inferred / ambiguous, citing
  record ids.
- **Bi-temporal frontmatter:** learned-at vs stale-at timestamps + confidence levels.
- **Critical-facts block:** a ~100–200-token always-fresh instance summary the engine
  maintains; `get_context` serves it so every session starts oriented.
- **Cadence:** event hooks for immediacy (intake provisioned, scope created) + nightly
  deep pass + weekly lint (schedule owner-tunable).

## Brief breakdown

- **M8-01 semantic layer:** pgvector migration, embedding pipeline (LiteLLM), hybrid
  search mode, wikilink/backlink extraction + links table. Unblocks everything.
- **M8-02 knowledge engine core:** `packages/brain` — ingest/merge/cross-link/lint
  loops, provenance + bi-temporal conventions, per-scope wiki maintenance, root pattern
  distillation, critical-facts block, capability registration, budgets, event hooks.
- **M8-03 scoped memory access:** recall tool(s), Connect token memory access,
  `get_context` critical-facts integration.
- **M8-04 creation wizard:** `packages/wizard` — intake tables (scope-first lifecycle:
  draft → needs_review → approved → provisioned/rejected, all events), wizard UI flow
  (framing → brain reuse detection → external pack → paste/MCP return → review/edit →
  provision), `scope-intake` skill + templates in skills repo, in-OS template editor,
  MCP intake tools.
- **M8-05 brain surfaces:** root-admin graph app + engine ops pages; brain-aware Ask OS
  at root.
- **M8-06 codebase documentation:** workbench repo ingestion into scope wikis
  (technical topic pages), via the engine's standard loop.

Dependencies: 01 → 02 → {03, 05, 06}; 04 needs 02 + 03.
