# packages/api/src/modules/intake - AGENTS.md

Creation wizard intake module. Scope-first lifecycle for onboarding packets attached to
already-created scopes.

## Purpose
- Persist intake packets and wizard progress on `intake_packets`.
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

## Tests
- `intake.test.ts` covers state transitions, permission matrix, paste parsing,
  reuse prefill, provisioning side effects, events, template parsing, and template
  editor GitHub path with mocks.

## Do Not
- Do not bypass `provisionScope`.
- Do not insert records/docs/tasks directly.
- Do not provision on submit or approve alone.
- Do not allow external agents to create new root structure; all tools operate on an
  existing scope or an existing intake id.
