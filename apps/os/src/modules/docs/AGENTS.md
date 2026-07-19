# apps/os/src/modules/docs - AGENTS.md

Wiki editor UI (M3-02 + UX-07 + M10-04A + M10-04B): Docs tab on scope pages, presented to users as Wiki pages. Document read surface plus outline, right-column page list, links from other pages, and explicit Simple/Advanced edit modes. Markdown canonical roundtrips via M3-01 services in packages/api. Human + agent edits share the same documents.

## Purpose
Provide read-first per-scope wiki pages with a structured Simple editor over canonical markdown plus the existing Notion-style Advanced editor using BlockNote (shadcn view). List current-scope and descendant pages by page purpose, create, rename (double-click), archive, past versions/revert, mark agent-written pages as correct, autosave/manual save, and show links from other pages. Read-only for viewer role. All writes via server actions -> service layer (principal resolved server-side). Styling strictly via design tokens.

## Files
- `DocsView.tsx`: document center column + outline + grouped right-column list/links from other pages. Client component. Handles descendant-aware list, selection via ?doc=, new dialog with Skip for now stub creation, inline rename, archive confirm, past versions popover + restore, mark-as-correct action, Notify me/Notifications on toggle, and links from other pages. Past versions show readable dates without exposing principal ids or revision terminology. Page list groups use the additive `displayCategory` returned by `listDocs` in this order: Start here, Current work, Decisions and policies, Guides and processes, Reference, Other pages. Same-scope page selection syncs ?doc= via native `history.replaceState` (no RSC navigation; Next syncs useSearchParams) so in-flight server actions can't hang on a pending navigation; cross-scope selection still uses router.replace. Doc loads run through `doc-load.ts` guards; a timed-out/failed/missing load shows a plain retry state (issue #54). The document center column is capped and centered at 860px reading width while the right list keeps its fixed natural width inside the fluid app shell (UX-08). Pins the `wiki` slug doc first (distinct icon/accent) per docs/patterns/WIKI.md; shows a "Shared wiki from <ancestor path>" banner linking the ancestor's doc index when the current scope has no wiki of its own (M6-09). Selected row is derived from the loaded document.
- `DocEditor.tsx`: read mode by default, parses frontmatter into quiet metadata chips, shows Needs a quick check where supplied by `listDocs`, renders `[[wikilinks]]`, anchors `##`/`###` headings, and moves trailing `## Sources` into a collapsed footer accordion. Edit mode defaults to Simple fields (Title, Page type, Also known as, What this is, More detail, Page sections) backed by pure markdown mapping, with Advanced mode using BlockNote @blocknote/shadcn. md->blocks on load (tryParseMarkdownToBlocks), blocks->md on change (blocksToMarkdownLossy) + 1.5s debounced autosave via action, manual Save, and Done. No-op manual saves keep the original markdown bytes. Respects readOnly.
- `structured-editor.ts`: pure frontmatter, page-purpose, structured-form, outline, and wikilink rendering helpers. Valid Page type values are `current-work`, `decisions-policies`, `guides-processes`, and `reference`; missing or unknown values display as Other pages and are preserved unless the user changes Page type. Keep this file server-free/client-safe and unit-test mapping behavior here through `docs.test.ts`.
- `doc-load.ts`: pure load guards (issue #54): `withTimeout` (15s cap on doc-load server actions, which Next.js can leave hanging forever when a navigation supersedes them — vercel/next.js#74246) and `createLoadSequence` (stale in-flight loads never apply state over a newer selection). Tested in `doc-load.test.ts`.
- `actions.ts`: "use server" thin wrappers calling api.* (getCurrentActorPrincipalId + bound services). Revalidate on mutates. `getInheritedWikiAction` resolves the nearest ancestor wiki (M6-09) via `api.findNearestWiki`, returning null when the current scope owns its own wiki. `getBacklinksAction`, `verifyDocAction`, `followDocAction`, `unfollowDocAction`, and `isFollowingDocAction` wrap API services for the page surface.
- `index.ts`: public exports for scope pages.
- `AGENTS.md`: this file.

## Data / Contract
Consumes from `@companyos/api` (via lib/api wrappers):
- listDocs, getDoc, saveDoc, renameDoc, archiveDoc, listDocRevisions, revertDoc, getBacklinks, verifyDoc, followDoc, unfollowDoc, isFollowing
- listDocs rows include additive `createdByKind`, `scopePath`, `unreviewed`, and `displayCategory` for purpose grouping and review chips; callers may request `includeDescendants`
- resolveAccess for readOnly
- findNearestWiki (M6-09) for the inherited-wiki banner; ancestor-walk, ownership check by `wiki.scopePath === scopePath`

Markdown is source of truth. Simple mode is only a scaffold over `body_md`; aliases and page type live in frontmatter, and unsupported markdown is kept in opaque textarea blocks rather than rewritten. Read-mode frontmatter and Sources handling is presentation-only. Advanced mode is constrained to default schema (markdown-survivable blocks only: no multi-col, images as links).

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
