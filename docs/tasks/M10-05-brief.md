# M10-05 — Self-docs (cos-* product manual) & seeding polish + wiki ops metric

*Implementer brief. Closes M10 (docs/tasks/M10-living-wiki-overview.md §152-154,
decisions 11 + 12). Line refs verified against main after #37/#38. Read this brief +
the touched modules' AGENTS.md. Implement exactly this, nothing else. Do NOT commit.*

## Part 1 — cos-* self-doc pages (decision 11)

Ship a product manual as wiki pages in the ROOT wiki of every instance, so "how do I
mint a token?" gets a cited answer from Ask OS through the standard retrieval path
(no new retrieval machinery — root wiki pages are already embedded + recalled).

1. **Content + seeder**: new `packages/api/src/modules/docs/self-docs.ts`:
   - Page content as exported TS constants (markdown strings), one per page. Author
     the content by DISTILLING these repo sources — accurate to what exists, no
     invented features, each page = lede definition + `##` sections + a `## Sources`
     section listing `- shipped: cos self-docs (CompanyOS <date>)`:
     - `cos-orientation` — what CompanyOS is: scopes tree, principals, grants,
       events, records, modules. Sources: `COMPANYOS-PRIMER.md`, `docs/DESIGN.md` §1-2.
     - `cos-wiki` — how the wiki works: pages/revisions, verify + unreviewed,
       Follow + page-update notifications, personal wikis, citations, attention
       proposals. Sources: `docs/patterns/WIKI.md`, `docs/NOMENCLATURE.md`.
     - `cos-agents` — how agents work in the OS: MCP connection, `get_context`,
       `recall_memory`/`search` + citations, gardening tools, wrap-ups. Sources:
       `packages/mcp/AGENTS.md`, `docs/DESIGN.md` §6.
     - `cos-tokens` — Connect: minting worker tokens, roles/grants, expiry.
       Sources: the Connect/tokens module AGENTS.md (`apps/os/src/modules/`) +
       `docs/NOMENCLATURE.md` Connect section.
     - `cos-vault` — credential rules: names in wiki/docs, values ONLY in the
       vault, agent read path, audit events. Sources: `packages/api` vault module
       AGENTS.md, `docs/patterns/WIKI.md` secrets rule.
     - `cos-attention` — Things to resolve: item kinds, approve/reject/dismiss,
       Following section, decision records. Sources: attention module AGENTS.md
       (api + apps/os).
   - `ensureSelfDocs(db)`: idempotent — for each page, if a doc with that slug does
     NOT exist in the root scope, `saveDoc` it as the system actor (mirror how
     `createSystemRecord` resolves its principal — see its use at
     `packages/api/src/modules/intake/service.ts:867`). **Seed-if-missing only; never
     overwrite an existing page** (admins may edit them; refresh policy is a later
     decision). Returns `{created: string[]}`.
2. **Boot hook**: `apps/os/src/instrumentation.ts` (new, Next.js `register()`):
   dynamic-import the api and call `ensureSelfDocs` once at server start. Guard it:
   skip when `DATABASE_URL` is unset; try/catch + `console.error` — a seeding
   failure must NEVER block boot. (This covers dev servers and staging deploys.)
3. **Conventions**: document the `cos-*` reserved namespace in `docs/patterns/WIKI.md`
   under root wiki reserved pages (alongside `scope-map`/`critical-facts`).

## Part 2 — wizard seeding polish (decision 12)

In `packages/api/src/modules/intake/service.ts` (seeding block :833-:856):

1. **Skip empty seeds**: a proposed doc/wiki seed whose bodyMd is empty/whitespace
   is skipped (currently saved as an empty page).
2. **Provenance**: seeded wiki pages get a `## Sources` section appended when missing:
   `- extracted: intake packet (<ISO date>)` — mirrors the WIKI.md provenance
   convention (see `ensureWikiPageBody` in `packages/brain/src/engine.ts` for the
   pattern; do not import brain from api — reimplement the small helper locally).
3. **Day-one overview stub**: after provisioning, if the scope is a project and has
   no `overview` page, seed a stub from the packet (title = "Overview", lede from the
   packet's goal/`packet_md` first paragraph) with a Sources line
   `- extracted: intake packet (<date>)`. The brain's `distillProjectOverview`
   maintains it thereafter (it upserts the same reserved slug).

"Start from scratch" (no intake packet) remains untouched and valid.

## Part 3 — wiki-contributions/day ops metric

1. `packages/api/src/modules/health/service.ts`: extend `getOpsHealth` (:681) result
   with `wikiContributions: Array<{ date: string; saves: number; verifies: number }>`
   for the last 14 days — counted from the `events` table (`doc.saved` /
   `doc.verified` by `created_at` day, instance-wide). One grouped SQL query; no new
   tables, no migration.
2. `apps/os/src/app/(app)/admin/health/page.tsx`: render it as a compact
   "Wiki contributions (14d)" block — date, saves, verifies rows (module's existing
   table styles); show a muted "No wiki activity yet." when all zero.

## Don't

- No new tables, columns, enums, or migrations.
- No skills-repo coupling for cos-* content (it ships in code, not via sync_skills).
- No overwrite/refresh of existing cos-* pages; no admin UI for them.
- No changes to the brain engine besides nothing at all (Part 2's helper is local to
  the intake module).
- No renaming or moving of existing intake seeding behavior beyond the three items.
- Do not commit. Do not apply anything to a live DB.

## Acceptance criteria

1. `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
2. Fresh DB + `ensureSelfDocs`: 6 cos-* pages exist in the root wiki; second call
   creates nothing and adds no revisions (test both).
3. Retrieval test: the existing search/recall test harness finds `cos-tokens` for a
   token-minting query and the hit carries the standard citation shape.
4. Intake approval with an empty-body seed skips it; seeded wiki pages contain a
   Sources line; project intake yields an `overview` stub (tests).
5. `getOpsHealth` returns 14 `wikiContributions` rows with correct counts for
   seeded events (test); /admin/health renders the block.
6. AGENTS.md updated in the same change for every touched module (docs api module,
   intake, health, apps/os admin) + `docs/patterns/WIKI.md`.
7. Report every file changed. On limits print `LIMIT-ALERT:` and stop.
