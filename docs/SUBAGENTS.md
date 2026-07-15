# Subagent Dispatch Guide (grok / codex)

*Companion to ORCHESTRATION.md (TRIP). That doc defines roles and the review loop; this one is the operational manual for invoking the headless implementer CLIs without tripping over their known failure modes. Update it whenever a new failure mode is discovered.*

**Entry:** `ONBOARDING.md` (triage: self vs orchestrate). **Models:** `docs/MODEL-POLICY.md` (confirm expensive with owner). Optional Claude Code Codex plugin: `docs/OPTIONAL-CLAUDE-CODEX.md`.

## Orchestrator role & token budget (read this first)

The orchestrator is often a frontier model (e.g. Claude Opus) -- **the single most token-expensive
resource in the loop, and its context window is the scarce thing to protect.** For non-trivial
work it must not do the bulk of implementation itself. Its job is:

1. **Triage** -- trivial vs standard vs heavy; self-implement only when trivial is clearly cheaper.
2. **Brief** -- tight task brief (Do / Don't / Acceptance criteria). Pin exact file paths so
   implementers don't have to re-explore. Link the plan for standard/heavy.
3. **Dispatch** -- hand coding to a cheaper capable implementer (codex, grok, or another
   worker). One implementer owns one module in one worktree. Model tier: MODEL-POLICY.md.
4. **Verify** -- re-run `pnpm typecheck && pnpm lint && pnpm test` yourself and review the
   **diff** against the brief/plan. Never trust an implementer's "green" claim.
5. **Commit + PR** -- implementers do not commit by default; orchestrator commits; owner merges.

Token discipline (do all of these):

- **Delegate non-trivial implementation.** Only edit code inline for genuinely trivial
  work where dispatching would cost more than the edit. Anything substantial -> dispatch.
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
6. **Dispatch commands must START with `grok` / `codex` / `.\scripts\dispatch-codex.ps1`.** The machine's Claude Code permission allowlist (2026-07-15) is prefix-matched against the whole command string, so `cd <worktree> && grok …` isn't covered and may be blocked by the permission classifier. Use grok `--cwd` / codex `-C` to target the worktree instead of a `cd` prefix.

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

### When to reach for grok (owner has ample grok credits — use them)

Grok is not just the fallback lane. It is the **first choice** for work that is mechanical or
well-pinned, so frontier/codex budget is saved for judgment. Proven-good grok jobs:

- **Web research & doc synthesis** — "search the web and summarize X into a structured
  report with sources." Cheap, parallelizable, and it does not need to touch the repo. Do
  NOT spend a frontier Claude subagent on this (see MODEL-POLICY "Research & exploration").
- **Mechanical, fully-pinned edits** — renames/label maps/string sweeps where the change set
  is enumerated up front (grok's first clean run was M10-06, a rename audit it had itself
  produced). Success pattern: exhaustive brief + hard file exclusions + "change ONLY these
  strings."
- **Delta / audit passes** — "list every place that still does X" (grok did the UX-06C audit).
- **Parallel second lane** — disjoint file set from a codex run, both in isolated worktrees.

Do NOT use grok for: subtle security reasoning, multi-file design under ambiguity, or
anything where "looks plausible" is not good enough — those stay codex-mid or the reviewer.

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
- **Token revocation lies about login state** (2026-07-14): the OAuth refresh token can be revoked server-side while `codex login status` still reports logged in — symptom is `401 token_revoked` on every call. Fix: `codex logout && codex login` (owner action, interactive).
- **`[windows] sandbox = "elevated"` in `~/.codex/config.toml` kills headless runs** (2026-07-14): every sandboxed run dies with `CreateProcessAsUserW: Access is denied` while spamming UAC popups. Do NOT edit the config value (the desktop app owns it) — dispatch with `-c windows.sandbox="unelevated"` (baked into `scripts/dispatch-codex.ps1`), or with owner-approved `--dangerously-bypass-approvals-and-sandbox` for Orca-tracked runs. Note `codex exec resume` does NOT inherit the bypass flag from the original session — pass it again on resume calls.
- **`cannot enforce split writable root sets; refusing to run unsandboxed`** (discovered 2026-07-15, FEAT-connect-oauth): a `-c windows.sandbox="unelevated"` run can fail *at sandbox setup* on `apply_patch` to an existing file — most often in a **git worktree with prior uncommitted work**. Likely cause: a worktree's `.git` is a file pointing at `<main-repo>/.git/worktrees/<name>`, so git-touching writes need a second writable root outside the worktree dir, and the unelevated restricted token can't express two disjoint roots. It can hit mid-task even after an earlier run in the same worktree succeeded. **Fix, in order:** (1) prefer the **codex-plugin-cc** path (`docs/OPTIONAL-CLAUDE-CODEX.md`) — it runs codex through its app server, not the raw `codex exec --sandbox` wrapper, so it sidesteps this whole class of sandbox-setup failure without weakening any isolation; (2) if the fix is small and you have already scoped it, orchestrator takeover is allowed after ~2 failed cycles (escalation ladder) rather than a third dispatch attempt; (3) only if neither fits, ask the owner in plain chat to approve `--dangerously-bypass-approvals-and-sandbox` **for that specific run** (a disposable worktree is externally sandboxed) — this is a per-run owner decision, never a standing default.
- **Model policy** (owner): routine briefs = `gpt-5.5` at `model_reasoning_effort=medium` (2026-07-11, the dispatch script's defaults); TRIP-workflow feature runs = `gpt-5.6-terra` at `high` (2026-07-14). Never `gpt-5.6-sol`/xhigh — too token-hungry.

## Claude Agent implementer lane — OVERRIDDEN, do not use (owner, 2026-07-09)

**Owner directive: implementation lanes are codex + grok ONLY.** Claude Agent subagents
are not to be used as implementers — they burn the owner's Claude plan usage, which is
the scarce resource in the loop ("dont use claude sub agents. use grok. i have lots of
credits on both grok and codex"). Read-only Explore/summary subagents for the
orchestrator's own context-saving remain fine.

(Historical note, kept for context: a general-purpose Claude Agent did deliver the UX-04
sidebar rewrite cleanly on 2026-07-09 when grok was still no-opping under the old
`--permission-mode` flag; grok's no-op cause is fixed — see the Grok section — so the
justification for this lane is gone.)

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

## Escalation ladder (updated 2026-07-15; owner lane policy 2026-07-09)

1. **codex** — default implementer (owner has ample codex quota). Launch via
   `scripts/dispatch-codex.ps1` or as an Orca worker with the autonomy flag so
   `worker_done` works.
2. **grok** — the parallel/second lane, viable with `--always-approve` (see Grok
   section). If it no-ops even with that flag, capture `--debug-file` and fall back
   to codex.
3. **architect (orchestrator) takeover** — last resort, and the **most token-expensive**
   path (see "Orchestrator role & token budget"). Prefer re-briefing + re-dispatching to
   a fresh implementer over implementing inline. Only take over for a genuinely trivial
   fix or after ~2 failed review-fix cycles, per ORCHESTRATION.md. Claude Agent
   subagents are NOT a lane (owner directive — see the overridden section above).

History: grok no-opped repeatedly (M4-02/04, M5-01, UX-04) — but every one of those runs used
the old `--permission-mode acceptEdits` flag, not `--always-approve`; the "grok is broken"
reputation is largely that flag bug. codex has been the dependable workhorse throughout.
