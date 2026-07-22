# Digest Module (M13-05)

Composes a **daily digest** surface for the "dream morning": five lanes of curated work items
across sessions, approvals, tasks, and automation candidates. Read-only curation; no new tables.

## Exports
- `getDigest(db, planeClient | null, { scopePath, includeDescendants?, limit? }, actor)` → `Digest`
  Returns 5 lanes (waiting_for_feedback, waiting_for_approval, completed_to_review,
  automation_candidates, ready_to_start). Each lane is an array of `DigestItem` plus optional note.
- Types: `Digest`, `DigestLane`, `DigestItem`, `DigestLaneKey`, `DigestOptions`

## What it does
Delegates to existing module services (`listSessions`, `listAttentionItems`, `listTasks`) to
assemble a single unified digest. Each item in lanes 1-3 includes `whyItNeedsYou` and
`whatHappensAfter` strings explaining the next action. Lane 4 is a stub (empty + note) pending
brain-lint wiring. Lane 5 degrades gracefully when `planeClient` is null (empty + note).

## Lane mapping
1. `waiting_for_feedback` — `listSessions(status: "waiting")`: sessions blocked awaiting feedback.
2. `waiting_for_approval` — `listAttentionItems(status: "open")`: the approval/question queue.
3. `completed_to_review` — `listSessions(status: "completed")`: finished, unreviewed wrap-ups.
4. `automation_candidates` — stub in v1 (empty + note); brain-lint wiring is a follow-up.
5. `ready_to_start` — `listTasks(state: "open")`; degrades to empty + note when planeClient is null.

## Do / Don't
- Do delegate to existing module services; each enforces its own access. Do keep ordering explainable.
- Don't add tables, writes, or task-manager features — this is a reading/acting surface.
- Don't call listTasks when planeClient is null.

## How to test
- `pnpm --filter @companyos/api exec vitest run src/modules/digest/digest.test.ts`
- `pnpm typecheck && pnpm lint`
