# HANDOVER-2 — Lexi build, continuation

*Generated 2026-07-23. Point the next agent at this folder and this file: "read `V2 - LEXI/HANDOVER-2.md` and continue."*
*This supersedes `HANDOVER.md` for day-to-day work. `HANDOVER.md` is still the reference for the original fork/deploy/OmniRoute setup — read it once for background.*

---

## 0. TL;DR — where we are right now

- Working dir: `C:\dev\companyos-lexi`. Branch: `main`, clean tree (only untracked files are `V2 - LEXI/tools/` and `V2 - LEXI/start-lexi-board.cmd`).
- **5 of 10 shots shipped, merged, and deploying/deployed** (see scoreboard). Gate baseline: **549 tests** pass (`pnpm typecheck && pnpm lint && pnpm test`).
- Deploy: merge to `main` → GitHub Actions "Release (Lexi OS)" → **https://lexi.risi.au** (307 → /sign-in). Shot 1 confirmed live. `apps/os` post-auth landing is now **`/digest`** (Shot 4 flipped it from `/s/root`).
- Repo: `origin` = `github.com/risi-au/companyos-lexi` (private fork). **`gh` must be pinned with `--repo risi-au/companyos-lexi`** or it resolves to `upstream` (companyos) and fails.
- **The execution model has changed** (owner updated the OmniRoute combos). Use the new orchestrator system prompt + `sprint-*` combos in §3. The old `lexi-*` combos are retired.

---

## 1. The mission

Build "Lexi" (a daily-usable, single-company AI-ops layer) on top of the CompanyOS fork, as a sequence of 10 "shots". The plan lives in **`V2 - LEXI/COS-TO-LEXI-GAP-REPORT.md`** (Kim K3's 10-shot guide) — read it for the full spec of each shot. Supplement: `V2 - LEXI/MEMORY-SYSTEM-COMPARISON.md`.

Sequencing (from the gap report): 0 → 1 → 2 → 3 → 4 (digest early) → **5 → 7 → 6**, with 8's parts pulled early, **9 last**.

### The COS constitution (hard rules — do not violate)
- Modules never import each other **at the package level** (enforced by `eslint-plugin-boundaries`, but note: that rule only governs `apps/os/**`; intra-`packages/api` cross-module imports are allowed and normal).
- ALL business logic lives in `packages/api`. `packages/mcp` and `apps/os` are thin clients.
- Every write emits an event.
- Markdown canonical + jsonb for flexibility.
- Update the touched module's `AGENTS.md` in the **same commit**.
- **PR only, never push to `main`.** (See auto-merge policy §6.)
- Gate = `pnpm typecheck` + `pnpm lint` + `pnpm test`.
- Additive-only for MCP tools and public contracts (never change existing tool signatures; add).
- Drizzle migrations are **generated**, never hand-written: edit schema, then `pnpm --filter @companyos/db db:generate` (non-interactive; writes SQL + snapshot + journal).

---

## 2. Scoreboard

| Shot | What | Status | PR |
|---|---|---|---|
| 0 | Hygiene (MCP tool surface, stale statuses) | ✅ merged | #1 |
| 1 | M11-01 arming ritual (MCP server instructions + `start_task`/`wrap_up` prompts) | ✅ merged + **live** | #2 |
| 2 | M13-02 briefed sessions + return contract (**R2**, DB migration 0032) | ✅ merged | #3 |
| 4 | M13-05 daily digest — the landing surface (`/digest`) | ✅ merged | #4 |
| 3 | M13-01 + M13-07 assistant bundles + reference assistant | ✅ merged | #5 |
| **5** | **M13-04 kickoff gradient + defaulting cascade** | ⏳ **next** | — |
| 7 | M13-06 standing roles / GM rails | ⏳ | — |
| 6 | M13-03 two-layer capture (largest) | ⏳ | — |
| 8 | Lexi Core contract extraction (**R2**, expensive) | ⏳ | — |
| 9 | M14 prod gate (**R2 / security**) | ⏳ last | — |

### What each shipped shot actually added (so you don't re-derive it)
- **Shot 1:** `packages/mcp/src/server.ts` exports `SERVER_INSTRUCTIONS` (the start→work→wrap ritual), passed to `McpServer` as `instructions`; registered MCP prompts `start_task({scope, goal?})` and `wrap_up({session_id})`. Doc: `docs/tasks/M11-01-tool-surface-audit.md` (64-tool inventory + conformance matrix; **owner staging OAuth smoke still pending** — the one open M11-01 human step).
- **Shot 2:** `agent_sessions` gained `brief` + `structured_return` jsonb (migration `0032_light_crystal`). `packages/api` sessions service: `registerSession` takes optional `brief` (validated non-empty goal); `completeSession` takes optional `structuredReturn` (the minimum return contract: outcome/artifacts/recordsLogged/humanInterventions/friction/followUps, validated non-empty outcome); new `getSession(db, id, actor)` (viewer, join-by-id). MCP: `brief` on `register_session`, `structured_return` on `complete_session`, new `get_session`. UI: `SessionsView` renders brief + return, "Unreviewed (completed) only" filter. **Durable review-state tracking was deliberately deferred to Shot 8 (L1b).**
- **Shot 4:** new isolated `packages/api/src/modules/digest` — `getDigest(db, planeClient, {scopePath, includeDescendants?, limitPerLane?}, actor)` composes 5 lanes: waiting-for-feedback (`listSessions status:waiting`), waiting-for-approval (`listAttentionItems status:open`), completed-to-review (`listSessions status:completed`), automation-candidates (**explainable stub** — brain-lint wiring is a follow-up), ready-to-start (`listTasks state:open`, degrades when Plane unconfigured). Each item carries `whyItNeedsYou` + `whatHappensAfter`. MCP `get_digest`. UI `/digest` route + `DigestView` + `api.getDigest`; **post-auth landing flipped to `/digest`** (middleware + `/` fallback); sidebar Digest link.
- **Shot 3:** new `packages/api/src/modules/assistants` — zod `assistantBundleSchema` + `parseAssistantBundle` + `metaAdsAssistantBundle` reference (draft-only Meta work). Docs: `docs/patterns/assistant-identity.md` (arming = agent principal + scoped worker token + budget-capped LiteLLM key, all existing machinery), `docs/assistants/meta-ads-assistant.md`. Bundle **instances** live in the external SKILLS_REPO and sync via `sync_skills`; this is the canonical contract.

---

## 3. HOW TO WORK — the (new) orchestrator model

The owner has reconfigured the OmniRoute combos into a role-based `sprint-*` set and provided a new orchestrator system prompt. **Adopt the prompt in §3.2 as your operating doctrine.** The old `lexi-orchestrator/implementer/cheap/mechanical/reviewer` combos are retired — do not use them.

### 3.1 New OmniRoute combos (use these exact aliases)
| Combo | Use for |
|---|---|
| `sprint-scout-cheap` | read-only recon: codebase mapping, dependency tracing, finding files/tests/similar impls |
| `sprint-implement` | primary implementation (strong Codex models + fallbacks) |
| `sprint-implement-r2` | independent 2nd path / stronger pass for hard/ambiguous/failed work |
| `sprint-mechanical-cheap` | deterministic repetitive edits (renames, boilerplate, predictable test adds) |
| `sprint-conformance-cheap` | verification vs explicit requirements (lint/types/tests/acceptance/schema) |
| `sprint-review-standard` | normal independent review |
| `sprint-review-r2` | deep/adversarial review (auth, permissions, migrations, concurrency, security) |
| `sprint-rescue` | recovery/debugging when stuck or repo is broken |

Verify they're live before starting: `iwr http://localhost:20128/api/v1/models | % Content` (OmniRoute dashboard at http://localhost:20128; endpoint key is in `HANDOVER.md`/`.env` — **never echo it into worker prompts or output**).

Dispatch a worker with:
```
cline -P "openai-compatible" -m "<combo>" --thinking high --auto-approve true -c "C:\dev\companyos-lexi" --timeout 1200 "<prompt>"
```

### 3.2 Orchestrator system prompt (adopt verbatim)

**Canonical full prompt: `V2 - LEXI/ORCHESTRATOR-PROMPT.md`** — use that file as your system/role prompt. The condensed version below is a quick-reference summary; the file is authoritative if they ever differ.

> You are the master software-engineering orchestrator.
>
> Your role is to understand the objective, inspect the repository, design the implementation plan, delegate execution to Cline workers through OmniRoute, verify their work, and deliver a correct integrated result.
>
> You are not the default implementation worker. Preserve your context and reasoning capacity for architecture, planning, delegation, review, conflict resolution, and final decisions. Only make direct code edits when the change is extremely small, urgent, and more efficient than delegating it.
>
> **Execution environment.** All delegated workers run through Cline using OmniRoute. Always select workers by the exact OmniRoute combo alias in §3.1. Do not replace these aliases with raw provider or model names. The primary `sprint-implement` combo is built around strong Codex implementation models with fallbacks — trust the combo's fallback chain; do not hand-pick its underlying models.
>
> **Core operating principles.** 1) Understand before editing. 2) Break large work into small, independently verifiable tasks. 3) One clear responsibility per worker. 4) Never let two workers edit overlapping files concurrently. 5) Parallelize read-only scouting and independent reviews when useful. 6) Serialize implementation tasks that touch shared code. 7) Treat worker claims as unverified until supported by diffs, test output, or repo evidence. 8) Never mark work complete solely because a worker says so. 9) Keep changes scoped to the request. 10) No opportunistic rewrites/upgrades/cleanup. 11) Prefer existing conventions. 12) Never expose OmniRoute keys, provider creds, tokens, or secrets to workers or output. 13) Do not commit/push/merge/publish/deploy unless explicitly requested. 14) Preserve user changes already in the working tree. 15) Never discard unexplained local modifications.
>
> **Workflow.** Phase 1 Triage (restate objective; acceptance criteria; unknowns/risks; inspect git status/branch/uncommitted changes; classify task; don't ask what the repo can answer; only ask on unresolved product/architecture decisions). Phase 2 Reconnaissance (`sprint-scout-cheap`, read-only, no edits; skip only when obvious). Phase 3 Plan (ordered atomic tasks; files; per-task acceptance criteria; validation commands; dependencies; risk; which combo runs each). Phase 4 Implementation (`sprint-implement`; `sprint-mechanical-cheap` for isolated repetitive edits; `sprint-implement-r2` when primary fails/weak/complex/independent-needed; never re-send an identical vague task). Phase 5 Conformance (`sprint-conformance-cheap` compares repo state vs request/criteria/conventions/types/lint/tests/build; reports exact failures; small obvious fixes assigned separately). Phase 6 Review (every meaningful prod change → `sprint-review-standard`; add `sprint-review-r2` for auth/secrets/billing/destructive/migrations/concurrency/public-APIs/security/infra/large architecture; reviewers must reason about the diff, not trust tests; classify blocker/high/medium/low/suggestion; only blocker/high/relevant-medium auto-trigger work). Phase 7 Rescue (`sprint-rescue` when app won't start / tests fail unclearly / worker stuck / incoherent code / weird integration / repo state murky / two attempts failed; diagnose before editing; separate root-cause/symptoms/repair/files/validation). Phase 8 Final verification (inspect final diff; no unrelated files; verify each acceptance criterion; run tests/types/lint/build; confirm generated files intentional; no secrets; no debug/temp leftovers; review warnings/risks). Complete only with evidence the behavior works.
>
> **Worker task-packet format** (every delegated task): ROLE, OBJECTIVE, CONTEXT, SCOPE, OUT OF SCOPE, REQUIREMENTS (numbered), ACCEPTANCE CRITERIA, VALIDATION (exact commands), CONSTRAINTS, OUTPUT REQUIRED (approach summary, files changed, key decisions, validation results, unresolved issues, risks/assumptions). Workers inspect existing code before editing and must not claim success without validation evidence.
>
> **Delegation rules.** Use the cheapest *suitable* combo, not the cheapest possible. Discovery→scout; repetitive edit→mechanical; normal impl→implement; hard/2nd→implement-r2; requirement/test verify→conformance; normal review→review-standard; high-risk review→review-r2; broken/blocked→rescue. Don't use a reviewer as implementer. Don't use rescue merely because a task is hard. Don't merge scouting+impl+review into one run unless trivial.
>
> **Retry policy.** Transient infra/provider failure → retry once if clearly transient, else switch combo or pause with a diagnosis. Reasoning/impl failure → don't resend identical prompt; explain what failed; add evidence; narrow the task; use implement-r2 or rescue. Auth failure → stop retrying; report which provider needs reauth; continue only on unaffected combos when safe.
>
> **Context management.** Keep a compact task ledger (Task / Combo / Status / Files / Validation evidence / Review findings / Remaining risk). After each worker response: extract facts+evidence, inspect resulting repo state, discard narration, update plan, decide next. Don't paste whole prior worker outputs forward — pass only what the next task needs.
>
> **Decision authority.** Workers execute/analyze; you decide correctness, relevance, whether another pass is needed, whether the change satisfies the user, and whether the repo is safe to leave. Resolve worker disagreements with repo evidence/tests/docs/requirements — not majority vote.
>
> **Final response format.** 1) What changed 2) Important decisions 3) Files/modules affected 4) Tests/checks run 5) Review findings addressed 6) Remaining risks/limitations/follow-ups. Be precise; never claim tests passed when not run; never hide failed checks; distinguish pre-existing from introduced failures.

---

## 4. HARD-WON LESSONS about Cline (read this before delegating — it will save you hours)

The previous agent shipped all 5 shots via Cline+OmniRoute. Cline's **routing (OmniRoute) was flawless**; **Cline-the-CLI and the routed models were flaky**. Concretely:

1. **Cheap models choke on large files.** Cline reading a 2300+ line file (`packages/mcp/src/server.ts` is ~2400 lines) silently stalls and produces nothing. **Fix:** pre-compute anything requiring a full-file read (tool inventories, symbol lists, structure maps) and put it *in the packet*; instruct the worker "do NOT read <big file> in full — use only the exact anchors below." This is why packets carry a `CODEBASE MAP` section.
2. **Silent omissions pass the gate.** Workers dropped fields / skipped whole features and still reported success, because missing≠broken compiles and tests green. **Fix:** the conformance check (§5) — a machine list of required symbols verified against the diff. It caught every omission.
3. **Never trust the worker's self-report.** Always independently review the diff AND re-run the full gate yourself. "Tests passed / done" was wrong on ~half the cards.
4. **Cline output is BUFFERED — an empty/frozen log ≠ Cline is idle.** On one card Cline had already written files while its log showed 16 bytes. **Judge liveness by the WORKING TREE (`git status`/`git diff`), never the log file.** Misreading this caused a kill-and-double-apply collision (duplicate imports, doubled JSX).
5. **Dispatch ONLY via the harness `run_in_background` (it notifies on completion). Never shell-`&` a Cline run with a foreground watchdog** — the watchdog hits the tool timeout, gets SIGTERM'd, and Cline keeps running detached with no notification → collisions.
6. **Cline writes NEW files as cp1252** (mojibake em-dashes, byte 0x97) which fails the repo encoding check. After a worker creates files, verify UTF-8 and convert if needed. (Its edits to *existing* files preserve UTF-8.)
7. **Piping a Cline run through `tee` masks its exit code** (you get tee's 0). Run without a pipe.
8. **Quality was set by the packet, not the worker.** When a change was fully specified, the worker reproduced it faithfully; it neither improved nor (usually) degraded well-specified content. So: **your packet is the quality ceiling. The worker adds throughput and failure modes.**

**Previous agent's blunt recommendation (take or leave):** for small/precise shots, the orchestrate-via-Cline overhead barely beat doing it directly, because you author the packet either way. The new `sprint-*` set is built on stronger Codex models for `sprint-implement`, which may change that calculus — give it a fair run, but keep the verification discipline. For the two R2 shots (8 Core, 9 prod gate), consider `sprint-implement-r2` + `sprint-review-r2`, and if Cline proves unreliable there, a Claude subagent as executor is the reliability fallback. The owner also floated an **Aider bake-off** (repo-map aware, cheap) — never run; still the one experiment worth trying if you want a cheap map-aware executor.

---

## 5. The tightened workflow + tooling (in `V2 - LEXI/tools/`, untracked)

These are orchestration scaffolding (not product code; not committed). They live in this folder on this machine.

- **`conformance-check.mjs <checklist> [baseRef]`** — greps a packet's required symbols against the change set (added diff lines + new/untracked files). Catches silent omissions the gate misses. Checklist line forms: `symbol` (must be in change set) · `path :: symbol` (must be in that file) · `path :: !symbol` (must NOT appear — forbidden guard). Exit 1 on any miss. **Note: case-sensitive** — match the exact casing.
- **`verify-card.sh <checklist> [gate cmd...]`** — the "gate hook" at the orchestration layer (Cline's own hook contract is undocumented in 3.0.46, so enforce here). Runs conformance THEN the gate; prints CARD GREEN/RED. Run after every worker card before treating it done. Example:
  `bash "V2 - LEXI/tools/verify-card.sh" "V2 - LEXI/tools/shotX.checklist.txt" bash -c 'pnpm --filter @companyos/api typecheck && pnpm --filter @companyos/api exec vitest run src/modules/<m>/<m>.test.ts'`
- **`PACKET-TEMPLATE.md`** — the hardened packet format (CODEBASE MAP + SELF-CHECK + CONFORMANCE TOKENS). Note this predates the owner's new §3.2 task-packet format (ROLE/OBJECTIVE/…); reconcile them — the new format is the required structure, and CODEBASE MAP / CONFORMANCE TOKENS / SELF-CHECK are proven add-ons that fit inside CONTEXT/VALIDATION/ACCEPTANCE.
- `shot3/4a/4b/4c.checklist.txt` — example conformance checklists from shipped shots (reference for the format).

**Per-shot loop that worked:** scout/map the domain → write per-card patch-spec packet (exact anchors + verbatim content + conformance tokens) → dispatch worker (harness background) → `verify-card` (conformance + scoped gate) → review the diff vs packet + fix deviations → full root gate → PR.

Handy commands:
```powershell
Set-Location -LiteralPath "C:\dev\companyos-lexi"; pnpm typecheck; pnpm lint; pnpm test   # full gate (~2 min, 549 tests)
iwr http://localhost:20128/api/v1/models | % Content                                       # OmniRoute models
node "V2 - LEXI/tools/conformance-check.mjs" "V2 - LEXI/tools/<card>.checklist.txt"        # conformance only
```
Single-file test: `pnpm --filter @companyos/api exec vitest run <path>` (NOT `pnpm --filter @companyos/api test -- <name>` — that runs from `packages/api` cwd and breaks `brain-surfaces.test.ts`, which reads `apps/os/...` via `process.cwd()`; the full root `pnpm test` handles it fine).

---

## 6. Repo / infra state + policies

- **Branches:** one per shot, `shot/<n>-<slug>`. All shipped branches merged; none open.
- **Deploy:** merge to `main` triggers "Release (Lexi OS)" → https://lexi.risi.au. Deploy contract in `docs/LEXI-DEPLOY.md`. cos-staging is untouched.
- **`gh` gotcha:** ALWAYS `gh pr create/merge --repo risi-au/companyos-lexi` (multi-remote; default resolves to `upstream` and errors).
- **Merge convention:** `gh pr merge <n> --repo risi-au/companyos-lexi --merge` (merge commits, matches history).
- **Auto-merge policy (owner-authorized, given live in prior session):** when gate is green AND your review is clean, you may merge non-R2 shots to `main` yourself (triggers deploy) and proceed. **PAUSE for owner approval — do NOT auto-merge — on R2/security shots: 2 (done), 8, 9.** Present the plan for those; owner merges. Hard-safety always: confirm before irreversible data deletion, real external sends, entering credentials. (Note: the new orchestrator prompt §3.2 rule 13 says "don't commit/merge/deploy unless explicitly requested" — this standing auto-merge authorization is that explicit request for green+clean non-R2 shots; when in doubt, ask.)
- **Git:** `git commit` occasionally hit a stale `.git/index.lock` — if so, remove it and re-commit (staging survives). End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Board:** `V2 - LEXI/start-lexi-board.cmd` launches the Cline Kanban at http://127.0.0.1:3484 (its AI planner sidebar is broken — orchestrate via headless Cline as above, not the board planner).

---

## 7. Next shots — specifics from the gap report

**Shot 5 — M13-04: Kickoff gradient + defaulting cascade** (`sprint-implement`; non-R2, auto-mergeable):
- Questions-as-cache-misses: kickoff resolves answers against run answers → principal working-profile memory (personal wiki, M10-02) → scope wiki → template defaults; write-back on miss.
- Kickoff artifact gradient by tool connectivity: full-MCP client gets the ritual (Shot 1); disconnected tool gets a paste pack; middle gets a checklist.
- Reuse the intake wizard machinery (same Frame→Arm→Work→Return→Learn loop). Note `packages/api` already has `findRelatedHistory`, `findReusePatterns`, `assembleIntakeExternalPack`, wizard templates/framing-questions — scout these first.

**Shot 7 — M13-06: Standing roles / GM rails** (`sprint-implement`; mostly wiring):
- Register each assistant (Shot 3 bundles) as a **capability** (run history + dead-man alerting already exist — `register_capability`/`report_run`/`list_capabilities`).
- Spend/publish/send proxied through the M10 approval queue (exists); autonomy per-action, each a logged decision; default mode observe/diagnose/plan.
- OS-side scheduling: body asks "what's due?" (Plane due dates via task tools); one active body per identity (token = baton).

**Shot 6 — M13-03: Two-layer capture** (`sprint-implement`/`-r2`; largest, 4-5 days):
- Platform mirror (start Meta via n8n): scheduled pulls → diff → **draft records** (floor: complete record even when rituals skipped).
- Reconciliation loop: unattributed mirror changes → attention items with one-tap attribution.

**Shot 8 — Lexi Core contract extraction** (**R2, expensive, owner-confirm**): L1 metadata (jsonb/sidecar matching `knowledge-artifact-v1.schema.json`); **L1b `review_state` fix** (the deferred verification-bug + session review-state from Shot 2); export/import bundle + 9 conformance tests; engine adapter. Deferred: federation, Individual Lexi.

**Shot 9 — M14 prod gate** (**R2/security, owner-confirm + `sprint-review-r2`**): rate limiting, security headers, token hygiene, `pnpm audit`, e2e smoke, uptime monitoring, external alert delivery, UX P0s.

---

## 8. Key files / pointers

- `V2 - LEXI/COS-TO-LEXI-GAP-REPORT.md` — the 10-shot plan (authoritative spec).
- `V2 - LEXI/HANDOVER.md` — original fork/deploy/OmniRoute setup + first-session detail.
- `V2 - LEXI/MEMORY-SYSTEM-COMPARISON.md` — memory architecture supplement.
- `V2 - LEXI/tools/` — conformance-check.mjs, verify-card.sh, PACKET-TEMPLATE.md, example checklists.
- `docs/CONSTITUTION.md`, `docs/LEXI-DEPLOY.md`, `docs/MODEL-POLICY.md`, `docs/tasks/M11-external-integrations-overview.md`.
- Auto-memory (previous agent, this machine's Claude): `~/.claude/projects/C--dev-companyos-lexi/memory/` — `lexi-shot-orchestration.md` (Cline gotchas, gate baseline) + `lexi-automerge-policy.md`. The next account won't share this memory — the relevant contents are folded into §4 and §6 here.
- Graphify: a knowledge graph of this repo exists (SessionStart hook builds it; ~686 nodes). No persistent `graphify-out/graph.json` at repo root — for a single shot, mapping the domain directly with targeted grep/read was faster than a full graphify build.

---

## 9. Recommended first moves for the next agent

1. Read this file + `COS-TO-LEXI-GAP-REPORT.md` (Shot 5 section). Adopt the §3.2 orchestrator prompt.
2. Confirm state: `git status` (expect clean on `main`), `git log --oneline -6`, OmniRoute models list (confirm the `sprint-*` combos exist), `pnpm typecheck && pnpm lint && pnpm test` (expect 549 green) — establish your own baseline.
3. Scout Shot 5 with `sprint-scout-cheap`: how the intake wizard + defaulting/reuse machinery works in `packages/api` (`findReusePatterns`, `findRelatedHistory`, wizard templates) and `apps/os` intake module.
4. Plan Shot 5 as atomic cards, write packets in the §3.2 format (+ CODEBASE MAP / CONFORMANCE TOKENS), delegate to `sprint-implement`, verify with `sprint-conformance-cheap` and `verify-card.sh`, review with `sprint-review-standard`, gate, PR, auto-merge (non-R2).
5. Keep the §4 lessons in front of you — especially: judge Cline by the working tree, never trust self-reports, run the full gate yourself, and only background via the harness.

*Owner is `risi@nutritionwarehouse.com.au` / GitHub `risi-au`. Today: 2026-07-23.*
