# M8-04: Creation wizard (`packages/wizard`) — intelligent scope onboarding

status: done
module: new package `packages/wizard` + apps/os UI + packages/mcp + central skills repo
templates + in-OS template editor
branch: task/M8-04

## Goal

Replace blank scope creation with a brain-powered onboarding flow. Creating a project or
scope opens a wizard that: asks template-driven framing questions; consults the brain for
similar existing patterns ("a meta-ads scope already runs for airbuddy — reuse that
template?") and can provision directly from existing knowledge; otherwise assembles an
external interview pack for any chat model, with paste-back and MCP return paths; then
review → approve → deterministic provisioning. Skippable, resumable, and the owner can
edit the wizard's templates at any time.

Supersedes the M7-04 external-intake-packets brief. Key inversion: **scope-first** — the
scope always exists before intake; external agents fill packets for intakes the OS
opened, never propose structure that doesn't exist.

## Context

- `createNewScope` (apps/os `(app)/_components/actions.ts`) + NewScopeDialog is the
  current creation path — the wizard attaches immediately after it.
- `provisionScope` (M4-04) is the only provisioning engine; the wizard prepares specs,
  never duplicates the logic.
- Brain (M8-02) supplies `pattern-*` pages; recall/hybrid search (M8-01/03) powers
  similarity detection. Wizard runs as a system principal for brain reads, surfacing
  suggestions to the creating user.
- Skills module (M4-06) syncs the central skills repo; `GitHubClient` (packages/api/lib)
  can write files back for the in-OS template editor.
- Records module `createSystemRecord` (M7-02) for system-authored records.
- Docs/tasks/wiki creation paths exist (saveDoc, tasks module, WIKI.md conventions).

## Pre-implementation analysis gate

Write docs/tasks/M8-04-creation-wizard.analysis.md covering:

1. Packet parse strategy for paste-back (fenced JSON block contract, zod validation,
   markdown-only fallback) and how validation errors guide the user.
2. Reuse flow mechanics: what a `pattern-*` page must contain for one-click "use this
   template" (provision spec + doc/task/wiki seeds) and what happens when it's partial.
3. Wizard state machine (statuses below) and exactly what each UI step persists.
4. Template file format in the skills repo (frontmatter + sections the wizard parses).
5. Permission matrix: create/resume/edit/approve/provision per role; MCP tool gating.

## Do

1. **Tables** (`intake_packets` + events via kernel): `id`, `scope_id` (required — the
   already-created scope), `status` (`draft | awaiting_external | needs_review |
   approved | provisioned | rejected | dismissed`), `template_slug`, `answers` jsonb
   (framing), `packet_md`, `research_sources` jsonb, `proposed_provision_spec` jsonb,
   `proposed_docs/tasks/wiki_updates` jsonb, `open_questions` jsonb, `risk_notes` jsonb,
   `reuse_pattern_slug` nullable, `source_engine/model` nullable, `submitted_by`,
   `approved_by` nullable, timestamps. Every transition emits `intake.*` events
   (submitted/updated/approved/rejected/provisioned/dismissed) — the brain hooks these.
2. **Wizard flow** (UI on the scope page, auto-opened after create; also from the resume
   card):
   a. **Framing**: template-driven branching questions (project kind, size, workbench?,
      Plane?, agent token?) → drafts the provision spec skeleton.
   b. **Brain check**: semantic search over `pattern-*` + scope indexes with the framing
      answers; matches surface as cards ("meta-ads pattern — in use at airbuddy [link if
      viewer+]. Use this template?"). Accept → prefill spec + doc/task/wiki seeds from
      the pattern page → jump to review (external interview skipped). Attribution of the
      source scope shown only when the user has viewer+ there; the pattern itself is
      client-agnostic and always usable.
   c. **External pack**: assemble programmatically (interview template + framing answers
      + parent get_context for sub-scopes + packet JSON schema + intake id). Two
      copy-button variants: paste-back ("end with one fenced ```json packet```") and MCP
      ("call submit_intake_packet with intake id X when done"). Status →
      `awaiting_external`.
   d. **Return**: paste box parses/validates (zod; errors shown precisely;
      markdown-only accepted as packet_md with empty proposals), or the packet arrives
      via MCP and the wizard shows it received. Status → `needs_review`.
   e. **Review**: rendered packet_md, sources, open questions, risk notes; editable
      provision spec and doc/task/wiki drafts. Approve / reject (reason) / back to
      external.
   f. **Provision**: approved only, admin on the scope; calls `provisionScope` with the
      final spec, then creates docs/tasks/wiki via existing services; saves the final
      packet as a report record (createSystemRecord) linked to the intake; links created
      artifacts back. Shows created/existing/manual steps. Status → `provisioned`.
3. **Skip/resume**: "Skip setup" leaves a blank scope + `draft` intake and a dismissible
   "Setup incomplete — resume" card on the scope page; the card reopens the wizard at the
   persisted step. Dismiss → `dismissed` (re-openable from the scope's Intake section).
4. **Templates in the skills repo**: `scope-intake` SKILL.md (external-agent operating
   guide: read parent context first, cite sources, separate facts from assumptions,
   packet schema, wrap-up ritual, CompanyOS-is-authoritative rule) + template files for
   framing flows and interview variants (new project / new sub-scope). Synced via the
   skills module; the wizard parses them at runtime.
5. **In-OS template editor**: admin surface listing wizard templates with markdown
   editing; save commits to the skills repo via GitHubClient (author attribution in the
   commit) and triggers a resync. Root-admin gated.
6. **MCP tools**: `submit_intake_packet` (fills an `awaiting_external` intake by id
   with editor+ on the scope; also accepts creating a `needs_review` intake directly on
   an existing scope), `list_intake_packets`, `get_intake_packet`,
   `update_intake_packet` (pre-approval), `approve_intake_packet` and
   `provision_from_intake_packet` (admin-gated; descriptions warn agents never to call
   them without explicit human instruction).
7. **Intake queue**: scope page Intake section + global `/admin/intake` (status, scope,
   submitter, age) for packets awaiting review — including agent-submitted ones.
8. **Tests**: full state machine, permission matrix, paste parse (valid/invalid/
   markdown-only), MCP submit correlation by intake id + subtree denial, reuse prefill
   from a fixture pattern page, provision calls provisionScope exactly once with the
   edited spec, report record + links created, all events emitted, skip/resume/dismiss,
   template parse from fixture skill files, editor commit path with mocked GitHubClient.

## Don't

- No OS-native interview chatbot; the deep interview stays external.
- Never provision on submit or on approve alone — provision is its own explicit act.
- No structure creation by external agents: MCP intake tools operate on existing scopes
  only, within the token's subtree.
- Don't duplicate or bypass `provisionScope`; don't hand-build GitHub URLs.
- Don't store scraped pages or external chat transcripts unless the user pastes them
  into packet_md deliberately.
- Don't put an LLM call in the wizard's own critical path (brain reads + programmatic
  assembly only).
- Don't leak client-identifying details through pattern suggestions to users without
  viewer+ on the source scope.

## Acceptance criteria

- [ ] Create scope → wizard opens; skip leaves blank scope + resume card; close/resume
      restores the exact step; dismiss is reversible from the Intake section
- [ ] Framing + brain check: with a seeded airbuddy-like pattern page, creating a
      similar scope surfaces the reuse card; accepting prefills spec + seeds and skips
      the external step; provisioning from it yields a fully seeded scope
- [ ] External pack contains template, answers, parent context (sub-scope case), schema,
      and intake id in both variants
- [ ] Paste-back parses a valid packet, rejects a malformed one with actionable errors,
      accepts markdown-only; MCP submit_intake_packet fills the same intake by id and is
      denied outside the token's subtree
- [ ] Review edits persist; approval alone provisions nothing;
      provision_from_intake_packet / the Provision button work only after approval and
      call provisionScope
- [ ] Final packet saved as a linked report record; docs/tasks/wiki created and linked
- [ ] All intake.* events emitted; brain targeted-ingest hook fires on provisioned
- [ ] scope-intake skill + templates synced and listable; in-OS editor commit + resync
      round-trip works (mocked GitHub)
- [ ] /admin/intake shows agent-submitted and wizard packets; permissions enforced
