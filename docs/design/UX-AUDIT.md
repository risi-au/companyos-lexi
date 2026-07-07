# CompanyOS UX/UI Audit — exhaustive

*Principal-designer audit, 2026-07-08. Method: design-taste-frontend skill (Redesign Protocol §11 audit-first, AI-Tells §9 + Copy Self-Audit, Interactive UI States §4.5-4.6, consistency locks) + ui-ux-pro-max product-UI rules (navigation, tables, forms, wizards, dark mode). Every UI-rendering file in `apps/os/src` and `packages/ui/src` was read. Companion docs: CONCEPTS.md (solutions), NOMENCLATURE.md (naming), STRING-AUDIT.md (per-string findings), DESIGN-SYSTEM-DELTAS.md (token spec).*

---

## 0. Screen & component inventory (completeness proof)

Audit status: **✓ read in full** by the auditing designer or a sweep with verbatim line-quoted reporting. "Verdict" is the world-class bar, stated harshly per the brief.

### Routes

| Route / file | Purpose | Status | World-class verdict |
|---|---|---|---|
| `app/page.tsx` | redirect → `/s/root` | ✓ | n/a (no UI) — but note it duplicates `(app)/page.tsx` |
| `app/(app)/page.tsx` | redirect → `/s/root` | ✓ | n/a |
| `app/layout.tsx` | HTML shell, fonts, metadata | ✓ | ships (fonts + metadata correct) |
| `app/(app)/layout.tsx` | app shell: sidebar frame + header bar | ✓ | **fails**: header renders a permanent placeholder string "Scope" (L89); "ops record" mystery subtitle (L66) |
| `app/(app)/_components/Sidebar.tsx` | scope tree + fixed nav + NewScopeDialog | ✓ | **fails**: no expand/collapse, six module rows repeated per node, native `<select>` switcher with `⌂` glyph, `alert()` errors, selected==hover |
| `app/(app)/s/[...path]/page.tsx` | the scope page: 11 tabs + MembersTab | ✓ | **fails**: tab row overflows with no handling, full-reload `<a>` tabs, raw enums in header, `JSON.stringify` in activity feed, ~80 lines of duplicated dead layout (L424-502), unconfirmed Revoke |
| `app/(app)/brain/page.tsx` | knowledge graph + stats | ✓ | close — cleanest page; fails on: no `aria-current`, no empty state for zero-node graph |
| `app/(app)/brain/engine/page.tsx` | engine runs, lint, spend | ✓ | **fails**: raw lowercase enum buttons ("ingest"/"lint"/"backfill") that fire jobs with no confirmation or feedback |
| `app/(app)/admin/layout.tsx` | admin shell + tab nav | ✓ | **fails**: no active-tab state at all — you cannot tell where you are |
| `app/(app)/admin/page.tsx` | admin overview: stat tiles + activity + settings | ✓ | close; fails on: "Alerts" and "Automations" tiles link to the same page; no error handling on 6-way `Promise.all` |
| `app/(app)/admin/users/page.tsx` | users table + create form | ✓ | **fails**: "Disable" is instant, unconfirmed, feedback-free; no row hover; raw status enums |
| `app/(app)/admin/grants/page.tsx` | grant create + table | ✓ | **fails**: label-less form (scope input has no label OR placeholder), no table empty state, unconfirmed Revoke |
| `app/(app)/admin/activity/page.tsx` | audit log table | ✓ | **fails**: raw `JSON.stringify` payload column, no empty state, no filtering on a 100-row log |
| `app/(app)/admin/automations/page.tsx` | capability runs + alerts | ✓ | **fails**: table has no empty state; "Capability" header on an "Automations" page (naming split); ` - ` ASCII separator |
| `app/(app)/admin/settings/page.tsx` | instance, integrations, LiteLLM keys | ✓ | **fails**: "No keys returned." API-voiced empties, ASCII `->` arrow as glyph, money columns not tabular, unconfirmed Revoke |
| `app/(app)/admin/health/page.tsx` | component health + run log | ✓ | closest to shipping — real status icons+tokens, filter chips with active state; fails on: raw enum status labels, no empty state for checks table, `aria-current` missing |
| `app/(app)/admin/mcp/page.tsx` | MCP manager + usage | ✓ | close; fails on: bespoke unauthorized pattern (every other page uses `notFound()`), role badge format differs from admin layout's |
| `app/(app)/admin/intake/page.tsx` | wizard queue + template editor | ✓ | **fails**: "Commit template update" edits live wizard content with a bare path+markdown form, no preview, no validation feedback, no success confirmation |
| `app/sign-in/page.tsx` | auth | ✓ | close; fails on: `"••••••••"` placeholder, labels not `htmlFor`-associated |
| `app/sign-up/page.tsx` | auth | ✓ | close; fails on: "Ada Lovelace" placeholder, password placeholder convention differs from sign-in |
| `app/change-password/page.tsx` | forced first-login password change | ✓ | **fails**: no error rendering, no pending state, no requirements hint, cold copy for a first-run moment |
| *(no `error.tsx`, `not-found.tsx`, `loading.tsx`, `global-error.tsx` anywhere)* | — | ✓ verified via glob | **fails**: 404/500 are raw Next.js defaults; zero route-level loading UI in an app full of server awaits |

### Components / module views

| Component | Purpose | Status | Verdict |
|---|---|---|---|
| `_components/UserMenu.tsx` | account row, theme toggle, sign-out | ✓ | close; fails on: bare `rounded`, sub-44px icon targets, no focus ring |
| `NewScopeDialog` (in Sidebar.tsx L205-277) | create scope modal | ✓ | **fails**: placeholder-as-label ×3, near-invisible `--muted`/60 scrim, no focus trap/Esc/`role="dialog"`, `alert()` on error, mixed radii on its own two buttons |
| `modules/intake/IntakePanel.tsx` | the creation wizard | ✓ | **fails**: not a stepper; all five lifecycle sections always visible; six raw-JSON textareas as the review step; UUIDs as list identity; raw enum statuses |
| `modules/credentials/CredentialsPanel.tsx` | vault + required-credential checklist | ✓ | best form component in the app; fails on: native `confirm()`, "set"/"unset" raw words, ` \| ` pipe separator |
| `modules/connect/ConnectPanel.tsx` | MCP token mint + snippets | ✓ | close (aria-labels, focus rings, copy-confirm states); fails on: `confirm()`, `<MCP_PUBLIC_URL>` literal placeholder visible pre-load |
| `modules/docs/DocsView.tsx` | doc list + dialogs | ✓ | **fails**: 3× `alert()` + 2× `confirm()`, hidden-until-hover row actions invisible to keyboard, `save_doc` tool name in empty-state copy, em-dashes in copy |
| `modules/docs/DocEditor.tsx` | BlockNote editor + autosave | ✓ | close; fails on: save status not `aria-live`, `•` separator, "Markdown canonical" jargon |
| `modules/canvas/CanvasView.tsx` | Excalidraw + list | ✓ | **fails**: create/load/archive errors silently swallowed, modal can't be dismissed by Esc/backdrop, `#ffffff` hardcoded, `Loading…` vs `Creating...` in the same file |
| `modules/worklog/WorkLogView.tsx` | records table + filters | ✓ | close — proper labels, error banner, empty state; fails on: `Loading...` text instead of skeleton |
| `modules/sessions/SessionsView.tsx` | agent sessions table | ✓ | **fails**: status badges hardcode emerald/amber/red/sky Tailwind palette — off-token, broken in dark mode |
| `modules/dashboards/DashboardGrid.tsx` (+EmptyState, RangePicker) | spec renderer | ✓ | close (RangePicker has `aria-current` — one of two places in the app); fails on: "Unknown widget type:" dev copy, `save_dashboard` in body copy |
| `modules/dashboards/MetricCard.tsx` | KPI tile | ✓ | close; fails on: skeleton exists but is dead code (`loading={false}` hardcoded, DashboardGrid.tsx:134), "— no prior" em-dash |
| `modules/dashboards/TableWidget.tsx` | data table widget | ✓ | close; fails on: "Date/Dim" header jargon, error color token differs from siblings |
| `modules/dashboards/TasksWidget.tsx` | Plane tasks list | ✓ | fails on: `open ↗` glyph link with vague label |
| `modules/dashboards/RecordsWidget.tsx` | recent records | ✓ | ships (minor: raw `rounded` on rows) |
| `modules/dashboards/TextWidget.tsx` | markdown widget | ✓ | fails on: no loading/empty/error states at all (its two siblings have all three) |
| `modules/dashboards/BarWidget.tsx` / `TimeseriesWidget.tsx` | charts | ✓ | close — all four states present; fails on: `mb-2` vs `mb-[var(--space-2)]` drift, axis numbers non-mono while tooltips are mono, raw upstream error text rendered |
| `modules/agent/AgentChatPanel.tsx` | Ask OS drawer | ✓ | **fails hardest**: `✕` unicode close with no aria-label, `text-[9px]`/`text-[10px]` off-scale type, "Agent request failed (gateway?)", `tool:name → ok` debug rendering, no dialog semantics/focus trap/Esc |
| `modules/agent/AskOSButton.tsx` | drawer trigger | ✓ | ships |
| `modules/mcp-manager/McpManagerView.tsx` | fleet token admin | ✓ | close (labels, focus rings, blast-radius confirms); fails on: native `confirm()`, orphan "Edit team access" dead span (L311) |
| `modules/mcp-manager/UsageDashboardView.tsx` | usage observability | ✓ | close; fails on: zero-row tables render silently empty, machine strings in Metadata column |
| `modules/brain/BrainGraphCanvas.tsx` | force graph | ✓ | fails on: unlabeled search input, mouse-only node interaction (no keyboard path), no empty-graph state |
| `modules/admin/UserCreateForm.tsx` | create user | ✓ | best form in the app (labels above, pending state, one-time secret reveal); fails on: no required indicators, 40px vs shared 44px button |
| `modules/admin/LiteLlmMintForm.tsx` | mint LLM key | ✓ | **fails**: placeholder-only labels; budget input has no label AND no placeholder; third button height variant |
| `packages/ui/src/components/button.tsx` | the design-system button | ✓ | ships as a component — **fails as a system**: almost nothing uses it (only auth pages); admin hand-rolls 3 divergent button recipes with no focus rings |
| Server-action strings (11 `actions.ts` files) | error/status text | ✓ swept | see STRING-AUDIT.md — jargon + inconsistent auth errors + an internal milestone ("invites in M5") shown to users |

**Coverage note:** all other files under `apps/os/src` are non-UI (API routes, tests, `lib/*`, `middleware.ts` — swept for redirect UX; index barrels). Nothing that renders pixels was skipped.

---

## 1. Current-design dial reading & mode (taste skill §11.B)

- **DESIGN_VARIANCE 2** — one card recipe repeated everywhere; grids symmetric; zero compositional risk. For an ops tool this is *nearly* right; the failure is that hierarchy inside the uniformity is missing (section headers are 13px medium, one step from body).
- **MOTION_INTENSITY 0–1** — not a single `transition` in the product code; DESIGN-SYSTEM.md's motion section is entirely unimplemented. The reduced-motion kill switch protects animations that don't exist.
- **VISUAL_DENSITY 6** — correct and should be preserved. 13px chrome, compact tables.
- **Brand tokens extracted:** slate neutrals, blue-700/500 primary, amber accent (defined, never consumed), red destructive, Inter + JetBrains Mono, radius 6/10/14, 4px grid, two shadows. Sound foundation; see DELTAS.
- **Mode: Redesign — Preserve.** IA is mostly right; the debt is in states, feedback, consistency of consumption, and two structural surfaces (wizard, sidebar).
- **What never changes silently:** routes/`?tab=` params (redirect plan required for renames), the slate+blue identity, font stack, density, light-default/dark-first-class posture.

---

## 2. Findings, ranked by user impact

### P0 — trust, safety, or task completion at risk

| # | Finding | Where | Impact |
|---|---|---|---|
| P0-1 | **Destructive actions execute instantly with no confirmation and no feedback**: Disable user, Revoke grant, Revoke LiteLLM key, Revoke member. Brain engine triggers (ingest/backfill — real jobs, real spend) also fire unconfirmed. | `admin/users/page.tsx:45-50`, `admin/grants/page.tsx:54`, `admin/settings/page.tsx:98-102`, `s/[...path]/page.tsx:548-552`, `brain/engine/page.tsx:60-68` | An owner can disable a person or revoke fleet access with one misclick and receive zero acknowledgment either way |
| P0-2 | **The creation wizard is not a wizard** — five lifecycle stages rendered as one always-on scroll; review = six raw JSON textareas; status = raw enum text. Full analysis + fix: CONCEPTS.md §1. | `modules/intake/IntakePanel.tsx` (whole file; esp. L68-70, L229, L350-355, L392-397) | The product's signature flow requires tribal knowledge to operate and cannot be delegated to a non-technical operator |
| P0-3 | **Sidebar tree has no expand/collapse and repeats six module links under every node**; switcher is a native select; selected state identical to hover. Fix: CONCEPTS.md §2. | `Sidebar.tsx:59, 131-191, 78-94, 102/144` | Primary navigation degrades linearly with instance size; wayfinding fails at ~3 subprojects |
| P0-4 | **No error.tsx / not-found.tsx / loading.tsx anywhere** — 404/500 show unstyled Next defaults; every server-rendered page blocks with no loading UI. | `apps/os/src/app/**` (verified absent) | The worst moments (errors, slow loads) are the least designed moments |
| P0-5 | **Feedback layer is `window.alert` / native `confirm` / silence.** No toast system. Success is invisible app-wide (every wizard save, member add, template sync). Canvas errors are *swallowed* (comment: "silent create error"). | `Sidebar.tsx:219,225`; `DocsView.tsx:187,213,227,241,275,283`; `CanvasView.tsx:123,231-233,245,252`; `ConnectPanel.tsx:179`; `McpManagerView.tsx:109,129`; `CredentialsPanel.tsx:105` | The app never tells you it worked and sometimes doesn't tell you it failed |
| P0-6 | **Scope page: 11 tabs in one unwrapped flex row; tabs are `<a href>` full reloads; ~80-line duplicated "legacy" layout branch.** | `s/[...path]/page.tsx:186-256, 424-502` | Overflow breakage ≤1280px; every navigation flashes; dead branch will drift |
| P0-7 | **`--space-5` referenced but undefined** → vertical rhythm silently collapses on the wizard + 3 admin pages. | `tokens.css:28-35` vs `IntakePanel.tsx:229`, `admin/layout.tsx:25`, `admin/page.tsx:24`, `admin/settings/page.tsx:20` | Screens render visibly worse than designed; nobody noticed because no token linting |
| P0-8 | **Admin nav has no active state** (no visual, no `aria-current`). | `admin/layout.tsx:10-16, 34-46` | You cannot tell which of 8 admin pages you're on |
| P0-9 | **No dialog in the app is a real dialog**: no `role="dialog"`, no focus trap, no consistent Esc/backdrop; NewScopeDialog's scrim is `--muted`/60 (invisible in light mode); CanvasView's modal can *only* be closed via its buttons; AgentChatPanel drawer has no Esc and no aria-label on `✕`. | `Sidebar.tsx:232-234`, `DocsView.tsx:443,481`, `CanvasView.tsx:341`, `AgentChatPanel.tsx:151` | Keyboard users get trapped; modality is not communicated |
| P0-10 | **SessionsView status badges hardcode Tailwind palette colors** (emerald/amber/red/sky-50/300/700) — off-token, unreadable in dark mode. | `SessionsView.tsx:42-46,159` | Direct violation of the system's own no-raw-hex rule; dark mode ships broken here |

### P1 — quality bar: jargon, states, consistency

| # | Finding | Where |
|---|---|---|
| P1-1 | Raw enums as user-facing text throughout: intake statuses via `replace(/_/g," ")` ("awaiting external"); roles (owner/admin/editor/viewer/agent lowercase); scope `· active`; `Role: admin`; session statuses; health `ok/warning/error`; engine modes as button labels; credential "set"/"unset"; password "change required"/"normal"; "unlinked" | `IntakePanel.tsx:68-70`; `s/[...path]:168,180,537-543`; `admin/users:31-32`; `admin/health:127`; `brain/engine:66`; `CredentialsPanel:171,271` |
| P1-2 | Developer voice leaking into UI: "invites in M5", "Agent request failed (gateway?)", "No keys returned.", `save_doc`/`save_dashboard` tool names in empty states, "Unknown widget type:", "auth principal exists", `tool:name → ok`, "Markdown canonical" | STRING-AUDIT.md §2 has the full table with rewrites |
| P1-3 | Missing empty states: grants table, admin activity, automations table, health checks table, usage summary + events tables, brain graph zero-state, empty history search in wizard | `admin/grants`, `admin/activity`, `admin/automations:16-39`, `admin/health` checks, `UsageDashboardView` both tables, `BrainGraphCanvas`, `IntakePanel:277` |
| P1-4 | The shared Button (44px, focus ring, solid destructive) is used only by auth pages; admin/wizard hand-roll ≥3 button recipes at 3 heights with no focus rings, and two destructive visual languages coexist (solid vs outline) | `packages/ui/src/components/button.tsx` vs `admin/*`, `IntakePanel.tsx`, `UserCreateForm.tsx:58`, `LiteLlmMintForm.tsx:30` |
| P1-5 | Placeholder-as-label forms: NewScopeDialog (Name/slug/reason), LiteLlmMintForm (alias/models; budget has *neither* label nor placeholder), grants form (scope input: no label, no placeholder), new-doc title, new-canvas name, chat input, graph search | `Sidebar.tsx:239-267`, `LiteLlmMintForm.tsx:16-18`, `admin/grants:19`, `DocsView:451`, `CanvasView:353`, `AgentChatPanel:201`, `BrainGraphCanvas:205` |
| P1-6 | Icon-only buttons without `aria-label`: DocsView History/Archive (title only), AgentChatPanel `✕` and model select; hidden-until-hover row actions (`opacity-60 group-hover:opacity-100`) unreachable by keyboard-visibility | `DocsView.tsx:383,390,400`, `AgentChatPanel.tsx:144,151` |
| P1-7 | Focus rings exist only in CredentialsPanel/ConnectPanel/McpManager/Usage + shared Button; sidebar links, all tabs, wizard buttons, auth-adjacent controls have none | app-wide; DELTAS §2.6 |
| P1-8 | Navigation honesty: sidebar's 6 module links ≠ scope page's 11 tabs; "Dashboard" and "Overview" are sibling tabs for near-identical intent; admin "Automations" page ≠ its own "Capability" table header; sidebar "Admin" ≠ page "Tenant Admin"; two stat tiles → same destination | `Sidebar.tsx:59` vs `s/[...path]:186-256`; `admin/automations:20`; `admin/layout:28`; `admin/page:19-20` |
| P1-9 | Tables: no row hover anywhere in admin; cell-padding density drift (`--space-3` vs `--space-4`); money not tabular in settings; numeric columns left-aligned (brain engine); raw JSON `<pre>` as a table cell (activity payload) | agent sweeps; `admin/settings:82-87`, `admin/activity:24`, `brain/engine:96-102` |
| P1-10 | First-login change-password: no error rendering, no pending, no hint, no show/hide; sign-in vs sign-up password placeholder conventions differ (`••••••••` vs "At least 8 characters") | `change-password/page.tsx`, `sign-in:73`, `sign-up:89` |
| P1-11 | Wizard packet list identifies packets by **status as title + raw UUID as subtitle**; header also prints the UUID | `IntakePanel.tsx:160-161, 233` |
| P1-12 | MetricCard's skeleton is dead code (`loading={false}` hardcoded); TextWidget has no states at all | `DashboardGrid.tsx:134`, `TextWidget.tsx` |
| P1-13 | Duplicate/colliding action intent: "Find" vs "Check" (both = search, same screen); "Reject" vs "Dismiss" (undifferentiated negative actions); "Revoke" names three different objects on three screens; "template" means both reuse-pattern and framing-template inside the same wizard; seven flavors of "Save" | `IntakePanel.tsx:274,318,335,140,415`; `admin/intake:62` vs `IntakePanel:335`; NOMENCLATURE.md §3 |
| P1-14 | Unauthorized handling is `notFound()` on five pages but a bespoke card on `/admin/mcp`; role badge format differs (`root:owner` mono vs `Role: owner` plain) | `admin/mcp/page.tsx:16-23,42` vs `admin/layout.tsx:20-22,33` |

### P2 — polish and coherence

| # | Finding | Where |
|---|---|---|
| P2-1 | Ellipsis chaos: `Loading…` vs `Loading...` vs `Working...` — both conventions, sometimes in one file | `CanvasView:276` vs `:367`; `WorkLogView:120`; `McpManagerView:226` |
| P2-2 | Timestamp formats: ISO-slice (`2026-07-08 14:30`), `toLocaleString()`, `toLocaleDateString()`, short-month — four conventions | `s/[...path]:349`, `admin/intake:49`, `CredentialsPanel:35`, `RecordsWidget:26` |
| P2-3 | Empty-value placeholder: `—` em-dash (members email, TableWidget cells, MetricCard) vs `-` hyphen (everywhere else) | `s/[...path]:532` vs `CredentialsPanel:270` etc. |
| P2-4 | Unicode glyphs as icons: `⌂` (switcher), `✕` (chat close), `↗` (task links ×3), `→` (chat footer/tool rows), ASCII `->` (settings aliases) | `Sidebar:88`, `AgentChatPanel:151,213,120`, `TasksWidget:32`, `s/[...path]:326,469`, `admin/settings:118` |
| P2-5 | Separator zoo: `·` middle dots, `•` bullets, ` \| ` pipes, ` - ` hyphens, `/` slashes as metadata separators | `DocsView:503`, `DocEditor:125,131`, `AgentChatPanel:213`, `CredentialsPanel:167`, `admin/automations:47`, `admin/health:113` |
| P2-6 | Em-dashes in UI copy (taste-skill hard ban): "Plane not configured — tasks hidden.", "Inherited wiki — from…", "Create the first doc — agents…", "— no prior" | `s/[...path]:318,459`, `DocsView:327,348`, `MetricCard:38` |
| P2-7 | One uppercase-tracked eyebrow in the whole app (sidebar "Project") — inconsistent with itself | `Sidebar.tsx:65` |
| P2-8 | Off-scale type: `text-[10px]`, `text-[9px]` below the 12px floor the design system mandates | `AgentChatPanel:143,179,213`, `DocsView:384,518`, `CanvasView:288,306` |
| P2-9 | Scrim inconsistency: `--muted`/60, `bg-black/40`, `bg-black/30` across four modals | `Sidebar:232`, `DocsView:443,481`, `CanvasView:341` |
| P2-10 | Radius drift: bare `rounded` (4px, off-system) ≈30 sites vs `--radius-sm` | DELTAS §4.1 |
| P2-11 | Sub-44px icon targets: UserMenu theme/sign-out, doc row actions, 8×8 credential buttons (h-8) | `UserMenu:51,60`, `DocsView:383`, `CredentialsPanel:282` |
| P2-12 | Error-color token split: `--destructive` vs `--status-error` used interchangeably for the same semantic | `TableWidget:22` vs siblings |
| P2-13 | `"Ada Lovelace"` and `"••••••••"` placeholders (AI-tells) | `sign-up:58`, `sign-in:73` |
| P2-14 | Orphan dead copy: "Edit team access" span with no action | `McpManagerView.tsx:311` |
| P2-15 | Health page 7-day window is a magic constant with no UI control | `admin/mcp/page.tsx:28-29` |

### P3 — strategic polish
Dark-mode delivery gaps (defined but not defaulted/stamped — CONCEPTS §8); zero motion (CONCEPTS §9); virtualization absent on 100-row capped tables (fine today, flag at >50 per design system); PWA/responsive posture untested below 768px (sidebar has no mobile behavior at all — `w-64` fixed, no drawer).

---

## 3. AI-tells sweep (taste skill §9 + Copy Self-Audit)

Found and indexed (details + rewrites in STRING-AUDIT.md):
- **Templated patterns:** feature-list comma subtitles on five admin headers ("Credential expiry, job liveness, webhook delivery, and alert surfacing"); identical card+13px-title recipe as the only composition; stat-tile + recent-activity dashboard boilerplate.
- **Glyph icons:** `⌂ ✕ ↗ → ->` (P2-4) — the system mandates Lucide-only.
- **Separator tells:** `· • | / -` zoo (P2-5); em-dashes in copy (P2-6).
- **Broken/awkward strings:** "ops record"; "Setup incomplete" as a card title with raw status subtitle; "No use specified."; "Values are write-only in the OS UI."; "Markdown canonical • autosaves on idle"; "Reverting creates a new revision."; "(no content)"; "Effective: standard fallback - 3120 estimated tokens".
- **Fake-data tells:** "Ada Lovelace" placeholder; `••••••••`.
- **Consistency-lock violations:** radius (P2-10), error-color (P2-12), scrims (P2-9), button heights (P1-4), timestamp formats (P2-2), one dead accent token (DELTAS §5.1).
- **Copy voice:** developer-first everywhere (§2 P1-2). The product's stated identity is "calm, trustworthy" — the strings say "internal tool by and for the person who wrote the schema".

---

## 4. State-coverage matrix (Interactive UI States §4.5)

✓ present · ✗ missing · ~ partial/text-only

| Surface | Loading | Empty | Error | Success feedback |
|---|---|---|---|---|
| Wizard (IntakePanel) | ✗ | ~ ("No intake packets.") | ~ (joined string blob) | ✗ |
| CredentialsPanel | ~ text | ✓ | ✓ inline | ✗ |
| ConnectPanel | ~ text | ✓ | ✓ banner | ✓ copy-check only |
| DocsView | ~ text | ✓ | ✗ (alerts) | ~ (save badge in editor) |
| CanvasView | ~ text | ✓ | ✗ (swallowed) | ~ badge |
| WorkLog / Sessions | ~ text | ✓ | ✓ banner | n/a |
| Dashboard widgets | ✓ (Bar/TS) ✗ (Text) dead (Metric) | ✓ | ✓ (raw text) | n/a |
| Admin pages (7) | ✗ all | ~ inconsistent (see P1-3) | ✗ all | ✗ all |
| Brain graph/engine | ✗ | ~ | ✗ | ✗ (triggers fire silently) |
| Auth + change-password | ✓ / ✗ | n/a | ✓ / ✗ | n/a |
| Route level | ✗ (no loading.tsx) | — | ✗ (no error.tsx) | — |

---

## 5. Interactive-element audit summary

- **Labels that lie or underspecify:** "Check" (searches patterns), "Submit return" (submits pasted packet), "Reset temp" (issues new temporary password), "Set" (saves a budget), "open ↗" (opens external Plane task), "Mint" (creates a token), "Commit template update" (saves + syncs to git?). Each needs verb+object truth — proposals in NOMENCLATURE.md.
- **Duplicate intent:** P1-13 list. One label per intent per screen.
- **Disabled-state opacity conventions differ** (`disabled:opacity-50` vs `60`) and disabled buttons never explain *why* (wizard Approve/Provision are silently disabled by status — the stepper concept fixes this structurally).
- **Keyboard reachability:** graph nodes (mouse-only), doc row actions (hover-revealed), drawer/dialogs (no traps/Esc), tab order otherwise natural since markup is semantic.
- **`aria-current` exists in exactly two places** (RangePicker, health FilterLink partially) out of ~10 nav/selected-state surfaces.

---

## 6. What is already good (preserve deliberately)

- Token discipline in the newest modules (ConnectPanel, McpManagerView, UsageDashboardView, WorkLogView, brain pages) — this is the standard to backfill.
- Semantic `<table>` everywhere; mono + `tabular-nums` for machine text is the app's most consistent instinct.
- UserCreateForm's one-time-secret reveal; ConnectPanel's copy-with-confirmation; McpManagerView's blast-radius confirmations ("Revoke 12 active tokens across 3 scopes?") — the best interaction writing in the product.
- No decorative gradients, no purple, no glassmorphism, no hero nonsense: the restraint the doctrine asks for is genuinely present. The work is finishing, not rethinking.
