# Slice D Brief: Ask OS explains the actual Wiki question

Implement Slice D from the owner-approved `FEAT-wiki-clarity.plan.md` in the current worktree. Build on accepted Slices A-C. Use `apply_patch` for every source/document edit. Do not commit.

## Owned files

- `packages/api/src/modules/agent/service.ts`
- `packages/api/src/modules/agent/agent.test.ts`
- `packages/api/src/modules/agent/AGENTS.md`
- `apps/os/src/modules/agent/AGENTS.md` only if the display contract changes

Do not edit any other file. Do not change schemas, migrations, lockfiles, environment files, UI components, Brain surfaces, or attention/docs service contracts.

## Required behavior

1. Add the additive Ask OS tools `list_things_to_resolve` and `inspect_thing_to_resolve`.
2. Use the existing attention service with the signed-in principal. Listing returns only open, authorized items for the current scope/subtree and describes Wiki questions and suggested Wiki updates in plain language.
3. Inspection accepts one item id, rechecks visibility, and returns the structured item plus current authorized snapshots of every referenced Wiki page in one call. Include structured citations for those pages. Never return a reserved `lint-report*` operational page.
4. Add citation capture for both `inspect_thing_to_resolve` and the existing `get_doc` tool. A citation must include scope path, page slug/title, and source; revision id remains optional.
5. The existing `get_doc` Ask OS tool must refuse reserved `lint-report*` pages even though direct system retrieval remains available elsewhere.
6. Update the system guidance so questions about a notification, Things to resolve, or a Wiki question inspect the notification first. If no id is available, list once to disambiguate, then inspect. Do not begin with broad `search` or `recall_memory`; inspection already contains current cited pages. Use `get_doc` only for a genuinely missing follow-up page.
7. Cap each turn at three model responses. Detect an identical repeated tool name+arguments call, do not execute it twice, and return a tool result telling the model to use the earlier result and answer. Replace the existing max-iterations placeholder with a friendly, useful fallback.
8. Preserve existing tools, wire contracts, writes, grants, persistence, events, and non-notification behavior. Internal identifiers stay stable; visible/explanatory strings use Wiki question, Two wiki pages disagree, This page may be out of date, Suggested wiki update, and Things to resolve.

## Tests

Add mocked-LiteLLM tests covering:

- the reported path: list once if needed, inspect the selected Wiki question, receive both current page snapshots, then answer within three model responses;
- direct inspection when the id is supplied;
- inspection/get_doc citations and reserved report exclusion;
- no broad search/recall on the Wiki-question path;
- no repeated identical tool execution;
- a friendly fallback with no `max iterations` placeholder;
- existing agent tests continue to pass.

Run the focused agent tests plus API typecheck and lint. Report changed files, checks, and any deviation. Do not commit.
