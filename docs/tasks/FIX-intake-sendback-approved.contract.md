# Product Contract — FIX-intake-sendback-approved (#42, expanded scope)

Owner approval: Rishi, 2026-07-17 (R2 plan approved as proposed)

## Purpose

"Send back" on an approved intake must perform a real `approved -> draft`
transition, and the intake status state machine must be race-safe: reopen and
provisioning can never interleave into silent inconsistency or partial
provisioning side effects.

## In scope

- `reopenIntakePacket`: `dismissed | rejected | approved -> draft` (clearing
  approval metadata) as a status-guarded atomic update; explicit `IntakeStateError`
  for `provisioned` and `provisioning`; idempotent no-op for pre-approval statuses.
- `provisionFromIntakePacket`: atomic claim `approved -> provisioning` BEFORE any
  side-effect work; rollback of the claim to `approved` on failure; final stamp
  `provisioning -> provisioned` guarded; stale-claim takeover (10-minute lease) so
  a hard crash mid-provision cannot permanently wedge an intake.
- New `provisioning` value on the `intake_packet_status` pg enum + generated
  migration (plain `ALTER TYPE ... ADD VALUE`, precedent: 0025/0026/0027/0030).
- UI: `provisioning` status label; IntakePanel treats `provisioning` as locked
  (like `approved`, not "live"); provision button stays approved-only.
- Regression tests for: approved send-back, provisioned refusal, mid-provision
  send-back refusal, claim serialization, stale-lease takeover, failure rollback.

## Exclusions

- No transactional/undo provisioning (side effects of a *successful* run are
  unchanged); no changes to approve/reject/dismiss flows; no queue redesign.
- No migration run against dev/staging DBs in this session (PGlite gate only;
  deploy applies it via the normal `db:migrate` path — owner-controlled).

## Safety invariants (must NEVER)

- Never two concurrent provision runs performing side effects for the same intake
  (within lease bounds).
- Never a `provisioned` stamp over an intake that was sent back mid-provision.
- Never a silent no-op state transition: every refused transition throws
  `IntakeStateError`.
- Never edit or reorder existing migration files or `meta/_journal.json` history.

## Acceptance checks

- [ ] Approved intake + Send back -> `draft`, approval metadata cleared, editable.
- [ ] Reopen during `provisioning` throws; provision then completes to `provisioned`.
- [ ] Provision on a non-approved (incl. fresh `provisioning`) intake throws.
- [ ] Stale `provisioning` claim (>10 min) can be re-provisioned.
- [ ] Provision failure mid-work rolls the claim back to `approved`.
- [ ] Full gate green incl. meta-chain migration consistency test.

## Deployment boundary

None in this task — PR only; owner merges and deploys. Migration 0031 applies on
the next deploy's standard migrate step.

## Risk

R2 — triggers: concurrency control redesign, DB migration (enum value add).
