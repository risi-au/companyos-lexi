# M8-05 Brain Surfaces Analysis Gate

## 1. Graph Rendering Approach

Use a client-side canvas renderer inside the Next.js `/brain` route. The server component gates root-admin access and fetches an initial bounded graph payload; the interactive force layout runs in a `"use client"` component so SSR never attempts DOM/canvas work.

I am not adding a new graph dependency for this task. A small canvas force layout is enough for the current target of a few thousand nodes when paired with server-side payload limits, simple clustering metadata, and client filters. Canvas is preferred over SVG because node/edge counts can grow quickly; WebGL is unnecessary until the graph is routinely larger than the expected instance size. The route renders immediately with summary/limit metadata and the canvas initializes after hydration.

Graceful degradation:
- default payload cap: a few thousand nodes and edges;
- server returns `truncated` metadata when limits are reached;
- client filters/search run against the bounded payload;
- graph remains read-only, with navigation handled through click-through URLs.

## 2. Graph Data Shaping

Node types:
- `scope`: every scope in the root subtree, including root and projects/subprojects.
- `wiki-page`: normal active docs in the root subtree.
- `root-pattern`: root docs whose slug is `critical-facts` or starts with `pattern-`.
- `workbench`: workbench repo/path anchors attached to scopes.

Lint state is a node flag, not a separate node type. A page or scope linked from a lint report is returned with `flagged: true`, so the renderer can tint it distinctly without losing its underlying type. Unresolved wikilink targets are also included as bounded page-like unresolved nodes so broken links remain visible.

Edge types:
- `scope-hierarchy`: parent scope to child scope.
- `wikilink`: document links from `doc_links`.
- `source-record`: reserved payload category for future provenance edges; M8-05 surfaces the type but only emits it when persisted data exists.
- `workbench`: scope to workbench anchor.

Payload limits:
- accept `limit` and `edgeLimit`, capped server-side.
- include `totalNodes`, `totalEdges`, `returnedNodes`, `returnedEdges`, and `truncated`.
- keep node metadata compact: id, type, title, scope path, href, slug, status, flagged.

## 3. Surface Location And Navigation

The root-admin surface lives in the app shell under:
- `/brain`: global graph.
- `/brain/engine`: engine operations, run history, lint findings, spend, and manual triggers.

The sidebar shows a `Brain` entry only when the visible tree includes root, which corresponds to a root grant. Direct page access and data/action endpoints still enforce owner/admin on the root scope through service-layer checks; the hidden nav is only UX, not security.
