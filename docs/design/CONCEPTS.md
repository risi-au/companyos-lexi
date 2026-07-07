# CompanyOS — Design Concepts

*Problem → concept → wireframe → what it improves → effort (S/M/L). Every concept traces to code read during the audit (file:line cited). Constraints honored: existing token system evolved not replaced (see DESIGN-SYSTEM-DELTAS.md), doctrine respected (agent-facing system of record; no CRM features; no chat UI in the wizard critical path). Wizard copy that lives in admin-editable templates is proposed separately in NOMENCLATURE.md §4.*

Design read (taste-skill §0.B): *product UI for an operator who lives here all day; calm, trustworthy operating-system language; Linear/Stripe-dashboard energy per DESIGN-SYSTEM.md; dials Variance 3 / Motion 2–3 / Density 6.*

---

## 1. THE CREATION WIZARD AS A TRUE STEPPER (owner priority 1)

### Problem
`modules/intake/IntakePanel.tsx` renders the entire lifecycle — Framing (L242), Related history (L269), Brain reuse (L313), External pack (L344), Review (L378) — as **one scrolling column of always-visible sections**, regardless of status. Consequences, all visible in code:

- No sequence, no progress. The only status cue is `statusLabel()` (L68-70) printing raw enums: "awaiting external", "needs review".
- Six raw JSON textareas (`LabeledArea`, L392-397 + L425-432) *are* the review step. Approving means eyeballing `JSON.stringify` output (L64-66).
- The paste-back flow is two unlabeled read-only textareas side by side (L350-353) — nothing tells the operator which one to copy, where to paste it, or what comes back.
- Every button is live all the time; gating exists only as `disabled` logic scattered across statuses (L402, L405), so the screen can't answer "what do I do next?"
- Save actions give zero success feedback (no toast system exists anywhere in the app).
- The intake list sidebar (L149-165) titles each packet with its **status** and shows a raw UUID (L161) as the identifier.

### Concept: a six-step rail with one job per screen

The intake status enum (`packages/db/src/schema/intake.ts:4-12`: draft → awaiting_external → needs_review → approved → provisioned, + rejected/dismissed) already *is* a step machine. The UI should surface it as one.

**Step map** (statuses in parentheses = where the stepper auto-positions):

| # | Step (code-level label) | Job — one per screen | Maps to existing code |
|---|---|---|---|
| 1 | **Basics** | Confirm name, position in tree, and the "why" captured at creation. Edit in place. | reason answer (IntakePanel L226, L245-246); NewScopeDialog fields (Sidebar.tsx L238-267) |
| 2 | **Framing** (draft) | Answer the admin-authored questions. Nothing else on screen. | template questions loop (L249-258), `saveFramingFieldsAction` |
| 3 | **History & starting point** (draft) | Two panes of the same job: pull related history + optionally adopt a reuse pattern. | Related history (L269-311) + Brain reuse (L313-342) merged — both are "seed the new scope with what we already know" |
| 4 | **External interview** (awaiting_external) | Copy the pack out, run it in the external LLM, paste the return. | External pack (L344-376) |
| 5 | **Review & approve** (needs_review) | Read a human summary of what will be created; approve or send back. | Review section (L378-419) |
| 6 | **Provision & credentials** (approved → provisioned) | Watch provisioning execute; fill requested credentials. | `provisionIntakeAction` (L405-410) + CredentialsPanel setupMode (s/[...path]/page.tsx L409-414) |

**Shell wireframe** (desktop; rail collapses to a top progress bar <1024px):

```
+--------------------------------------------------------------------------+
| New scope: indya/seo                                    Esc = save+close |
|--------------------------------------------------------------------------|
|  1 Basics        ✓   |                                                   |
|  2 Framing       ✓   |   Step 4 of 6 - External interview                |
|  3 History       ✓   |                                                   |
|  4 Interview     ●   |   [step body - ONE job]                           |
|  5 Review        ○   |                                                   |
|  6 Provision     ○   |                                                   |
|                      |                                                   |
|  status: waiting     |                                                   |
|  on interview        |   [ ← Back ]                    [ Continue → ]    |
+--------------------------------------------------------------------------+
```

Rail rules:
- Completed steps: check + normal text, clickable (revisit is non-destructive; edits before approval are the point of review).
- Current: filled dot + `--primary` + `aria-current="step"`.
- Future: hollow dot + `--muted-foreground`, not clickable until prerequisites save.
- Steps 1–3 are freely reorderable visits; 5 unlocks when a return is submitted (or explicitly skipped with the markdown-only path); 6 unlocks on approve. This encodes the existing status guards (L402, L405) as *visible structure* instead of silently disabled buttons.
- One primary action per screen (bottom right). Today's competing "Save framing" / "Save related history" / "Save review" buttons become the single Continue (auto-saving on step exit; drafts already persist server-side).
- Reject/Dismiss live in an overflow menu in the header — destructive intent, off the happy path, with a confirmation dialog (today Reject is a bare input + button inline, L413-418).

**Per-step states** (every step defines all four; today none do):

| Step | Loading | Empty | Error | Success |
|---|---|---|---|---|
| 2 Framing | skeleton rows matching question count | "No framing questions in this template yet. Admins can add them in Admin → Setup templates." + link | inline per-field below input | rail check + auto-advance |
| 3 History | skeleton result cards after Search | "Nothing found for '{query}'. Try client name, domain, or an old scope path." (today an empty search renders *nothing at all*, L277 renders only when hits exist) | "Search failed - retry" inline with button | selected items chip-list persists across visits |
| 4 Interview | "Assembling pack…" button-pending state | pre-assembly explainer (below) | paste validation errors as a **list with line references**, not the current joined string blob (L356: `errors.join(" · ")`) | parsed-return summary (below) |
| 5 Review | skeleton cards | "Nothing proposed yet - go back to the interview step." | per-card parse errors | approve → advances rail |
| 6 Provision | per-item progress list (registry → repo → modules → tokens), since provisioning is deterministic and enumerable (DESIGN.md §2.12) | — | failed item marked, "Retry provisioning" (idempotent per DESIGN.md, so retry is safe to offer) | "Scope is live" card + credential checklist |

### Step 4 made foolproof (the paste-back step)

Today: two anonymous `readOnly` textareas (`pack.pasteBack`, `pack.mcp`, L351-352), a paste box with placeholder "Paste external packet markdown here" (L355), and a "Submit return" button. The operator must already know the ritual.

Concept — a three-stage strip that *is* the instruction:

```
+-----------------------------------------------------------------------+
| (1) Copy the interview pack                                           |
|     Includes: framing answers · 3 history digests · scope tree pos.   |
|     Never includes: credential values (names only).                   |
|     [ Copy pack ]   or   [ Copy MCP variant ]  <- one-click, no       |
|        `Copied ✓` state on click                  visible textareas   |
|                                                                       |
| (2) Run it in your external LLM                                       |
|     Paste into Claude/ChatGPT/etc. Answer its questions. When it      |
|     produces the final packet, copy the whole reply.                  |
|                                                                       |
| (3) Paste the reply back                                              |
|     [ big paste target - whole reply, don't trim it ]                 |
|     On paste, instant client-side pre-check:                          |
|       ✓ Found fenced JSON packet                                      |
|       ✓ provision spec present   ✓ docs: 4   ✓ tasks: 6              |
|       ⚠ No wiki updates found - that can be fine                      |
|     [ Submit and review → ]                                           |
+-----------------------------------------------------------------------+
```

- The two textareas disappear behind copy buttons with a `Copied ✓` confirmation (state change ≤150ms, `--duration-fast`).
- "What's in the pack" is listed *before* copying — this is also the security affordance the doctrine demands (OPERATING-DOCTRINE.md §Secrets: interview collects credential *names* only). Saying "never includes credential values" at the copy moment turns policy into visible trust.
- The existing markdown-only fallback (L380-384) becomes a calm amber (`--status-warn-bg`) path, not a red `--destructive` alarm: it is a *supported* mode per the code, so it shouldn't be dressed as failure. Wording: "No structured packet found. You can still proceed - every field on the review step will start empty and must be filled by hand."
- Validation errors render as a bulleted checklist (what was expected, what was found), replacing `errors.join(" · ")`.
- The pack snapshot (`packSnapshot`, L385-390) stays, relabeled "What was sent" as a collapsed disclosure on this step - it is the audit trail for the paste-back.

### Step 5: review as a confident summary, not a data dump

Replace the six JSON textareas with **artifact cards**, JSON demoted to a "source" toggle:

```
This will create:
+---------------------------+  +---------------------------+
| Scope modules             |  | Documents            4    |
| dashboard · docs · canvas |  | - Brief                   |
| + credential vault        |  | - Comms log               |
| [view source]             |  | - ...           [source]  |
+---------------------------+  +---------------------------+
+---------------------------+  +---------------------------+
| Tasks                6    |  | Wiki updates         2    |
| first 3 titles, "+3 more" |  | targets listed            |
+---------------------------+  +---------------------------+

Open questions (3)  - checklist; must be checked or dismissed
Risk notes (2)      - amber cards
[ Send back ]                       [ Approve and provision → ]
```

- Cards render parsed `proposedProvisionSpec/Docs/Tasks/WikiUpdates` (L218-223) as human titles + counts. Editing stays possible: "view source" flips a card to its textarea (keeps current capability, loses the wall-of-JSON default).
- Open questions become blocking affordances: approve is disabled until each is checked off or dismissed, with the reason captured. Today `openQuestions` is just another JSON box (L396).
- The dead-token spacing bug makes this whole panel worse than designed: the wizard's `space-y-[var(--space-5)]` (L229) resolves to nothing — see DESIGN-SYSTEM-DELTAS §1.1.

**What it improves:** the wizard becomes self-explaining (status = position on rail), the review step becomes something a non-developer can approve with confidence, the external round-trip stops depending on tribal knowledge, and every error has a place to live.
**Effort: L** (structure M + states M; actions/back-end contract unchanged — this is a re-skin of existing server actions).

---

## 2. SIDEBAR SPEC (owner priority 2)

### Problem
`(app)/_components/Sidebar.tsx` + `(app)/layout.tsx:63-83`:
- The "tree" isn't a tree: for the selected project, **every** node renders a header plus the same six module links (`moduleTabs`, L59: dashboard/overview/activity/docs/canvas/intake) — a 3-project × 4-subscope instance shows ~35 sidebar rows with massive repetition and no way to collapse anything.
- No chevrons, no +/− affordance; depth is a bare 12px text indent (L134).
- The six module links don't match the scope page's eleven tabs (`s/[...path]/page.tsx:188-255` adds Work Log, Sessions, Connect, Credentials, Members) — the nav lies about what a scope contains.
- Project switching is a native `<select>` (L78-94) with a `⌂` glyph option (L88) — an unstyled OS control plus a unicode-glyph icon (two tells at once).
- Fixed items (Brain, Ops Health, Admin, L98-122) sit *above* the tree, so admin chrome outranks the user's actual work.
- Selected state = same `--muted` fill as hover (L102, L144); active and hover are indistinguishable.
- "ops record" subtitle under the wordmark (`layout.tsx:66`) is lowercase mystery-meat.

### Concept: switcher · tree · system rail

```
+----------------------------------+
| Brissie Digital           [v]    |   <- switcher: instance-styled
|----------------------------------|      popover (replaces <select>)
|  ⌕ Search               ctrl+k  |   <- future slot; reserve row
|----------------------------------|
|  WORK                            |
|  v indya                    ●    |   <- chevron = expand/collapse
|    · Overview                    |      selected node: --surface-
|    · Docs                        |      selected + 2px left accent
|    · Setup           (badge 1)   |
|    > marketing                   |   <- collapsed child: chevron
|    > website                     |      right, no module rows
|  > airbuddy                      |
|  > llmtxt                        |
|----------------------------------|
|  SYSTEM                          |
|  Brain                           |
|  Ops Health              ⚠ 2    |
|  Admin                           |
|----------------------------------|
|  Rishi                     [◐][→]|   <- user menu, theme, sign out
+----------------------------------+
```

**Full spec:**

1. **Switcher.** Popover listing top-level projects + "{Instance} overview" (root), replacing the native select. Current project shown as trigger with name + chevron-down. Keyboard: arrows + Enter. The `⌂` glyph dies; root gets a Lucide `Home` 16px icon. (Existing cookie mechanism `nav.selectedProject`, layout.tsx:35, is fine — this is presentation only.)
2. **Tree behavior.**
   - Chevron (Lucide `ChevronRight`, rotates 90° in `--duration-base`) on every node with children; click chevron = expand/collapse, click name = navigate. Two hit zones, both ≥28px tall rows with full-row hover.
   - Expansion state persists per user (localStorage keyed by scope path; survives navigation).
   - Default state: selected project expanded one level; everything else collapsed. Auto-expand ancestors of the current route.
   - **Module links render for the *active* node only** (the node matching the current route), indented under it. Every other node is a single row. This alone removes ~80% of current sidebar rows.
   - Depth cues: 16px indent per level **plus** a 1px `--border` vertical guide line for levels ≥2 (hierarchy readable at a glance, still Swiss-quiet).
   - States: hover `--surface-hover`; selected `--surface-selected` + 2px `--primary` left bar + 500-weight text; focus ring per DELTAS §2.6. Selected ≠ hover, finally.
   - Truncation: names ellipsize with `title` tooltip (truncate exists today, L144, tooltip doesn't).
3. **Module links under the active node** — mirror the scope page's real tabs, grouped and renamed per NOMENCLATURE.md: `Overview · Activity · Docs · Canvas` then `Setup` (intake + credentials) with a badge when setup is incomplete (the resume-detection logic already exists, IntakePanel.tsx L118), then `Tasks ↗` (external, keeps `ExternalLink` icon, L185).
4. **Fixed items: bottom "System" group, in this order — Brain, Ops Health, Admin.** Rationale: work first, system chrome last (drawer-usage rule: sidebar primary nav = user's destinations; admin = secondary). Ops Health gets a count badge when components are in `warning/error` (data already computed for `/admin/health`). Admin is last: it is the blast-radius item and sits directly above the user row, spatially separated from work nav (destructive-nav-separation rule).
5. **Header.** Instance name stays; replace "ops record" (layout.tsx:66) with nothing (the wordmark suffices) or the environment tag when self-hosted staging exists. Subtitle text was decoration, not information.
6. **Collapse.** Sidebar collapses to 56px icon rail (`--sidebar-width` token, DELTAS §2.5); tooltip labels on hover; state persisted. Ships after 1–4; listed for the token contract.
7. **New scope entry.** The `+` button (L67-74) moves next to the WORK group label, keeps `aria-label`, opens the wizard's Step 1 as a proper Dialog primitive (focus trap, Esc, `--overlay` scrim — the current one has none of these and a near-invisible `--muted`/60 scrim, L232).

**What it improves:** the sidebar stops shouting every module six times, gains real hierarchy affordances, matches the page it navigates to, and puts admin where admin belongs.
**Effort: M** (tree interaction + popover) — the data (grant-filtered tree) is already delivered by the layout.

---

## 3. SCOPE PAGE HEADER + TABS

### Problem
`s/[...path]/page.tsx`: eleven `<a>` tabs in one flex row (L186-256) — will wrap or overflow at 1024px with zero overflow handling; full page reload per tab (`<a href>`, not `<Link>`); header shows `· {scope.status}` raw enum (L168) and `Role: {access}` raw enum (L180); the app-level header bar renders a literal placeholder string "Scope" (`(app)/layout.tsx:89`); the whole page is duplicated as a dead "legacy combined" branch (L424-502) that can render stale UI.

### Concept
- **Tab diet by grouping** (no feature loss): `Overview · Activity · Docs · Canvas · Setup · Access` where —
  - Overview = dashboard when present, overview cards otherwise (today's auto-default logic, L94, already does this; two tabs for it is one too many — "Dashboard" and "Overview" as siblings is a naming collision, see NOMENCLATURE),
  - Activity = segmented control within the tab for Events / Work log / Sessions (three views of "what happened here"),
  - Setup = Intake + Connect + Credentials (all "get this scope wired up" jobs; the intake tab already embeds CredentialsPanel, L400-416, so the grouping is half-real today),
  - Access = Members (visible per existing `canManageMembers` guard).
- Tabs become a `Tabs` primitive: `<Link>` navigation (no full reloads), `aria-current`, active underline animates `--duration-base`, container scrolls horizontally on overflow (never wraps).
- Header: status becomes a StatusChip (`active` → green dot+"Active"), role chip reads "You're an admin here" tooltip'd, breadcrumb path stays mono but each segment becomes a link (it's a path — let it navigate). App-header placeholder "Scope" is replaced by the real breadcrumb (move it out of the page into the shell) or the header bar is deleted — a 48px bar that says "Scope" forever is negative information.
- Delete the legacy duplicated branch (L424-502) — it's unreachable-by-design UI debt that will drift.
- Activity feed items stop rendering `JSON.stringify(payload)` (L354, L493); each event type gets a one-line human renderer with "view payload" disclosure.

**What it improves:** navigation honesty, information scent, -5 tabs, no reload flashes, no raw enums in the first line users read.
**Effort: M**.

---

## 4. ADMIN AREA COHERENCE

### Problem (from the admin sweep; file:line in UX-AUDIT.md)
Admin nav has **no active-tab state** (`admin/layout.tsx:10-16` renders all tabs identically); destructive actions (Disable user `users/page.tsx:45-50`, Revoke grant `grants/page.tsx:54`, Revoke key `settings/page.tsx:101`) fire instantly with no confirmation and no pending state; a good shared `Button` exists (`packages/ui/src/components/button.tsx`) but admin hand-rolls three different button sizes; grants/activity/automations tables have no empty states; unauthorized handling is `notFound()` in some places and a bespoke card in `admin/mcp/page.tsx:16-23`.

### Concept
1. **Admin nav = same Tabs primitive as scope page**, with `aria-current` + active underline. MCP and Health join the tabs array (they're hardcoded stragglers today, `admin/layout.tsx:41-46`).
2. **Destructive action pattern, one rule everywhere:** outline-destructive button → confirmation Dialog stating the object and consequence ("Disable Priya Nair? They lose access immediately; grants are kept.") → pending state on confirm → toast on completion. Applies to: Disable, both Revokes, credential Delete (currently native `confirm()`, CredentialsPanel.tsx:105), wizard Reject/Dismiss.
3. **One table primitive** (DELTAS §6): fixes in one move the missing hover states (all admin tables), missing empty states (grants, activity, automations, health-checks), density drift (`--space-3` vs `--space-4` cell padding between settings and health), and non-tabular money columns (`settings/page.tsx:82-83`).
4. **Overview page truth:** "Alerts" and "Automations" stat tiles both link to `/admin/automations` (`admin/page.tsx:19-20`) — merge into one tile or give alerts a real destination.
5. **One unauthorized pattern:** a shared "You need admin access on the root scope for this" card (the mcp/page.tsx wording is right; make it the standard instead of the exception).

**What it improves:** admin stops feeling like seven pages by seven authors; destructive safety becomes systemic.
**Effort: M**.

---

## 5. FEEDBACK LAYER: TOASTS, CONFIRMATIONS, INLINE ERRORS

### Problem
No toast system exists. Failures use `window.alert` (Sidebar.tsx:219, 225) or silently return; successes are mostly invisible (every wizard save, member add, template save `admin/intake/page.tsx:84`). The one native `confirm()` (CredentialsPanel.tsx:105) is the app's only confirmation.

### Concept
- `Toast` primitive (DELTAS §2.4): bottom-right, status-tinted left edge, icon + one sentence, 4s auto-dismiss, `aria-live="polite"`. Success toasts for: saves, member changes, credential set, template sync, provisioning completion.
- `ConfirmDialog` primitive for destructive intent (§4.2 pattern).
- Inline errors stay inline (field-level below inputs); toasts are for *transient outcomes only* — matching the taste-skill 4.5 rule.
- Error copy standard: cause + recovery ("Couldn't save the template - the path must start with scope-intake/. Fix the path and retry."), replacing "Failed to create user"-class strings (see STRING-AUDIT.md).

**Effort: S** (primitive) + **S** (adoption sweep).

---

## 6. EMPTY STATES AS FIRST-RUN EXPERIENCE

### Problem
Twelve-plus bare one-liner empties ("No records yet.", "No events.", "No intake packets.", "No visible projects.", "No alerts.", "No keys returned.") — each a dead end. For a brand-new instance the *entire product* is empty states: the current first-run is a wall of grey sentences.

### Concept
`EmptyState` primitive (icon 20px + what-this-is + one action), tiered:
- **Root overview, zero projects** (the true first-run): a short "set up your first scope" card sequence — 1. Create a scope → opens wizard; 2. Connect an agent → Connect tab; 3. Log your first record → doc link. This is the only place onboarding checklist UI is justified; it disappears once a project exists.
- **Module empties teach the agent-first model**, because per the doctrine most content *arrives via agents*: e.g. Records: "Nothing recorded here yet. Records usually arrive from agents via MCP - or add one from a session." Docs: "No docs yet. The wizard's interview usually seeds the first ones."
- **Filtered empties** stay plain ("No matching runs." is correct as-is, `admin/health/page.tsx:160`).

**What it improves:** first-run stops being silence; the empty state becomes the manual.
**Effort: S–M**.

---

## 7. FIRST-LOGIN / CHANGE-PASSWORD MOMENT

### Problem
`change-password/page.tsx`: cold copy ("This account was created with a temporary password.", L20), no error rendering (action failures vanish or 500), no requirements hint beyond a silent `minLength=8`, no show/hide, no pending state, no post-success welcome.

### Concept
Same card, warmer and complete:
- Title "Welcome to {INSTANCE_NAME}"; body "Set your own password to finish signing in." (This is a *first-login* moment, not a security incident.)
- Helper under new-password: "At least 8 characters." (mirrors sign-up's placeholder, `sign-up/page.tsx:89` — consistency for free); show/hide toggle; `useActionState` error inline; pending "Saving…".
- On success land on root overview with the first-run empty state (§6) doing the welcome work.
**Effort: S**.

---

## 8. DARK MODE: FROM DEFINED TO DELIVERED

### Problem
Complete dark token set exists (`tokens.css:88-108`) and UserMenu has a working toggle writing `.dark` + localStorage (`UserMenu.tsx:16-40`) — but there's no system-preference default, no pre-hydration stamp (theme flashes), and dialog/scrim/raised-surface tokens needed for dark layering don't exist (DELTAS §1.3, §4.2).

### Concept
System-preference default + persisted manual override; inline `<head>` script stamps the class pre-paint; add `--overlay` and `--surface-raised`; a one-time dark-mode audit pass of every screen (checklist: text ≥4.5:1, chips readable on status-bg tints, chart palette on dark canvas, BlockNote mapping already done in `apps/os/src/app/globals.css:48-67`).
**Effort: S–M**.

---

## 9. TYPE HIERARCHY & RHYTHM PASS (the "world-class feel" multiplier)

### Problem
Everything between 12px and 14px: section headers are 13px medium (IntakePanel.tsx:243 et al.), one step from body — so screens read as walls. Page titles are 30px (one step too loud). The `--space-5` bug (DELTAS §1.1) kills vertical rhythm on the wizard and admin pages. Zero transitions anywhere.

### Concept (mostly lands via DELTAS §3 tokens + primitives)
- Page title 24px/600; section headers 16px/600; card titles 14px/600; body 14; captions 12. Two honest levels between title and body instead of zero.
- Rhythm: 24px between sections, 16px within cards, 8px label→input — enforced by primitives, not memory.
- Motion at dial 2: tab underline slide, chevron rotate, dialog fade+scale, toast slide — each ≤260ms, each motivated (state change), nothing else moves.
**Effort: S tokens, M sweep**.

---

## Priority order (impact × effort)

| # | Concept | Effort | Why this order |
|---|---|---|---|
| 1 | DELTAS §1 token bugs + §2.1 state tokens | S | everything else builds on it |
| 2 | Feedback layer (§5) | S | safety + perceived quality, app-wide |
| 3 | Sidebar (§2) | M | first thing seen; owner priority |
| 4 | Wizard stepper (§1) | L | owner priority; highest single-flow payoff |
| 5 | Scope tabs + header (§3) | M | daily-driver surface |
| 6 | Admin coherence (§4) + tables | M | trust surface |
| 7 | Empty states + first-run (§6, §7) | S–M | new-instance experience |
| 8 | Dark mode delivery (§8) + type pass (§9) | S–M | polish multiplier |
