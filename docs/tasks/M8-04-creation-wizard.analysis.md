# M8-04 creation wizard analysis gate

## 1. Paste-back packet parse strategy

External paste-back uses a strict preferred contract and a permissive fallback.

- Preferred contract: the external agent ends with one fenced JSON block whose info
  string is `json` and whose object is an intake packet. The wizard extracts the last
  matching fenced block, parses JSON, and validates it with zod before mutating the
  intake.
- Packet fields: `packet_md` markdown narrative, `research_sources` array/object,
  `proposed_provision_spec`, `proposed_docs`, `proposed_tasks`, `proposed_wiki_updates`,
  `open_questions`, `risk_notes`, optional `source_engine`, optional `source_model`.
  Unknown keys are ignored for safety; markdown stays in `packet_md`.
- Validation failures do not change persisted proposals. The parser returns field-level
  paths and messages such as `proposed_provision_spec.scopePath is required` or
  `proposed_tasks must be an array`, and the UI shows them above the paste box so the
  user can ask the external agent to repair only the malformed section.
- Markdown-only fallback: if there is no JSON fence, the full pasted text is accepted as
  `packet_md` with empty proposals and status `needs_review`. This preserves deliberate
  pasted transcripts or notes without pretending they are structured provisioning input.
- Invalid JSON inside a `json` fence is a hard parse error, not markdown fallback,
  because the user deliberately supplied structured output and needs exact repair
  guidance.

## 2. Reuse flow mechanics

Reuse reads brain-maintained root pattern pages (`pattern-*`) plus scoped indexes through
the existing memory/search surface. A pattern page is one-click reusable when its
frontmatter/body expose enough structured payload for deterministic provisioning:

- `provision_spec`: a JSON object whose `scopePath` can be replaced with the newly
  created scope path and whose module/workbench/Plane/agent settings are complete.
- `doc_seeds`, `task_seeds`, and `wiki_updates`: JSON arrays or maps containing markdown
  bodies and titles/slugs where applicable.
- `pattern_slug`, `title`, `summary`, and optional `source_scope_path` for attribution.

If the pattern has a valid `provision_spec`, accepting the card persists
`reuse_pattern_slug`, prefills `proposed_provision_spec` and available seeds, and moves
the intake to `needs_review`, skipping the external step. If seeds are partial, the
review step marks the missing artifact groups as empty/editable rather than blocking.
If the provision spec is missing or invalid, the pattern is surfaced as context only:
the user can copy its summary into the external pack, but one-click reuse is disabled.
Source-scope attribution is shown only when the actor has viewer+ on that scope; the
client-agnostic pattern title/summary remains visible and usable.

## 3. Wizard state machine and persisted UI steps

Statuses are `draft`, `awaiting_external`, `needs_review`, `approved`, `provisioned`,
`rejected`, and `dismissed`.

- Create scope: creates a `draft` intake tied to the already-created scope. The wizard
  can open immediately from the `?wizard=` URL or from the resume card.
- Framing step (`draft`): persists `template_slug`, `answers`, and an initial
  `proposed_provision_spec` skeleton. Updating answers emits `intake.updated`.
- Brain check step (`draft` or `needs_review` after accept): persists
  `reuse_pattern_slug`, prefills proposal/seeds from a pattern, and emits
  `intake.updated`.
- External pack step (`awaiting_external`): persists current answers/spec skeleton and
  the assembled pack metadata by transitioning to `awaiting_external`, emitting
  `intake.submitted`.
- Return step (`needs_review`): paste-back or MCP submission persists `packet_md`,
  sources, proposals, open questions, risk notes, source engine/model, and emits
  `intake.submitted`.
- Review step (`needs_review`): edits persist proposal fields and notes; approval
  changes only status and `approved_by`, emits `intake.approved`; rejection stores
  risk/reason text and emits `intake.rejected`; returning to external changes status
  back to `awaiting_external`.
- Provision step (`approved` to `provisioned`): admin-only explicit action calls
  `provisionScope` exactly once with the final edited spec, creates requested docs/tasks
  and wiki pages through existing services, saves a final report record through
  `createSystemRecord`, links artifact ids into the intake proposals, and emits
  `intake.provisioned` through `emitEvent` so `handleBrainEvent` can target-ingest it.
- Skip leaves the scope and `draft` intake unchanged. Dismiss changes status to
  `dismissed` and emits `intake.dismissed`; reopening from the Intake section changes it
  back to `draft`.

## 4. Skills repo template format

The central skills repo owns the external operating guide and wizard templates.

- `scope-intake/SKILL.md` has YAML frontmatter with `name: scope-intake`,
  `description`, `scope_pattern`, and `domains`, followed by sections the external
  agent reads verbatim: CompanyOS authority rule, parent-context ritual, source citation
  rules, facts-vs-assumptions separation, packet schema, and wrap-up ritual.
- Template files are markdown with frontmatter:
  `slug`, `title`, `kind` (`framing` or `interview`), `applies_to`
  (`project` or `sub-scope`), `version`, and optional `domains`.
- Parsed sections use H2 headings:
  `## Framing questions`, `## Branches`, `## Interview guide`,
  `## Provision skeleton`, and `## Packet instructions`.
- Framing questions are simple line items with stable ids, labels, type hints, options,
  and optional branch predicates. Provision skeleton blocks are fenced JSON and are
  merged with answers to build the draft spec. Unparseable templates are listed in the
  editor with errors and are not used by the wizard.

## 5. Permission matrix

- Create intake: the scope must already exist. Humans need admin+ on the parent for
  scope creation, then editor+ on the created scope to edit the draft. Agents may only
  submit to existing scopes inside their subtree.
- Resume/list/get: viewer+ on the intake scope. Global `/admin/intake` requires root
  admin and shows all statuses/scopes; scope Intake section shows only that scope.
- Edit/submit/update pre-approval: editor or agent on the intake scope, only while
  `draft`, `awaiting_external`, or `needs_review`.
- Approve/reject/dismiss/reopen: admin+ on the intake scope; approval never provisions.
- Provision: admin+ on the intake scope, status must be `approved`, and the explicit
  UI button or MCP tool call must be user-instructed.
- Template editor: root admin only; saves through `GitHubClient.putFile`/repo APIs and
  triggers `syncSkills`.
- MCP tools: `submit_intake_packet`, `list_intake_packets`, `get_intake_packet`,
  `update_intake_packet`, `approve_intake_packet`, and
  `provision_from_intake_packet` all authenticate the token principal and delegate to
  the API service. The submit/update tools require editor/agent on the existing scope;
  approve/provision require admin+ and their descriptions warn agents not to call them
  without explicit human instruction.
