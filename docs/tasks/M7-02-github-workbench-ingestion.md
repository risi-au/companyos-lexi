# M7-02: GitHub workbench ingestion (git -> OS safety net)

status: done — implemented 2026-07-07 by codex (one review fix cycle: blanket stub
suppression bug, fabricated session links, records-table boundary → createSystemRecord,
provisioning test expectation). Full gates green (242 tests). Live GitHub webhook
registration on the workbench repos + staging env `GITHUB_WEBHOOK_SECRET` still pending
(needs origin push / staging deploy). See .review.md + docs/tasks/M7-02-analysis.md.
module: packages/api (new module `workbench-events`) + apps/os API route + GitHub webhook
branch: task/M7-02

## Goal

CompanyOS notices when work lands through GitHub even if the terminal agent forgets to
wrap up. A push, PR open/update, or merge on a provisioned workbench is mapped back to the
correct scope, written as OS events, and optionally turned into a lightweight changelog
stub that the owner or gardener can reconcile later. Agent MCP logging remains the primary
path; this is the safety net.

## Context

- M6-07: sessions registry shows running/waiting/stale/completed sessions, but registration
  is cooperative and a killed terminal may never call `complete_session`.
- M6-08: Work Log rollup makes records visible from ancestors and root. This task should
  create records only when needed so the Work Log can answer "what changed in git this
  week?".
- M6-04/M6-06: workbench repo + path mapping already exists and is surfaced to agents.
  Reuse that mapping to resolve GitHub webhook payloads to scopes.
- M7-01: wiki gardener distills records into current wiki truth. GitHub-ingested records
  become another input stream for the gardener, especially for missed wrap-ups.
- GitHub remains truth for files/code; CompanyOS remains truth for the work record.

## Pre-implementation analysis gate

Do not blindly implement this brief as written. Before coding, write a short analysis note
in the PR/commit body covering:

1. Which GitHub events are actually needed for v1, and which would create noise?
2. How repo/path matching behaves for root-level files, nested scopes, renamed files, and
   one push touching multiple scope folders.
3. How duplicate suppression works when an agent already called `log_change` or
   `complete_session`.
4. What is intentionally stored in CompanyOS vs left in GitHub.
5. What could leak cross-client information if filtering is wrong.

If that analysis finds a cheaper or safer v1, implement the safer version and note the
tradeoff. If it contradicts the goal or acceptance criteria, stop and ask the architect for
an amended brief.

## Do

1. **Webhook route** in `apps/os`: `POST /api/webhooks/github`
   - Verify GitHub signature using env-configured secret.
   - Accept `push`, `pull_request`, and `ping` events in v1.
   - Reject unsigned/invalid events before parsing business payloads.
2. **Workbench resolver** in `packages/api`
   - Given `{ repoFullName, changedPaths[] }`, find provisioned workbench scope(s).
   - Match by repo first, then deepest configured `workbenches.path` prefix.
   - If multiple scopes match a push, group changes by scope; if no scope matches, record
     a low-noise ignored event or return success with `ignored: true` so GitHub does not
     retry.
3. **Events**
   - Emit `workbench.push`, `workbench.pr_opened`, `workbench.pr_updated`,
     `workbench.pr_merged` as appropriate.
   - Payload includes repo, branch, commit SHAs, PR number/url, author login, changed path
     samples, resolved scope path, and delivery id.
   - Use delivery id for idempotency so GitHub retries do not duplicate records/events.
4. **Record stub policy**
   - On PR merge: create a `changelog` record if no recent agent-authored record or
     session completion already references the same PR/commit range.
   - Title format: `GitHub merge: <PR title>` or `GitHub push: <branch>`.
   - Body includes PR/commit links, changed path summary, detected scope, and a clear
     "Needs human/agent summary" note when no agent wrap-up was found.
   - For ordinary pushes, default to events only unless the push is to the default branch
     without an associated PR.
5. **Session linking**
   - Best-effort link to active/recent sessions by scope + worktree_ref/branch + principal
     or author metadata where available.
   - Do not require a session match; missed sessions are the reason this task exists.
6. **UI**
   - Work Log records from this path render like normal records, with a GitHub source
     badge.
   - Optional small section on a scope page: "Unreconciled GitHub activity" showing recent
     stub records that still contain the needs-summary marker.
7. **Docs**
   - Update provisioning/workbench AGENTS.md managed block to remind agents to include PR
     or commit refs in `log_change` / `complete_session` summaries.
   - Add setup notes for GitHub webhook secret and events to the relevant module AGENTS.md.

## Don't

- Don't replace agent-authored `log_change` / `complete_session`; this is a fallback.
- Don't scrape local disks or require the user's PC to be online.
- Don't auto-edit wiki pages from GitHub payloads; the gardener handles distillation from
  records later.
- Don't create records for every commit on feature branches; avoid noisy Work Log spam.
- Don't store GitHub secrets in code or generated AGENTS.md.
- Don't change GitHub repo layout or provisioning conventions.

## Acceptance criteria

- [ ] Signed GitHub webhook accepted; missing/invalid signature rejected
- [ ] Push/PR payload maps repo + changed paths to the deepest matching CompanyOS scope
- [ ] Multiple scopes changed in one push are grouped correctly; sibling/client leakage
      does not occur
- [ ] Duplicate GitHub delivery id does not duplicate events or records
- [ ] PR merge without a matching agent wrap-up creates one changelog stub at the resolved
      scope with PR/commit links
- [ ] PR merge with an existing recent session completion or changelog reference does not
      create a duplicate stub
- [ ] Events emitted for push/open/update/merge paths and visible in audit/activity
- [ ] Work Log rollup shows GitHub-created changelog records at client and root levels
- [ ] Gardener pilot can consume a GitHub-created changelog stub as an ordinary record
- [ ] Webhook setup documented, including env vars and GitHub event selection
