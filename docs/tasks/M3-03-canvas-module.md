# M3-03: Canvas module (Excalidraw)
status: todo
module: canvas
branch: task/M3-03

## Goal
Per-scope Excalidraw canvases: humans draw process maps in a **Canvas** tab; scenes are JSON in our Postgres; agents can read/write scenes via MCP. Both backend module and UI in one brief (the module is small).

## Context
- `docs/DESIGN.md` §2 item 2 (canvas module), §5 (`canvases`), §6 (canvas tools). Module pattern as ever (schema+migration, service, AGENTS.md, PGlite tests, events, editor/agent write, viewer read).
- `@excalidraw/excalidraw` React component (verify current version + Next.js App Router integration via web — it needs `"use client"` + dynamic import with ssr:false).
- Scene = Excalidraw's serialized JSON ({elements, appState, files}). Store as jsonb. Cap scene size at 2MB (typed error beyond).
- Theming: Excalidraw has light/dark theme prop — bind to our theme toggle state.

## Do
1. Schema `packages/db/src/schema/canvases.ts`: `canvases`: id, scope_id FK cascade, slug (unique per scope), name, scene jsonb default {}, updated_by, created_at, updated_at; unique(scope_id, slug). Migration. (No revisions for v1 — scenes are large; snapshot-on-demand later.)
2. Service `packages/api/src/modules/canvas/service.ts`: `saveCanvas` (upsert by scope+slug, size cap, emits `canvas.saved`), `getCanvas`, `listCanvases`, `archiveCanvas` (soft, archived_at). 
3. MCP tools: `save_canvas`, `get_canvas`, `list_canvases`. HTTP: `GET/POST /api/v1/canvas`. Update AGENTS.mds.
4. **Canvas tab** on scope page: canvas list (left, like Docs) + Excalidraw editor (right) with debounced autosave (2s idle) via server action, save indicator, read-only for viewers (Excalidraw viewModeEnabled), new-canvas dialog, dark/light bound to app theme.
5. Tests: service round-trip (scene jsonb intact), size cap, access, events; MCP/HTTP round-trips. UI verified by architect.

## Don't
- No realtime collab. No revisions. No image file uploads into scenes (elements only for now — keep scenes portable JSON). Don't touch other modules, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] Draw shapes in the Canvas tab → autosave → reload → shapes persist (architect browser-verifies)
- [ ] A scene saved via MCP `save_canvas` opens in the UI (architect verifies)
- [ ] Scene JSON round-trips intact via HTTP (tested); 2MB cap enforced (tested)
- [ ] Access control + events; Excalidraw follows app theme
