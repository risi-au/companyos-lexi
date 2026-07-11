# apps/os/src/modules/docs - AGENTS.md

Wiki editor UI (M3-02 + UX-07 + M10-04A + M10-04B): Docs tab on scope pages, presented to users as Wiki pages. Document read surface plus outline, right-column page list, backlinks, and explicit Form/Markdown edit modes. Markdown canonical roundtrips via M3-01 services in packages/api. Human + agent edits share the same documents.

## Purpose
Provide read-first per-scope wiki pages with a structured Form editor over canonical markdown plus the existing Notion-style Markdown editor using BlockNote (shadcn view). List current-scope and descendant pages, create, rename (double-click), archive, history/revert, verify unreviewed agent pages, autosave/manual save, and show backlinks. Read-only for viewer role. All writes via server actions -> service layer (principal resolved server-side). Styling strictly via design tokens.

## Files
- `DocsView.tsx`: document center column + outline + grouped right-column list/backlinks. Client component. Handles descendant-aware list, selection via ?doc=, new dialog with Skip for now stub creation, inline rename, archive confirm, history popover + restore, verify action, Follow/Following toggle, and backlinks. The document center column is capped and centered at 860px reading width while the right list keeps its fixed natural width inside the fluid app shell (UX-08). Pins the `wiki` slug doc first (distinct icon/accent) per docs/patterns/WIKI.md; shows an "Inherited wiki from <ancestor path>" banner linking the ancestor's doc index when the current scope has no wiki of its own (M6-09). Selected row is derived from the loaded document.
- `DocEditor.tsx`: read mode by default, parses frontmatter into quiet metadata chips, shows Unreviewed where supplied by `listDocs`, renders `[[wikilinks]]`, anchors `##`/`###` headings, and moves trailing `## Sources` into a collapsed footer accordion. Edit mode defaults to Form fields (Title, Aliases, Definition, Details, Sections) backed by pure markdown mapping, with Markdown mode using BlockNote @blocknote/shadcn. md->blocks on load (tryParseMarkdownToBlocks), blocks->md on change (blocksToMarkdownLossy) + 1.5s debounced autosave via action, manual Save, and Done. No-op manual saves keep the original markdown bytes. Respects readOnly.
- `structured-editor.ts`: pure frontmatter, structured-form, outline, and wikilink rendering helpers. Keep this file server-free/client-safe and unit-test mapping behavior here through `docs.test.ts`.
- `actions.ts`: "use server" thin wrappers calling api.* (getCurrentActorPrincipalId + bound services). Revalidate on mutates. `getInheritedWikiAction` resolves the nearest ancestor wiki (M6-09) via `api.findNearestWiki`, returning null when the current scope owns its own wiki. `getBacklinksAction`, `verifyDocAction`, `followDocAction`, `unfollowDocAction`, and `isFollowingDocAction` wrap API services for the page surface.
- `index.ts`: public exports for scope pages.
- `AGENTS.md`: this file.

## Data / Contract
Consumes from `@companyos/api` (via lib/api wrappers):
- listDocs, getDoc, saveDoc, renameDoc, archiveDoc, listDocRevisions, revertDoc, getBacklinks, verifyDoc, followDoc, unfollowDoc, isFollowing
- listDocs rows include additive `createdByKind`, `scopePath`, and `unreviewed` for page grouping and review chips; callers may request `includeDescendants`
- resolveAccess for readOnly
- findNearestWiki (M6-09) for the inherited-wiki banner; ancestor-walk, ownership check by `wiki.scopePath === scopePath`

Markdown is source of truth. Form mode is only a scaffold over `body_md`; aliases live in frontmatter, and unsupported markdown is kept in opaque textarea blocks rather than rewritten. Read-mode frontmatter and Sources handling is presentation-only. Markdown mode is constrained to default schema (markdown-survivable blocks only: no multi-col, images as links).

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
- Read-mode/helper tests cover YAML frontmatter extraction, metadata chip formatting, trailing Sources extraction, byte-identical no-op save handling, structured Form mapping, alias frontmatter updates, opaque markdown blocks, and wikilink rendering.
- Architect browser verification: create, edit rich content, autosave, reload persists; MCP-saved doc (from save_doc) loads and roundtrips after edit; viewer read-only; no clash with tokens.

## Do / Don't
- Only this module's UI (no kernel, no other modules, no schema changes).
- Server actions + api wrappers, never raw db.
- Follow toggle is visible in the selected page header for signed-in viewers and remains available in read-only mode.
- Update this AGENTS.md on any behavioral change.
- Debounced 1.5s + explicit Cmd/Ctrl+S.
- Empty states per brief.
