# COS Layer Model

This document captures the layered operating model discussed for COS. The purpose is to keep the system modular, scalable, and easy to reason about as more clients, projects, automations, agents, and employees are added.

## Why Layers Matter

COS should not become one large tangled system where every tool talks to every other tool directly.

Each layer should have a clear job. This keeps the architecture flexible and prevents Cursor, Affine, Hermes, n8n, GitHub, and gbrain from becoming unnecessarily complicated.

## Layer 1: Source of Truth Layer

### Primary role
Store durable business memory, decisions, context, changelogs, templates, and agent handoff material.

### Main tools
- GitHub
- Markdown files
- Per-client/project repos
- Standard `.cos/` folders

### Responsibilities
- Client/project context
- Task briefs
- Decisions
- Changelogs
- Agent-readable handoff files
- Standard operating templates
- Historical reasoning and context

### Principle
GitHub Markdown remains the source of truth. Other tools may index, display, analyze, or automate around it, but they should not replace it as the durable memory layer.

## Layer 2: Planning Layer

### Primary role
Let humans plan visually and strategically before execution begins.

### Main tools
- Affine
- Future planning agent interface
- Structured task specification blocks

### Responsibilities
- Visual client boards
- Funnel maps
- Task planning
- Strategy diagrams
- Relationship mapping between ads, pages, products, offers, audiences, and data sources
- Human-friendly planning and discussion

### Principle
Affine should be the visual planning and command-centre layer, not the raw data warehouse or source-of-truth backend.

## Layer 3: Structured Task Specification Layer

### Primary role
Translate flexible human planning into a structured format that agents and automations can reliably process.

### Main format
A structured task block, likely YAML or JSON, embedded in an Affine page, GitHub file, or submitted through a form/chat.

### Example

```yaml
client: AirBuddy
business_area: Marketing
task_type: Meta Ads Optimization
goal: Improve ROAS and identify next scaling opportunities
inputs:
  - Meta Ads
  - GA4
  - WooCommerce
  - landing pages
outputs:
  - weekly analysis report
  - action plan
  - changelog update
  - follow-up tasks
repo_target: airbuddy/meta-ads/weekly-optimization
review_cadence: weekly
approval_required: true
```

### Principle
Visual planning can guide the agent, but structured fields should drive automation.

## Layer 4: Orchestration Layer

### Primary role
Coordinate what needs to happen across tools, agents, workflows, repos, and data sources.

### Main tool
- Hermes

### Responsibilities
- Understand the task spec
- Choose the correct COS template
- Decide what needs to be created
- Trigger n8n/GitHub actions
- Notify the user when data or analysis is ready
- Track overdue follow-ups
- Summarize project status
- Route work to the right execution tool or agent

### Principle
Hermes should start as planner, coordinator, and notifier. It should not become a mandatory gateway for every Cursor chat or every execution task.

## Layer 5: Automation Layer

### Primary role
Run reliable repeatable workflows, scheduled jobs, and tool integrations.

### Main tool
- n8n

### Responsibilities
- Scheduled data pulls
- Webhook handling
- Creating folders/files from templates
- Triggering reports
- Sending notifications
- Connecting APIs such as Meta, Google Ads, GA4, WooCommerce, SEO tools, CRM, and email platforms

### Principle
n8n handles deterministic workflows. Hermes handles judgment, planning, prioritization, and synthesis.

## Layer 6: Data Layer

### Primary role
Store raw and structured performance data separately from narrative project memory.

### Possible tools
- Postgres
- BigQuery
- Supabase
- Google Sheets as a simple starting point
- Future warehouse/BI tooling

### Responsibilities
- Raw performance metrics
- Weekly/monthly snapshots
- Source data from Meta Ads, Google Ads, GA4, WooCommerce, SEO tools, CRM, etc.
- Historical trend data
- Data for AI analysis and dashboards

### Principle
Raw performance data should not live mainly in Affine or Markdown. Markdown should store interpretation, decisions, and analysis snapshots.

## Layer 7: Analysis and Intelligence Layer

### Primary role
Turn raw data and project context into insight, recommendations, and follow-up actions.

### Main tools
- Frontier AI models
- Hermes later
- gbrain later
- Scheduled analysis prompts

### Responsibilities
- Weekly performance analysis
- Pattern detection
- Before/after impact analysis
- Follow-up recommendations
- Opportunity detection
- Risk detection
- Cross-channel insights

### Principle
AI analysis should write durable outputs back into the source-of-truth layer as Markdown reports, decisions, and changelog entries.

## Layer 8: Execution Layer

### Primary role
Make actual changes to websites, ads, code, docs, workflows, and systems.

### Main tools
- Cursor
- Claude Code
- Codex
- ChatGPT
- Terminal agents
- Other specialist agents

### Responsibilities
- Website/code edits
- Campaign structure changes
- Landing page updates
- SEO implementation
- CRO changes
- Report writing
- Workflow editing
- Repo updates

### Principle
Cursor should remain a clean execution environment. It should primarily use local folder context, repo files, `.cursor/rules`, `README.md`, `.cos/context.md`, and generated `.agent/context.md` files.

Cursor should not need to call Hermes/gbrain for every chat.

## Layer 9: Memory Retrieval Layer

### Primary role
Help agents find the right context across many repos, clients, projects, and historical decisions.

### Main tool
- gbrain

### Responsibilities
- Hybrid search
- Scoped retrieval
- Cross-project synthesis
- Context compression
- Gap analysis
- No context bleed between clients/projects
- Retrieval of old decisions, lessons, and follow-ups

### Principle
gbrain should be added when search and cross-project synthesis become painful. It should index and synthesize the source of truth, not replace it.

## Layer 10: Visual Dashboard / Command Centre Layer

### Primary role
Give humans a high-level view of what is happening across clients and projects.

### Possible tools
- Affine
- Dashboards
- BI tools
- Future COS UI

### Responsibilities
- Client overview
- Project status
- Data readiness
- Open follow-ups
- Overdue reviews
- Active experiments
- Recent decisions
- Links to repos, reports, workflows, and boards

### Principle
This layer should summarize and link back to the underlying source-of-truth and data layers. It should not become the only place where work exists.

## Layer 11: Access Control and Scaling Layer

### Primary role
Allow the system to scale to employees, consultants, clients, and contractors without exposing unnecessary data.

### Main surfaces
- GitHub permissions
- Affine workspace permissions
- n8n credentials
- Data source credentials
- Future gbrain/Hermes scopes

### Responsibilities
- Access by business
- Access by client
- Access by project
- Access by task/workstream
- Access by data source
- Separation between internal and client-facing information

### Principle
All access control should follow the same hierarchy: business → client → project → workstream/task.

## Practical Layer Flow

Example AirBuddy Meta Ads optimization flow:

```text
Affine planning board
→ structured task spec
→ Hermes reviews and plans
→ n8n creates folders/workflows
→ GitHub stores docs/context/changelogs
→ n8n pulls Meta/GA4/WooCommerce data
→ data lands in data layer
→ AI creates weekly Markdown analysis
→ Hermes flags follow-ups
→ Cursor/Claude/Codex executes changes
→ changelog and decisions are updated
→ next report compares before/after impact
```

## Current Build Priority

The recommended build order is:

1. Strengthen GitHub Markdown source-of-truth templates.
2. Define structured task specs.
3. Create one AirBuddy pilot flow.
4. Use n8n to create folders/docs and pull weekly data.
5. Generate Markdown analysis reports.
6. Keep Cursor as the main execution layer.
7. Add Hermes only when coordination becomes valuable.
8. Add gbrain only when retrieval and cross-project memory become painful.

## Current Status

This is a design note only. These layers describe the intended modular architecture and should guide future implementation decisions.
