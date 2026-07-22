# M11-01 — Tool-Surface Audit & Conformance Matrix

CompanyOS exposes ONE MCP server for every client (claude.ai, Claude Code, Hermes, Codex,
Cursor). There are no per-platform tool variants. The start/wrap ritual ships in-band: the
server advertises `instructions` on the MCP `initialize` handshake, and exposes two MCP
prompts — `start_task` and `wrap_up` — discoverable on any client supporting the prompts
capability. Per-tool arming and per-platform context files are therefore unnecessary; a
platform recipe is only a connect note plus a row in the conformance matrix below.

## Server instructions

On connect, the server returns the arming ritual as `instructions` (see `SERVER_INSTRUCTIONS`
in `packages/mcp/src/server.ts`): START (whoami ? get_context ? recall_memory ? join/register
session ? list_attention_items), WORK (heartbeat + persist records), WRAP (complete_session
with citations), plus the memory-subordination doctrine (OS wikis authoritative, tool memory
is a cache).

## Prompts

| Prompt | Args | Purpose |
|---|---|---|
| `start_task` | `scope` (required), `goal` (optional) | Renders the arming sequence for the given scope. |
| `wrap_up` | `session_id` (required) | Renders the debrief sequence for the given session. |

## Tool inventory

64 tools registered in `packages/mcp/src/server.ts`.

### Connectivity & identity
| Tool | Access | Purpose |
|---|---|---|
| `ping` | none | Connectivity check; returns pong. |
| `whoami` | any principal | Authenticated principal + explicit grants. |

### Context & memory
| Tool | Access | Purpose |
|---|---|---|
| `get_context` | viewer | Markdown context bundle for a scope. |
| `recall_memory` | viewer | Distilled wiki memory for a scope + root patterns. |
| `search` | viewer | Keyword/semantic/hybrid search over records + docs. |
| `get_tree` | viewer | Indented active subtree paths. |
| `verify_workbench` | viewer | Warn if client cwd ? expected workbench folder. |
| `get_context_profile` | admin | Effective context profile for a scope. |
| `set_context_profile` | admin | Create/update a context profile. |
| `query_usage` | admin | Usage summary of MCP/context overhead. |

### Records
| Tool | Access | Purpose |
|---|---|---|
| `log_change` | editor/agent | Create a changelog record. |
| `log_decision` | editor/agent | Create a decision record. |
| `save_report` | editor/agent | Create a report record. |
| `save_note` | editor/agent | Create a note record. |
| `list_records` | viewer | Compact recent records list. |
| `get_record` | viewer | Full record by id. |

### Sessions
| Tool | Access | Purpose |
|---|---|---|
| `register_session` | editor/agent | Register a cooperative work session. |
| `update_session` | editor/agent | Heartbeat/update a session. |
| `complete_session` | editor/agent | Complete a session with wrap-up summary + citations. |
| `list_sessions` | viewer | List scoped sessions with staleness flags. |

### Tasks
| Tool | Access | Purpose |
|---|---|---|
| `create_task` | editor/agent | Create a Plane-backed task. |
| `complete_task` | editor/agent | Complete a task; optional changelog note. |
| `update_task` | editor/agent | Partial task update. |
| `list_tasks` | viewer | Compact task list. |

### Metrics
| Tool | Access | Purpose |
|---|---|---|
| `write_metrics` | editor/agent | Batch write/upsert metric points. |
| `query_metrics` | viewer | Query metric series. |
| `list_metric_names` | viewer | Distinct metric names. |

### Capabilities & alerts
| Tool | Access | Purpose |
|---|---|---|
| `register_capability` | admin | Register/update a capability. |
| `report_run` | editor/agent | Persist a capability run, optional alert. |
| `list_capabilities` | viewer | Scoped capabilities with latest run. |
| `list_capability_runs` | viewer | Runs for one capability. |
| `list_alerts` | viewer | alert.fired events for a scope. |

### Skills
| Tool | Access | Purpose |
|---|---|---|
| `sync_skills` | root admin | Refresh cached skills from GitHub. |
| `list_skills` | viewer | Matching cached skills (no body). |
| `get_skill` | any principal | One cached skill with body. |

### Docs / dashboards / canvas
| Tool | Access | Purpose |
|---|---|---|
| `save_doc` | editor/agent | Create/update a KB markdown doc. |
| `get_doc` | viewer | Fetch a doc. |
| `list_docs` | viewer | List docs in a scope. |
| `list_doc_revisions` | viewer | Doc revision history. |
| `revert_doc` | editor/agent | Revert a doc to a revision. |
| `rename_doc` | editor/agent | Rename a doc. |
| `archive_doc` | editor/agent | Archive a doc. |
| `get_backlinks` | viewer | Backlinks to a doc. |
| `get_link_graph` | viewer | Wiki link graph. |
| `save_dashboard` | editor/agent | Create/update a dashboard spec. |
| `get_dashboard` | viewer | Fetch a dashboard. |
| `list_dashboards` | viewer | List dashboards. |
| `list_widget_types` | public | Widget vocabulary discovery. |
| `revert_dashboard` | editor/agent | Revert a dashboard. |
| `save_canvas` | editor/agent | Create/update an Excalidraw scene. |
| `get_canvas` | viewer | Fetch a canvas. |
| `list_canvases` | viewer | List canvases. |

### Intake
| Tool | Access | Purpose |
|---|---|---|
| `submit_intake_packet` | editor/agent | External intake return path. |
| `list_intake_packets` | viewer | Intake queue. |
| `get_intake_packet` | viewer | One intake packet. |
| `update_intake_packet` | editor/agent | Pre-approval intake edits. |
| `approve_intake_packet` | admin | Approve an intake packet (no provision). |
| `provision_from_intake_packet` | admin | Provision from an approved packet. |
| `provision_scope` | admin | Deterministic scope onboarding. |

### Attention
| Tool | Access | Purpose |
|---|---|---|
| `list_attention_items` | viewer | Things-to-resolve items for the principal. |
| `resolve_attention_item` | editor/agent | Approve/reject/dismiss an attention item. |
| `resolve_wiki_question` | editor/agent | Resolve a wiki-question (lint_finding) item. |

### Credentials
| Tool | Access | Purpose |
|---|---|---|
| `list_credentials` | viewer | Credential metadata only (never values). |
| `get_credential` | agent/editor/admin/owner | One credential value; emits credential.accessed. |

Total: 64 tools + 2 prompts.

## Conformance matrix

Verified by the owner staging smoke, not by code. All cells start "pending owner smoke".

| Client | Connect | List tools | Run ritual | Join session | Answer attention item |
|---|---|---|---|---|---|
| claude.ai (web) | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke |
| claude.ai (desktop) | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke |
| claude.ai (mobile) | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke |
| Claude Code | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke |
| Hermes | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke |
| Codex | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke |
| Cursor | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke | pending owner smoke |

## Owner smoke checkpoint

The last open issue #53 checkbox: the owner verifies the staging `/api/mcp` endpoint from
claude.ai's custom-connector flow and from Claude Code via the connect wizard — confirming a
fresh client connects over OAuth, lists tools, and is guided start?work?wrap by the server
instructions + prompts without any human-written prompt. This is a human step tracked
separately and does not block the code changes in this shot.