# M8-08: Brain run integrity — surface parse failures, enforce output contract, auto-sync skills

status: todo
module: packages/brain + packages/api (workbench-events) + apps/os (brain surfaces)
branch: task/M8-08

## Goal

Close the gaps that let the first real staging brain run (2026-07-07) report **success
with 0 pages** while silently discarding both LLM responses, and that let a skills-repo
push go un-synced. All three were found live; none are covered by tests because the
fake LLM client always returns perfect JSON.

## Findings (staging, code as of `81c4fcf`)

1. **Parse failures are silently swallowed.** `parseJsonObject` (packages/brain/src/
   engine.ts:187) falls back to `{pages: []}` / `{findings: []}` on any non-JSON
   response; the run then reports `success`. The 2026-07-07 ingest spent 10,661 tokens,
   both calls returned 1.8–3.8KB of content, zero pages landed, status said success.
   Nothing anywhere records what the model actually said.
2. **Output contract was never in the prompt.** Neither the wiki-maintenance skill nor
   the engine's user prompts specified the expected JSON envelope. Hotfixed 2026-07-07
   by appending an "Output format (mandatory)" section to `wiki-maintenance/SKILL.md`
   (skills repo commit `51e7cd94ae64`) — but the engine should not depend on skill
   authors remembering this.
3. **Skills-repo pushes don't sync.** `handleGitHubWebhook` (packages/api/src/modules/
   workbench-events/service.ts:498) only resolves workbench scopes; a push to
   `companyos-skills` (not a workbench) returns `ignored: true`. Skill edits only reach
   the DB via manual `sync_skills` or the template editor's explicit sync call.

## Do

1. **Surface parse failures**: when the response text is non-empty but doesn't parse
   (or parses to zero usable pages/findings), record it — per-scope `parseFailed: true`
   in scopeRuns, run status `error` (or at minimum a distinct summary), and stash a
   bounded response excerpt (first ~2KB) in the run payload so the next person can see
   what the model said. Root-distill slug filtering should likewise count+report
   dropped non-reserved slugs instead of dropping silently.
2. **Enforce the envelope in code**: append a compact schema instruction to the user
   prompt in all four call sites (scope-ingest, root-distill, lint-scope, code-docs)
   so the contract survives skill rewrites; consider `response_format:
   {type: "json_object"}` in the LiteLLM client (drop_params already set — verify
   Moonshot passthrough) and a tolerant extractor (first `{`…last `}`) before giving up.
3. **Auto-sync skills on push**: in `handleGitHubWebhook`, when the pushed repo matches
   `GITHUB_ORG/SKILLS_REPO` and the default branch, call `syncSkills` (idempotent,
   delivery-deduped). Emit a kernel event either way.
4. **Tests**: fake-LLM cases for prose responses, fenced-with-preamble responses,
   truncated JSON, non-reserved root slugs; webhook test for skills-repo push.

## Don't

- Don't retry LLM calls automatically (budget risk) — surfacing beats retrying here;
  M9-01 will alert on failed runs.
- Don't log full prompts/responses wholesale (token/PII bloat) — bounded excerpts only.

## Acceptance criteria

- [ ] A prose-only LLM response produces a visibly failed/flagged run, never a quiet success
- [ ] Run payload contains a bounded excerpt of any unparseable response
- [ ] All four call sites carry the JSON envelope instruction in-prompt
- [ ] Push to the skills repo default branch syncs skills without manual action
- [ ] New fake-LLM tests cover the malformed-response matrix
