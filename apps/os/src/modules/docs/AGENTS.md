# apps/os/src/modules/docs — AGENTS.md

KB editor UI (M3-02): Docs tab on scope pages. Two-pane (list + BlockNote editor). Markdown canonical roundtrips via M3-01 services in packages/api. Human + agent edits share the same documents.

## Purpose
Provide Notion-style rich editing for per-scope KB documents using BlockNote (shadcn view). List, create, rename (double-click), archive, history/revert, autosave. Read-only for viewer role. All writes via server actions -> service layer (principal resolved server-side). Styling strictly via design tokens.

## Files
- `DocsView.tsx`: two-pane list + editor wrapper. Client component. Handles list, selection via ?doc=, new dialog, inline rename, archive confirm, history popover + restore.
- `DocEditor.tsx`: BlockNote instance using @blocknote/shadcn. md→blocks on load (tryParseMarkdownToBlocks), blocks→md on change (blocksToMarkdownLossy) + 1.5s debounced autosave via action. Save indicator. Respects readOnly.
- `actions.ts`: "use server" thin wrappers calling api.* (getCurrentActorPrincipalId + bound services). Revalidate on mutates.
- `index.ts`: public exports for scope pages.
- `AGENTS.md`: this file.

## Data / Contract
Consumes from `@companyos/api` (via lib/api wrappers):
- listDocs, getDoc, saveDoc, renameDoc, archiveDoc, listDocRevisions, revertDoc
- resolveAccess for readOnly

Markdown is source of truth. Editor constrained to default schema (markdown-survivable blocks only: no multi-col, images as links).

## Theming
BlockNote CSS vars mapped in apps/os/src/app/globals.css to --background, --surface, --foreground, --muted, --border, --primary (light + dark). .bn-root overrides. Inter font via core import.

## Usage in scope page
```tsx
import { DocsView } from "@/modules/docs";
// inside tab render:
<DocsView scopePath={scopePath} initialDocSlug={sp.doc} initialAccess={access} />
```

## Testing / Acceptance
- `pnpm typecheck && pnpm lint && pnpm test` (root)
- Roundtrip guard test (apps/os/src/modules/docs/docs.test.ts or co-located): uses BlockNote parse + blocksToMarkdownLossy over fixture (headings, lists, code, table, image link, formatting) in jsdom. Semantic stability asserted.
- Architect browser verification: create, edit rich content, autosave, reload persists; MCP-saved doc (from save_doc) loads and roundtrips after edit; viewer read-only; no clash with tokens.

## Do / Don't
- Only this module's UI (no kernel, no other modules, no schema changes).
- Server actions + api wrappers, never raw db.
- Update this AGENTS.md on any behavioral change.
- Debounced 1.5s + explicit Cmd/Ctrl+S.
- Empty states per brief.
