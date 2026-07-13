# Brief: reliable workbench repo creation + honest provisioning failure UX

status: ready for implementer (codex lane; zero schema changes)
found: 2026-07-13 during COS-Learning pilot readiness (staging)

## Background (what actually happened)

Provisioning a project is supposed to create its GitHub repo in the org
(`GITHUB_ORG` = `Brissie-Digital-PTY-LTD` on staging) and sync a managed
`AGENTS.md`. It was silently not happening. Root cause on staging was a
credential gap (the deployed `GITHUB_TOKEN` lacked `Administration: write` +
"All repositories", so `POST /orgs/{org}/repos` 403'd). That token has since
been replaced and repo creation now works end-to-end (verified: the OS created
`Brissie-Digital-PTY-LTD/wb-mechanism-test` with a synced `AGENTS.md`).

But the incident exposed two real product defects that made a simple
mis-scoped-token take hours to diagnose. Fix both. This is NOT about the token
(already fixed by the owner) — it is about the code being fragile and dishonest
when repo creation is skipped or fails.

## Defect 1 — repo creation is silently skipped, and hard-500s on any GitHub error

Two sub-problems in `packages/api/src/modules/provisioning/service.ts`:

1a. **Silent skip.** `provisionScope` only attempts a workbench when
`spec.workbench` is truthy (`service.ts:513-518`); otherwise it records
`{ key: "workbench", status: "skipped", message: "No workbench requested" }`
and moves on. The provision spec comes from the intake packet's
`proposed_provision_spec`, which is whatever the pasted interview reply
contained. `skeletonSpec` (`service.ts:177-184`) never adds a `workbench`
object, and the framing question "Will code be written here (needs a GitHub
workbench)?" (wizard framing step) is not wired into the spec. Net effect: a
project can answer "yes, code" and still get no repo, with no signal — every
project on staging had silently skipped it.

1b. **Hard 500 on GitHub errors.** `ensureWorkbenchWithRepo`
(`service.ts:562-576`) wraps `getRepo`/`createRepo` in a try/catch that only
handles `OrgNotFoundError` (→ `addManual`, a graceful "manual step"). Any other
error — e.g. the 403 `createRepo` throws as a generic `Error` at
`packages/api/src/lib/github-client.ts:104-107` — hits `throw error`, which
propagates out of `provisionFromIntakePacket` and 500s the whole server action.
No repo, no partial success, no actionable message.

### Do (Defect 1)

- In `ensureWorkbenchWithRepo`, catch GitHub failures from `getRepo`/`createRepo`
  (and the `putFile` AGENTS.md sync) and **degrade to `addManual`** with an
  actionable message instead of rethrowing — mirror the existing
  `OrgNotFoundError` branch. Detect the permission case (HTTP 403 /
  "Resource not accessible by personal access token") and say exactly that:
  e.g. `"GitHub token cannot create repos in <org> (403). Grant the token
  Administration: read/write + All repositories, then re-run setup."` Keep the
  provision transaction succeeding for everything else (scope, modules, docs,
  tasks) so a repo problem never blocks the rest.
- Make repo creation reliably requested for code projects: when the framing/
  answers indicate code will be written, **default
  `proposed_provision_spec.workbench = { repo: <topLevelSlug> }`** rather than
  relying on the pasted JSON. Best placement is where the packet is normalized
  server-side (submit/update intake) or in `skeletonSpec`; if a review-step
  default is easier, set it there and show it in "What will be created". A
  project that will not hold code must still be able to opt out (no workbench),
  as `cos-learning` intentionally does.
- The GitHub error string from `github-client.ts` currently interpolates the raw
  response body into a thrown `Error`. When you convert these to manual steps,
  do not leak token values (there are none in these responses today, keep it
  that way) and keep the org/repo/status in the message.

### Don't (Defect 1)

- Don't create a repo for every scope. **One repo per top-level project**;
  subprojects get `AGENTS.md` files at their paths inside that one repo
  (existing behavior in `ensureWorkbenchWithRepo` via `rowScopes` + `syncAgentsFile`).
  Do not add per-subproject repos.
- Don't touch the token/env or `GITHUB_ORG` — the credential is already fixed.

## Defect 2 — provisioning UI sticks on "Creating…" and fakes success

In `apps/os/src/modules/intake/IntakePanel.tsx`, `runProvision`
(`IntakePanel.tsx:480-495`):

- It sets `provisionRunning=true` / `scopeLive=false`, fires
  `provisionIntakeAction`, then runs a **timer-driven** step animation
  (486-490) that marks each step "done" on a delay regardless of the real
  result. On failure the steps still all show green.
- `await actionPromise` (491) throws on a 500, so `setScopeLive(true)` and
  `setProvisionRunning(false)` (493-494) never run. The button label is
  `currentStep === 6 ? "Creating"` (line 514), so it stays on "Creating…"
  **forever** until reload. The only failure signal is a transient toast from
  `runAction` (411-419) — easy to miss, gone on reload.

### Do (Defect 2)

- Wrap the provision body in `try/finally` so `provisionRunning` is always reset
  and the button never stays stuck; on failure, surface the error inline in the
  provision panel (not just a toast) with the actionable message from Defect 1.
- Drive the step statuses from the **actual** `ProvisionResult.steps`
  (`created`/`existing`/`skipped`/`manual`) returned by the action, and render a
  failed/manual step distinctly (e.g. the GitHub step showing "manual: grant
  token repo-creation permission") instead of a cosmetic all-green sweep.
- Keep the success path ("Project is live.") intact.

## Acceptance criteria

- [ ] Provisioning a project whose intake indicates code-will-be-written creates
      the repo automatically (workbench defaulted) — no reliance on the pasted
      interview JSON including `workbench`.
- [ ] A project that opts out of a workbench provisions with a `skipped`
      workbench step and no error (regression guard for `cos-learning`).
- [ ] When `createRepo` returns 403 (simulate by pointing at an org the token
      can't create in, or mock the client), provisioning **completes** with the
      GitHub step marked `manual` and an actionable message; scope/modules/docs/
      tasks are still created; no 500.
- [ ] `OrgNotFoundError` path still degrades to manual (no regression).
- [ ] The provision UI never sticks on "Creating…": on failure the button resets
      and the real error + failed step are shown inline; on success it goes
      "Project is live."
- [ ] Step indicators reflect real `ProvisionResult.steps`, not a timer.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from repo root.

## Pinned references

- `packages/api/src/modules/provisioning/service.ts`
  - `skeletonSpec` 177-184 (never sets workbench)
  - `provisionScope` 476-544; workbench gate 513-518
  - `ensureWorkbenchWithRepo` 546-589; catch-only-OrgNotFoundError 562-576
- `packages/api/src/lib/github-client.ts`
  - `createRepo` 94-108 (404 → OrgNotFoundError; else generic throw)
  - `getFile`/`putFile` 120-175 (Contents ops for AGENTS.md sync)
  - `OrgNotFoundError` 27-31
- `apps/os/src/modules/intake/IntakePanel.tsx`
  - `runProvision` 480-495; step-animation 486-490; button label 514
  - `runAction` (toast-only error handling) 411-419
- Intake provisioning entry: `provisionFromIntakePacket`
  `packages/api/src/modules/intake/service.ts:867-969`

## Related smaller gaps (note, don't necessarily fix here)

- The `GITHUB_TOKEN` health check reports "Healthy" on presence/expiry only; it
  never verifies repo-creation capability, so a mis-scoped token looks fine.
  Consider a create-capability probe or clearer capability reporting.
- There is no UI to delete/archive a provisioned scope; a failed/throwaway
  project lingers (kernel `archiveScope` exists but isn't surfaced via MCP/UI).
