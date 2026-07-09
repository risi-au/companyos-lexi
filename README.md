# CompanyOS

**A self-hosted, AI-native system of record for running businesses.** Work happens anywhere — terminal agents, chat tools, ad platforms, local folders. CompanyOS is the one place that knows everything: what exists, what changed, what's pending, what it cost, and why.

Built as a SaaS, used internally first. Tenant #1 is our own multi-business holding company.

## The idea

> Chats are disposable. Tools are disposable. **The record is the asset.**

- **Scope tree** — clients/projects nested to any depth; every node composes its own modules (dashboard, tasks, docs, canvas, metrics, capabilities).
- **Agent-authored dashboards** — dashboards are specs agents write and edit on request.
- **MCP front door** — any agent (Claude, Grok, Hermes, Cursor, n8n, Flowise) pulls scoped context and writes back outcomes: changelogs, decisions, reports, task updates.
- **Own the data** — Postgres + git + markdown. Adopted engines (Plane, n8n, LiteLLM, Flowise) are swappable behind the OS contract.

## Documentation

| Doc | What |
|---|---|
| [COMPANYOS-PRIMER.md](COMPANYOS-PRIMER.md) | Self-contained overview for any agent or human: concepts, modules, MCP surface, doctrine, playbook. Point external agents at this single file |
| [docs/DESIGN.md](docs/DESIGN.md) | The founding design: requirements, components, data model, MCP contract, roadmap |
| [docs/CONSTITUTION.md](docs/CONSTITUTION.md) | Engineering rules (kernel/modules, API-first, events, tokens) |
| [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) | How this gets built (architect + implementer agent loop) |
| [AGENTS.md](AGENTS.md) | Entry point for AI agents working in this repo |

`legacy/` holds the superseded 2025 plan for historical reference.

## Status

Live on staging (https://cos-staging.risi.au, instance #1) at v0.7.x, approaching v0.8.0.
Shipped: the full kernel spine, all core modules (records, docs, canvas, metrics,
dashboards, sessions), MCP server (57 tools), Plane + n8n + LiteLLM integration, brain
engine (nightly wiki maintenance + hybrid search), creation wizard v2, credential vault,
tenant admin, ops health panel, native arm64 release pipeline, nightly encrypted backups.
Next: UX overhaul (UX-01..05), then v0.8.0 and live promotion. `docs/tasks/*.md` status
lines are authoritative; see [COMPANYOS-PRIMER.md](COMPANYOS-PRIMER.md) §10 for detail.
