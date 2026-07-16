# FIX-intake-sendback-approved: Wizard "Send back" on an approved intake is a silent no-op

status: done
type: bug
issue: #42
module: intake
branch: risi-au/wizard-send-back-on-an-approved-intake-is-a-sile
size: standard
triage: self (owner waiver in Session Brief, 2026-07-17)

> TRIP bugfix plan. Diagnosis before patch. No production code in this file.
> Owner approval: Rishi, 2026-07-17 (Session Brief approved as proposed)

## Symptom

Wizard "Send back" menu item on an approved intake appears to succeed (UI returns
to the Interview step) while the server keeps status `approved`. Every later
edit/save/resubmit fails with `IntakeStateError` — surfaces as opaque 500s.
Issue #42 (observed on cos-staging, intake bddb82fc…, 2026-07-12).

## Repro

1. Approve an intake, open its wizard, choose "Send back", confirm.
2. Expected: intake back in an editable draft state. Actual: UI shows Interview
   step, server still `approved`; next save throws IntakeStateError.
3. Environment: staging (issue evidence); reproduced locally as failing unit test
   (approved intake → `reopenIntakePacket` → status unchanged, no error).

## Minimise

`reopenIntakePacket` in `packages/api/src/modules/intake/service.ts` (L905): for
any status other than `dismissed`/`rejected` it returns the row unchanged with no
error. UI (`IntakePanel.tsx` menuAction "sendBack") treats any resolved action as
success. Not involved: reject/dismiss paths, permissions, provisioning.

## Hypotheses (ranked)

1. Status guard silently no-ops for `approved` — confirmed by direct code read;
   no elimination rounds needed.

## Root cause

`reopenIntakePacket` only transitions `dismissed | rejected → draft` and returns
the intake unchanged (no error) for every other status, so an approved intake is
never sent back yet the caller observes success.

## Fix plan (surgical)

> SCOPE EXPANDED 2026-07-17 after review cycle 2 (owner decision): promote to R2,
> add atomic provisioning claim. Contract: FIX-intake-sendback-approved.contract.md

### 1. Allow approved → draft; make non-reopenable states loud

**File**: `packages/api/src/modules/intake/service.ts`

- Pre-approval statuses (`draft`, `awaiting_external`, `needs_review`) return
  unchanged — they are still editable, so send-back is an idempotent no-op.
- `provisioned` and `provisioning` throw `IntakeStateError`.
- `dismissed | rejected | approved` transition to `draft` via status-guarded
  update (0 rows → `IntakeStateError`); approval metadata cleared.
- Verify: regression test + full gate.

### 2. Atomic provisioning claim (R2 expansion)

**Files**: `packages/db/src/schema/intake.ts` + generated migration 0031,
`packages/api/src/modules/intake/service.ts`

- Add `provisioning` to `intake_packet_status` enum (append; plain ADD VALUE
  migration via `pnpm --filter @companyos/db db:generate`, precedent 0025-0030).
- `provisionFromIntakePacket`: claim `approved -> provisioning` atomically before
  any side-effect work; allow stale-claim takeover when `provisioning` is older
  than 10 min (crash recovery); on failure roll the claim back to `approved` and
  rethrow; final stamp guarded on `provisioning`.
- Verify: race/claim/lease/rollback tests + meta-chain test.

### 3. UI status handling

**Files**: `apps/os/src/lib/labels.ts`, `apps/os/src/modules/intake/IntakePanel.tsx`

- Label for `provisioning`; IntakePanel locks `provisioning` like `approved`
  (not "live"); provision button remains approved-only.

## Regression test

- Red on old code: approved → reopen returned `approved` unchanged (assertion
  `status === "draft"` fails); provisioned → reopen resolved instead of throwing.
- Path: `packages/api/src/modules/intake/intake.test.ts` — "sends an approved
  intake back to draft and refuses to reopen a provisioned intake".

## Files to modify

| Path | Change |
|---|---|
| `packages/api/src/modules/intake/service.ts` | reopen guard + provisioning claim/rollback/stamp |
| `packages/api/src/modules/intake/intake.test.ts` | regression tests (send-back, race, claim, lease, rollback) |
| `packages/api/src/modules/intake/AGENTS.md` | document reopen + claim contract (same-commit rule) |
| `packages/db/src/schema/intake.ts` | add `provisioning` enum value + type union |
| `packages/db/drizzle/0031_*.sql` (+meta) | generated ADD VALUE migration |
| `packages/db/AGENTS.md` | note the enum add |
| `apps/os/src/lib/labels.ts` | `provisioning` status label |
| `apps/os/src/modules/intake/IntakePanel.tsx` | treat `provisioning` as locked, not live |

## Don't

- Fix adjacent "while I'm here" issues (file a new issue instead)
- Broad refactors
- UI changes — the panel already merges the returned intake and surfaces errors

## Acceptance criteria

- [x] Repro no longer fails (unit-level repro; staging re-check post-deploy)
- [x] Regression test covers the bug
- [x] Gate green: `pnpm typecheck && pnpm lint && pnpm test`
- [x] No drive-by file changes

## Finish report

- Files changed:
  - `packages/api/src/modules/intake/service.ts` — reopen: guarded dismissed/rejected/approved → draft (clears approval metadata), throws on provisioning/provisioned; provision: atomic claim approved → provisioning fenced by claim updated_at stamp, 10-min stale-lease takeover, rollback-on-failure, fenced provisioned stamp
  - `packages/api/src/modules/intake/intake.test.ts` — regression tests: approved send-back, provisioned refusal, mid-provision send-back refusal, claim serialization, stale-lease takeover, fencing, failure rollback
  - `packages/api/src/modules/intake/AGENTS.md` — reopen + claim contract, #84 limitation
  - `packages/db/src/schema/intake.ts` + `drizzle/0031_*.sql` + meta — `provisioning` enum value
  - `packages/db/AGENTS.md` — enum note
  - `apps/os/src/lib/labels.ts` — Provisioning label
  - `apps/os/src/modules/intake/IntakePanel.tsx` — isPostApproval lock states; provision button retryable for stale claims
- Deviations from plan: fencing token (claim updated_at) added during review; owner-accepted residual: duplicate report/Plane issues if a >10-min-hung run resumes post-takeover (#84)
- Left undone: staging re-check of the original repro after deploy (tracked in PR); idempotent provisioning side effects (#84)
- Gate: typecheck ok | lint ok | tests 407 passed (receipt: FIX-intake-sendback-approved.gate.md)
- Review: codex FULL_REVIEW cycle 1 → R1 (owner expanded scope, R2 re-plan); FULL_REVIEW on R2 diff → R2-01/R2-02; FOCUSED_FIX (fencing) → rereview: R2-02 resolved, R2-01 state-machine aspects resolved, side-effect idempotency residual accepted by owner as #84
