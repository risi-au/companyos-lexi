# M7-04: External onboarding intake packets (interview -> provision plan)

status: todo (blocked on: M6-09 shipped; M7-03 optional but recommended for token tuning)
module: packages/api (new module `intake`) + packages/mcp + apps/os
branch: task/M7-04

## Goal

High-reasoning external agents can interview the owner about a new project or new scope,
use browsing/file access/subscription models outside CompanyOS, then submit a structured
native intake packet to CompanyOS. The OS stores the packet, lets a human review and edit
the proposed plan, and only then runs deterministic provisioning to create scopes,
GitHub structure, starter docs/wiki/tasks, and records.

This keeps the exploratory interview in the best available external tool while making
CompanyOS the durable handoff, approval, and provisioning system.

## Context

- M4-04: `provision_scope` already performs the deterministic 80%: scopes, modules,
  workbenches, GitHub skeleton, managed AGENTS.md, Plane adoption/manual steps.
- M4-06: skills are synced through CompanyOS. The external agent should use an onboarding
  skill that explains the interview process and packet schema.
- M6-05: managed AGENTS.md defines session behavior and memory precedence.
- M6-09: `get_context`, `search`, and wiki surfacing let an external agent understand an
  existing parent project before proposing a sub-scope.
- M7-01: the wiki gardener later distills approved intake records/docs into durable wiki
  truth.
- Owner decision: no n8n bridge for v1. Intake packets are native OS records/data with a
  first-class review/provision lifecycle.

## Mental model

External agents are the interview/research surface. CompanyOS is the authority that
receives the finished packet and decides what becomes real.

```
External agent + onboarding skill
    -> optional get_context/search/wiki reads through MCP
    -> interview + research + brainstorm
    -> submit_intake_packet
    -> OS review/edit/approve
    -> provision_scope + starter docs/tasks/wiki
```

The agent may recommend structure. It must not silently create the structure unless an
admin explicitly approves the packet.

## Pre-implementation analysis gate

Before coding, write a short analysis note in the PR/commit body covering:

1. Which packet fields are required for v1 vs useful later.
2. How new-project intake differs from new-sub-scope intake.
3. How the OS avoids blindly trusting externally researched claims.
4. Which parts of the proposed plan should be editable before approval.
5. What permission level is required to submit, approve, and provision a packet.

If the analysis suggests a narrower v1 is better, keep the schema extensible but implement
the smaller path first. Do not build an OS-native interview chatbot in this task.

## Do - packet format

Define a stable packet contract used by the skill, MCP tool, and UI:

```ts
type IntakeMode = "new_project" | "new_scope";

interface IntakePacketInput {
  mode: IntakeMode;
  parentScopePath?: string;        // required for new_scope, omitted/root for new_project
  proposedScopePath: string;
  title: string;
  packetMd: string;                // human-readable interview/research output
  answers?: Record<string, unknown>;
  researchSources?: { title?: string; url?: string; note?: string }[];
  proposedProvisionSpec?: ProvisionSpec;
  proposedDocs?: { slug: string; title: string; bodyMd: string; scopePath?: string }[];
  proposedTasks?: { title: string; descriptionMd?: string; scopePath?: string }[];
  proposedWikiUpdates?: { slug: string; title: string; bodyMd: string; scopePath?: string }[];
  openQuestions?: string[];
  riskNotes?: string[];
}
```

Rules:

- `packetMd` is the readable source of truth for the review.
- JSON fields are machine-actionable proposals derived from the packet.
- External research stays cited; uncited claims should be marked as assumptions.
- `proposedProvisionSpec` is a draft, never executed on submit.

## Do - schema/API

1. New module-owned tables:
   - `intake_packets`: id, mode, parent_scope_id nullable, proposed_scope_path, title,
     packet_md, answers jsonb, research_sources jsonb, proposed_provision_spec jsonb,
     proposed_docs jsonb, proposed_tasks jsonb, proposed_wiki_updates jsonb,
     open_questions jsonb, risk_notes jsonb, status
     (`draft | needs_review | approved | provisioned | rejected`), source_engine nullable,
     source_model nullable, submitted_by, approved_by nullable, provisioned_scope_id
     nullable, created_at, updated_at.
   - Optional `intake_packet_events` only if the event table is not enough for review
     comments/history. Prefer kernel events first.
2. Services in `packages/api/src/modules/intake/`:
   - `submitIntakePacket(db, input, actor)` - editor/agent on parent scope for
     `new_scope`; root admin or explicitly allowed root-level agent for `new_project`.
     Stores packet with status `needs_review`. Emits `intake.submitted`.
   - `listIntakePackets(db, { scopePath?, status? }, actor)` - viewer on requested scope
     or root admin for global review.
   - `getIntakePacket(db, { id }, actor)` - viewer on parent/proposed scope branch.
   - `updateIntakePacket(db, { id, patch }, actor)` - editor/admin before approval;
     emits `intake.updated`.
   - `approveIntakePacket(db, { id }, actor)` - admin on parent/root; emits
     `intake.approved`.
   - `rejectIntakePacket(db, { id, reason }, actor)` - admin on parent/root; emits
     `intake.rejected`.
   - `provisionFromIntakePacket(db, deps, { id }, actor)` - approved packets only; calls
     the existing provisioning service, then creates proposed docs/tasks/wiki records as
     applicable. Emits `intake.provisioned`.
3. Keep provisioning deterministic. The intake module prepares and approves inputs; it
   does not duplicate `provisionScope`.

## Do - MCP tools

Add tools with clear descriptions for external agents:

- `submit_intake_packet(input)` - primary wrap-up tool for external interviews.
- `list_intake_packets({ scope?, status? })`
- `get_intake_packet({ id })`
- `update_intake_packet({ id, patch })`
- `approve_intake_packet({ id })` - admin-gated.
- `provision_from_intake_packet({ id })` - admin-gated and approval-required.

Tool descriptions must tell agents:

- For new scopes, call `get_context(parentScopePath)` and `search(parentScopePath, ...)`
  before interviewing.
- Submit the packet when the interview/research is complete.
- Do not call approve/provision unless the human explicitly instructs it and the token has
  admin rights.

## Do - UI

1. Admin/Scope UI:
   - "Intake" section on scope pages and a global `/admin/intake` queue.
   - List packets by status, mode, parent scope, proposed scope, submitter, age.
   - Detail view with rendered packet markdown, research sources, open questions, risk
     notes, proposed provision spec, docs/tasks/wiki previews.
2. Review flow:
   - Edit proposed scope path, provision spec, docs/tasks/wiki drafts before approval.
   - Approve, reject, or request more information.
   - Provision button appears only after approval and only for admins.
   - Provision result shows created/existing/manual steps from `provisionScope`.
3. After provisioning:
   - Create/link a report record containing the final packet.
   - Link generated docs/tasks/wiki pages back to the intake packet id.
   - Show packet status as `provisioned` with the resulting scope path.

## Do - onboarding skill

Add or update a synced skill, e.g. `scope-intake`, for use in Claude/Hermes/ChatGPT/Grok
or any MCP-capable external surface.

The skill must include:

- Brand-new project interview template.
- Existing-project/new-scope interview template.
- Instructions to use `get_context`, `search`, and wiki docs for new sub-scopes.
- Browser/research guidance: cite sources and separate facts from assumptions.
- Packet output schema.
- Wrap-up ritual: call `submit_intake_packet` and save a short report if useful.
- Rule: CompanyOS is authoritative; external chat memory is not.

## Don't

- Don't build the interview chat UI inside CompanyOS in this task.
- Don't use n8n as the packet receiver or canonical workflow.
- Don't auto-provision on packet submit.
- Don't allow an external agent token to create a new top-level project unless it has the
  required root/admin grant.
- Don't treat web research as verified truth unless cited and approved.
- Don't store browser session data, scraped pages, or raw external chat transcripts unless
  the user intentionally includes them in `packetMd`.
- Don't duplicate provisioning logic or bypass `provisionScope`.

## Acceptance criteria

- [ ] External agent can submit a `new_project` packet through MCP and it appears in the
      admin intake queue
- [ ] External agent can submit a `new_scope` packet under an existing parent after reading
      parent context; access outside the token's subtree is denied
- [ ] Packet detail renders markdown, sources, proposed provision spec, docs/tasks/wiki
      previews, open questions, and risk notes
- [ ] Reviewer can edit the proposed provision spec before approval
- [ ] Submit does not provision anything; approval alone does not provision anything
- [ ] `provision_from_intake_packet` works only after approval and calls the existing
      provisioning service
- [ ] Provisioning creates/updates the scope/workbench/AGENTS.md through M4-04 paths, not
      duplicate logic
- [ ] Final packet is saved or linked as a report record on the resulting scope
- [ ] All writes emit events: submitted, updated, approved, rejected, provisioned
- [ ] The `scope-intake` skill is synced/listable and contains both new-project and
      new-scope interview flows
