# Subagent Dispatch Guide (grok / codex)

*Companion to ORCHESTRATION.md. That doc defines roles and the review loop; this one is the operational manual for invoking the headless implementer CLIs without tripping over their known failure modes. Update it whenever a new failure mode is discovered.*

## Golden rules (learned the hard way)

1. **Exit code 0 does not mean work was done.** Grok has exited cleanly after reading files and printing "Implementing the remaining fixes..." without writing a single line. After every run, verify (see checklist below).
2. **Always close stdin when dispatching headless.** CLIs that detect a non-TTY stdin will block forever waiting for EOF. From bash: append `< /dev/null`. Never dispatch `codex exec` from a background PowerShell pipeline without this — it hangs at "Reading additional input from stdin...".
3. **Run implementers in the background and check startup within ~30 seconds.** Tail the output file once early to confirm the model is actually producing output, then leave it alone until completion.
4. **Tell the implementer about pre-existing uncommitted work.** If the working tree has partial work from a prior run, say explicitly: "Do NOT redo or revert the uncommitted changes in <files>; build on them." Otherwise it may start over or revert.
5. **Don't add unrelated files to the repo while an implementer is running.** If it was told to "commit everything", your file gets swept into its commit.

## Grok CLI

Template (per ORCHESTRATION.md):

```
grok -p "<prompt>" --cwd <repo> --permission-mode acceptEdits --check
```

Known issues (as of grok 0.2.81, 2026-07-03):

- **Do NOT pass `--effort high`.** The default model `grok-composer-2.5-fast` rejects the `reasoningEffort` parameter with a 400 error and the run dies immediately. The template in older ORCHESTRATION.md revisions includes this flag — omit it.
- **Silent no-op runs.** Grok sometimes exits 0 after only reading files. Verify output; if it no-ops, re-run once, then escalate to codex.
- History: grok CLI was fully broken during M4-02 (architect had to take over, commit 873c3a8).

## Codex CLI

Template (from bash, not PowerShell):

```
codex exec --sandbox workspace-write -C "C:/dev/companyos" "<prompt>" < /dev/null
```

Notes (as of codex-cli 0.142.5, 2026-07-03):

- **`< /dev/null` is mandatory headless** — without it the run hangs forever on stdin (see golden rule 2).
- `--full-auto` is deprecated; use `--sandbox workspace-write`.
- **Codex cannot commit on Windows**: the workspace-write sandbox denies writes to `.git` (`Unable to create .git/index.lock: Permission denied`, discovered M4-04). It leaves completed work in the tree; the architect commits after review. Don't count this as a failure.
- Codex has no `pnpm` in its sandbox PATH and restricted network (Corepack fetch fails) — it verifies with `tsc -b` / `eslint` / `vitest` directly; the orchestrator's own root `pnpm typecheck/lint/test` run (checklist step 4) is the real gate, as always.
- **Limit alerting**: include in the prompt: on rate/usage limits print a line starting `LIMIT-ALERT:` and commit WIP. Additionally arm a log monitor for limit signals — grep the log with `-a` (codex output contains control chars that make grep call it binary) and avoid bare patterns like `429` (matches git hashes) or words echoed from your own prompt. **Anchor the alert pattern to line start (`^LIMIT-ALERT:`)** — codex echoes the dispatch prompt into its log and also prints this very file when it reads it, so an unanchored grep false-alarms immediately (bitten during M4-05).
- Defaults come from `~/.codex/config.toml`: currently `model = "gpt-5.5"`, `model_reasoning_effort = "high"`. Override per-run with `-c model_reasoning_effort=medium` for routine briefs to save tokens.
- The repo must be in codex's trusted projects list (`c:\dev\companyos` already is) or the sandbox will prompt/fail.
- **Out-of-credits mode** (discovered M5-01): `ERROR: Your workspace is out of credits` — exits 1 within seconds, before any work. Credits reset/refill on the owner's plan, so retry codex once before falling back to grok, and tell the owner so he can refill. Add `out of credits` to the log-monitor pattern alongside `^LIMIT-ALERT:`.

## Post-run verification checklist (orchestrator must do all of these)

1. `git log --oneline -3` — a new commit exists with the correct `M<x>-<nn>:` prefix.
2. `git status --short` — working tree is clean (or only expected leftovers).
3. The diff touches what the brief demands — especially **tests** and the module's **AGENTS.md**; implementers most often skip these.
4. `pnpm typecheck && pnpm lint && pnpm test` from root, run by the orchestrator — never trust the implementer's claim that they pass.
5. Review the diff against the brief's Do / Don't / Acceptance criteria before merging.

## Escalation ladder

1. grok (default implementer)
2. codex (grok no-ops/fails twice, or the task is genuinely hard)
3. architect takeover (after 2 failed review-fix cycles, per ORCHESTRATION.md)

Owner override (2026-07-03): prefer codex directly while owner has ample codex quota — grok no-opped again on M4-04 (exit 0 after "Creating the schema..." with nothing written); codex delivered M4-04 in one run.
