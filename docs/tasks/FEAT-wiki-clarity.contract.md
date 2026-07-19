# Product Contract: A clear and trustworthy wiki

**Purpose:** Make the CompanyOS wiki understandable to a non-technical business owner and dependable for agents. People should be able to find current knowledge, understand why CompanyOS needs their input, and make a decision that actually corrects the wiki.

**In scope (V1):**
- Replace user-facing "lint" and other technical wiki wording with plain language. The primary terms are "Wiki health", "Wiki question", and "Two wiki pages disagree".
- Organize pages by purpose: Start here, Current work, Decisions and policies, Guides and processes, Reference, and Other pages. Store the machine-readable page type in markdown frontmatter; keep markdown as the only content format.
- Keep operational health output out of normal wiki pages, search, memory, the knowledge graph, and Ask OS. Stop creating `lint-report` pages; retain old reports without deleting them.
- Only surface a claimed contradiction when it matches a supported conflict class, names the same subject/property/timeframe, cites exact text from two existing pages, and provides a safe one-page correction for either outcome.
- Replace generic Approve/Reject actions for wiki items with outcome-specific actions. Applying a chosen correction updates the affected page, creates the normal revision/event/decision trail, and closes the item.
- Give an out-of-date page a guided "Mark as current" action with a human-chosen next review date; never invent a review period.
- Let Ask OS read Things to resolve directly, fetch the cited pages, and explain the question and available actions without looping through broad searches.
- Apply a complete plain-language pass to the Wiki, wiki-related Things to resolve cards, wiki update notifications, and the Brain's wiki-health surface.

**Explicitly OUT of scope:**
- Renaming internal enums, API parameters, database values, event names, routes, or the repo's developer `lint` command.
- A second wiki storage format, a new editor, a new chat surface, or a new background worker framework.
- Automatically rewriting a page from an unsupported or weak model finding.
- Deleting or bulk-archiving existing wiki pages or historical `lint-report` documents.

**Safety invariants:**
- Never apply a model-proposed correction unless both quoted claims still exist exactly and the target page still matches the version used to prepare the correction. The page save, item resolution, events, and decision record must commit or roll back together.
- V1 applies at most one page repair per human choice; if more work is needed, leave the item open and require a fresh proposal.
- Never treat workflow completion as successful approval unless a source explicitly says approved, accepted, successful, or equivalent.
- Never close a contradiction as fixed unless a wiki page changed successfully. "Not a conflict" may close it without changing pages and must record that decision.
- Never allow the generic attention resolver to approve, reject, or dismiss any wiki-health item; only the dedicated, audited outcome operation may resolve it.
- Never expose operational reports as current business truth to users or agents.
- Preserve access controls, module boundaries, markdown round-trip safety, revision history, and the event-on-write rule.

**Acceptance checks:**
- [x] No user-facing wiki surface uses "lint", raw finding enums, raw record ids, or raw wikilink syntax as its primary explanation.
- [x] The reported `intake workflow completed` versus `intake dismissed` case is rejected as unsupported, not surfaced as a success-versus-rejection conflict.
- [x] A valid conflict shows two page titles, exact quotes, source links, why they disagree, and clear choices; choosing one atomically updates the other page and records the chosen outcome plus before/after evidence.
- [x] An old or malformed finding has no Approve button and cannot mutate a page.
- [x] A current stale-page check can be marked current with a future review date; old stale items can be closed as unclear and cannot become stuck.
- [x] Old `lint-report` pages remain retrievable for system history but are absent from normal wiki lists, search, memory, the graph, and Ask OS.
- [x] Pages group under the plain-language taxonomy, and people and agents read/write the same frontmatter page type.
- [x] Ask OS can explain a selected/open wiki question from its structured item and cited pages within three tool rounds, with page citations.
- [x] Root typecheck, code-quality checks, tests, production build, and browser verification pass.

**Deployment boundary:** CompanyOS application, API, MCP adapter, and Brain packages in this repository. No production deploy, database mutation, or destructive cleanup without the normal release checkpoint and owner authorization.

**Risk profile:** R2 - model-derived knowledge correction, multi-surface behavior change, and writes to standing business truth. Neutralized by structured evidence, deterministic validation, compare-before-write, single-page repair, human choice, full audit trail, and no schema or destructive migration.
