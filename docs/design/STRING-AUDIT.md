# CompanyOS String Audit — every flagged user-facing string

*Copy Self-Audit (taste skill §4.9) across all visible strings. Only flagged strings are listed — strings that passed (e.g. "No data in range.", "No matching runs.", WorkLog filter labels, ConnectPanel snippet titles, UserCreateForm helper copy) are not repeated here. Flags: **J** jargon leak · **V** vague · **D** developer-voiced · **G** grammar/awkward · **I** inconsistent across screens · **T** AI-tell (glyph/separator/template). Each row: exact string → file:line → flags → proposed rewrite. Vocabulary-level renames live in NOMENCLATURE.md; this doc is sentence-level.*

## 1. Shell & navigation

| String | Where | Flags | Rewrite |
|---|---|---|---|
| "ops record" | `(app)/layout.tsx:66` | V,G | Delete (wordmark suffices) |
| "Scope" (permanent header placeholder) | `(app)/layout.tsx:89` | V,D | Replace with real breadcrumb or remove bar (CONCEPTS §3) |
| "⌂ {instanceName} overview" | `Sidebar.tsx:88` | T | "{instanceName} overview" + Lucide Home icon |
| "New scope" / "Create new scope" (aria) | `Sidebar.tsx:70-71` | J | "New project" |
| "slug (optional)" (placeholder-as-label) | `Sidebar.tsx:248` | J,D | Label "URL name (optional)" + helper "Lowercase, no spaces — used in the path." |
| "(top level — new Project / Client)" | `Sidebar.tsx:257` | T (em-dash), G | "Top level (new project)" |
| "What is this scope for?" (placeholder) | `Sidebar.tsx:265` | J | Label "Why does this exist?" + helper "One or two sentences; becomes the start of the brief." |
| "Top level creates a Project / Client; picking a parent creates a Sub-project under it." | `Sidebar.tsx:273` | G | "Choose a parent to nest this inside it; leave empty to create a top-level project." |
| "Create scope failed" | `Sidebar.tsx:225` | D,V | "Couldn't create the project. {reason}" (toast, not `alert`) |
| "Project" (uppercase-tracked eyebrow) | `Sidebar.tsx:65` | T | Sentence-case "Projects" group label |

## 2. Wizard / intake

| String | Where | Flags | Rewrite |
|---|---|---|---|
| "Setup incomplete" + "{status} · {templateSlug}" | `IntakePanel.tsx:126-128` | V,J,T(·) | "Finish setting up {scope name}" + "Step {n} of 6 — {status label}" |
| "Creation wizard" + "{uuid} · {status}" | `IntakePanel.tsx:232-233` | D,T | "Set up {scope name}"; drop the UUID (keep in a details disclosure) |
| statusLabel: `status.replace(/_/g," ")` → "awaiting external", "needs review" | `IntakePanel.tsx:68-70` | D,I | Label map per NOMENCLATURE §4 |
| "No reason captured." | `IntakePanel.tsx:246` | G | "No reason recorded yet. Add one." |
| "Optional extra search terms" (placeholder) | `IntakePanel.tsx:272` | V | Label "Search past records and docs" + placeholder "client name, domain, old scope path" |
| "meta ads, client launch, codebase docs" (placeholder) | `IntakePanel.tsx:316` | — ok as examples, but needs a label | Label "What kind of work is this?" |
| "In use at {scopePath}" | `IntakePanel.tsx:327` | G | "Currently used by {scopePath}" |
| "Assemble pack" / "Submit return" | `IntakePanel.tsx:347,374` | V | NOMENCLATURE §3 |
| "Paste external packet markdown here" | `IntakePanel.tsx:355` | J,D | "Paste the LLM's full reply here — don't trim it." (hyphen, not em-dash) |
| `{errors.join(" · ")}` (error blob) | `IntakePanel.tsx:356` | T,V | Bulleted list; each item = expected vs found |
| "Markdown-only return: no fenced JSON packet was found. Review every field manually before approval." | `IntakePanel.tsx:381-383` | D | "No structured packet found in the reply. You can continue — every review field will start empty and must be filled by hand." Style: warn (amber), not destructive |
| "Pack snapshot sent to external agent" | `IntakePanel.tsx:387` | J | "What was sent to the interview" |
| "Provision spec" / "Wiki updates" / "Open questions" / "Risk notes" (labels on raw JSON boxes) | `IntakePanel.tsx:392-397` | J | Become card titles: "What will be created", "Documents", "Tasks", "Wiki updates", "Open questions", "Risks" (CONCEPTS §1 step 5) |
| "Reject reason" (placeholder) | `IntakePanel.tsx:414` | V | In confirm dialog: label "Why is this going back?" |
| "No intake packets." / "No intake selected." | `IntakePanel.tsx:153,180` | J | "No setups yet for this project." / "Select a setup on the left." |

## 3. Admin

| String | Where | Flags | Rewrite |
|---|---|---|---|
| "Tenant Admin" | `admin/layout.tsx:28` | J,I (sidebar says "Admin") | "Admin" |
| "Root-scope operations for this CompanyOS instance." | `admin/layout.tsx:30` | J,D | "Instance-wide settings, people, and access." |
| `root:{role}` badge vs `Role: {role}` | `admin/layout.tsx:33` vs `admin/mcp:42` | I | One chip format: "Owner" with tooltip "on {instance} (root)" |
| "Alerts" tile → `/admin/automations` (same as "Automations" tile) | `admin/page.tsx:19-20` | I,V | Merge tiles or give alerts a destination |
| "configured" / "not configured" / "missing" / "present" | `admin/page.tsx:56`, `admin/settings:39,129` | D,I | "Connected" / "Not configured" chips (one pair, both pages) |
| "Reset temp" | `admin/users:45` | V,G | "Issue new temporary password" |
| "unlinked" / "change required" / "normal" | `admin/users:31-32` | D | NOMENCLATURE §4 |
| "Principal" (option-as-label), unlabeled scope input | `admin/grants:16,19` | J + form defect | Real labels: "Person or agent", "Project path" |
| "Grant" (submit) | `admin/grants:27` | V | "Grant access" |
| "Capability runs and alert events. MCP usage lives in MCP Manager; liveness checks live in Health." | `admin/automations:14` | D,T | "Automation runs and alerts. Usage is under MCP; uptime checks under Health." |
| `{scopePath} - {date}` (hyphen separator) | `admin/automations:47` | T | Two lines or `<time>` right-aligned |
| "LLM &amp; keys" | `admin/settings:48` | G | "Models & keys" |
| "LiteLLM virtual keys, aliases, provider key presence, and spend. Agent-side token usage is in MCP Manager; probes are in Health." | `admin/settings:49-51` | J,D,T | "API keys, model aliases, and spend for this instance." |
| "No keys returned." / "No aliases returned." / "No spend returned." | `admin/settings:107,120,143` | D | "No keys yet." / "No aliases configured." / "No spend recorded yet." |
| `alias -> model (provider)` (ASCII arrow) | `admin/settings:118` | T | Two-column layout or "alias → model" as *columns*, no glyph |
| "Mint virtual key" / "Minting..." / "Mint key" / "One-time virtual key" | `LiteLlmMintForm:13,23,31` | J | "Create key" / "Creating…" / "Shown once. Copy it now." |
| "key alias" / "optional, comma separated models" (placeholder-only), unlabeled budget input | `LiteLlmMintForm:16-18` | form defect,G | Labels above: "Key name", "Monthly budget (USD)", "Allowed models (optional)" |
| "Credential expiry, job liveness, webhook delivery, and alert surfacing." | `admin/health:57-59` | T (feature-list subtitle) | "Is everything running? Credentials, jobs, webhooks, alerts." or drop |
| "Expiry / next expected" · "Summary / error" (slash headers) | `admin/health:112,155` | T | "Next expected" (expiry in cell detail); "Result" |
| ok/warning/error raw status | `admin/health:127` | D | "Healthy / Warning / Failing" |
| "Fleet-level connection tokens, subtree revocation, and principal offboarding." | `admin/mcp:38-40` | J,T | "Agent connections across all projects: review, revoke, offboard." |
| "Usage Observability" / "Estimated CompanyOS MCP and context overhead. Actual model tokens appear only when clients provide them." | `admin/mcp:48-51` | J,D | "Usage" / "Estimated context tokens used by agents. Model-side token counts appear when clients report them." |
| "Intake queue" / "Global creation wizard review and template administration." | `admin/intake:24-25` | J | "Setup queue" / "Setups waiting on review, and the interview templates." |
| "Packets awaiting action" / "No packets awaiting review." | `admin/intake:29,31` | J | "Waiting on review" / "Nothing waiting on review." |
| "Commit template update" / "Save and sync" | `admin/intake:75,84` | D | "Edit template" / "Save template" + helper "Syncs to the skills repo." + success toast |
| "Template path and markdown body are required" | `admin/intake:17` | D | "Add both a path and the template content." (and render inline, not thrown) |

## 4. Server-action errors (rendered in panels/alerts)

| String | Where | Flags | Rewrite |
|---|---|---|---|
| "Not authenticated" (×20+) vs "No authenticated actor" (brain, agent) | all `actions.ts`; `brain/actions.ts:12`, `agent/actions.ts:21` | I,D | One string everywhere: "Your session expired. Sign in again." + redirect affordance |
| "Name, slug, and reason required" | `_components/actions.ts:17` | J,G | "Add a name and a reason. (URL name is optional.)" — with per-field inline errors |
| "Insufficient permissions to create scope" / "…to manage members" | `_components/actions.ts:26,50,74,91` | D | "You need admin access on this project to do that." |
| `No existing user with email "{email}". (User must sign up first; invites in M5)` | `_components/actions.ts:55` | **D — internal milestone shown to users** | "No account with that email yet. They need to sign up first — invites are coming." (or omit the promise) |
| "Scope and principal required" | `_components/actions.ts:67,85` | J | "Select a person and a project." |
| "mode must be ingest, lint, or backfill" | `brain/actions.ts:14` | D | Unreachable via UI once buttons are fixed; keep as 400-level API error |
| "Better Auth changePassword API is not available" | `modules/admin/actions.ts:152` | D | "Password change isn't available right now — contact your admin." (comma form) |
| "Failed to create user" / "Failed to mint LiteLLM key" / "Failed to load X" family | `modules/admin/actions.ts:52,126` + panels | V | Standard: cause + recovery. "Couldn't create the account — {reason}. Fix and retry." Error-copy rule: never just "Failed to X" |
| "Agent request failed (gateway?)" | `AgentChatPanel.tsx:101` | D,G | "The agent didn't respond. Check the model gateway in Admin → Settings, then retry." |
| "Access denied" | `docs/actions.ts:71` | V | "You don't have access to this project's wiki." |

## 5. Modules

| String | Where | Flags | Rewrite |
|---|---|---|---|
| "Inherited wiki — from {scopePath}" | `DocsView.tsx:327` | T (em-dash) | "Inherited wiki (from {scopePath})" |
| "No docs yet. Create the first doc — agents can also write here via save_doc." | `DocsView.tsx:348` | T,D (tool name) | "No docs yet. Create the first one; agents can add docs here too." |
| `Archive "{title}"? It will be hidden from list.` | `DocsView.tsx:227` | G | "Archive "{title}"? It will be hidden from the list (not deleted)." |
| "{date} · {savedBy.slice(0,8)}" (truncated UUID + middle dot) | `DocsView.tsx:503` | T,D | "{date}, by {name}" (or two lines). Resolve principal names; never show raw ids |
| "Reverting creates a new revision." | `DocsView.tsx:518` | G (fine but placed as 10px whisper) | Keep text; render as normal helper, 12px |
| "Markdown canonical • autosaves on idle" | `DocEditor.tsx:131` | J,T | "Autosaves as you work" |
| "Saved · {time}" | `DocEditor.tsx:125` | T | "Saved {time}" |
| "Excalidraw • 2MB cap" | `CanvasView.tsx:306` | T,D | Remove from footer; warn inline only when a canvas nears the 2MB limit |
| "No canvases yet. Create one." | `CanvasView.tsx:278` | V (terse) | "No canvases yet. Sketches and diagrams live here." + New canvas button |
| "Chat with the OS agent. Uses tools for live data." | `AgentChatPanel.tsx:172` | D | "Ask about this project: metrics, tasks, records. Answers use live data." |
| "Thinking + using tools…" | `AgentChatPanel.tsx:175` | G | "Working…" with tool names streaming in the trace |
| "model: {model} · durable writes → records/docs" | `AgentChatPanel.tsx:213` | J,T | Remove footer; model already in the picker |
| `tool:{name} → ok / err:` | `AgentChatPanel.tsx:120` | D,T | "{name} ✓ / {name} failed" inside the trace disclosure |
| "(no content)" | `AgentChatPanel.tsx:127` | D | "No reply — try again." |
| "No prior chats" | `AgentChatPanel.tsx:156` | G | "No chats yet" |
| "open ↗" | `TasksWidget:32`, `s/[...path]:326,469` | T,V | "Open task ↗" with `aria-label` incl. title; icon = Lucide ExternalLink |
| "via Plane" / "read-only" (card corner tags) | `s/[...path]:314,289` | J,V | Tooltips or drop; "Synced from your task board" |
| "Plane not configured — tasks hidden." | `s/[...path]:318,459` | T,J | "Task sync isn't set up yet. Connect it in Admin → Settings." |
| "— no prior" | `MetricCard.tsx:38` | T | "no previous period" |
| "Date/Dim" | `TableWidget.tsx:55` | J | "Date" (or the dimension's actual name when dims exist) |
| "Unknown widget type: {type}" | `DashboardGrid.tsx:185` | D | "This widget type isn't supported yet ({type})." |
| "An agent can create one with save_dashboard for this scope." | `DashboardGrid.tsx:198` | D | "No dashboard yet. Ask an agent to create one, or use Ask OS right here." |
| "Values are write-only in the OS UI." | `CredentialsPanel.tsx:135` | D | "Stored encrypted. Values can be replaced but never read back." |
| "{whatFor} \| {loginMethodNotes}" (pipe separator) | `CredentialsPanel.tsx:167` | T | Two lines |
| "No use specified." | `CredentialsPanel.tsx:166` | G | "No description." |
| "Requested during intake" | `CredentialsPanel.tsx:157` | J | "Requested during setup" |
| "set" / "unset" | `CredentialsPanel.tsx:171,271` | D | "Set ✓" / "Needed" chips |
| "This scope's credentials" | `CredentialsPanel.tsx:248` | J | "Credentials in this project" |
| "Viewer access is read-only for MCP connections." | `ConnectPanel.tsx:272` | G | "Viewers can see connections but can't create tokens." |
| "Token shown once" / "You will not see this token again." | `ConnectPanel.tsx:281-282` | ok | Keep — good pattern; mirror wording in LiteLLM form |
| "Grants are read-only here. Edit team access belongs to Tenant Admin." + orphan "Edit team access" span | `McpManagerView.tsx:308-311` | G, dead UI | "Access is read-only here — manage it in Admin → Access." as a link; delete the orphan span |
| "Working..." / "Loading..." vs "Loading…" | `McpManagerView:226`, `WorkLogView:120`, `CanvasView:276/367` | I | One convention: real ellipsis "…" everywhere (then replace with skeletons per DELTAS §6) |
| "Second brain global graph" (aria-label) | `BrainGraphCanvas.tsx:236` | J,I ("Brain" elsewhere, "Second brain" here) | "Brain knowledge graph" |
| "Runs, lint, and spend" | `brain/engine:31` | T | "How the Brain distills records into the wiki" |
| " (partial)" run suffix | `brain/engine:98` | D | chip "Partial" with tooltip "Stopped before finishing; safe to re-run." |
| "Ada Lovelace" placeholder | `sign-up:58` | T | "Your name" |
| "••••••••" placeholder | `sign-in:73` | T,I (sign-up says "At least 8 characters") | Match sign-up: no placeholder or "At least 8 characters" |
| "First user becomes owner of the root workspace" | `sign-up:45` | J | "The first account becomes this instance's owner." |
| "This account was created with a temporary password." | `change-password:20` | G (cold) | "Welcome to {instance}. Set your own password to finish signing in." |

## 6. Standards going forward (the rule that prevents regrowth)

1. **Error copy = cause + recovery**, named object, no bare "Failed to X".
2. **No raw enums, UUIDs, tool names, vendor names, or milestone codes** in visible strings; label maps + resolved display names only.
3. **One ellipsis (…), no em/en dashes** (taste-skill hard ban) — commas, periods, colons, parentheses; hyphens only in compounds/ranges.
4. **One separator style:** prefer layout (two lines, columns) over glyph separators; where inline metadata is unavoidable use a single `·` max per line — better, avoid entirely.
5. **Second person, present tense, calm**: "You need admin access…" not "Insufficient permissions…".
6. Strings live next to a screen? Then they're code-level and reviewed against this doc; strings in wizard templates follow NOMENCLATURE §5's style guide.
