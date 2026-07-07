# M8-07: Creation wizard recheck — external-agent briefing + brain-informed reuse

status: todo
module: packages/wizard + packages/api (intake) + companyos-skills repo (scope-intake)
branch: task/M8-07

> **Process note (owner request 2026-07-07): this is deliberately NOT an implementation
> guide.** The wizard is the front door of the OS and the owner wants a detailed design
> discussion at implementation time. This doc records the audit findings and the recheck
> checklist; the Do-list gets written together with the owner before any codex dispatch.

## Goal

The wizard's promise is: the brain checks whether something similar already exists and
the new scope starts from those learnings, while an external agent (Claude/ChatGPT/Kimi
web — owner's choice) runs a well-briefed interview with the end user. The M8-04
implementation shipped the machinery (statuses, paste-back parsing, provisioning,
template editor) but the *content and context* of the external pack is far below that
promise. This task is a full recheck of the wizard flow, then targeted fixes.

Constraint that must survive: **no LLM call in the wizard critical path.** The pattern
stays: brain pre-computes learnings nightly; wizard-time similarity is retrieval;
synthesis happens in the external agent.

## Audit findings (2026-07-07, code as of `81c4fcf`)

1. **External pack barely briefs the agent.** `assembleExternalPack`
   (packages/wizard/src/index.ts:246) sends one framing sentence, the framing answers,
   parent context, a 2-line interview guide, and the packet schema. Nothing explains
   what CompanyOS is (scopes/docs/records/Plane/workbench/brain wiki), why the interview
   exists, how to conduct it with the end user (question cadence, facts vs assumptions,
   citing sources), or what good looks like per packet field.
2. **`scope-intake/SKILL.md` is 4 lines** (DEFAULT_SCOPE_INTAKE_SKILL,
   packages/api/src/modules/intake/service.ts:613) and the seeded skills-repo copy is
   byte-matched to it — same thinness in production.
3. **Reuse patterns never reach the external agent.** `findReusePatterns`
   (intake/service.ts:363) surfaces root `pattern-*` pages in the wizard UI only;
   `assembleIntakeExternalPack` (intake/service.ts:445) does not include matches, nor
   the accepted pattern's seeds. The "use those learnings" half of the promise is
   missing from the pack.
4. **Similarity matching is lexical term-overlap only** — no embeddings even when the
   `embed` alias is live. Fine as fallback, weak as the primary matcher.
5. **Top-level scopes get an empty pack.** `parentPath` is null when `scopePath` has no
   `/` (intake/service.ts:452) → no parent context, and no fallback to root
   `scope-map` / `critical-facts`.
6. **markdownOnly paste-back is accepted silently** (parsePastedIntakePacket) — a paste
   without the fenced JSON degrades to packet_md only; worth rechecking whether the
   review UI makes that degradation loud enough.

## Recheck checklist (walk these end-to-end during the design discussion)

- [ ] Persona-level dry run: owner plays end user, external agent gets the current pack
  verbatim — record where it flounders. Use that transcript to drive the rewrite.
- [ ] Pack content: what should the CompanyOS explainer, interview-conduct rules, and
  per-field packet guidance actually say? (Owner voice matters here.)
- [ ] Where briefing content lives: skills repo (`scope-intake/SKILL.md` + templates)
  vs hardcoded defaults in service.ts — keep byte-parity rule or make repo win?
- [ ] Reuse patterns in the pack: how many matches, summary vs full body, and how the
  accepted pattern's `provision_spec`/seeds are presented to the agent.
- [ ] Context fallback for top-level scopes: include root `scope-map` +
  `critical-facts`; decide size caps.
- [ ] Semantic matching in `findReusePatterns` via `embed` alias with lexical fallback
  (fail-open, keeps no-chat-LLM rule). Depends on OPENAI_API_KEY being live.
- [ ] Both pack variants (paste-back and MCP) get the same upgrades; MCP variant should
  point the agent at `get_context`/`search` for deeper digging.
- [ ] Framing templates (new-project / new-sub-scope): are the 3–5 framing questions
  still the right ones now that the pack will carry real context?
- [ ] Review surface: does /admin/intake show the reviewer what the external agent was
  told (pack snapshot), not just what came back?

## Don't (already settled, not up for re-discussion)

- No chat-LLM call inside wizard/intake request paths.
- No new scope doc for this — M8-07 owns the whole recheck.
- Don't fork template content: skills repo and DEFAULT_TEMPLATE_FILES stay in sync
  (whichever sync rule the discussion picks).
- provisionScope stays a separate post-approval act; statuses/events unchanged.

## Acceptance criteria (final list agreed at design discussion; these are the floor)

- [ ] External pack explains CompanyOS, the interview's purpose, conduct rules, and
  per-field packet guidance — validated by a fresh external-agent dry run
- [ ] Matched reuse patterns (and accepted-pattern seeds) are included in the pack
- [ ] Top-level scope packs include root context fallback
- [ ] Skills repo templates and in-code defaults updated together
- [ ] 284+ tests stay green; new tests cover pack assembly variants
