# apps/os/src/modules/canvas — AGENTS.md

Canvas UI (M3-03): Canvas tab on scope pages. Left list + right Excalidraw editor. JSON scene stored via api. Autosave (debounce 2s idle), save indicator, new dialog, archive, read-only for viewers. Theme bound to app dark/light.

## Purpose
Humans draw in Canvas tab (process maps etc). Uses @excalidraw/excalidraw (client-only via dynamic + ssr:false per current docs). Scene roundtrips via saveCanvas/getCanvas in packages/api. MCP can save scene that appears in UI.

## Files
- `CanvasView.tsx`: two-pane (list left + editor). Client component. New canvas dialog, select, autosave on change (debounced), indicator, archive. Syncs theme class.
- `scene.ts`: sanitizes Excalidraw scene data for storage and initialData. Uses Excalidraw restore/serialization helpers when available; fallback keeps only JSON-safe database appState keys.
- `actions.ts`: "use server" wrappers to api.* + revalidate.
- `index.ts`: export CanvasView.
- `AGENTS.md`: this.

## Data / Contract
Consumes from `@companyos/api` (via lib/api):
- listCanvases, getCanvas, saveCanvas, archiveCanvas
- resolveAccess for readOnly

Scene shape: Excalidraw JSON scene data ({ elements, appState?, files? } plus optional Excalidraw metadata). Stored as jsonb, size capped 2MB server-side. UI must sanitize before save and before passing to `<Excalidraw initialData>`: runtime-only/non-serializable appState fields such as `collaborators`, cursor state, selection, and edit-session state are not persisted. No images in scene for v1.

## Theming
Excalidraw theme prop "dark" | "light" synced from <html class="dark"> (UserMenu toggle + storage). Import @excalidraw/excalidraw/index.css

## Integration in scope page
Add tab link and:
import { CanvasView } from "@/modules/canvas";
<CanvasView scopePath={scopePath} initialCanvasSlug={sp.canvas} initialAccess={access} />

## Testing / Acceptance
- `pnpm typecheck && pnpm lint && pnpm test` (root)
- Architect verifies: draw shapes → autosave → reload persists; MCP save_canvas opens in UI; scene json intact; 2MB cap; viewer readOnly; theme follows toggle; no cross module imports.

## Do / Don't
- Only canvas UI. Uses design tokens where possible (list like docs).
- Server actions + api only, never db.
- Update AGENTS.md on change.
- Debounce ~2s idle + explicit save indicator.
- Excalidraw dynamic import only (no ssr).
- Per brief: no other modules touched.
