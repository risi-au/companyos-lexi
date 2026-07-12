# M13: Assistants & Standing Roles (milestone capture)

status: **CAPTURE / PRE-BRIEF — 2026-07-09.** Not an implementation brief. This is the
graduation of the 2026-07-08 "assistants" brainstorm into the roadmap so an implementer
can chat it into real sub-briefs. Do NOT treat the sub-task list as acceptance criteria.
depends on: M10 (approval primitive = action gates; personal wiki = principal memory),
M11 (universal MCP = arming; sessions-join; integrations = the bodies), and composes
M12 (durable record) where available.
discussion sources: `C:\dev\Feature Requests\2026-07-08-META-ADS-AUTOMATION-AND-
ASSISTANTS-SESSION-RECORD.md` (Parts 3-5, 8) — full rationale lives there.

## Vision

Recurring work and standing roles become **assistants**: the OS arms an external tool
to do a job and debriefs it, learning each time. The creation wizard already implements
the loop once, for scope birth — **Frame → Arm → Work (outside) → Return → Learn**. An
assistant is that loop generalized from scopes to tasks and to ongoing roles (like a
project "General Manager"). The OS never executes the work; it arms the user's chosen
tool and captures the result.

## The core decomposition (from the GM scenario, Part 8)

An assistant — including a standing role like a GM — is four separable parts:
- **Identity** = a principal + token (e.g. `indya-gm`), granted at a scope. GM =
  granted at PROJECT ROOT, inheriting to all sub-scopes; a scope specialist = same
  primitive granted narrower. The GM is NOT a scope — it's an actor. "GM" = the
  assistant with the widest grant. Assistants all the way down.
- **Brain** = the scope's wiki + records + metrics, served over MCP. Not in the body —
  which is why the body is swappable.
- **Role** = a content bundle in the skills repo (role definition, skills manifest,
  credential schema, kickoff templates, return contract, learning hooks). Zero kernel
  code per new assistant → Google Ads / GM / anything addable as content.
- **Body** = any MCP-capable agent (Hermes, Claude, Codex, Grok). Interchangeable.

Point any body at (token + MCP endpoint + role bundle) → it becomes that assistant.

## Components discussed (each ~= a sub-brief later)

1. **Assistant bundle format** — the content-bundle schema above, in the skills repo,
   synced like scope-intake skills. Defines an assistant with no platform code.
2. **Briefed sessions + `start_task` / `wrap_up`** — task-shaped briefing/packet;
   sessions carry a brief; tools JOIN the human's one session by id (M11 decision 7).
   The OS opens a briefed session, the body joins — same inversion as scope-first
   intake. Return contract = the minimum a wrap-up must carry.
3. **Kickoff artifact gradient** — pointer / pack / checklist chosen by the tool's
   connectivity (full MCP client gets the ritual; a disconnected tool gets a paste
   pack). Answers "prompt or token or MCP?" per tool.
4. **Questions-as-cache-misses + defaulting cascade** — every wizard/assistant question
   is a cache miss resolved against: run answers → **principal working-profile memory
   (personal wiki, M10-02)** → scope wiki → template defaults. The wizard shrinks as
   these fill. Incentive principle: the person who hits missing context has the reason
   to fix it in the flow (write-back on miss).
5. **Two-layer capture** — the antifragile record:
   - **Mirror (floor):** platform APIs (Meta, Woo, GA, Shopify) diffed on a schedule →
     draft records. Guarantees a complete record even when rituals are skipped.
   - **Briefing (ceiling):** the enriched "why" from briefed sessions.
   - **Reconciliation loop:** unattributed mirror changes → attention items
     ("the mirror saw X not in any wrap-up — yours?") for one-tap attribution. Self-
     healing record.
6. **Daily digest** — a brain-curated surface of what matters (NOT a task manager);
   pairs with the M10 "Things to resolve" queue.
7. **Standing roles / GM rails** (from Part 8) — must preserve when built:
   - **Substitutability yes, simultaneity no:** one active body per identity (token =
     baton, not broadcast).
   - **Brain externalized, body disposable** (no large local memory in the body).
   - **A target-driven agent will act** → all spend / publish / send route through the
     M10-01 approval queue; autonomy granted per-action, later, each a logged decision;
     start at observe/diagnose/plan/task/follow-up.
   - **Schedules live in the OS** (Plane due dates, n8n); the body's cron is a dumb
     alarm that asks the OS "what's due?"
   - Register the assistant as a **capability** (run history + dead-man alerting — you
     must be told when your GM stops running) with a budget-capped LiteLLM key.
   - An assistant is only as good as intake-seeded wikis (brand voice / design language
     / region rules) — hollow wiki → confident planning from nothing.
8. **Genesis loop** — assistants are born from pilot-session reports. The 2026-07-08 NW
   Meta Ads manual session is the genesis of the **reference assistant: "Meta Ads
   Assistant."** (The NW-specific Phase 0/1 pipeline stays a TENANT workflow in
   `C:\dev\Feature Requests` / the NW Box folder — not a platform task here. This
   milestone is the generic assistant machinery; the NW pipeline is its first instance
   and proving ground.)

## Open questions parked (decide at implementation)

- Briefing = a session extension vs a new object.
- Working profiles global (per-principal, instance-wide) vs per-scope — leaning global
  per M10-02, confirm.
- Minimum viable return contract (what a wrap-up MUST carry).
- Direct vs proxied platform writes (hybrid leaning — proxy the publish/spend step so
  the gate is server-enforced).
- Mirror-first vs assistant-first build sequencing (mirror is the guaranteed-value
  floor; strong case for first).
- Reconciliation claim UX; multi-user attribution.

## Rough sub-task breakdown (indicative, not briefs)

- **M13-01** assistant bundle format (skills-repo schema).
- **M13-02** briefed sessions + `start_task`/`wrap_up` + return contract.
- **M13-03** two-layer capture: platform mirror + reconciliation loop (case for first).
- **M13-04** kickoff gradient + defaulting cascade (reads personal wiki + scope wiki).
- **M13-05** daily digest surface.
- **M13-06** standing roles / GM: capability registration, dead-man alert, budget cap,
  action-gating through the approval queue, OS-side scheduling.
- **M13-07** genesis (pilot-report → bundle) + the reference Meta Ads Assistant bundle.

Dependencies: needs M10-01 (approval), M10-02 (personal wiki), M11-01 (universal MCP),
M11 session-join. Within M13, mirror/reconciliation (M13-03) is the strongest
first-value slice.
