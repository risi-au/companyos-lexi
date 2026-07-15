# Ops cockpit (how to run day-to-day work)

*Personal operating guide. Canonical process lives in ONBOARDING.md + ORCHESTRATION.md. This file is the short "what do I click" path.*

## Board

- Queue: **GitHub Issues** on `risi-au/companyos`
- Types: `feature`, `bug`
- Labels: see ONBOARDING.md (triage, size, process)

```bash
gh issue list --label needs-triage
gh issue list --label ready
```

## Start a piece of work

1. Open or pick an issue (`#N`).
2. Open an Orca (or other) worktree/chat on companyos.
3. Prompt:

```text
Read ONBOARDING.md. Do issue #N. Follow TRIP. Confirm with me before expensive models.
```

4. Agent should: triage class, self vs orchestrate, model tier, next plan/brief path.

## Feature path

Issue (feature template) -> triage -> plan `docs/tasks/FEAT-*.plan.md` if non-trivial -> implement on `task/<slug>` -> gate -> review -> PR `Closes #N` -> owner merges.

## Bug path

Issue (bug template) -> repro/minimise -> plan `docs/tasks/FIX-*.plan.md` if non-trivial -> implement on `fix/<slug>` -> regression test -> gate -> review -> PR `Fixes #N` -> owner merges.

## Debug-Setup worktree

This folder may be an Orca worktree used as a long-lived checkout for process/docs and bugfix environment work. It is **not** a second source of truth: always follow root `ONBOARDING.md` from the branch you are on.

## Do not

- Push to `main`
- Run migrations against live/staging from a task
- Store secrets in issues, plans, or wiki
