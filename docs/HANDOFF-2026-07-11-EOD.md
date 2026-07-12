# Handoff — 2026-07-11 EOD (autonomous run: M10-03/02/04A/06 ALL MERGED)

*Next session: read this + `ONBOARDING.md`. Auto-memory has the same facts compressed.*

## Shipped / merged (owner authorized "merge all PRs" end of session)

- **#33 M10-03 citations + agent gardening** — main, staging deployed green.
- **#34 M10-06 confirmed renames** (grok-implemented) — Wiki tab, Connect three-way
  split, NOMENCLATURE.md §0 ratification + full audit report committed.
  **Owner still to rule on:** 10 ambiguous strings + 3 candidate renames in
  `docs/tasks/M10-06-audit-report.md`.
- **#35 M10-02 personal wikis** — personal scope type (migration 0025, applied to
  local dev DB post-merge), admin-proof mediation (resolveAccess personal
  short-circuit; agent-kind+root-grant carve-out = the brain), recall union with
  `source: "personal"`, brain person-vs-work routing + two-way graduation
  proposals, wizard personal context.
- **#36 M10-04A wiki surface** — structured Form|Markdown editor, outline,
  backlinks panel, verify + unreviewed badges, aliases, wikilink rendering,
  subtree browsing. Playwright-verified. Known cosmetic nit: leading `# H1` shows
  in the form's Definition field (content-safe; fold into title in a polish pass).

**main = `d91d033`** (merge order #34 → #35 → #36, all clean). Gates re-run on the
combined main by the architect. Release workflow redeploys staging per merge —
verify the final run is green next session (migration 0025 applies there via the
pipeline).

## Next work: M10-04B, then M10-05

**M10-04B** = per-page Following + notifications + brain-maintained project
overview page. FIRST STEP IS A DESIGN CALL WITH THE OWNER (flood control:
follow-notifications must not swamp "Things to resolve" — decide: new
`attention_kind` value like `page_update` with dismiss-only semantics, vs a
separate digest surface, vs get_context-banner-only). The M10-04 Explore pass
already pinned the substrate (no re-explore needed):

- NO follow/subscribe/notification/digest machinery exists anywhere.
- `doc_follows` table slots into `packages/db/src/schema/documents.ts` next to
  `docLinks` (~:97-116 pattern): `(documentId, principalId, createdAt)` + unique.
- Doc events to hook (docs service emits): `doc.saved` (:266), `doc.renamed`
  (:580), `doc.archived` (:634) — payloads carry `{slug,title,documentId}`; note
  there is NO event-subscriber/worker framework — fan-out must be inline in the
  service fns or a brain-style consumer.
- `attention_kind` is a pg enum (`wiki_proposal|lint_finding|graduation|
  external_gate`) — a notification kind needs a migration (plain SQL ADD VALUE).
- Brain project overview page: mirror `distillRoot` (packages/brain/src/engine.ts
  :839-929) per top-level project inside the `targetTopLevelScopes` loop
  (:434-465); reserved slug e.g. `overview`; digest inputs already exist in
  `collectInputs` (:679-708, records + filtered events since watermark).
- M10-04A left `doc.verified` as a new event — include it in follow triggers.

Then **M10-05 self-docs & seeding** (cos-* page set, wizard/mirror seeding polish,
wiki-contributions/day ops metric) closes M10. M11 external integrations is next
milestone (overview committed).

## Environment state

- **Dev server**: :3000 + :3001 run from the MAIN folder. LANDMINE: `next dev`
  only auto-loads env from `apps/os/.env` (NOT repo root) — that file now exists
  (gitignored copy of root `.env`); recreate it in any worktree that serves the app.
- **Worktrees**: ALL removed; only the main folder remains (`git worktree list` =
  main @ d91d033). Remote branches task/M10-03|M10-02|M10-04|audit/M10-06-terms
  still exist on origin (classifier blocks architect deleting them; harmless).
- **Local dev DB**: migrations through 0025 applied; drizzle bookkeeping healthy.
  RULE: a hand-applied migration must also get its bookkeeping row (`hash` =
  sha256 of the .sql text, `created_at` = journal "when"), or the next
  `pnpm db:migrate` dies re-running it. verify-bot login works.
- **Staging**: current with `d91d033` — the final Release run (M10-04A merge)
  deployed green, migration 0025 applied via the pipeline. Nothing to verify.
- **Incident note**: mid-session, ALL background tasks got externally killed at
  once (cause unknown); the detached codex process survived but its sandbox helper
  broke → codex stopped cleanly mid-M10-04A. Recovery that worked: re-dispatch in
  the SAME worktree with "partial work exists, do NOT revert, git diff first,
  complete + verify". Check `Get-Process codex` + StartTime before assuming a run
  died with its wrapper.

## Owner items

Rule on the 10 ambiguous renames + 3 candidates (docs/tasks/M10-06-audit-report.md)
· M10-04B design call (notification delivery — first step of next session) · vault
e2e walkthrough · Nutrition Warehouse pilot report · M5-05/M9+ discussions.
