# M10-06 Nomenclature Audit Report

Read-only sweep at HEAD of `audit/M10-06-terms`. Scope: user-facing strings in `apps/os/src`, `packages/ui`, `packages/wizard`. Excluded: `USER DATA/`, `legacy/`, tests, `AGENTS.md`, variable/function/route/enum/API names, MCP tool names.

**Authority:** `docs/tasks/M10-living-wiki-overview.md` decision 13 (2026-07-09). Label maps: `apps/os/src/lib/labels.ts`.

---

## NOMENCLATURE.md current state

`docs/design/NOMENCLATURE.md` exists and is the prior vocabulary proposal (pre–decision 13). Notable gaps vs ratified renames:

| Topic | NOMENCLATURE.md says | Decision 13 says |
|---|---|---|
| Docs surface | Still proposes "New doc" / "Documents" (§3) | **Docs → Wiki** (tab + surface) |
| Connect | Keep tab "Connect"; panel "Connect an agent" (§2 L36) | **Three-way split:** Connected apps / Platform connections / Worker tokens |
| Intake | **Intake → Setup** (§2 L21) — largely landed in code | Candidates: Scope setup / setup packet |
| Attention queue | Not mentioned | **Things to resolve** |
| Capabilities | Automation everywhere (§2 L30) — mostly landed | Candidate: confirm Automations vs n8n overlap |
| Principals | Person or agent / Who (§2 L27) — mostly landed | Candidate: **People & agents** in directory UI |

Decision 13 overrides NOMENCLATURE.md where they conflict; NOMENCLATURE.md should be updated when renames land.

---

## 1. Confirmed renames

### 1.1 Docs → Wiki

| File:line | Current string | Proposed string |
|---|---|---|
| `apps/os/src/app/(app)/_components/Sidebar.tsx:61` | `Docs` (scope tab label) | `Wiki` |
| `apps/os/src/app/(app)/s/[...path]/page.tsx:271` | `Docs` (scope tab label) | `Wiki` |
| `apps/os/src/modules/docs/DocsView.tsx:188` | `Your docs` (list group title) | `Your wiki` (or owner-appropriate variant) |
| `apps/os/src/modules/docs/DocsView.tsx:403` | `Documents` (aside heading) | `Wiki` |
| `apps/os/src/modules/docs/DocsView.tsx:408` | `New doc` (aria-label) | `New wiki page` |
| `apps/os/src/modules/docs/DocsView.tsx:410` | `New doc` (button) | `New wiki page` |
| `apps/os/src/modules/docs/DocsView.tsx:439` | `No docs yet. Create the first one; agents can add docs here too.` | Wiki-oriented empty state |
| `apps/os/src/modules/docs/DocsView.tsx:458` | `Select a document from the list.` / `Create the first doc to start editing.` | Wiki-oriented placeholders |
| `apps/os/src/modules/docs/DocsView.tsx:462` | `Loading document...` | `Loading wiki page...` |
| `apps/os/src/modules/docs/DocsView.tsx:483` | `New document` (dialog title) | `New wiki page` |
| `apps/os/src/modules/docs/DocsView.tsx:486` | `Doc title` (placeholder) | `Page title` (or `Wiki page title`) |
| `apps/os/src/modules/docs/DocsView.tsx:214` | `Couldn't create the doc. Check the title and retry.` (toast) | Wiki-oriented error |
| `apps/os/src/modules/docs/DocsView.tsx:245` | `Couldn't rename the doc. Check the title and retry.` (toast) | Wiki-oriented error |
| `apps/os/src/modules/docs/DocsView.tsx:253` | `Archive document` (confirm title + label) | `Archive wiki page` |
| `apps/os/src/modules/docs/DocsView.tsx:263` | `Couldn't archive the doc. Refresh and try again.` (toast) | Wiki-oriented error |

**Already aligned (no change under this rename):** `DocsView.tsx:418` `Inherited wiki from …`; `docs/actions.ts:71` `You don't have access to this project's wiki.`; `IntakePanel.tsx:1026` `Wiki updates`; `AttentionCard.tsx:19` `wiki proposal`.

**Count:** 15 strings to update; 4 already wiki-aligned in scope.

---

### 1.2 Connect → three-way split

Decision 13 assigns three distinct user-facing names. Today one overloaded word (*Connect* / *connections* / *credentials*) spans all three surfaces.

#### A. Worker tokens (scope-level token minting — today: Connect tab + `ConnectPanel`)

| File:line | Current string | Proposed string |
|---|---|---|
| `apps/os/src/app/(app)/_components/Sidebar.tsx:63` | `Connect` (tab label) | `Worker tokens` |
| `apps/os/src/app/(app)/s/[...path]/page.tsx:273` | `Connect` (tab label) | `Worker tokens` |
| `apps/os/src/modules/connect/ConnectPanel.tsx:199` | `Connect an agent` (panel title) | Worker-tokens framing (e.g. `Worker tokens` + helper re MCP) |
| `apps/os/src/modules/connect/ConnectPanel.tsx:205` | `Refresh connections` (aria-label) | `Refresh worker tokens` |
| `apps/os/src/modules/connect/ConnectPanel.tsx:206` | `Refresh connections` (title) | `Refresh worker tokens` |
| `apps/os/src/modules/connect/ConnectPanel.tsx:124` | `Couldn't load connections. Refresh and try again.` | Worker-tokens error |
| `apps/os/src/modules/connect/ConnectPanel.tsx:175` | `Couldn't create the connection token. Check the fields and retry.` | Worker-tokens error |
| `apps/os/src/modules/connect/ConnectPanel.tsx:182` | `This agent connection stops working immediately.` (revoke confirm body) | Worker-token revoke copy |
| `apps/os/src/modules/connect/ConnectPanel.tsx:266` | `Create token` (button) | `Create worker token` (or keep `Create token` with panel context) |
| `apps/os/src/modules/connect/ConnectPanel.tsx:275` | `Viewers can see connections but can't create tokens.` | Worker-tokens read-only notice |
| `apps/os/src/modules/connect/ConnectPanel.tsx:312` | `This scope's connections` (table heading) | `Worker tokens in this project` |
| `apps/os/src/modules/connect/ConnectPanel.tsx:314` | `Loading connections…` | `Loading worker tokens…` |
| `apps/os/src/modules/connect/ConnectPanel.tsx:316` | `No connections created for this project.` | Worker-tokens empty state |

**Count:** 13 strings.

#### B. Platform connections (scope-level vault credentials — today: Credentials tab + `CredentialsPanel`)

| File:line | Current string | Proposed string |
|---|---|---|
| `apps/os/src/app/(app)/_components/Sidebar.tsx:64` | `Credentials` (tab label) | `Platform connections` |
| `apps/os/src/app/(app)/s/[...path]/page.tsx:274` | `Credentials` (tab label) | `Platform connections` |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:72` | `Couldn't load credentials. Refresh and try again.` | Platform-connections error |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:137` | `Setup credentials` / `Credentials` (panel title) | `Platform connections` |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:143` | `Refresh credentials` (aria-label) | `Refresh platform connections` |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:144` | `Refresh credentials` (title) | `Refresh platform connections` |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:194` | `Admin access is required to add, update, or delete credentials.` | Platform-connections permission copy |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:251` | `Credentials in this project` (table heading) | `Platform connections in this project` |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:253` | `Loading credentials…` | `Loading platform connections…` |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:255` | `No credentials set for this project.` | Platform-connections empty state |

**Count:** 10 strings.

#### C. Connected apps (account-level MCP clients — today: Admin MCP Manager + `McpManagerView`)

| File:line | Current string | Proposed string |
|---|---|---|
| `apps/os/src/app/(app)/admin/mcp/page.tsx:21` | `MCP connection management requires admin access for this instance.` | Connected-apps permission copy |
| `apps/os/src/app/(app)/admin/mcp/page.tsx:38` | `MCP Manager` (h1) | `Connected apps` (or `Connected apps · MCP`) |
| `apps/os/src/app/(app)/admin/mcp/page.tsx:40` | `Agent connections across all projects: review, revoke, offboard.` | Connected-apps subtitle |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:103` | `Couldn't load MCP connections. Refresh and try again.` | Connected-apps error |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:134` | `…active connection tokens across…` (offboard confirm body) | Connected-apps / worker-token wording |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:233` | `…connections visible` | Connected-apps count copy |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:262` | `Connection` (table header) | `App` or `Connected app` |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:277` | `No connections match these filters.` | Connected-apps empty/filter state |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:349` | `No connection access for this person or agent.` | Connected-apps empty state |
| `apps/os/src/modules/mcp-manager/UsageDashboardView.tsx:67` | `connection: "Connection"` (group-by label map) | `Connected app` |
| `apps/os/src/modules/mcp-manager/UsageDashboardView.tsx:200` | `["Connection", connectionId, setConnectionId]` (filter chip) | `Connected app` |
| `apps/os/src/modules/connect/ConnectPanel.tsx:305` | `Claude Desktop connector` (snippet block title) | Connected-apps setup copy |

**Count:** 12 strings.

**Connect split total:** 35 strings across three surfaces.

---

### 1.3 Attention queue → Things to resolve

| File:line | Current string | Proposed string |
|---|---|---|
| `apps/os/src/modules/attention/AttentionCard.tsx:38` | `Things to resolve` | *(already correct)* |

No user-facing `Attention queue`, `attention queue`, or `Attention items` surface labels found in scoped paths. The rename appears **complete** in `apps/os/src`.

**Count:** 0 remaining changes; 1 already correct.

---

## 2. Candidate renames (audit only — not decided)

### 2.1 intake / intake packet → Scope setup / setup packet — **CANDIDATE**

Code has largely moved to *Setup* (NOMENCLATURE §2 L21). Candidate tightens to *Scope setup* / *setup packet*.

| File:line | Current string | Notes |
|---|---|---|
| `apps/os/src/app/(app)/_components/Sidebar.tsx:65` | `Setup` (tab label) | CANDIDATE: `Scope setup` |
| `apps/os/src/app/(app)/s/[...path]/page.tsx:275` | `Setup` (tab label) | CANDIDATE: `Scope setup` |
| `apps/os/src/modules/intake/IntakePanel.tsx:102` | `Provision` (wizard step label) | CANDIDATE: align with setup vocabulary |
| `apps/os/src/modules/intake/IntakePanel.tsx:223` | `Discard setup?` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:224` | `This discards the setup and removes it from the active queue.` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:225` | `Discard setup` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:231` | `Setup discarded.` (toast) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:233` | `Couldn't discard the setup…` (toast) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:258` | `Discard setup` (button) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:268` | `Setup` (sidebar heading) | CANDIDATE: `Scope setup` |
| `apps/os/src/modules/intake/IntakePanel.tsx:271` | `No setups yet for this project` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:271` | `New projects create setup details here.` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:286` | `Setup details` / `Open a setup to continue the wizard.` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:451–464` | `Send setup back?` / `Discard setup?` confirm copy | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:477` | `Setup sent back.` / `Setup discarded.` (toasts) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:519` | `Setup reopened.` (toast) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:537` | `Discard setup` (menu) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:695` | `…filling the setup details.` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:973` | `…generated setup artifacts…` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:992` | `This setup can move straight to approval.` | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:1032` | `Reason for the setup menu action` (placeholder) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:1042` | `Setup approved.` (toast) | CANDIDATE |
| `apps/os/src/modules/intake/IntakePanel.tsx:1053` | `Run the setup sequence…` | CANDIDATE |
| `apps/os/src/modules/credentials/CredentialsPanel.tsx:160` | `Requested during setup` | CANDIDATE |
| `apps/os/src/app/(app)/admin/intake/page.tsx:27` | `Setup queue` (h1) | CANDIDATE: scope-setup queue framing |
| `apps/os/src/app/(app)/admin/intake/page.tsx:28` | `Setups waiting on review…` | CANDIDATE |
| `apps/os/src/app/(app)/admin/intake/page.tsx:36` | `Submitted setups appear here when they need review.` | CANDIDATE |
| `apps/os/src/app/(app)/admin/intake/page.tsx:49` | `Setup templates` | CANDIDATE |
| `apps/os/src/app/(app)/admin/intake/page.tsx:58` | `No setup templates` | CANDIDATE |
| `apps/os/src/app/(app)/admin/intake/page.tsx:66` | `scope-intake/templates/new-project.md` (placeholder) | CANDIDATE: path is instance data hint |
| `packages/wizard/src/index.ts:318` | `# CompanyOS Scope Intake` (interview pack heading) | CANDIDATE: user-copied external pack |
| `packages/wizard/src/index.ts:320` | `Intake id: ${input.intakeId}` | CANDIDATE: `setup packet` id wording |
| `packages/wizard/src/index.ts:324` | `Fill this intake for the existing scope only` | CANDIDATE |

**Count:** 33 CANDIDATE strings (29 in `apps/os/src`, 4 in `packages/wizard` user-copied pack text).

---

### 2.2 capabilities → Automations — **CANDIDATE**

Admin tab and table headers already say *Automations* / *Automation*. Remaining *capability* user-facing strings:

| File:line | Current string | Notes |
|---|---|---|
| `apps/os/src/lib/labels.ts:98` | `Capability run reported` (event type label) | CANDIDATE: `Automation run reported` |
| `apps/os/src/app/(app)/admin/health/page.tsx:148` | `…after capabilities report activity.` (empty state body) | CANDIDATE: `automations report activity` |
| `apps/os/src/app/(app)/admin/page.tsx:80` | Renders `labelForEventType(event.type)` → includes `Capability run reported` | CANDIDATE (via labels map) |

**Count:** 3 CANDIDATE strings (2 direct + 1 via label map).

---

### 2.3 principals → People & agents — **CANDIDATE**

No raw `Principal` table headers remain in scoped UI; directory surfaces use fragmented labels (`Person or agent`, `Who`, `All people and agents`, `Users`).

| File:line | Current string | Notes |
|---|---|---|
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:167` | `Person or agent` (filter label) | CANDIDATE: `People & agents` |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:173` | `All people and agents` (select option) | CANDIDATE: consolidate with `People & agents` |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:264` | `Person or agent` (table header) | CANDIDATE |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:313` | `Per-person access` (section title) | CANDIDATE: directory framing |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:322` | `Person or agent` (select label) | CANDIDATE |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:328` | `Select person or agent` (option) | CANDIDATE |
| `apps/os/src/modules/mcp-manager/McpManagerView.tsx:349` | `No connection access for this person or agent.` | CANDIDATE |
| `apps/os/src/modules/mcp-manager/UsageDashboardView.tsx:65` | `principal: "Person or agent"` | CANDIDATE |
| `apps/os/src/modules/mcp-manager/UsageDashboardView.tsx:198` | `["Person or agent", principalId, setPrincipalId]` | CANDIDATE |
| `apps/os/src/app/(app)/admin/grants/page.tsx:19` | `Person or agent` (aria-label) | CANDIDATE |
| `apps/os/src/app/(app)/admin/grants/page.tsx:20` | `Person or agent` (select option) | CANDIDATE |
| `apps/os/src/app/(app)/admin/grants/page.tsx:37` | `Give a person or agent access…` (empty state) | CANDIDATE |
| `apps/os/src/app/(app)/admin/grants/page.tsx:41` | `Who` (table header) | CANDIDATE: `People & agents`? |
| `apps/os/src/app/(app)/admin/activity/page.tsx:18` | `Who` (table header) | CANDIDATE |
| `apps/os/src/app/(app)/admin/layout.tsx:22` | `Instance-wide settings, people, and access.` | CANDIDATE: directory chrome alignment |

**Count:** 15 CANDIDATE strings. `admin/users` uses `User` / `Users` (separate from principals candidate).

---

## 3. Ambiguous / overlapping cases (owner or architect call)

| # | Issue | Examples | Why ambiguous |
|---|---|---|---|
| 1 | **Plane “Connect” ≠ MCP Connect** | `page.tsx:342,481` — `Connect it in Admin Settings` (task sync) | Verb *connect* refers to Plane integration, not any of the three Connect concepts. Needs distinct wording regardless of MCP rename. |
| 2 | **Integration “Connected” ≠ Connected apps** | `labels.ts:75` — `Connected` / `Not configured` (admin integrations) | Same word as Connected apps; different object (Meta/Shopify integration flags). |
| 3 | **Docs tab rename vs review-step “Documents”** | `IntakePanel.tsx:1024` — `Documents` (provision artifact field); `IntakePanel.tsx:750` — aria `Search past records and docs` | Review JSON field names proposed *docs*; may stay technical or follow Wiki rename depending on artifact semantics. |
| 4 | **MCP Manager page title vs Connected apps** | `admin/mcp/page.tsx:38` `MCP Manager` vs decision’s *Connected apps* | Admin tab is still labeled `MCP` (`AdminTabs.tsx:13`). Three-way split may need Admin IA change, not just subtitle strings. |
| 5 | **Worker token mint UI vs client setup snippets** | `ConnectPanel.tsx:302–306` — `Claude CLI`, `Claude Desktop connector`, etc. | Snippets describe how humans connect MCP *clients* (Connected apps) but live on the Worker tokens panel. M11-01 panel fix may relocate these. |
| 6 | **Usage dashboard “Connection” filter** | `UsageDashboardView.tsx:67,200` | Filter groups MCP token usage — overlaps Worker tokens and Connected apps depending on grouping semantics. |
| 7 | **Wiki tab vs non-wiki pages in same surface** | `DocsView.tsx` lists all scope markdown pages; `slug === "wiki"` already special-cased | Renaming tab to *Wiki* while still hosting arbitrary pages (not only the wiki slug) needs product call on whether non-wiki pages keep “page” wording. |
| 8 | **Admin setup queue orphan route** | `admin/intake/page.tsx` exists; not linked from `AdminTabs.tsx` | `/admin/intake` is reachable by URL only. Naming pass should decide if it becomes an Admin tab and under what label. |
| 9 | **NOMENCLATURE.md drift** | See table above | Implementation brief should update NOMENCLATURE.md so decision 13 and code stay aligned. |
| 10 | **packages/wizard interview pack** | `packages/wizard/src/index.ts:318–324` | User-copied text still says *Scope Intake* / *Intake id* while in-app UI says *Setup*. External/agent-facing copy may need a separate rule from in-app labels. |

---

## 4. Count summary

| Category | Strings found | Already correct | Remaining work |
|---|---:|---:|---:|
| **Confirmed: Docs → Wiki** | 15 | 4 (wiki-aligned) | **15** |
| **Confirmed: Connect → Worker tokens** | 13 | 0 | **13** |
| **Confirmed: Connect → Platform connections** | 10 | 0 | **10** |
| **Confirmed: Connect → Connected apps** | 12 | 0 | **12** |
| **Confirmed: Attention → Things to resolve** | 1 | 1 | **0** |
| **CANDIDATE: intake / setup packet** | 33 | 0 | *(decision pending)* |
| **CANDIDATE: capabilities → Automations** | 3 | 0 | *(decision pending)* |
| **CANDIDATE: principals → People & agents** | 15 | 0 | *(decision pending)* |
| **Ambiguous cases** | 10 | — | *(architect call)* |

**Confirmed rename totals:** 51 strings to update (35 Connect split + 15 Docs → Wiki + 1 attention already done).

**packages/ui:** No nomenclature-specific hardcoded product strings; components accept `title` / `body` / `label` from callers. Default confirm dialog uses `Confirm` / `Cancel` only.

**packages/wizard:** 4 user-visible CANDIDATE strings in interview-pack markdown (§2.1); schema constant `INTAKE_PACKET_SCHEMA_MARKDOWN` is agent-facing instruction text, not in-app chrome.

---

*Audit complete. No source files modified.*