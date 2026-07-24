# Kickoff Module (M13-04)

Builds agent session kickoffs through a questions-as-cache-misses cascade and a connectivity-aware artifact gradient. It resolves reusable answers from the current run, the actor's personal profile, scope defaults, and template defaults, then provides concise, checklist, or self-contained kickoff text.

## Exports
- `parseKickoffAnswers(bodyMd)` - safely extracts string answers from the first fenced JSON block.
- `renderKickoffDoc(kind, answers)` - renders deterministic human-readable markdown with a canonical JSON answer block.
- `resolveKickoffAnswers(db, input, actor)` - read-only run, personal, scope, template cascade resolution and ordered misses.
- `recordKickoffAnswers(db, input, actor)` - merges non-empty answers into the selected cache layer and emits `kickoff.answers_recorded` after saving.
- `assembleKickoffArtifact(db, input, actor)` - validates the goal, resolves answers, and builds the full, checklist, or paste artifact plus a `SessionBrief`.

Cache layers are ordinary documents, not new columns: `kickoff-profile` in the acting principal's personal scope and `kickoff-defaults` in the selected scope. Each document has a single JSON block containing a flat string map; the canonical block is always the last fenced `json` block in the body (parsing tolerates answer values that themselves contain code fences).

`resolveKickoffAnswers` and `assembleKickoffArtifact` require `viewer` on the target scope and throw `ScopeNotFoundError` for an unknown scope. Scope-layer write-back (`recordKickoffAnswers` target `scope`) requires `editor`.

Known limitations (follow-ups, not bugs): the `personal` layer relies on the actor's personal scope, which today exists only for human principals and only after it has been provisioned; agent principals resolve the personal layer as empty and cannot write-back to it. Duplicate question keys are not de-duplicated.

## How to test
- `pnpm --filter @companyos/api exec vitest run src/modules/kickoff/kickoff.test.ts`
- `pnpm --filter @companyos/api typecheck`
- `node scripts/check-encoding.mjs`
