# Subagent Dispatch Guide (grok / codex)

*Companion to ORCHESTRATION.md. That doc defines roles and the review loop; this one is the operational manual for invoking the headless implementer CLIs without tripping over their known failure modes. Update it whenever a new failure mode is discovered.*

## Orchestrator role & token budget (read this first)

The orchestrator is a frontier Claude model (e.g. Opus) — **the single most token-expensive
resource in the loop, and its context window is the scarce thing to protect.** It must not
do the implementation itself. Its entire job is four cheap steps:

1. **Brief** — write a tight task brief (Do / Don't / Acceptance criteria). Pin exact file
   paths so implementers don't have to re-explore.
2. **Dispatch** — hand the actual coding to a cheaper, capable implementer (codex, grok, or
   a Claude Agent subagent — see below). One implementer owns one module in one worktree.
3. **Verify** — confirm the work is correct: re-run `pnpm typecheck && lint && test`
   yourself and review the **diff** against the brief. Never trust an implementer's "green"
   claim.
4. **Merge** — commit (implementers often can't) and merge the PR to `main` (staging). This
   is a couple of `git`/`gh` calls — keep it that cheap.

Token discipline (do all of these):

- **Delegate implementation always.** Only edit code inline for a genuinely trivial
  one-liner where dispatching would cost more than the edit. Anything substantial → dispatch.
- **Don't read whole codebases into orchestrator context.** To gather the structural map a
  brief needs, spawn an `Explore` or general-purpose subagent and consume its *summary* —
  don't open twenty files yourself.
- **Review diffs, not full files.** `git diff` + targeted reads of the highest-risk files;
  lean on the gates (typecheck/lint/test) to catch the rest.
- **Parallelize across implementers**, not across your own context — fan work out to
  multiple workers in isolated worktrees and let them run.
- **Offer a fresh session when context grows large.** A handover doc + the auto-memory
  carry state across sessions cheaply; a bloated context does not.

The goal is: powerful implementer models do ~all the typing; the orchestrator spends its
tokens only on judgment (is it correct?) and the merge. See ORCHESTRATION.md for the
role definitions and the review/escalation loop.

## Golden rules (learned the hard way)

1. **Exit code 0 does not mean work was done.** Grok has exited cleanly after reading files and printing "Implementing the remaining fixes..." without writing a single line. After every run, verify (see checklist below).
2. **Always close stdin when dispatching headless.** CLIs that detect a non-TTY stdin will block forever waiting for EOF. From bash: append `< /dev/null`. Never dispatch `codex exec` from a background PowerShell pipeline without this — it hangs at "Reading additional input from stdin...".
3. **Run implementers in the background and check startup within ~30 seconds.** Tail the output file once early to confirm the model is actually producing output, then leave it alone until completion.
4. **Tell the implementer about pre-existing uncommitted work.** If the working tree has partial work from a prior run, say explicitly: "Do NOT redo or revert the uncommitted changes in <files>; build on them." Otherwise it may start over or revert.
5. **Don't add unrelated files to the repo while an implementer is running.** If it was told to "commit everything", your file gets swept into its commit.

## Grok CLI

**Corrected template (2026-07-09, grok 0.2.93):**

```
grok -p "<prompt>" -m grok-composer-2.5-fast --always-approve --no-auto-update --cwd <worktree>
```

**The single most important fix: `--always-approve`.** The old template used
`--permission-mode acceptEdits` (a Claude-Code-ism). Per the xAI headless-scripting docs
(https://docs.x.ai/build/cli/headless-scripting) the documented flag for auto-executing
tools headlessly is `--always-approve`. **Without it, headless grok reads the code, prints
"Implementing…", and exits 0 having written nothing — that is the entire cause of the
long-standing "grok no-op".** It was never really the model (composer-2.5 is fine and has
worked from a direct terminal); it was that writes were never approved with no TTY to
confirm at.

Flag notes (grok 0.2.93):

- Use the top-level `-p`/`--single "<prompt>"` one-shot form, NOT the `agent` subcommand —
  `agent` does not reliably execute writes headlessly (verified 2026-07-09 on UX-06B: the
  `-p` form worked, `agent` did not). Add `--output-format json` if you want to parse the
  result.
- `--no-auto-update` suppresses the background update check/prompt in automated runs.
- `-m grok-composer-2.5-fast` is the default and is preferred (owner call). `grok-4.5` is
  also available (`grok models`) — reach for it only on a genuinely hard task.
- Do NOT pass `--effort high` (composer-2.5 rejects `reasoningEffort` with a 400).
- Still verify output after every run (golden rule 1). If it *still* no-ops with
  `--always-approve`, add `--debug-file <path>` to capture why, then escalate.
- History: grok CLI was fully broken during M4-02; it no-opped again on UX-04 (2026-07-09)
  while still using the old `--permission-mode` flag — the trigger for this fix.

## Codex CLI

Two ways to run codex. Pick by whether you want Orca to track it.

### A. As an Orca-orchestrated worker (recommended — makes `worker_done` actually work)

Launch codex in the worktree's Orca terminal with autonomy to call back:

```
orca terminal create --worktree id:<wt> --title <name> \
  --command "codex --dangerously-bypass-approvals-and-sandbox" --json
```

**Why the flag.** Orca's completion protocol requires the *worker* to run the `orca` CLI
itself (`orca orchestration send --type worker_done …`) — there is no MCP/socket/env-var
alternative (confirmed in the Orca docs, https://www.onorca.dev/docs/cli/orchestration).
Under the default `--sandbox workspace-write`, codex **cannot** exec `orca` (it's outside
the workspace and needs to reach the local runtime), so on completion it **hangs on an
approval prompt** ("orca path present in PATH but inaccessible inside the sandbox →
requesting un-sandboxed run"). This happened on UX-02 and UX-05 (2026-07-09) even when the
prompt told codex not to. `--dangerously-bypass-approvals-and-sandbox` is *designed for
exactly this* — the codex help says it's "intended solely for environments that are
externally sandboxed," and Orca's isolated git worktree is that boundary. With it, the loop
closes: dispatch `--inject` → codex works → sends real `worker_done` → your
`check --wait` gets the event (no manual terminal-polling, no Esc-cancel dance). Granular
equivalent if you prefer: `codex -s danger-full-access -a never`. The safety net is
unchanged: the architect still re-runs the gates and reviews the diff before merging, so
nothing lands unverified regardless of how autonomously codex ran.

After `dispatch --inject`, codex usually needs a **manual Enter** (the prompt lands
mid-MCP-boot and doesn't auto-submit), and it may show a **version-update prompt** on launch
→ send "2" (Skip). See the Orca mechanics section below.

### B. Direct headless (no Orca tracking)

```
codex exec --sandbox workspace-write -C "C:/dev/companyos" "<prompt>" < /dev/null
```

Notes (as of codex-cli 0.142.5, 2026-07-03):

- **`< /dev/null` is mandatory headless** — without it the run hangs forever on stdin (see golden rule 2).
- `--full-auto` is deprecated; use `--sandbox workspace-write`. (This mode can't report `worker_done` either — verify the tree directly.)
- **Codex cannot commit on Windows**: the workspace-write sandbox denies writes to `.git` (`Unable to create .git/index.lock: Permission denied`, discovered M4-04). It leaves completed work in the tree; the architect commits after review. Don't count this as a failure.
- Codex has no `pnpm` in its sandbox PATH and restricted network (Corepack fetch fails) — it verifies with `tsc -b` / `eslint` / `vitest` directly; the orchestrator's own root `pnpm typecheck/lint/test` run (checklist step 4) is the real gate, as always.
- **Limit alerting**: include in the prompt: on rate/usage limits print a line starting `LIMIT-ALERT:` and commit WIP. Additionally arm a log monitor for limit signals — grep the log with `-a` (codex output contains control chars that make grep call it binary) and avoid bare patterns like `429` (matches git hashes) or words echoed from your own prompt. **Anchor the alert pattern to line start (`^LIMIT-ALERT:`)** — codex echoes the dispatch prompt into its log and also prints this very file when it reads it, so an unanchored grep false-alarms immediately (bitten during M4-05).
- Defaults come from `~/.codex/config.toml`: currently `model = "gpt-5.5"`, `model_reasoning_effort = "high"`. Override per-run with `-c model_reasoning_effort=medium` for routine briefs to save tokens.
- The repo must be in codex's trusted projects list (`c:\dev\companyos` already is) or the sandbox will prompt/fail.
- **Fresh-worktree ACL failure (discovered M10-01, 2026-07-10):** in a brand-new `git worktree`, codex's sandbox may get "Access is denied" writing under `packages/*` (its own `icacls` repair is denied too, and it correctly no-ops). The tree's files carry a stale per-run sandbox-user ACE. Repair from OUTSIDE the sandbox before (re)dispatching:
  `foreach ($d in @("packages","apps","docs","infra")) { icacls "<worktree>\$d" /grant "CodexSandboxUsers:(OI)(CI)(M)" /t /q }` (plus the worktree root non-recursively). Also override the broken default model while CLI 0.142.5 is installed: dispatch with `-c model=gpt-5.5` (config default `gpt-5.6-sol` 400s on this CLI version).
- **Out-of-credits mode** (discovered M5-01): `ERROR: Your workspace is out of credits` — exits 1 within seconds, before any work. Credits reset/refill on the owner's plan, so retry codex once before falling back to grok, and tell the owner so he can refill. Add `out of credits` to the log-monitor pattern alongside `^LIMIT-ALERT:`.

## Claude Agent implementer lane (reliable second lane)

A **general-purpose Claude Agent subagent** (the `Agent` tool) is a first-class implementer,
not just a searcher — it delivered the full UX-04 sidebar-tree + mobile-drawer rewrite in one
shot and ran its own gates (2026-07-09). Use it when:

- **codex is near its quota** (it flags "N usage limit resets available") and you want true
  parallelism — a Claude Agent runs on a *different* resource, so two modules can build at
  once without both codex instances stalling on the same near-limit account.
- **grok no-ops** and you don't want to burn a codex slot on the retry.

How: give it the worktree **ABSOLUTE path**, the brief path, the structural map you already
gathered, and explicit instructions to *verify the gates, NOT commit, and report every file
changed*. It uses `Edit`/`Write`/`Bash` directly. Note it runs in the primary working dir, so
tell it to use absolute paths under the target worktree. If launched as an Orca `--agent claude`
worker it CAN report `worker_done` (it isn't sandboxed the way codex is), so the orchestration
loop works with it out of the box.

## Orca orchestration mechanics (Windows — read before dispatching)

- **Prefer the tracked path.** Per ORCHESTRATION.md, use Orca orchestration
  (`task-create` → worker terminal → `dispatch --inject` → `check --wait`) rather than plain
  terminal prompts, so tasks/dispatch/worker_done provenance exists. Launch codex workers with
  the autonomy flag above so `worker_done` isn't blocked.
- **`orca` is not on the Git-Bash PATH** — it's `C:\Users\<user>\AppData\Local\Programs\Orca\resources\bin\orca.cmd`.
  Add that dir to PATH so the Bash tool can call `orca` directly; otherwise call it from
  PowerShell. **One-time env fix worth doing.**
- **Ignore orca's exit code from PowerShell** — it returns **255 even on success** (PowerShell
  wraps the CLI's stderr as a `NativeCommandError`). Parse the JSON `.ok` field instead; add
  `2>$null` to suppress the noise.
- **Don't run `orca … check --wait` as a PowerShell background job** — its stderr heartbeats
  trip the same NativeCommandError and PowerShell kills it at ~600s. Run the wait from the Bash
  tool, use short rolling waits, or poll `terminal list` `lastOutputAt`.
- **After `dispatch --inject`, send a follow-up Enter.** The injected prompt lands mid-MCP-boot
  and sits pasted-but-unsubmitted in the composer: `terminal wait --for tui-idle` → `terminal read`
  → if you see "[Pasted Content …]" unsubmitted, `terminal send --text "" --enter`.
- **`--result` / any JSON arg must be space-free** when passed from PowerShell (it splits on
  spaces): `--result '{"pr":20,"gates":"green"}'`, not `{"pr": 20}`.
- **codex launch prompts:** a version-update prompt → send "2" (Skip). (The `worker_done` hang is
  handled by the autonomy flag in the Codex section.)

## Post-run verification checklist (orchestrator must do all of these)

1. `git log --oneline -3` — a new commit exists with the correct `M<x>-<nn>:` prefix.
2. `git status --short` — working tree is clean (or only expected leftovers).
3. The diff touches what the brief demands — especially **tests** and the module's **AGENTS.md**; implementers most often skip these.
4. `pnpm typecheck && pnpm lint && pnpm test` from root, run by the orchestrator — never trust the implementer's claim that they pass.
5. Review the diff against the brief's Do / Don't / Acceptance criteria before merging.

## Escalation ladder (updated 2026-07-09)

1. **codex** — default implementer (owner has ample codex quota). Launch as an Orca worker
   with the autonomy flag so `worker_done` works.
2. **Claude Agent subagent** — the reliable parallel/second lane. Use when codex is near its
   limit (don't run two codex against a near-limit account) or as the immediate fallback when
   grok no-ops. Runs on a different resource, so it parallelizes cleanly with a codex run.
3. **grok** — now viable with `--always-approve` (see Grok section). Try it for a module when
   you want a third lane; if it still no-ops with that flag, drop it and use lane 2.
4. **architect (orchestrator) takeover** — last resort, and the **most token-expensive** path
   (see "Orchestrator role & token budget"). Prefer re-briefing + re-dispatching to a fresh
   implementer over implementing inline. Only take over for a genuinely trivial fix or after
   ~2 failed review-fix cycles, per ORCHESTRATION.md.

History: grok no-opped repeatedly (M4-02/04, M5-01, UX-04) — but every one of those runs used
the old `--permission-mode acceptEdits` flag, not `--always-approve`; the "grok is broken"
reputation is largely that flag bug. codex has been the dependable workhorse throughout.
