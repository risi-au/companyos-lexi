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

Pre-M1. See `docs/DESIGN.md` §7 for the milestone roadmap.
