# CompanyOS Nomenclature — naming audit & proposals

*Every user-facing noun and verb, audited against the operating doctrine ("calm, trustworthy operating system", agent-facing system of record) and DESIGN.md's own ratified terminology. Per-string grammar/voice findings live in STRING-AUDIT.md; this doc is the vocabulary.*

## 0. Ratified (decision 13, M10-06 — 2026-07-09)

**Authority:** `docs/tasks/M10-living-wiki-overview.md` decision 13. User-facing label strings only — tab keys (`?tab=docs`), routes, query params, enum values, API/tool/schema names, and variables stay unchanged.

### Confirmed renames (landed in M10-06)

| Concept | User-facing term | Where | Internal name (unchanged) |
|---|---|---|---|
| **Docs surface** | **Wiki** | Scope tab label, docs module chrome | `docs`, `save_doc`, `?tab=docs` |
| **Worker tokens** | **Worker tokens** | Scope tab + `ConnectPanel` — mint MCP tokens for non-human principals in this project | `connect`, `connection_tokens`, `mint_connection_token` |
| **Platform connections** | **Platform connections** | Scope tab + `CredentialsPanel` — vault credentials (Meta, Shopify, Google Ads; connect-once promise) | `credentials`, `credential_vault` |
| **Connected apps** | **Connected apps** | Admin MCP Manager (`/admin/mcp`) — account-level MCP clients (Claude, Hermes…) | `mcp`, `list_connections` |
| **Attention queue** | **Things to resolve** | Scope overview card (`AttentionCard`) | `attention_items` |

### Wiki clarity vocabulary (ratified for issue 115 - 2026-07-19)

These names are for people using CompanyOS. Internal routes, enum values, event names, API parameters, MCP tool names, database fields, and the repository's developer `lint` command stay unchanged.

| Internal or former wording | User-facing term |
|---|---|
| Wiki lint | **Wiki health** |
| lint finding | **Wiki question** |
| contradiction | **Two wiki pages disagree** |
| stale page | **This page may be out of date** |
| AI-maintained | **Kept up to date by CompanyOS** |
| Backlinks | **Links from other pages** |
| Unreviewed | **Needs a quick check** |
| Mark verified | **Mark as correct** |
| Follow / Following | **Notify me / Notifications on** |
| Aliases | **Also known as** |
| Definition | **What this is** |
| Details | **More detail** |
| Sections | **Page sections** |
| Form / Markdown | **Simple / Advanced** |
| History | **Past versions** |
| wiki proposal | **Suggested wiki update** |
| Approve / Reject on a suggested update | **Apply update / Keep current page** |

**Connect split rationale:** one overloaded word (*Connect* / *connections* / *credentials*) previously covered all three surfaces. Each now has a distinct user-facing name; M11-01 implements the panel IA fix.

### Pending owner confirmation (do not apply until decided)

| Current (as shown) | Proposed | Notes |
|---|---|---|
| **Setup** (tab), setup / setup packet | **Scope setup** / **setup packet** | In-app UI largely says *Setup* already; candidate tightens wizard vocabulary |
| **capability** (event labels, health copy) | **Automations** | Tab already says *Automations*; watch n8n overlap |
| **Person or agent** / **Who** (directory UI) | **People & agents** | Consolidate fragmented principal labels in grants, activity, MCP manager |

---

## 1. Principles

1. **The UI speaks operator language; MCP/API speaks agent language.** `scope`, `principal`, `provision_scope` are correct *contract* words — they should keep living in the MCP tools, API params, and docs. The question per term is only: what does the human see?
2. **DESIGN.md already ratified some of this** (§2 Structure ratification: top level = "Project / Client", nested = "Sub-project"; "never conflate" tenant vs scope). Much of the audit is the UI failing its own ratified naming.
3. **One name per concept, one concept per name.** The current UI has both collisions (two things called "template") and synonyms (Dashboard/Overview).
4. **Statuses and roles are sentences to humans, enums to machines.** Enum values never render raw.
5. **Where wording lives matters:** *code-level* strings (labels, buttons, statuses) vs *instance data* (wizard framing questions + template markdown edited in `/admin/intake` via `saveWizardTemplateAction`). Proposals are split accordingly — §5 is the template-wording proposal, everything else is code-level.

---

## 2. Core nouns

| Current term (as shown) | Where it appears (examples) | Proposed user-facing term | Rationale | Lives in |
|---|---|---|---|---|
| **scope** (raw, ~20 sites: "New scope", "Insufficient permissions to create scope", "This scope's credentials", "scope: {path}", "No credentials set for this scope") | `Sidebar.tsx:71,237`, `_components/actions.ts:26`, `CredentialsPanel.tsx:248,252`, `DashboardGrid.tsx:201` | **Project / Sub-project** in labels; "this project"; keep the mono *path* (`indya/marketing`) as the visible address. "Scope" survives only in Admin + agent-facing surfaces (Connect snippets, MCP docs) | DESIGN.md §2 ratified exactly this and the UI ignores it. "Scope" is an authz concept; operators think in projects. The path already communicates the tree | Code |
| **Project / Client** badge; "(top level — new Project / Client)" | `s/[...path]:166`, `Sidebar.tsx:257` | **Project** (badge). The create-flow explains "clients and internal ventures are both projects" once, in helper text | "Project / Client" as a compound label reads as indecision. Doctrine: clients convert *into* scopes; the type is project either way | Code |
| **Intake** (tab), **intake packet** | `s/[...path]:246`, `IntakePanel.tsx`, `admin/intake` | **Setup** (tab + wizard surface, landed). *Candidate (pending):* **Scope setup** / **setup packet** | "Intake" is clinic/CRM vocabulary; doctrine says this is the *creation wizard*. See §0 pending table | Code |
| **Creation wizard** (panel title) | `IntakePanel.tsx:232` | **Set up {scope name}** as the wizard title (e.g. "Set up indya/seo") | The wizard should name its object, not its mechanism | Code |
| **External pack / paste back / Submit return** | `IntakePanel.tsx:345,351,374` | **Interview pack** (what you copy out) / **Interview results** (what you paste back). Button: "Submit results" | "External pack" describes the architecture; "interview" describes the activity. Doctrine already calls it "the external interview" | Code |
| **Provision / provisioned** | `IntakePanel.tsx:409`, status enum | Verb on button: **"Create everything"** or "Run setup" (with a sub-line listing what gets created); status: **"Live"**. Keep *provision* in admin/API | "Provision" is ops jargon; the moment deserves plain confidence. Admins auditing the queue still see the precise term | Code + DB enum label map |
| **Brain reuse** (wizard section), **Use template** | `IntakePanel.tsx:314,335` | **Starting points** (section), **"Start from this"** (button) | "Brain reuse" is internal-architecture naming. It also collides with the *other* template (below) | Code |
| **Wizard templates / Commit template update** (admin) | `admin/intake:62,75` | **Setup templates** / **"Save template"** (sync detail in helper text: "Saved templates sync to the skills repo.") | "Commit" leaks git; and "template" must belong to exactly one thing — the admin-edited framing/markdown. The reuse-pattern side is renamed (above) to break the collision | Code |
| **principal** ("Principal" table headers, "Scope and principal required", "principal offboarding") | `admin/grants`, `admin/activity`, `McpManagerView` | **Person or agent** / **Who** (landed). *Candidate (pending):* **People & agents** in directory UI | "Principal" stays in schema/API. See §0 pending table | Code |
| **grant / Grants** (admin tab, "Project members (grants on this scope)") | `admin/layout:12`, `s/[...path]:514` | **Access** (admin tab); "Members" for the project surface (already exists); "grant" survives in admin table detail where precision helps (`root:owner`) | Access is what's being granted; the tab should name the outcome | Code |
| **Plane** ("via Plane", "Plane not configured — tasks hidden.", "Task Manager") | `s/[...path]:314,318`, `Sidebar.tsx:185`, `TasksWidget:20` | **Tasks** everywhere; provenance as tooltip/detail ("Synced from Plane"). Keep "Task Manager ↗" link but rename **"Open task board ↗"** | Vendor names in primary chrome undercut the "tools are disposable" bet (DESIGN.md §1). If Plane is swapped, the UI shouldn't need renaming | Code |
| **capability / Capability** (table headers) vs **Automations** (tab) | `admin/automations`, `labels.ts`, `admin/health` | **Automations** (tab landed). *Candidate (pending):* **Automation** everywhere user-facing including event labels; "capability" remains the registry/API term. Watch n8n overlap | See §0 pending table | Code |
| **Brain / Brain Engine** | `brain/page:23`, `brain/engine:28` | Keep **Brain** for the knowledge map; name the maintenance page **Wiki health** | The maintenance page should name the outcome a business owner cares about | Code |
| **ingest / lint / backfill** (trigger buttons) | `brain/engine:61-66` | **Update Wiki knowledge / Check Wiki health / Review older records**, each with a description and confirmation | Bare enums are implementation details and the actions can spend money | Code |
| **Ops Health** | `Sidebar.tsx:113`, `admin/health:56` | Keep **Ops Health** | Accurate, short, already consistent in both sites | — |
| **Tenant Admin** (h1) vs **Admin** (sidebar) | `admin/layout:28` vs `Sidebar.tsx:119` | **Admin** in both; the tenant/instance distinction belongs to the control plane, not this UI | Same destination, two names = broken wayfinding; "tenant" is SaaS-internal vocabulary (DESIGN.md: never conflate — so don't surface it here) | Code |
| **Mint / minted / Mint virtual key** | `ConnectPanel`, `LiteLlmMintForm`, `admin/settings` | **Create worker token** (ConnectPanel, landed) / **Create key**; "Minted by" column → **"Created by"** | "Mint" is crypto-flavored; "create" is calm. (Keep `mint` in API names) | Code |
| **MCP / Connect to MCP** | `s/[...path]:234` tab, `ConnectPanel`, `admin/mcp` | **Three-way split (decision 13):** scope tab **Worker tokens** + panel; scope tab **Platform connections** + `CredentialsPanel`; admin **Connected apps** for account-level MCP clients. MCP named in helper/body, not tab headlines | One word "Connect" covered three distinct concepts; each now has its own label | Code |
| **Credential vault / Setup credentials** | `CredentialsPanel:134` | **Platform connections** (title, per decision 13); "vault" reassurance in helper line ("Stored encrypted; values can't be read back — only replaced.") | Scope-level vault credentials are not generic "credentials" | Code |
| **Dashboard** + **Overview** (sibling tabs) | `s/[...path]:192,198` | One tab: **Overview** (renders dashboard spec when present, starter cards otherwise — the default logic at L94 already behaves this way) | Two tabs for one intent is a naming failure expressed as IA | Code (`?tab=` redirect) |
| **Work Log / Sessions / Activity** (three history tabs) | `s/[...path]:207-217, 201` | Group under **Activity** with segmented views: **Work log · Sessions · System events** | Three adjacent tabs answering "what happened here?" | Code |
| **Records / kinds** (changelog · decision · report · note) | `WorkLogView:18-24`, overview cards | Keep **Records** and the four kinds (capitalize chips) | Doctrine-core vocabulary; already right | — |
| **Ask OS / resident agent** | `AskOSButton:16`, `AgentChatPanel:139` | Keep **Ask OS**; drop "resident agent" from tooltips ("Ask the OS about this project") | Ask OS is the best name in the product | Code |
| **Instance name subtitle "ops record"** | `(app)/layout.tsx:66` | Delete (or environment tag only) | Lowercase mystery label; the wordmark carries identity | Code |
| **worktree / heartbeat / engine** (sessions table) | `SessionsView:132-137` | Keep **Engine**; "Age" already humanizes heartbeat (good); **Worktree** stays (correct term for its audience) | Sessions is an agent-operator surface; precision wins | — |
| **slug** ("Name, slug, and reason required", "slug (optional)") | `_components/actions.ts:17`, `Sidebar.tsx:248` | **URL name** or **path segment** ("Short name used in the path — lowercase, no spaces") | "Slug" is CMS-developer vocabulary | Code |
| **root / root workspace / {Instance} overview** | `Sidebar.tsx:88`, `sign-up:45` | **{Instance name} overview** consistently ("root" stays visible only as the mono path) | Sign-up's "owner of the root workspace" and the sidebar's overview should share one term | Code |
| **Memory** column (connections) | `ConnectPanel:323`, `McpManagerView:260` | **Memory access** with on/off chip | Bare "Memory" column reads as RAM | Code |
| **Context profile / lean·standard·deep / Recommended trims** | `UsageDashboardView:217-242` | Keep concept; humanize options: **Lean / Standard / Deep** (capitalized) + one-line effect each (already present); "Recommended trims" → **"Suggested savings"** | Admin surface, jargon acceptable; casing + one friendlier label | Code |

## 3. Verbs & action labels

| Current | Where | Proposed | Rationale |
|---|---|---|---|
| "Check" (searches reuse patterns) | `IntakePanel:318` | "Search patterns" → (section renamed: "Search starting points") | "Check" says nothing; also collides with "Find" two sections up |
| "Find" (related history) | `IntakePanel:274` | "Search history" | Verb+object; consistent with above |
| "Assemble pack" | `IntakePanel:347` | "Copy interview pack" (one action = copy, with Copied ✓ state; see CONCEPTS §1) | "Assemble" describes the server's job, not the user's |
| "Submit return" | `IntakePanel:374` | "Submit results" | "Return" is ambiguous (go back?) |
| "Save framing / Save related history / Save review" | `IntakePanel:265,309,399` | One auto-saving **Continue** per step (stepper) | Three sibling save-verbs = three chances to forget one |
| "Approve" / "Provision" (two-step) | `IntakePanel:402-410` | "Approve" → "Create everything" (or "Approve & build" if kept as one) | The pair currently requires knowing the status machine |
| "Reject" vs "Dismiss" (both negative, no explanation) | `IntakePanel:415,140` | "Send back (with reason)" vs "Discard setup" + confirm dialogs that state the difference | Today indistinguishable; one keeps the packet editable, one buries it |
| "Reset temp" | `admin/users:45` | "Issue new temporary password" | "Reset temp" is a shrug |
| "Disable" (user) | `admin/users:49` | Keep "Disable" + confirmation stating effect ("loses access immediately; grants kept") | Verb fine; missing consequence |
| "Revoke" (member role / connection token / LiteLLM key — three objects) | `s/[...path]:551`, `ConnectPanel:348`, `admin/settings:101` | "Remove access" (members) / "Revoke token" / "Revoke key" | Same verb, three objects — name the object |
| "Set" (budget) | `admin/settings:96` | "Save budget" | Column context isn't enough for a bare "Set" |
| "open ↗" | `s/[...path]:326`, `TasksWidget:32` | "Open in task board ↗" (aria-label with task title) | Vague label + glyph icon |
| "Save and sync" | `admin/intake:84` | "Save template" + helper "Syncs to the skills repo on save." + success toast | Compound verbs hide which part failed |
| "Use template" | `IntakePanel:335` | "Start from this" | Breaks the template collision (§2) |
| "New" (wiki) / "New" (canvas) / "+" (scope) | `DocsView:319`, `CanvasView:271`, `Sidebar:67` | "New wiki page" / "New canvas" / "New project…" | Bare "New" fails out of visual context (a11y, menus). Docs tab → **Wiki** (decision 13) | Code |

## 4. Status & role vocabulary (label maps, never raw enums)

| Enum (keep in DB/API) | Current render | Proposed label | Notes |
|---|---|---|---|
| `draft` | "draft" | **In progress** | wizard step 1–3 |
| `awaiting_external` | "awaiting external" | **Waiting on interview** | pairs with amber `--accent` job (DELTAS §5.1) |
| `needs_review` | "needs review" | **Ready for review** | positive framing; it's an achievement, not a nag |
| `approved` | "approved" | **Approved** (helper: "ready to build") | |
| `provisioned` | "provisioned" | **Live** | |
| `rejected` | "rejected" | **Sent back** | matches "Send back" verb |
| `dismissed` | "dismissed" | **Discarded** | |
| roles `owner/admin/editor/viewer/agent` | lowercase raw | **Owner / Admin / Editor / Viewer / Agent** + one-line description in pickers ("Editor: can create and edit content; can't manage access") | `s/[...path]:537-543`, `admin/grants:21-25`, `UserCreateForm:40-43` |
| scope `status` ("· active") | raw | chip: **Active / Archived** | `s/[...path]:168` |
| sessions `running/waiting/idle/completed/error` (+"stale") | lowercase pills | Capitalized + tokens (P0-10); "stale" → **Stale** with tooltip "No heartbeat for {age}" | `SessionsView:157-160` |
| health `ok/warning/error` | raw | **Healthy / Warning / Failing** | `admin/health:127` |
| credentials "set"/"unset" | raw words | chips **Set ✓ / Needed** | `CredentialsPanel:171,271` |
| password "change required"/"normal" | raw | **Temporary / Set** | `admin/users:32` |
| "unlinked" | raw | **Not signed in yet** | `admin/users:31` |
| integrations "configured"/"missing"/"present" | raw lowercase | **Connected / Not configured** (+icon) | `admin/page:56`, `admin/settings:39,129` |

## 5. Admin-editable template wording (instance data — proposed separately)

The framing questions and template markdown are **not code**: they're rows edited at `/admin/intake` (`api.listWizardFramingQuestions`, `saveWizardTemplateAction`) and rendered verbatim in the wizard (`IntakePanel.tsx:249-258`). Proposal = a style guide + starter set the owner can adopt by editing instance data, shipped as defaults for new instances:

1. **Question style rules:** second person; one ask per question; concrete over abstract; state where the answer ends up. Format: *Question line* + optional muted example line.
   - "What is this scope for?" → **"What should this project achieve? One or two sentences — this becomes the opening of the project brief."**
   - Add helper affordance to the template schema: each question gets optional `hint` text (code change) so templates can carry examples without stuffing them into the question.
2. **Pack preamble (in template markdown):** state the contract to the external LLM explicitly *and* the safety line that the doctrine mandates: "Ask one question at a time. Collect credential **names only** — never values." The UI shows the same safety line at the copy moment (CONCEPTS §1 step 4).
3. **Do not encode UI chrome in templates.** Step names, buttons, statuses are code-level; templates should carry only questions + interview instructions, so admin edits can never break wizard navigation.
4. **Template titles** should be operator-facing ("New client project", "Internal function scope") — they surface in the packet list and admin queue (`admin/intake:66`, `IntakePanel:128`).

## 6. Where each class of wording lives (implementation map)

| Wording class | Lives in | Change mechanism |
|---|---|---|
| Tab labels, buttons, table headers, chrome | Code (components listed above) | Normal PR; `?tab=` value renames need redirects (never silent — taste skill §11.F) |
| Status/role labels | Code: one `labelFor(enum)` map per domain (proposed in DELTAS §6 Badge primitive) | PR; enums untouched |
| Error strings | Code: server actions + panels (see STRING-AUDIT §4 standard) | PR |
| Framing questions, interview instructions, pack markdown | **Instance data** (DB via `/admin/intake`) | Admin edit; §5 style guide + shipped defaults |
| MCP tool names, API params (`scope`, `principal`, `provision_scope`, `save_doc`) | Contract — **do not rename** | n/a (additive versioning only, DESIGN.md §6) |
