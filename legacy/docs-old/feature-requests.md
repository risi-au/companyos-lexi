# COS Feature Requests & Future Design Notes

This document captures emerging product/design ideas that should be considered before implementation. These are not yet implemented unless explicitly marked otherwise.

## 1. Visual Planning Layer with Affine

### Goal
Use Affine as a visual planning surface where a user can open a client/project workspace, create a new task, sketch relationships, add structured context, and then ask the COS planning agent to create the required downstream assets.

### Desired User Experience
Example flow:

1. User opens a client workspace such as `AirBuddy` in Affine.
2. User creates a new task or planning board, such as `Meta Ads Weekly Optimization`.
3. User maps the work visually using notes, arrows, docs, canvases, links, and structured task fields.
4. User triggers `Chat with Hermes` or `Send to COS Planner`.
5. Hermes reads the Affine task/board context.
6. Hermes decides what needs to be created for the next layers.
7. n8n/GitHub automation creates the appropriate repo folders, task docs, context files, workflow skeletons, report templates, and follow-up tracking.
8. Hermes writes links/status back to Affine so the visual board remains the human-facing command centre.

### Important Principle
Affine should be the visual planning and strategy layer, not the primary backend or raw analytics database.

The scalable pattern should be:

```text
Affine = visual planning and human command centre
Hermes = planning/coordinator agent
n8n = deterministic automation and scheduled workflows
GitHub Markdown = source of truth for context, decisions, changelogs, and agent handoff
Database/warehouse = structured performance data
Cursor/Claude/Codex/ChatGPT = execution agents
```

## 2. Hermes Planning Agent

### Goal
Hermes should eventually act as a planning/coordinator agent that can turn a human request or Affine board into a standardized COS project/task structure.

### Desired Capabilities
Hermes should be able to:

- Read a structured client/project/task brief.
- Understand scope, business, client, channel, objective, inputs, outputs, and required data sources.
- Select the right COS template for the task type.
- Create or request creation of the correct GitHub repo/folder structure.
- Create `.cos/` context files and agent handoff documents.
- Create or request n8n workflow skeletons.
- Create report templates and recurring review cadence.
- Create follow-up tasks and change tracking.
- Write summary/status links back to Affine.
- Avoid forcing every Cursor chat through Hermes.

### Initial Scope
Hermes should not be built as an all-powerful always-on brain at the start. The first practical role should be:

```text
Hermes = planner + coordinator + notifier
```

Not:

```text
Hermes = mandatory gateway for every agent/chat/action
```

## 3. Structured Task Specification

### Problem
Freeform whiteboard drawings are useful for humans but may be unreliable for agents at scale.

### Requirement
Each Affine task/board that should be processed by Hermes must include a structured task specification block.

Example:

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

## 4. Automated Project/Task Creation

### Goal
From a structured task request, COS should automatically create the necessary working environment.

### Desired Outputs
Depending on task type, the system may create:

- GitHub repo or folder structure.
- `README.md` project/task hub.
- `.cos/context.md` scoped context file.
- `decisions.md`.
- `changelog.md`.
- `reports/` folder.
- `reports/YYYY-MM-DD-analysis.md` template.
- n8n workflow skeleton.
- data source checklist.
- execution prompt for Cursor/Claude/Codex.
- Affine status section with links back to created assets.

### Example Output Structure

```text
clients/airbuddy/meta-ads/weekly-optimization/
├── README.md
├── .cos/context.md
├── decisions.md
├── changelog.md
├── data-sources.md
├── reports/
│   └── YYYY-MM-DD-weekly-analysis.md
└── prompts/
    └── execution-agent.md
```

## 5. Data, Monitoring, and Optimization Loop

### Goal
Use COS to track not just tasks and decisions, but performance changes, follow-ups, and optimization opportunities.

### Example AirBuddy Loop

```text
n8n pulls weekly data
→ data lands in database/sheets/warehouse
→ AI generates analysis markdown
→ Hermes flags what needs attention
→ user selects/approves action
→ Cursor/Claude/Codex executes changes
→ changelog and decisions are updated
→ next report compares before/after impact
```

### Desired Data Sources
For marketing clients like AirBuddy, the system may connect:

- Meta Ads
- Google Ads
- GA4
- WooCommerce
- SEO tools
- landing page/CRO tools
- CRM/email platforms

### Principle
Raw performance data should live in a structured data store, while GitHub Markdown should store interpretation, decisions, changelog, and agent-readable context.

## 6. Cursor as Execution Layer

### Goal
Cursor should remain simple and useful as the main execution environment.

### Principle
Do not force every Cursor chat through Hermes/gbrain.

Cursor agents should primarily use:

- current folder context
- repo files
- `.cursor/rules`
- `README.md`
- `.cos/context.md`
- generated `.agent/context.md` when useful

Hermes/gbrain should be used only when broader project/company memory is required, such as cross-client comparisons, older decisions, overdue follow-ups, or company-wide monitoring.

## 7. gbrain as Later Retrieval Layer

### Goal
gbrain should not replace GitHub Markdown as source of truth.

### Role
gbrain should later provide:

- hybrid search across company/project memory
- scoped retrieval with no context bleed
- synthesis of large context into concise agent handoffs
- gap analysis
- recurring memory/dream-cycle style cleanup

### Principle
Start with GitHub Markdown as memory. Add gbrain when search, scale, or cross-project synthesis becomes painful.

## 8. Access Control and Scaling

### Goal
The system should support future employees, consultants, and role-based access without becoming messy.

### Requirements
Eventually support access by:

- business
- client
- project
- channel/workstream
- task folder
- data source
- automation workflow

### Principle
GitHub repo permissions, Affine workspace permissions, n8n credentials, and future gbrain scopes must align around the same client/project/task hierarchy.

## 9. Open Questions

These need to be resolved before implementation:

1. Should the first working trigger be `Chat with Hermes` or an Affine/n8n form/button?
2. What Affine export/API path is reliable enough for Hermes to read board content?
3. Can Hermes write back into Affine directly, or should it write a summary/link block through automation?
4. Should each client have one repo with folders, or should larger clients get multiple repos?
5. What is the minimum structured task spec required before automation runs?
6. Which task type should be the pilot: AirBuddy Meta Ads, AirBuddy CRO, AirBuddy SEO, or another project?
7. Which data store should hold raw performance data first: Postgres, BigQuery, Supabase, Google Sheets, or another warehouse?
8. How much automation is allowed before human approval is required?

## 10. Recommended Pilot

Use AirBuddy as the first pilot.

Pilot scenario:

```text
AirBuddy → Meta Ads Weekly Optimization
```

Pilot success criteria:

- A structured task spec can be created.
- The system creates the right GitHub folders/docs.
- n8n can pull or receive weekly performance data.
- AI can create a weekly analysis markdown report.
- Recommended actions are tracked.
- Cursor/Claude/Codex can execute from the generated context.
- Changelog and decisions are updated after execution.
- Next weekly report can compare before/after impact.

## Status

Current status: feature request / design note only.

These capabilities are not yet implemented in the current repository. The current COS repo contains the architecture, templates, initial setup files, and implementation direction, but the Affine-to-Hermes-to-GitHub/n8n automation layer still needs to be designed and built.
