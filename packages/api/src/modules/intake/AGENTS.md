# packages/api/src/modules/intake - AGENTS.md

Creation wizard intake module. Scope-first lifecycle for onboarding packets attached to
already-created scopes.

## Purpose
- Persist intake packets and wizard progress on `intake_packets`.
- Store the creation reason in `answers.reason`, the external pack snapshot in
  `pack_snapshot`, and selected lead/history references in
  `related_history_selections`.
- Enforce lifecycle and permissions for draft, external return, review, approval,
  dismissal, and explicit provisioning.
- Emit all `intake.*` events through the kernel event bus so the brain can consume
  `intake.provisioned`.
- Delegate provisioning, docs, tasks, records, skills, and GitHub writes to existing
  service modules.

## Contract
- All functions take `db` first.
- Reads require viewer on the scope, except global queue/template editor which require
  root admin.
- Draft/update/submit require editor/agent while pre-approval.
- Approve/reject/dismiss/reopen/provision require admin; provision requires status
  `approved` and calls `provisionScope`.
- No LLM calls in this module.
- Related history and reuse-pattern matching use embeddings-only retrieval with
  lexical fail-open behavior; never add chat-LLM calls to request paths.
- Wizard framing/interview templates are read from synced `skills_index` template
  rows first, with packaged defaults only as fallback.
- Provisioning writes a `source-refs` system note when related-history selections
  exist. It links source record/doc ids and scope paths; it does not migrate source
  content.

## Tests
- `intake.test.ts` covers state transitions, permission matrix, paste parsing,
  related-history selection, pack snapshots, root fallback context, reuse prefill,
  synced template preference, provisioning side effects, events, template parsing,
  and template editor GitHub path with mocks.

## Do Not
- Do not bypass `provisionScope`.
- Do not insert records/docs/tasks directly.
- Do not provision on submit or approve alone.
- Do not allow external agents to create new root structure; all tools operate on an
  existing scope or an existing intake id.
- Do not store credential secret values in packets, packs, rows, docs, or records.
