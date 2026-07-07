# packages/api/src/modules/docs — AGENTS.md

Knowledge base module (M3-01): per-scope documents with markdown as canonical body. Revisions preserved (last 50), soft archive, slug uniqueness per scope with auto-suffix on derived slugs. Agents + HTTP + (future UI) all use the same service layer. M8-01 adds wikilink extraction/backlinks and deferred semantic embeddings.

## Purpose
Markdown-canonical documents for scopes. Supports save (upsert by slug), get, list (excludes archived), rename, archive (soft), revisions + revert. All mutations emit kernel events. Viewer/editor/agent grants control access.

## Tables (in packages/db)
- `documents` (new):
  - id (uuid pk)
  - scope_id (fk scopes, cascade)
  - slug (text not null; [a-z0-9-]+ ; unique per scope_id)
  - title (text not null)
  - body_md (text not null default '')
  - position (int not null default 0)
  - created_by, updated_by (fk principals)
  - created_at, updated_at (timestamptz)
  - archived_at (timestamptz nullable) — soft delete; list excludes by default
  - unique: documents_scope_slug_unique on (scope_id, slug)
  - idx: documents_scope_updated_idx
- `document_revisions`:
  - id, document_id (fk cascade), title, body_md, saved_by (fk), created_at
  - Pruned to last 50 on each append.
- `doc_links`:
  - from_document_id, to_scope_id, to_slug, to_document_id nullable, created_at
  - Replaced for the source document on every save/revert; unresolved target documents are allowed.
- `embeddings`:
  - Entity-level semantic embedding rows for docs/records. Docs enqueue embedding refresh after save/revert; the embedding library owns upsert/hash-skip/fail-open behavior.

Exports from `@companyos/db`: documents, documentRevisions, Document, DocumentRevision, New* types.

## Contract / Functions
All take `db: DB` first. Re-exported from `@companyos/api`.

- `saveDoc(db, {scopePath, slug?, title, bodyMd?}, actor)`: editor/agent. Slug defaults to slugify(title) with -2/-3 suffix on collision for auto case. Upsert by (scope,slug). Appends revision + prune. Emits `doc.saved`.
- `extractLinksForDocument(db, documentId, actor?)`: replaces that document's `doc_links` rows from wikilinks. Same-wiki links use `[[slug]]`; cross-wiki links use `[[scope-path:slug]]`.
- `getDoc(db, {scopePath, slug}, actor)`: viewer. Returns full or null. (returns archived too)
- `getBacklinks(db, {scopePath, slug}, actor)`: viewer. Returns source docs that link to the target slug in that scope.
- `getLinkGraph(db, {scopePath}, actor)`: viewer. Returns nodes and edges for docs in the requested subtree; `root` means the whole instance.
- `listDocs(db, {scopePath, includeArchived?}, actor)`: viewer. Returns {id,slug,title,updatedAt}[] ordered by position then title. Excludes archived unless flag.
- `renameDoc(db, {scopePath, slug, newTitle?, newSlug?}, actor)`: editor/agent. Changes title and/or slug (validates unique on change). Emits `doc.renamed`.
- `archiveDoc(db, {scopePath, slug}, actor)`: editor/agent. Sets archived_at. Emits `doc.archived`. No hard delete.
- `listRevisions(db, {scopePath, slug, limit?}, actor)`: viewer.
- `revertDoc(db, {scopePath, slug, revisionId}, actor)`: editor/agent. Restores title+body from rev, appends as new rev, emits `doc.reverted`.

Uses kernel: getScope, requireAccess (viewer read, editor+agent write), emitEvent.

Slugify: lower, [a-z0-9-]+ only, collision suffix only on defaulted slug from title.

## Files
- `src/modules/docs/service.ts`
- `src/modules/docs/AGENTS.md`
- `src/modules/docs/docs.test.ts`
- Semantic/link tables: `packages/db/src/schema/documents.ts`, migration `0018_semantic_layer.sql`
- Updated: `packages/db/src/schema/documents.ts`, `packages/db/src/schema/index.ts`, new migration 0006, `packages/api/src/errors.ts` (DocumentNotFoundError), `packages/api/src/index.ts`, `packages/mcp/src/server.ts`, `packages/mcp/AGENTS.md`, HTTP routes under apps/os/src/app/api/v1/docs/

## How to test
- `pnpm --filter @companyos/api test`
- `pnpm test`
- `pnpm typecheck && pnpm lint`

Tests cover: migrations, access matrix, save/get/list roundtrip (byte exact md), slug collision suffix, revisions prune+revert, archive hides from list, rename, events emitted, wikilink extraction/update/removal, backlinks, graph access control, MCP tools, HTTP handlers.

## Key behaviors
- Markdown body is canonical; roundtrips exact.
- Every mutation emits event (doc.saved / renamed / archived / reverted).
- Slug unique enforced at DB + logic.
- Archive is soft; get and revert can target archived; list default hides.
- Access: viewer for read/list/get/revisions; editor/agent for save/rename/archive/revert.
- Agent grants work via subtree inheritance.
- Invalid slug on provided throws or normalizes for auto.
- Revisions always append on save and on revert.
- Save/revert extracts `[[slug]]` and `[[scope-path:slug]]` links into `doc_links`.
- Save/revert queues a deferred document embedding refresh through `lib/embeddings.ts`; LiteLLM failures must not fail document writes.

## Do not
- No UI editor (M3-02), no file sync, no attachments/embeds.
- Never touch other module schemas or docs/ folder.
- No direct DB access outside services.
- Update this AGENTS.md with any behavior change.

## Usage
```ts
import { saveDoc, getDoc, listDocs, renameDoc, archiveDoc, listRevisions, revertDoc } from "@companyos/api";
const d = await saveDoc(db, { scopePath: "acme", title: "Overview", bodyMd: "# Hello\n\n..." }, principal);
const got = await getDoc(db, { scopePath: "acme", slug: d.slug }, principal);
const list = await listDocs(db, { scopePath: "acme" }, principal);
await renameDoc(db, { scopePath: "acme", slug: "overview", newTitle: "Company Overview" }, principal);
await archiveDoc(db, { scopePath: "acme", slug: "overview" }, principal);
const revs = await listRevisions(db, { scopePath: "acme", slug: "overview" }, principal);
await revertDoc(db, { scopePath: "acme", slug: "overview", revisionId: revs[1].id }, principal);
```
