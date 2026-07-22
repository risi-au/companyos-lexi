# CompanyOS Primer — everything an agent needs to know

*Self-contained overview for any AI agent (or human) working with or alongside
CompanyOS. You do not need access to the codebase to use this document. If you were
given only this file, it is enough to understand what the OS is, how to interact with
it, and what is expected of you. Last updated 2026-07-08 (v0.7.x, pre-v0.8.0).*

---

## 1. What CompanyOS is

**A self-hosted, AI-native system of record and visibility layer for running
businesses.** Work happens elsewhere — in terminal agents, chat tools, ad platforms,
spreadsheets, local folders. CompanyOS is the one place that *knows everything*: what
exists, what changed, what's pending, what it cost, and why.

The core bet:

> **Chats are disposable. Tools are disposable. The record is the asset.**

Agents and vendor tools are stateless workers. All durable state — decisions,
changelogs, reports, documents, metrics, credentials, knowledge — lives in CompanyOS
as structured, scoped, queryable data. Any agent, today or in five years, gets its
context from the OS and reports its outcomes back to the OS. Switching tools costs
muscle memory, never data.

CompanyOS is **not** a CRM, a mailer, a task tracker, or a billing system. It sits on
top of the tools a company already uses. External tools keep doing what they do;
integrations mirror the important facts in; agents consume those facts and add new
ones.

It is built as a SaaS whose first tenant is the owner's own holding company
(Brissie Digital). One *instance* serves one company; inside an instance live many
*scopes* (clients, projects, functions).

---

## 2. Mental model — the ten concepts that matter

| Concept | What it is |
|---|---|
| **Instance / tenant** | One deployed CompanyOS stack serving one company. Everything below lives inside an instance. |
| **Scope** | A node in a tree of arbitrary depth. Top level = a client or project (e.g. `airbuddy`, `indya`); below that, anything (`indya/marketing/meta-ads`). The root scope is the company-wide view. Every scope has its own modules, grants, docs, records, credentials. |
| **Principal** | An actor — human or agent. Both are the same kind of thing to the OS. |
| **Grant** | principal × scope × role (`owner`, `admin`, `editor`, `viewer`, `agent`). A grant covers the whole subtree beneath its scope. Access is enforced at the service layer on every call — never just in the UI. |
| **Token** | A hashed API key belonging to one principal. Every MCP/API call authenticates a token → resolves the principal → checks grants → executes → emits an event. There are no god-keys. |
| **Event** | Append-only log entry emitted by **every write** in the system (type, scope, principal, payload, timestamp). Powers the audit trail, activity feeds, cross-module reactions, and usage analytics. |
| **Record** | A fact about something that happened: a change shipped, a decision taken, a report produced, a note. Markdown body + structured metadata, attached to a scope. Records are the durable memory. |
| **Module** | A per-scope surface (dashboard, docs, canvas, work log, metrics, credentials, …). Scopes compose whichever modules they need. |
| **Capability** | An automation registered per scope (built in n8n, or any engine) with its own scoped token. The OS tracks its runs, statuses, and alerts. |
| **Workbench** | A local folder + git repo where actual work happens, linked to a scope. GitHub is the truth for code/files; the OS is the truth for the record; the scope key joins them. |

Two supporting concepts:

- **Skills** — reusable how-to instructions (markdown, `SKILL.md` format) in one
  central git repo, indexed by the OS and resolvable per scope (global + domain +
  scope-specific, specific overrides general). Agents fetch them via MCP.
- **The brain** — a maintenance engine that nightly distills raw records and events
  into a curated per-scope wiki (see §5), so context stays current without anyone
  writing documentation by hand.

---

## 3. Architecture in one minute

- **TypeScript monorepo.** Next.js web app (`apps/os`), typed service layer
  (`packages/api` — ALL business logic), MCP server (`packages/mcp`), Drizzle ORM +
  Postgres (`packages/db`), shared UI primitives + design tokens (`packages/ui`),
  wiki maintenance engine (`packages/brain`).
- **API-first, three clients.** The web UI, the MCP server, and any future mobile
  app are all thin clients of the same service layer. Nothing is reachable only
  through the UI: if the UI can do it, an agent can do it via MCP, and vice versa.
- **Adopted, swappable engines** behind the OS contract:
  - **Plane** (self-hosted) — tasks/project management. The OS proxies task tools
    and maps scopes to Plane workspaces/projects.
  - **n8n** (self-hosted) — scheduled data pulls and automations.
  - **LiteLLM** (self-hosted) — one OpenAI-compatible model gateway. Virtual keys
    per capability give per-scope cost tracking and **hard budget caps**
    (default US$25/month per key). Model names are role aliases (`cheap`,
    `analysis`, `reasoning`, `embed`) — never vendor names.
  - **Excalidraw** (embedded) — canvases, stored as JSON in our Postgres.
  - **BlockNote** (embedded) — Notion-style doc editor. **Markdown is canonical
    storage**; nothing is trapped in a proprietary format.
- **Self-hosted, zero lock-in.** Docker Compose on a VPS; all data in own Postgres +
  git. Nightly encrypted backups ship offsite (Cloudflare R2).
- **Engineering rules** (the "constitution"): kernel + isolated vertical modules
  that never import each other; every write emits an event; markdown for content,
  jsonb for flexible structure; design tokens only in UI; 12-factor config; every
  module documents itself and tests its contract.

---

## 4. The modules (what a scope can have)

Every scope page in the UI is a set of tabs; agents reach the same data via MCP.

| Module | What it does |
|---|---|
| **Overview / Dashboard** | Agent-authored dashboards: stored JSON specs rendered by the shell (metric cards, time series, bar charts, tables, task lists, text widgets). Agents create and edit them on request ("add a spend-by-country widget"). Versioned and revertable. |
| **Docs (wiki + documents)** | Markdown documents with revisions. Includes the brain-maintained wiki pages (see §5) and human/agent-authored docs. Synced to workbenches as `.md` files. |
| **Work log** | The records store: changelogs, decisions, reports, notes. Filterable per scope. This is where "what happened" lives. |
| **Tasks** | Plane-backed task lists (assignee, state, due date). Agents create/update/complete tasks via MCP; humans use Plane's UI or the OS. |
| **Metrics** | Generic time-series (scope, metric, date, value, dimensions). Filled by n8n pulls (ad platforms, analytics, commerce) or agent writes. Dashboards query it. |
| **Canvas** | Excalidraw whiteboards per scope, agent-editable via MCP (scene JSON). |
| **Sessions** | Agent work sessions: register at start, update along the way, complete with a wrap-up summary. Gives humans a live view of what agents are doing. |
| **Credentials (vault)** | Per-scope encrypted secrets (AES-256-GCM). Admins write values; agents read them at work time via MCP (`get_credential`), every access audited. The UI is write-only — values are never displayed. |
| **Connect** | Where humans mint agent tokens and copy ready-made connection snippets (Claude Code, Cursor, generic MCP config, ChatGPT). |
| **Intake (creation wizard)** | The structured flow for creating new scopes — see §6. |
| **Capabilities / Automations** | Registry of per-scope automations with run history and alerting. |

Instance-level surfaces (root admins only): **Admin** (users, grants, activity log,
automations, instance settings, LLM keys & budgets), **Health** (credential expiry
warnings, job liveness, run log, email alerts), **MCP manager** (fleet-wide token
administration), **Brain** (knowledge graph + engine runs), **Usage** (API/token
spend by scope, capability, model, principal).

---

## 5. The brain — how knowledge stays current

Raw records pile up; nobody wants to hand-maintain documentation. The brain engine
runs nightly (and on triggering events):

- **Per-scope ingest**: reads new records, workbench pushes, and session wrap-ups;
  merges the important facts into that scope's wiki pages (update-in-place, via the
  same `save_doc` path agents use).
- **Root distillation**: maintains company-wide pages — `critical-facts`,
  `scope-map`, and `pattern-*` pages (recurring patterns worth reusing).
- **Code docs**: for scopes with a workbench, maintains `code-architecture`,
  `code-stack`, `code-integrations`, `code-ops` pages from GitHub reads, citing
  commit SHAs.
- **Lint pass**: checks wiki quality, auto-fixes safe issues, raises alerts on the rest.
- **Hybrid search**: full-text + vector embeddings across records and docs, exposed
  to agents via the `search` and `recall_memory` MCP tools.

Practical consequence for you as an agent: **if you log your work as records, the
system learns from it automatically.** If you don't, the OS doesn't know it happened.

---

## 6. The creation wizard — how new scopes are born

New clients/projects aren't just created — they're *interviewed into existence* so
the scope starts with real context:

1. **Reason** — why does this scope need to exist? (required, stored verbatim)
2. **Framing** — structured questions from an admin-editable template.
3. **Related history** — hybrid search over existing records; relevant hits get
   attached (e.g. all the pre-sale conversations with a lead who just converted).
4. **Pack assembly** — the OS compiles a briefing pack (markdown): framing answers,
   history digest, similar past patterns, structural context, a packet schema
   listing `required_credentials` and `external_systems`.
5. **External interview** — a human runs that pack through any external LLM (this
   deliberately happens *outside* the OS; the pack contains no secret values).
6. **Paste back** — the structured result is submitted as an *intake packet*.
7. **Review → approve → provision** — a human reviews (the pack snapshot stays
   visible), approves, and the OS deterministically provisions: scope, module
   instances, Plane project, repo skeleton, tokens, a `source-refs` record linking
   back to the originating history.
8. **Credential fill-in** — the named credentials get their values entered into the
   vault (values were never part of the interview).

**Conversion rule: link, don't migrate.** Pre-signing history stays where it
happened; the new scope points back at it permanently.

---

## 7. Connecting to the OS (MCP)

The MCP server is the front door for every agent surface (Claude Code, Cursor,
ChatGPT connectors, n8n, custom scripts).

- **Endpoint**: `https://<instance-domain>/api/mcp` (HTTP transport). Instance #1
  staging: `https://cos-staging.risi.au/api/mcp`.
- **Auth**: `Authorization: Bearer <token>` header. Tokens are minted by a human in
  the Connect tab of the relevant scope (or fleet-wide in the MCP manager) and are
  bound to a principal with explicit grants.
- Claude Code one-liner (the Connect tab generates these):
  `claude mcp add companyos <endpoint> --transport http --header "Authorization: Bearer <token>"`

There is also a versioned **HTTP API** (`/api/v1/...`) used by capabilities (e.g.
`POST /api/v1/capabilities/report-run`) and integrations; MCP is the richer surface
meant for interactive agents.

### MCP tool surface (v1, as deployed)

Grouped; every call is scope-checked and emits an event. The contract is additive —
tools are added or deprecated with warnings, never silently changed.

- **Identity & context**: `ping`, `whoami`, `get_context` (scope brief + recent
  changes + open tasks + skills, token-budgeted), `get_context_profile`,
  `set_context_profile`, `get_tree`, `verify_workbench`
- **Search & memory**: `search` (hybrid, per scope), `recall_memory`, `get_record`
- **Records**: `log_change`, `log_decision`, `save_report`, `save_note`,
  `list_records`
- **Tasks (Plane proxy)**: `create_task`, `update_task`, `complete_task`,
  `list_tasks`
- **Sessions**: `register_session`, `update_session`, `complete_session`,
  `list_sessions`
- **Docs**: `save_doc`, `get_doc`, `list_docs`, `list_doc_revisions`, `revert_doc`,
  `rename_doc`, `archive_doc`
- **Wiki/links**: `get_backlinks`, `get_link_graph`, `resolve_wiki_question`
- **Dashboards**: `save_dashboard`, `get_dashboard`, `list_dashboards`,
  `list_widget_types`, `revert_dashboard`
- **Metrics**: `write_metrics`, `query_metrics`, `list_metric_names`
- **Canvas**: `save_canvas`, `get_canvas`, `list_canvases`
- **Skills**: `list_skills`, `get_skill`, `sync_skills`
- **Credentials (vault)**: `list_credentials` (names/metadata), `get_credential`
  (value; audited, agent-role and above)
- **Intake wizard**: `submit_intake_packet`, `list_intake_packets`,
  `get_intake_packet`, `update_intake_packet`, `approve_intake_packet`,
  `provision_from_intake_packet`
- **Capabilities & ops**: `register_capability`, `report_run`, `list_capabilities`,
  `list_capability_runs`, `list_alerts`, `provision_scope`,
  `list_attention_items`, `resolve_attention_item`
- **Admin-gated analytics**: `query_usage`

---

## 8. Operating doctrine — what goes where

When you're deciding where something belongs, classify it by shape:

- **Scope-shaped** — needs its own access boundary (grants, agents, wiki, repo,
  vault)? It's a scope; create it through the wizard. Clients get a scope **when
  they convert**, never per-lead. Function scopes (sales, marketing) hold the
  company's own recurring work.
- **Plane-shaped** — has an assignee, a state, and a due date? It's a Plane task.
- **Record-shaped** — a fact about something that happened (comm sent, quote
  issued, decision taken, deploy shipped)? It's an OS record at the scope where it
  happened, logged by whoever did it. **The agent doing the work is the
  integration.**
- **External-tool-shaped** — pipelines with their own machinery (CRM, billing,
  email tracking, ad platforms) stay external. Mirror the key facts into records
  and metrics. The test: the OS must be able to answer "what's the state of X?"
  from mirrored records even though the source of truth is external.

### Secrets — hard rules

- Secret values never go in git repos, never in docs, never through external LLM
  interviews, never in records or reports.
- Connection *procedures* (how to log in, do's and don'ts) are open markdown docs;
  the *values* they reference live in the scope's vault as
  `{{credential:name}}` references. Fetch values at work time via `get_credential`;
  every access is audited.

---

## 9. Playbook — how an agent should work a task

If you have MCP access:

1. **Start**: `get_context(scope)` — identity, brief, recent changes, open tasks,
   skills. Optionally `register_session` so humans can see you working.
2. **Orient**: `search` / `recall_memory` for prior art; `list_skills` +
   `get_skill` for how-to instructions relevant to the scope; `list_credentials` +
   `get_credential` for the accounts you need.
3. **Work**: do the actual task in whatever tool is right for it.
4. **Record as you go**: `log_change` for things you changed, `log_decision` for
   choices made (with the why), `create_task`/`complete_task` for follow-ups,
   `write_metrics` for numbers worth tracking.
5. **Finish**: `save_report` with a structured wrap-up, `complete_session` with a
   short summary. Every save must be at the scope where the work happened.

If you do **not** have MCP access (e.g. you're a sandboxed agent given only this
file): do the work, and produce your outputs as markdown structured for later
ingestion — a report body plus, at the end, a short list of the records that should
be logged (each with: type `change|decision|report|note`, scope path, title,
one-paragraph body). A human or connected agent will feed them in.

### Report convention (important)

When a task is run partly to *learn how the OS should improve* (pilot tasks in new
domains — for example, operational work for a retail client like Nutrition
Warehouse), finish with a detailed report containing these sections:

1. **What was asked** — the task as understood.
2. **What was done** — steps, tools used, outcomes, artifacts produced.
3. **What context was needed** — every piece of information you had to find or ask
   for. Note which of it CompanyOS provided vs. what was missing from it.
4. **Friction log** — anything slow, manual, repeated, or error-prone; anything
   you had to work around.
5. **OS gaps and suggestions** — concretely: which module, tool, record kind,
   skill, or automation would have made this task cheaper or safer? What should be
   mirrored into the OS (records/metrics) so it can answer questions about this
   domain next time?
6. **Records to log** — the list described above, ready for ingestion.

These reports are read by the architect and feed directly into the OS roadmap.

---

## 10. Where things stand (2026-07-08)

- **Built and deployed** (staging, instance #1): the full spine — scope tree,
  principals/grants/tokens, events; records, docs (BlockNote, markdown-canonical),
  canvases, metrics, dashboards, Plane task integration, capabilities + alerts,
  skills sync, sessions; MCP server with the full tool surface above; resident
  "Ask OS" chat; brain engine with nightly wiki maintenance, embeddings, hybrid
  search; creation wizard v2 (structured intake, external interview, provisioning);
  credential vault v1; tenant admin (users, grants, activity, LLM keys with
  budgets); ops health panel; native arm64 release pipeline (~9 min build+deploy);
  nightly encrypted backups (offsite upload in final verification).
- **Next**: a five-package UX overhaul (foundations → feedback layer → strings →
  sidebar → wizard stepper), then v0.8.0 tagging and live promotion.
- **Deliberately deferred**: client-facing portal, email ingestion, CRM-lite,
  in-OS billing, control plane v1 (until a second tenant is real), source
  connectors design.

---

## 11. Glossary quick reference

- **Scope path** — slash-joined tree address, e.g. `indya/marketing/meta-ads`.
- **Intake packet** — the structured result of a wizard interview, awaiting review.
- **Wrap-up** — the summary an agent leaves via `complete_session`.
- **Wiki** — the brain-maintained doc set per scope (`critical-facts`, `scope-map`,
  `code-*`, etc.). Distinct from hand-authored docs, same storage.
- **Virtual key** — a LiteLLM API key bound to one capability/scope with a budget.
- **Role aliases** — `cheap` / `analysis` / `reasoning` / `embed`: model names
  workflows use so vendors stay swappable.
- **Source-refs** — the record in a converted scope linking back to pre-conversion
  history (link-don't-migrate).
