# FEAT-wiki-clarity Slice B: organized pages and clean retrieval

Role: Codex medium implementer. Work in the current Orca worktree. Do not commit.
Use `apply_patch` for every source/document edit. If `apply_patch` is blocked, stop and report the blocker; do not switch to PowerShell, Python, shell redirection, or another scripted write path.

Build on the existing uncommitted approved Slice A changes. Do not revert, reformat, or edit Slice A files.

Read first:

1. `AGENTS.md`, `ONBOARDING.md`, `docs/CONSTITUTION.md`
2. `docs/tasks/FEAT-wiki-clarity.contract.md`
3. `docs/tasks/FEAT-wiki-clarity.plan.md`, especially sections 2.1, 2.2, 2.5 and Slice B
4. The `AGENTS.md` in every owned package/module below
5. Current owned implementation and tests only

## Owned files

- `packages/db/src/schema/documents.ts` or one sibling exported documents-contract file, plus `packages/db/AGENTS.md`
- `packages/api/src/modules/docs/service.ts`, `packages/api/src/modules/docs/docs.test.ts`, `packages/api/src/modules/docs/AGENTS.md`
- `packages/api/src/modules/search/service.ts`, `packages/api/src/modules/search/search.test.ts`, `packages/api/src/modules/search/AGENTS.md`
- `packages/api/src/modules/memory/service.ts`, `packages/api/src/modules/memory/memory.test.ts`, `packages/api/src/modules/memory/AGENTS.md`
- `apps/os/src/modules/docs/DocsView.tsx`, `apps/os/src/modules/docs/DocEditor.tsx`, `apps/os/src/modules/docs/structured-editor.ts`, `apps/os/src/modules/docs/docs.test.ts`, `apps/os/src/modules/docs/AGENTS.md`

If an existing directly-related index/export file must change to expose the shared helper, keep that edit minimal and report it. Do not edit attention, agent, Brain, MCP, schema migrations, lockfiles, `.env*`, `USER DATA/`, or `legacy/`.

## Implement

1. Put one pure shared predicate in `packages/db` for reserved operational wiki reports (`lint-report` and `lint-report*`). Consume that same predicate everywhere in this slice. Do not duplicate slug checks.
2. Keep direct authorized `getDoc` retrieval unchanged, but exclude those system reports from normal document listing, full-text search, vector search, memory recall, and graph-like result assembly present in the owned services.
3. Add pure frontmatter/page-purpose helpers. Topic category values are exactly `current-work | decisions-policies | guides-processes | reference`; missing/unknown legacy values fall back to Other pages. Reserved placement is deterministic:
   - Start here: `wiki`, `overview`, `critical-facts`, `scope-map`
   - Guides and processes: root `pattern-*`
   - Topic category groups: Current work, Decisions and policies, Guides and processes, Reference
   - fallback: Other pages
4. Return the display category from `listDocs` additively and replace author-based wiki grouping with the ordered purpose groups above. Preserve normal authorization and stable ordering within groups.
5. Extend `verifyDoc` additively with optional `nextReviewAt`. When supplied it must be a real future date, and the same markdown-safe frontmatter update must write `verified_at`, `verified_by`, and `stale_after`. Existing callers retain current behavior. Preserve unknown frontmatter and markdown.
6. Add a Page type field to Simple editing. It must round-trip the four category values, preserve unknown frontmatter/body content, and leave Advanced editing available.
7. Apply the complete approved visible wording in the owned wiki surfaces, including accessible labels/tooltips and empty/loading/error states:
   - AI-maintained -> Kept up to date by CompanyOS
   - Backlinks -> Links from other pages
   - Unreviewed -> Needs a quick check
   - Mark verified -> Mark as correct
   - Follow / Following -> Notify me / Notifications on
   - Aliases -> Also known as
   - Definition -> What this is
   - Details -> More detail
   - Sections -> Page sections
   - Form / Markdown -> Simple / Advanced
   - History -> Past versions
   - wiki proposal -> Suggested wiki update
   - Approve / Reject for a wiki proposal -> Apply update / Keep current page
8. Remove raw slugs from primary page/proposal copy. Technical slugs may remain in hrefs and clearly secondary details. Keep internal identifiers and API contracts stable where the plan says so.
9. Use plain, calm language throughout. Do not show `lint`, `lint finding`, raw frontmatter keys, or internal record IDs to ordinary users.
10. Update each touched module `AGENTS.md` with its new contract and boundary.

## Tests

Add focused coverage for:

- category frontmatter parse/serialize and unknown-frontmatter preservation;
- legacy fallback, reserved-page mapping, purpose grouping and order;
- system-report exclusion in normal list, full-text search, vector search, memory recall, and any owned graph result path;
- direct authorized retrieval of a legacy report remains available;
- `verifyDoc` future `nextReviewAt` behavior and invalid/past rejection without mutation;
- Simple editor Page type round-trip and the approved plain labels;
- no primary raw slug display.

Run focused tests and feasible package/app typecheck and lint commands. The coordinator owns the root gate.

## Done report

Report every changed file, tests/commands and results, deviations, and follow-up needed by later slices. On a rate or usage limit, print a line beginning `LIMIT-ALERT:` and stop. Do not commit.
