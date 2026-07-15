# Model and effort policy

*How to pick implementer models and when to ask the owner. Platform-agnostic: works with Orca, Claude Code, Codex CLI, Grok, or any other harness.*

Companion: `docs/ORCHESTRATION.md` (TRIP loop), `docs/SUBAGENTS.md` (CLI recipes).

## Goals

1. Prefer **cheaper capable** models for typing; keep expensive frontier context for judgment.
2. **Never invent spend.** Expensive lanes need explicit owner confirmation.
3. One implementer owns one module (or disjoint file set) per run.

## Cost tiers

| Tier | When to use | Examples (adjust as tooling changes) | Confirm with owner? |
|---|---|---|---|
| **Cheap** | Trivial edits, mechanical renames, docs, simple bugfix, explore summaries | grok-composer fast lane; small/fast models | No |
| **Mid** | Standard multi-file features/fixes, most briefs | codex with medium effort; gpt-5.5 medium (dispatch script default); optional gpt-5.6-terra at high for hard TRIP features when owner has approved that default | No (default OK) |
| **Expensive** | Kernel/security, hard multi-module design, stuck after 2+ failed mid attempts, long rescue | xhigh / sol / max effort; multi-hour runs; multi-agent parallel heavy lanes | **Yes -- stop and ask** |

If unsure which tier: choose **Mid**, state why, offer Expensive only with a one-line cost reason.

## Orchestrator vs implementer

| Role | Prefer | Avoid |
|---|---|---|
| Orchestrator (planning, triage, review, commit) | Whatever chat the owner opened; keep context small | Reading whole modules; implementing non-trivial code |
| Implementer (writes code) | Mid by default; Cheap when task is tiny | Expensive without confirmation |
| Adversarial reviewer | Fresh session/model, Mid; Expensive only if owner wants deep review | Same session that wrote the code |

## Confirmation template (expensive)

Before starting an expensive run, ask the owner:

```text
I want to use <model> at <effort> because <one sentence>.
Estimated: <rough time/usage if known>. Proceed? (yes / use mid instead / abort)
```

Do not start the expensive run until the owner answers yes.

## Dispatch defaults

See `scripts/dispatch-codex.ps1` and `docs/SUBAGENTS.md` for exact CLI flags.

- Default implementer: **codex, medium effort** (mid tier).
- Second lane: **grok** with `--always-approve` for mechanical or parallel disjoint work.
- Do not default to xhigh / sol / maximum effort.

## Anti-patterns

- Spawning expensive models "just to be safe"
- Parallel expensive agents on the same files
- Using the orchestrator's expensive context to re-implement what a mid implementer should write
- Skipping confirmation because "the user is busy"
