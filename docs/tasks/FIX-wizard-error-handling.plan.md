# FIX-wizard-error-handling: validate provision spec early (#43) + surface wizard errors (#44)

status: done
type: bug
issue: #43, #44
module: intake (packages/api/src/modules/intake) + apps/os/src/modules/intake
branch: fix/wizard-error-handling
size: standard
triage: orchestrate (implementer: Grok; reviewer: Codex)

> TRIP bugfix plan. Owner approval: Rishi, 2026-07-17 (Session Brief #2: one task,
> dispatch to Grok, Codex review). Risk R1 (intake submit/approval + client UX;
> no auth/migration/concurrency triggers).

## CONTRACT (product contract — plan-lite inline)

- **Purpose**: A malformed intake packet must never reach the locked `approved`
  state and then fail (or silently mis-provision) at "Create everything"; and any
  known wizard error must show inline in the UI, not as an opaque 500 with a stuck
  "Creating…" button.
- **In scope**: (a) validate `proposedProvisionSpec` shape at approval;
  (b) structured error returns from the wizard server actions + inline rendering
  and pending-state reset in the client.
- **Exclusions**: the provisioning engine itself (#84 idempotency), the atomic
  claim/lease logic (already shipped in #42), Plane deployment (#75).
- **Safety invariants**: no change to auth/roles; no DB migration; approval still
  requires `admin`; existing intake state machine transitions unchanged.
- **Acceptance checks**: see below (regression tests + client behaviour).
- **Deployment boundary**: none (no infra/deploy).

## Symptom

- #43: an interview packet whose `proposed_provision_spec` had the wrong shape
  (`{docs, tasks, workbench}` instead of `{scopePath, modules[]}`) was accepted at
  submit and **approved**, failing only at provision time.
- #44: server-action failures reach the browser as `500` with no message; the
  "Create everything" button stays on "Creating…" forever.

## Current state (verified 2026-07-17)

- `normalizeProvisionSpec` (service.ts:302) now force-sets `scopePath`, so #43's
  exact `service.ts:1013` 500 is largely gone — BUT a malformed spec still reaches
  `approved` and then **silently mis-provisions** (`modules` undefined →
  `ensureModules([])` skips; bogus keys ignored). Still a real defect.
- `approveIntakePacket` (service.ts:877) does **no** spec validation.
- Wizard server actions (`apps/os/src/modules/intake/actions.ts`) let all `api.*`
  errors propagate raw (e.g. `provisionIntakeAction` L148) — #44 confirmed valid.

## Root cause

- #43: no validation gate on the provision-spec shape between submit and the
  locked `approved` state.
- #44: server actions don't translate known domain errors (`IntakeStateError`,
  validation) into structured results, and the client has no error/pending-reset path.

## Fix plan (surgical)

### 1. Validate provision-spec shape at approval — #43

**File**: `packages/api/src/modules/intake/service.ts`

- Add a `ProvisionSpec` shape validator (zod or a small guard) requiring:
  `scopePath` (non-empty string, must equal the intake's own scopePath),
  `modules` (array; every entry ∈ {`docs`,`tasks`,`workbench`}),
  optional `workbench` (`{repo:string}`), optional `subprojects`
  (`[{slug,name}]`). Reject unknown/extra top-level keys.
- Call it in `approveIntakePacket` before flipping to `approved`; on failure throw
  `IntakeStateError` with a clear, user-facing message. (Optionally also validate in
  `submitIntakePacket` for earlier feedback — nice-to-have, keep it DRY.)

### 2. Surface wizard errors + reset pending state — #44

**Files**: `apps/os/src/modules/intake/actions.ts`, `apps/os/src/modules/intake/IntakePanel.tsx`

- In the mutating actions that can raise domain errors (`approveIntakeAction`,
  `provisionIntakeAction`, `submitPasteAction`, `saveReviewAction`), catch known
  domain errors and return a structured result (e.g. `{ ok:false, error }`) instead
  of throwing; keep unknown/programmer errors throwing.
- In `IntakePanel.tsx`: render the returned error inline (banner/toast), reset the
  "Creating…"/pending state on failure, and disable submit/approve/provision
  controls when the intake is in a locked state (`approved`/`provisioning`/`provisioned`).

## Regression tests

- `packages/api/src/modules/intake/intake.test.ts`: approving an intake whose
  `proposedProvisionSpec` is malformed (missing scopePath / scopePath mismatch /
  `modules` contains an unknown value / wrong shape) throws `IntakeStateError`; a
  well-formed spec still approves. (Red on current code — approval accepts it.)
- Client: if the project has component-test infra use it; otherwise state in the
  finish report that #44 is covered by the action-level structured-return change +
  manual verification (drive the wizard).

## Files to modify

| Path | Change |
|---|---|
| `packages/api/src/modules/intake/service.ts` | spec-shape validator + call in approve (opt. submit) |
| `packages/api/src/modules/intake/intake.test.ts` | approval-validation regression tests |
| `apps/os/src/modules/intake/actions.ts` | structured error returns for domain errors |
| `apps/os/src/modules/intake/IntakePanel.tsx` | inline error + pending reset + lock disable |

## Don't

- Touch the atomic claim/lease/provisioning engine (#42/#84).
- Change auth/roles, add migrations, or alter state-machine transitions.
- Broad refactor of the wizard. Surgical only.

## Acceptance criteria

- [ ] Malformed spec cannot be approved (regression test red→green)
- [ ] Known wizard errors render inline; pending state resets; locked controls disabled
- [ ] Gate green: typecheck + lint + test (packages/api and apps/os)
- [ ] No drive-by changes

## Finish report

- Files changed:
  - `packages/api/src/modules/intake/service.ts` — strict zod `ProvisionSpec` validator;
    called in `approveIntakePacket` before a fenced (`id+status+updatedAt`) status flip.
  - `packages/api/src/modules/intake/intake.test.ts` — approval-validation regressions
    (missing/mismatched scopePath, unknown module, #43 nested shape, empty-workbench).
  - `apps/os/src/modules/intake/actions.ts` — structured `{ok,...}` returns for
    `IntakeStateError` (explicit allowlist); local JSON-parse handling.
  - `apps/os/src/modules/intake/IntakePanel.tsx` — inline error rendering, pending-state
    reset, locked-state control disabling; reads `res.intake` / `res.result`.
- Implementer: Grok (dispatched, both the build and the review-fix pass). Reviewer: Codex.
- Deviations from plan: #43's exact 500 was already mitigated by `normalizeProvisionSpec`,
  so #43 became defensive shape-validation (as anticipated in the brief). Review added a
  concurrency fence on the approve transition (F2) — an R1-proportionate use of the
  existing provision-claim fencing idiom, not new architecture.
- Review: FULL_REVIEW → 2 BLOCKING (workbench.repo strictness; validate/approve
  non-atomic) + 3 NON_BLOCKING → FOCUSED_FIX (all 5) → REREVIEW → F3 tightening →
  **APPROVED**.
- Left undone: none for #43/#44. Manual UI drive of the failure banner not performed
  (no component-test infra); behaviour is covered by the action-contract + server tests.
- Gate: api tsc/lint ok · apps/os tsc/lint ok · intake tests 23 pass · full API suite
  285 pass (one unrelated migration-test timeout flake, passes in isolation).
