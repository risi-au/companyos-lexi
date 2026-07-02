# M3-01: Knowledge base module (documents, markdown-canonical)
status: todo
module: docs (KB)
branch: task/M3-01

## Goal
Per-scope documents with markdown as the canonical format: agents read/write docs via MCP + HTTP, revisions preserved, ready for the BlockNote editor UI (M3-02) and workbench `.md` sync (M4).

## Context
- `docs/DESIGN.md` §2 item 5 (KB), §5 (`documents` + revisions), §6 (docs tool group). Markdown-canonical is a load-bearing decision: body is always markdown text; no HTML storage.
- Module pattern identical to records/metrics/dashboards (schema+migration, service, AGENTS.md, PGlite tests, events, kernel access: editor/agent write, viewer read).

## Do
1. Schema `packages/db/src/schema/documents.ts`: `documents`: id, scope_id FK cascade, slug text (unique per scope, `[a-z0-9-]+`), title text, body_md text default '', position int default 0, created_by FK principals, updated_by FK principals, created_at, updated_at; unique(scope_id, slug). `document_revisions`: id, document_id FK cascade, title, body_md, saved_by, created_at (keep last 50, prune). Migration.
2. Service `packages/api/src/modules/docs/service.ts`:
   - `saveDoc(db, {scopePath, slug?, title, bodyMd}, actor)` — upsert by (scope, slug) where slug defaults to slugified title; editor/agent; revision append + prune; emits `doc.saved`.
   - `getDoc(db, {scopePath, slug}, actor)` — viewer.
   - `listDocs(db, {scopePath}, actor)` — viewer; id/slug/title/updated_at ordered by position then title.
   - `renameDoc(db, {scopePath, slug, newTitle?, newSlug?}, actor)` — editor/agent; emits `doc.renamed`.
   - `archiveDoc(db, {scopePath, slug}, actor)` — soft: add `archived_at` timestamp column; hidden from listDocs by default; emits `doc.archived`. (No hard delete — KB is knowledge.)
   - `listRevisions` / `revertDoc` — same pattern as dashboards.
3. MCP tools: `save_doc`, `get_doc`, `list_docs` (+ optional revert via existing pattern if trivial). Update mcp AGENTS.md.
4. HTTP: `POST /api/v1/docs/save`, `GET /api/v1/docs?scope=&slug=` route handlers (same bearer pattern as metrics/records; remember /api/v1 is middleware-exempt already).
5. Tests: upsert-by-slug, slugify collisions (-2 suffix), revisions + prune + revert, archive hides from list, access control, events, MCP + HTTP round-trips.

## Don't
- No editor UI (M3-02). No workbench file sync (M4). No embeds/attachments yet.
- Don't touch other modules, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Markdown round-trips byte-exact through save→get (MCP and HTTP, tested)
- [ ] Slug uniqueness per scope with collision suffixing (tested)
- [ ] Revisions prune at 50; revert works; archive soft-hides (tested)
- [ ] Access control + events on every mutation
