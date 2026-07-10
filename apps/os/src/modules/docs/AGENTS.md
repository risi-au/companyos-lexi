# apps/os/src/modules/docs - AGENTS.md

KB editor UI (M3-02 + UX-07): Docs tab on scope pages. Document read surface plus right-column list and explicit BlockNote edit mode. Markdown canonical roundtrips via M3-01 services in packages/api. Human + agent edits share the same documents.

## Purpose
Provide read-first per-scope KB documents with explicit Notion-style rich editing using BlockNote (shadcn view). List, create, rename (double-click), archive, history/revert, autosave/manual save. Read-only for viewer role. All writes via server actions -> service layer (principal resolved server-side). Styling strictly via design tokens.

## Files
- `DocsView.tsx`: document center column + grouped right-column list. Client component. Handles list, selection via ?doc=, new dialog, inline rename, archive confirm, history popover + restore. Pins the `wiki` slug doc first (distinct icon/accent) per docs/patterns/WIKI.md; shows an "Inherited wiki from <ancestor path>" banner linking the ancestor's doc index when the current scope has no wiki of its own (M6-09). Selected row is derived from the loaded document.
- `DocEditor.tsx`: read mode by default, parses frontmatter into quiet metadata chips and moves trailing `## Sources` into a collapsed footer accordion. Edit mode uses BlockNote @blocknote/shadcn, md->blocks on load (tryParseMarkdownToBlocks), blocks->md on change (blocksToMarkdownLossy) + 1.5s debounced autosave via action, manual Save, and Done. No-op manual saves keep the original markdown bytes. Respects readOnly.
- `actions.ts`: "use server" thin wrappers calling api.* (getCurrentActorPrincipalId + bound services). Revalidate on mutates. `getInheritedWikiAction` resolves the nearest ancestor wiki (M6-09) via `api.findNearestWiki`, returning null when the current scope owns its own wiki.
- `index.ts`: public exports for scope pages.
- `AGENTS.md`: this file.

## Data / Contract
Consumes from `@companyos/api` (via lib/api wrappers):
- listDocs, getDoc, saveDoc, renameDoc, archiveDoc, listDocRevisions, revertDoc
- listDocs rows include additive `createdByKind` for Your docs vs AI-maintained grouping
- resolveAccess for readOnly
- findNearestWiki (M6-09) for the inherited-wiki banner; ancestor-walk, ownership check by `wiki.scopePath === scopePath`

Markdown is source of truth. Read-mode frontmatter and Sources handling is presentation-only. Editor constrained to default schema (markdown-survivable blocks only: no multi-col, images as links).

## Theming
BlockNote CSS vars mapped in apps/os/src/app/globals.css to --background, --surface, --foreground, --muted, --border, --primary (light + dark). Portal overlay vars and opaque menu surfaces are also mapped in packages/ui/src/globals.css so slash/formatting menus inherit theme tokens outside .bn-root. Inter font via core import.

## Usage in scope page
```tsx
import { DocsView } from "@/modules/docs";
// inside tab render:
<DocsView scopePath={scopePath} initialDocSlug={sp.doc} initialAccess={access} />
```

## Testing / Acceptance
- `pnpm typecheck && pnpm lint && pnpm test` (root)
- Roundtrip guard test (apps/os/src/modules/docs/docs.test.ts or co-located): uses BlockNote parse + blocksToMarkdownLossy over fixture (headings, lists, code, table, image link, formatting) in jsdom. Semantic stability asserted.
- Read-mode helper tests cover YAML frontmatter extraction, metadata chip formatting, trailing Sources extraction, and byte-identical no-op save handling.
- Architect browser verification: create, edit rich content, autosave, reload persists; MCP-saved doc (from save_doc) loads and roundtrips after edit; viewer read-only; no clash with tokens.

## Do / Don't
- Only this module's UI (no kernel, no other modules, no schema changes).
- Server actions + api wrappers, never raw db.
- Update this AGENTS.md on any behavioral change.
- Debounced 1.5s + explicit Cmd/Ctrl+S.
- Empty states per brief.
