# M7-01: Wiki gardener (records → wiki distiller capability)

status: SUPERSEDED by M8 (2026-07-07) — absorbed into the native knowledge engine, no
n8n, no pilot client. See docs/tasks/M8-second-brain-overview.md and M8-02.
module: capability (infra/n8n workflow + central skills repo + capability registration) —
no OS app code expected
branch: task/M7-01

## Goal

A scheduled capability that keeps each scope's wiki true without human effort: it reads
new records across a top-level scope's subtree, distills durable knowledge into the wiki
topic pages per docs/patterns/WIKI.md, repairs structure (index links, duplicate pages,
dead references), and reports every run. This is the "day-dreaming" layer that makes the
OS connect work done months apart. Pilot on ONE client before fleet-wide.

## Context

- docs/patterns/WIKI.md — the contract; the gardener's prompt IS this document.
- M6-09: search + subtree record listing (M6-08) give the gardener its inputs; save_doc /
  get_doc / list_docs (existing) are its outputs. get_context surfaces its work.
- M6-05: sessions already update wiki pages at wrap-up — the gardener is the safety net
  for what sessions miss, not the only mechanism.
- M7-02: GitHub/workbench ingestion is the upstream safety net for sessions that changed
  files but failed to write a complete changelog. The gardener consumes the records it
  creates the same way it consumes agent-authored records.
- Capabilities registry + alert pattern (docs/patterns/ALERTS.md): register per scope,
  scoped agent token, report_run each execution, alert on failures.
- LiteLLM: virtual key per capability = budget cap + cost tracking; role alias
  (`analysis` or `cheap` — tune during pilot), never a vendor name.
- Precedent for committed workflows: infra/n8n/demo-metrics-pull.json + README.

## Do

1. **Skill** (central skills repo, synced via skills module): `wiki-maintenance`
   SKILL.md — scope_pattern `**`, domain `knowledge`. Body: the WIKI.md contract restated
   as operating instructions (placement rules, update-in-place, Sources sections, index
   repair, graduation respect) PLUS the memory-precedence rule (CompanyOS authoritative;
   vendor tool memory = personal preferences only — same block as the M6-05 managed
   template).
2. **n8n workflow** (committed to infra/n8n/ + README section), per top-level scope:
   - Schedule (start: daily, off-peak).
   - Determine "new since": last successful run's finished_at from capability runs
     (HTTP list or stored workflow state) → list_records with `since` +
     includeDescendants over the scope subtree.
   - No new records → report_run success with "nothing to distill", stop (cheap no-op).
   - Else: LLM step via LiteLLM (capability's virtual key, role alias) with the skill
     body + current wiki index + affected topic pages + new records → proposed page
     updates (update-in-place, cite record ids).
   - Apply via save_doc (docs revisions preserve every prior state — safe by
     construction); never delete docs (archive at most, and only for exact-duplicate
     merges).
   - report_run with summary (pages touched, records distilled, tokens/cost if
     available); alert (severity warning) on LLM/API failure per ALERTS.md.
3. **Registration**: register_capability name `wiki-gardener` on the pilot top-level
   scope; dedicated scoped agent token (editor-equivalent agent role, that scope only);
   LiteLLM virtual key with a hard monthly budget cap.
4. **Pilot criteria** (owner + architect review after ~2 weeks on the pilot client):
   pages read as current truth; no duplicate/orphan pages introduced; Sources sections
   cite real record ids; cost within cap; then template the workflow for other clients.

## Don't

- No OS module/schema/MCP changes — if the gardener needs a missing primitive, STOP and
  brief it separately.
- No deletion of docs or records, ever.
- No fleet-wide rollout before pilot sign-off.
- No vendor-named models in the workflow — role aliases only.
- Don't run against scopes without a wiki index page — create the index first (manual or
  first-run bootstrap step that only creates `wiki` if absent).

## Acceptance criteria

- [ ] Skill synced and visible via list_skills on the pilot scope
- [ ] Workflow JSON + README committed; importable; schedule + manual trigger both work
- [ ] Run with no new records → success report, no LLM call, no doc writes
- [ ] Run with fixture records → topic page updated in place with Sources citing the
      record ids; index updated if a new page was created
- [ ] Failure path emits alert.fired (warning) and a failed run report
- [ ] Capability visible in OS with run history; budget cap set on the virtual key
- [ ] Two-week pilot review passed on the pilot client (owner sign-off recorded as a
      decision record on that scope)
