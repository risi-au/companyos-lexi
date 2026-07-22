# COS → Lexi: Full Discovery Report

*Date: 2026-07-19. Based on: `cos-learning/docs/VISION.md` + all Lexi Core docs, full `companyos` repo audit (HEAD `4512d66`), UX/UI code audit, learning-program evidence state. Read-only analysis — no code was changed.*

---

## PART A — How far is COS from becoming Lexi?

### A1. The vision, decomposed into buildable capabilities

Reading `VISION.md` + `LEXI-CORE-ARCHITECTURE.md`, "Lexi" is six durable contracts plus one proactive experience layer:

| # | Lexi requirement | What exists in COS today | State |
|---|---|---|---|
| 1 | **Source ledger** (immutable evidence: records, events, decisions, session returns) | Records module, append-only events on every write, sessions with wrap-ups, workbench/git ingestion | 🟢 ~85% — no immutable record-revision ledger; bounded wiki history threatens rebuild lineage |
| 2 | **Knowledge artifacts** (synthesized pages/patterns/profiles, portable) | Markdown-canonical wiki + revisions, brain nightly distillation, wikilinks/backlinks/citations, personal wikis | 🟢 ~80% — metadata only partly structured; flat frontmatter parser can't carry the v1 contract |
| 3 | **Provenance & policy** (per-claim origin, ownership, review state) | Scope grants, citations (M10-03), classification emerging | 🟡 ~50% — **known bug**: brain writes `verified_at == learned_at`, so "unreviewed" is indistinguishable from "human-verified"; no explicit `reviewState` |
| 4 | **Engine interface** (replaceable brain behind `describe/ingest/query/lint/rebuild` contract) | `packages/brain` works but is an internal module | 🟡 ~30% — no versioned provider interface, no conformance tests, no engine registry, no shadow-run/rollback |
| 5 | **Federation interface** (company ↔ individual brains, revocable, one-way) | Nothing — zero hits in code | 🔴 0% — **deliberately deferred**; current `personal` scope lives inside the company trust domain and the docs correctly say it's NOT Individual Lexi |
| 6 | **Evaluation & portability** (export/import bundles, conformance suite) | Backups/DR exist (restore drill passed) | 🔴 ~10% — no artifact bundle export, none of the 9 conformance checks |
| 7 | **Proactive layer** (dream morning: prioritized view, kickoff, recommendations, learning loop) | Attention items + bell (M10), Ask OS chat, approval queue, graduation proposals | 🟡 ~35% — reactive pieces exist; the proactive/digest/kickoff/recommendation machinery is M13 = **0% started** |

### A2. The dream morning, line by line

| VISION.md says Lexi shows… | COS today |
|---|---|
| Work waiting for my feedback / approval | ✅ Exists — "Things to resolve" attention queue + notification bell (M10-01, poll-based) |
| Completed agent work to review | ✅ Exists — sessions registry + structured wrap-ups; ⚠️ no "unreviewed" filter or review action |
| Work ready to start | ⚠️ Tasks exist (Plane), but no "ready" surfacing, no prioritization |
| A single prioritized operating view | ❌ **Missing — this is M13-05 (daily digest)** |
| Kickoff: gather context conversationally, recognize similar prior work, recommend tool/model/effort with cost explanation | ❌ Missing — M13-02/M13-04 (briefed sessions, defaulting cascade). The *pattern* exists once, for scopes (intake wizard) |
| Smallest useful kickoff artifact per tool connectivity | ❌ Missing — M13-04 kickoff gradient |
| Structured return + state sync | 🟡 Sessions wrap-up is freeform; no minimum return contract (M13-02) |
| Learn from completed work, propose safer automation | 🟡 Brain graduation proposals exist (wiki-level); opportunity/automation guidance exists only as cos-learning *templates*, not product |
| Available on web/mobile/desktop, vendor-independent | 🟡 Responsive web ✅; doctrine = external MCP clients (mobile Claude) instead of native apps; LiteLLM role aliases (`cheap`/`analysis`/`reasoning`/`embed`) give real vendor independence ✅ |

### A3. The verdict on distance

**System-of-record spine: ~90–95% done for v1.** All 13 modules are real (zero stubs), 63 MCP tools registered (primer says 57 — stale doc), 44 test files, staging-deployed with CI, release pipeline, and a passed backup restore drill.

**Proactive assistant layer: ~35–45% done.** The gates exist (approvals, personal memory, citations); the *proactivity* does not.

**Overall: roughly 55–65% of the way to a daily-usable "Lexi for one company"** (the internal dream morning). The remaining work is concentrated and already mostly *named* in the roadmap: the M11-01 sliver + all of M13 + the Lexi Core contract extraction + M14. **Federation and Individual Lexi are a later chapter by design — do not build them now.**

The architecture doc already made the key strategic call correctly: *"retain the current COS brain as engine version 1. Extract the stable Lexi Core contracts around it before adopting another engine."*

---

## PART B — Implementation Guide (paste this into a new working session)

> **Context block for a new session:** CompanyOS (`C:\dev\companyos`) is a TS monorepo: `apps/os` (Next.js), `packages/{db,api,mcp,ui,brain,wizard}`. Constitution: modules never import each other; ALL logic in `packages/api`; every write emits an event; markdown canonical + jsonb; PRs only, never push to main; update module `AGENTS.md` in the same commit. Roadmap lives in `docs/tasks/*.md` (status lines authoritative). Target: evolve COS into Lexi per `C:\dev\cos-learning\docs\VISION.md` + `LEXI-CORE-ARCHITECTURE.md` + `KNOWLEDGE-PORTABILITY-CONTRACT.md` (`schemas/knowledge-artifact-v1.schema.json`). Current state: M1–M10 + UX-01..08 done; M11 partially shipped (OAuth #55, connect wizard #59, connected apps #68); M12/M13 are pre-brief captures; M14 is the prod gate.

### Shot 0 — Hygiene (½ day, do first)
1. Fix 3 stale status lines: `M6-00-overview.md` (children all done), `FEAT-connected-apps-list.plan.md`, `FIX-rename-timestamp-migration.plan.md` (both shipped).
2. Update `COMPANYOS-PRIMER.md` §7: 57 → 63 tools.
3. Resolve the `cos.risi.au` vs `cos-staging.risi.au` DNS/doc mismatch noted in `CURRENT-COS-STATE.md`.
4. **Security hygiene:** `.codex/config.toml` in cos-learning holds a live bearer token in plaintext on disk (gitignored, but present). Rotate it and move token storage to env var.

### Shot 1 — Finish M11-01: the arming ritual (1–2 days) — *everything in M13 depends on this*
- MCP **server instructions** carrying the start/wrap ritual, and `start_task` / `wrap_up` as MCP **prompts** (`registerPrompt` — confirmed absent in `packages/mcp/src/server.ts`).
- Tool-surface audit + conformance matrix doc.
- Owner staging OAuth smoke (the one open FEAT-connect-oauth checkbox).
- **Done when:** a fresh Claude/Hermes client connects via OAuth and is guided through register→work→wrap without a human-written prompt.

### Shot 2 — M13-02: Briefed sessions + return contract (2–3 days) — *the spine of Lexi's task loop*
- DB migration: `sessions` gains `brief jsonb` (goal, context refs, kickoff artifact ref, expected return schema) and `structured_return jsonb`.
- `packages/api` sessions module: brief validation; wrap-up **minimum return contract** (outcome, artifacts, records logged, human interventions, friction, follow-ups).
- Session-join by ID (M11 decision 7): multiple bodies join the human's one session.
- MCP: extend `register_session`/`complete_session` (additive, per contract rules). UI: session detail renders brief + structured return; "unreviewed completed sessions" filter.
- **Done when:** an external worker can be armed with a brief and its wrap-up lands structured, queryable, and reviewable.

### Shot 3 — M13-01 + M13-07: Assistant bundles + reference assistant (2 days)
- Bundle schema in the skills repo: role definition, skills manifest, credential schema (names only), kickoff templates, return contract, learning hooks. Sync via existing `sync_skills`.
- Create the assistant identity pattern: principal + scoped token + budget-capped LiteLLM key (all existing machinery — document it).
- Reference bundle: **Meta Ads Assistant** from the 2026-07-17 NW session evidence (`synthesis/handoffs/2026-07-17_rishi_optimum-weekend.md`): draft-only Meta work, human keeps budget/targeting/publish.

### Shot 4 — M13-05: Daily digest = the "dream morning" surface (3–4 days) — *highest perceived-value shot; this is what makes COS FEEL like Lexi*
- New isolated module `digest` (own `AGENTS.md`), service in `packages/api`.
- Compose the five lanes from VISION.md: waiting-for-feedback, waiting-for-approval (attention_items), completed-to-review (sessions, unreviewed), automation candidates (repeated patterns/brain lint), ready-to-start (tasks).
- Each item explains: project, work type, state, **why it needs you**, what the worker did, **what happens after you act** (all data exists; this is a curation/ranking job — brain-authored ordering is fine, but keep it explainable).
- UI: digest as the landing surface; MCP: `get_digest`. No task-manager features — it's a reading/acting surface.

### Shot 5 — M13-04: Kickoff gradient + defaulting cascade (2–3 days)
- Questions-as-cache-misses: kickoff flow resolves answers against run answers → principal working-profile memory (personal wiki, M10-02) → scope wiki → template defaults. Write-back on miss.
- Kickoff artifact gradient by tool connectivity: full-MCP client gets the ritual (Shot 1); disconnected tool gets a paste pack; middle gets a checklist.
- Reuse intake wizard machinery — it's the same Frame→Arm→Work→Return→Learn loop, generalized from scopes to tasks.

### Shot 6 — M13-03: Two-layer capture (4–5 days; largest — can slip past "first daily-use" cut)
- Platform mirror (start with Meta via n8n): scheduled pulls → diff → **draft records** (floor: complete record even when rituals are skipped).
- Reconciliation loop: unattributed mirror changes → attention items ("the mirror saw X not in any wrap-up — yours?") with one-tap attribution.

### Shot 7 — M13-06: Standing roles / GM rails (2–3 days, mostly wiring)
- Register each assistant as a **capability** (run history + dead-man alerting already exist).
- All spend/publish/send proxied through the M10 approval queue (exists); autonomy per-action, each a logged decision; default mode = observe/diagnose/plan.
- OS-side scheduling: body asks "what's due?" (Plane due dates via existing task tools); one active body per identity (token = baton).

### Shot 8 — Lexi Core contract extraction (the "engine v1 → Lexi Core" work; parallelizable, 5–8 days total)
1. **L1 Metadata:** docs/artifacts gain structured v1 metadata (jsonb column or sidecar) matching `knowledge-artifact-v1.schema.json`: `artifactId, brainId, namespace, kind, classification, reviewState, confidence, times, sourceRefs`. Keep frontmatter to flat stable scalars (parser limitation).
2. **L1b Fix the verification bug:** explicit `review_state` (`unreviewed|verified|disputed|stale|archived`) + `verified_by/verified_at` independent of `learned_at`; brain proposals always land `unreviewed`; attention/EOD confirmation flips to `verified`. *(This is the single most important correctness fix for the whole learning thesis.)*
3. **L2 Preservation policy:** record-revision ledger (or document events-as-ledger coverage) + wiki revision retention policy so rebuild-from-sources stays possible.
4. **L3 Export/import bundle v1** (manifest, artifacts/*.md+meta.json, ledger/*.jsonl, relations, policies, engines manifest) + the **9 conformance tests** from `KNOWLEDGE-PORTABILITY-CONTRACT.md` as an automated suite (markdown round-trip, stable IDs, citations, namespaces, policy enforcement, revision history, **rebuild without embeddings**, no cross-brain leakage, deterministic rollback).
5. **L4 Engine adapter:** versioned provider interface (`describe/ingest/query/lint/rebuild/export_state`) wrapping `packages/brain` as engine v1; engine registry + manifest; shadow-run mode (proposals to staging area, human-reviewed diffs); adapter switch + rollback.
- **Explicitly deferred:** federation wire protocol, Individual Lexi deployment, claim-level provenance tables (add when evidence demands).

### Shot 9 — M14 prod gate + UX P0s (3–4 days) — *required before "finished product I work with daily"*
- M14 checklist: rate limiting (none today), security headers, token hygiene (protected/system tokens, rotation runbook), `pnpm audit` automation, secrets scanning, e2e smoke, uptime monitoring, **external alert delivery** (n8n→Telegram/email — without this the proactive loop dies when the tab is closed), incident runbook.
- UX P0s from Part C (at minimum: wizard Esc data-loss, wizard/sidebar offset, Ask OS new-chat + Esc + type sizes, canvas silent failures, members-tab confirm + error handling).

**Sequencing logic:** 0 → 1 → 2 → 3 → **4 (digest early — daily value)** → 5 → 7 → 6, with 8's L1/L1b/L2 pulled as early as cheap (adding `namespace`/`reviewState` columns NOW is nearly free; retrofitting provenance is expensive). Do NOT start: federation, native mobile, control plane, CRM/email ingestion.

---

## PART C — UX/UI quirks audit (from code, with evidence)

The overhaul (UX-01..08) built genuinely good infrastructure: V2 tokens + lint, 4 themes, motion guard with reduced-motion kill switch, excellent ConfirmDialog (focus trap + restore), Tabs with roving tabindex, resizable sidebar (220–420px, keyboard accessible), mobile drawer. The problem is **adoption lag (~60% migrated) and the surfaces the overhaul never touched**.

### High severity
1. **Wizard takeover hardcodes `left-[264px]` but the sidebar is user-resizable 220–420px** — `modules/intake/IntakePanel.tsx:656` vs `AppShellChrome.tsx:187`. Resize the sidebar → the signature setup flow overlaps or gaps. Integration bug at the seam of two finished packages.
2. **"Esc saves & closes" doesn't save** — `IntakePanel.tsx:665` label vs handler at 371–379 (closes only). **Silent data loss on the exact action the UI instructs.**
3. **Intake review step is 6 raw JSON textareas, no validation** — `IntakePanel.tsx:1222–1227`. The flow meant to be delegable to non-technical operators requires hand-editing JSON blind.
4. **Ask OS is the weakest surface and sits on every scope header** — `AgentChatPanel.tsx`: no streaming ("Working…" only); **no new-chat button** (auto-selects `list[0]` — you cannot start a second conversation); `text-[9px]`/`text-[10px]` (design floor is 12px); raw `JSON.stringify(toolTrace)` debug dumps; raw model aliases in mono; no `role="dialog"`, no Esc, no focus trap, no aria-live; fixed `w-96` on all viewports.
5. **Canvas swallows errors silently** — `CanvasView.tsx:126,234,255` (`catch { /* ignore */ }`); create can no-op with zero feedback; new-canvas background reads `--primitive-white` which **is defined nowhere** (line 220); hardcoded `bg-black/40` scrim, no Esc.
6. **Members tab: instant unconfirmed "Remove access"** (`s/[...path]/page.tsx:618–624` — the only destructive action without `ConfirmSubmitButton`) and form errors **throw to the full-page error boundary** ("No account with that email yet.").

### Medium severity
7. Sessions status chips hardcode light-mode Tailwind palette (`SessionsView.tsx:53–57`) — broken in 2 of 4 themes.
8. Admin tabs **full-reload** while scope tabs soft-navigate (same `Tabs` primitive; `AdminTabs.tsx` doesn't pass `linkComponent`); `/admin/intake` is an **orphan page** absent from AdminTabs.
9. No skeletons/Suspense anywhere; scope pages block on 5 sequential awaits; dashboard widgets load **sequentially** despite a "parallel where possible" comment; MetricCard's skeleton is dead code (`loading={false}` hardcoded).
10. "Scope" jargon persists in user copy ("Archived scope", header title "Scope") despite NOMENCLATURE; **decorative ⌘K chip** in `Sidebar.tsx:235` — no command palette exists anywhere.
11. **Five date-format conventions** including UTC-with-no-marker `toISOString().slice(0,16)` in the activity feed; raw UUIDs/`event.type`/`JSON.stringify(payload)` in admin activity; unconfirmed spend triggers ("ingest/lint/backfill" buttons) on `/brain/engine`.
12. `<MCP_PUBLIC_URL>` literal shows in Connect when unconfigured; change-password (forced first-run!) has no error rendering or pending state.

### Consistency debt / low
- Button primitive used in exactly 3 places; 5+ hand-rolled button recipes elsewhere; Button itself still V1-styled. V1/V2 token aliases mixed in the same rows. 3 different focus-ring systems. Stat surfaces disagree (StatCard sans vs mono MetricCard vs custom brain stats). "Loading…" vs "Loading..." vs "Working…". Rename wiki page = double-click only (undiscoverable, keyboard-hostile). 5 breakpoint systems with an 820px off-by-one overlap. Unused shadcn deps (`clsx`, `tailwind-merge`, `cva`).

---

## PART D — Usability analysis: daily use, individuals & teams

### For Rishi (individual daily driver)
**What works:** the record spine is trustworthy; MCP arming of external tools is real; personal wiki gives durable memory; approvals are MCP-answerable, so he can resolve gates from any client.

**What's missing for daily use:**
1. **A home.** There is no prioritized morning view — he must hunt across 11 tabs per scope. (→ Shot 4 digest.)
2. **Reach-out notifications.** Bell is poll-based, in-app only. If the tab is closed, "Things to resolve" don't exist. External delivery (n8n→Telegram/email, M11-03) is the difference between reactive tool and proactive assistant.
3. **A real chat surface** — no streaming, no conversation management, debug-grade rendering. As-is it erodes trust in the AI layer daily.
4. **Global search / command palette.** Hybrid search exists via MCP but the UI front-end is a fake ⌘K chip. For a system of record, no keyboard-first find-anything is a daily tax.
5. **Review ergonomics** — "completed sessions awaiting my review" isn't a filter or a queue; wrap-ups aren't structured yet (Shot 2).

### For teams (Priyanka today; clients' teams later)
**What works:** grants enforced at the service layer (never just UI) — genuinely solid; personal scopes are admin-proof; per-user working profiles are correctly never merged.

**What's missing / risky:**
1. **The delegation story breaks exactly where it should shine**: the intake wizard (built so non-technical operators can provision projects) ends in raw JSON textareas. Fix this before onboarding anyone non-technical.
2. **Unsafe member management** — instant unconfirmed removal + crash-to-error-boundary on routine mistakes. This is the most common team admin task.
3. **First-run experience** — forced change-password screen with no error handling is the literal first screen a new teammate sees.
4. **No discussion layer.** No comments on records/docs/decisions/attention items anywhere in the 13 modules. Team conversation happens in external chat, then must be manually mirrored as records — the #1 adoption friction for teams, and it starves the record (the core asset) of the "why."
5. **Assignment gaps** — tasks assign via Plane, but attention items/digest lanes have no native assignee/ownership concept visible; team triage will need it.
6. **Two invisible scope-switch systems** (tree click vs `nav.selectedProject` cookie driving the Task board URL) — nobody can form a correct mental model of the second one.
7. **Plane context-switch** for anything beyond basic task ops; the more the OS proxies natively, the less team members need two tools.
8. **Empty states don't teach** consistently (good `EmptyState` primitive exists; adoption is partial).

---

## PART E — Sensibility check: are you on the right path?

**Yes — and the foundation is unusually sound. Specific strengths:**

- **The core bet is correct and aging well.** "Chats are disposable. Tools are disposable. The record is the asset." is exactly the right posture for the agentic era, and the API-first/MCP-front-door architecture — made before MCP was fashionable — is now validated by the ecosystem.
- **The evidence-first proving strategy is methodologically right.** Refusing to design Lexi from imagined personas and instead instrumenting real work (Rishi + Priyanka), with labelled evidence (`observed/reported/inferred/hypothesis`), confirmation-separated-from-confidence, and explicit anti-promotion discipline. The loop already proved itself: the first real session (07-17) produced two contract violations, and both were folded back into `DATA-CONTRACT.md` the same day. That self-correction is the system working.
- **Deferrals are correct:** federation, Individual Lexi, native mobile, control plane, CRM/email — all correctly parked. The trust separation (company brain vs individual brain) is being treated with the seriousness privacy law and user trust will eventually demand.
- **Docs are truthful** — 3 stale status lines in an entire repo this size is remarkable, and it means the roadmap-driven agent workflow can actually function.
- **The staged autonomy doctrine** (observe → diagnose → plan → act-behind-gates → per-action autonomy, each a logged decision; spend/publish always proxied through the approval queue) is the responsible path, and the infrastructure for it (attention queue, capabilities, budget caps) already exists.

**Risks and honest warnings:**

1. **Evidence volume vs. design speed.** The learning program is ~5 days old with **1 confirmed session, 1 participant, 0 validated patterns, 0 feature-evidence files**. Meanwhile M13 is already richly designed. The vision says "let repeated evidence reveal the right product primitives" — keep M13 honest by treating its sub-briefs as hypotheses the evidence must confirm, and **get Priyanka's leg running** (her readiness is still pending; no cross-participant conclusion can exist until then).
2. **Single-bus-factor.** Everything routes through Rishi (product approvals, taxonomy, program structure, readiness). Fine now; name a deputy for ops before the team grows.
3. **The polish gap is now a bigger risk than the feature gap.** The spine is done; what will make Priyanka (or any second user) bounce off is the Ask OS panel, the wizard JSON step, silent canvas failures, and crash-on-member-error — not the absence of federation. Fix the Part C top-6 before any new-user onboarding.
4. **Proactivity dies without external delivery.** If "Things to resolve" only lives in an open browser tab, Lexi is a place you visit, not an assistant that reaches you. Prioritize n8n→Telegram/email (M11-03) earlier than its roadmap position suggests.
5. **Federation is the hardest unsolved problem** (technical *and* legal). Correct to defer — but the cheap forward-compatible moves belong in Shot 8 **now**: `namespace` on every artifact, explicit `reviewState`, stable artifact IDs, the conformance test harness. Retrofitting provenance later is 10× the cost.
6. **Keep cos-learning evidence company-owned and honest** — don't let future Individual-Lexi profile data settle into company-owned stores during the pilot; unwinding mixed trust domains later is painful. The docs already say this; hold the line.
7. **"Few shots" realism:** Shots 1–5 + 9 (≈ 2–3 weeks of focused work) gets a genuinely daily-usable Lexi-for-one-company. Shots 6–8 complete the vision's durability/portability story. Don't try to land it all at once — ship the digest early; it converts the whole system from "place I log things" to "thing that works for me" overnight, which is the emotional core of the Lexi dream.

**Bottom line:** The vision is coherent, the architecture genuinely anticipates the hard problems (provenance, replaceable engines, trust separation), the current build is ~60% of the way there with no stubs and no fake progress, and the instinct to learn from real work before committing to product primitives is the single best decision in the whole program. The path is right. The main course-correction: **sequence the daily-value surfaces (digest, notifications, chat quality) ahead of the deep contract work, keep M13 subordinate to evidence, and fix the top UX wounds before onboarding the second user.**
