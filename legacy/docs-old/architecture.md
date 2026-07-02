# COS High-Level Architecture

## Mermaid Diagram

```mermaid
flowchart TB
    subgraph Interfaces["Interfaces (Zero Lock-in)"]
        D[Discord<br/>Channels + Threads<br/>per scope]
        C[Cursor / Terminal<br/>in any folder]
        A[Affine<br/>Visual SSOT + Canvas]
        Future[Future Frontends]
    end

    subgraph Orchestrator["Hermes Agent Orchestrator"]
        H[Hermes Core<br/>Model/Provider Routing<br/>Skills + Sub-agents<br/>Self-improving]
        HS[Hindsight<br/>Retain / Recall / Reflect<br/>Experiential Learning]
    end

    subgraph PersistentLayer["Persistent Layer (Scoped, No Bleed)"]
        GB[gbrain<br/>Postgres + pgvector<br/>Git MDs as Source of Truth<br/>MCP Server + Hybrid Search<br/>Synthesis + Gap Analysis + Dream Cycle]
        GH[GitHub Repos<br/>Per Business<br/>Nested + .cos/ templates]
        AF[Affine<br/>Docs + Infinite Canvas + DBs<br/>Visual Processes + Onboarding]
    end

    subgraph Automation["Automation + Tools"]
        N8N[n8n<br/>Visual Workflows + Scheduling]
        MCP[MCP Ecosystem<br/>GitHub, Filesystem, Meta API, etc.]
    end

    D -->|Scoped message + metadata| H
    C -->|cos-load-context or .agent/context.md| H
    A -->|Webhooks / Agent calls| H
    Future -->|Adapter| H

    H <-->|MCP calls| GB
    H <-->|Skills + HTTP| N8N
    H <-->|API / MCP / Git| GH
    H <-->|Webhooks / API| AF
    HS <-->|Retain/Recall/Reflect| H

    GB <-->|Sync + Capture| GH
    AF <-->|Sync / Export| GH
    N8N -->|Triggers + Updates| H
    N8N -->|I/O + Simple nodes| MCP

    classDef core fill:#e0f2fe,stroke:#0369a1
    class H,GB,AF,N8N core
```

## Data Flows (Key)
- Context load (any interface) → Hermes → scoped gbrain `think`/search + Hindsight recall + local MDs → synthesized efficient chunk → back to interface or `.agent/context.md`
- Task/automation → Hermes (scope-aware) → tools/MCP (Meta, git, gbrain write) → updates to Git + gbrain + Affine → Hindsight reflect
- Nightly: gbrain dream cycle (enrichment, dedup) + Hermes scheduled jobs

## Integration Summary
**Hermes + gbrain + Hindsight** form the central persistent intelligence layer with perfect scoping (no context bleed between businesses/clients/projects).

See full proposal for detailed integration mechanics.