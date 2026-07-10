# Handoff — 2026-07-10 EOD (UX arc closed, M10 started)

*Next session: read this + `ONBOARDING.md` (rewritten today — stable entry point with
the state-discovery protocol and per-task routing). Auto-memory has the same facts
compressed.*

## What merged today (all on `main`)

- **#29 UX-07** docs surface (3-column, read/edit, metadata chips).
- **#30 UX-08 + 08B + 08C** — sidebar v2 (folder tree, accordion, resize), walkthrough
  punch-list (soft tab nav via `Tabs linkComponent` + GSAP panel transition, linked
  breadcrumbs with scope names, docs fill width, **frontmatter-safe DocEditor** — edit
  mode used to destroy YAML frontmatter on autosave), and the owner-picked hover-reveal
  module-shortcut design (option A of a 4-way interactive prototype artifact).
- **#31 M10-01** attention & approval primitive — `attention_items` + typed proposals,
  Ask OS existing-doc edits file `wiki_proposal`s, brain flagged lint findings become
  deduped items, MCP `list_attention_items`/`resolve_attention_item`, `get_context`
  count banner, "Things to resolve" card on scope Overview, decision record on every
  resolution. Verified: gates 333/333 + live smoke (approve applied the wiki edit).

## Root causes fixed today (don't re-diagnose these)

- **"Local Tailwind flake" is dead.** It was never random: `packages/ui/src/globals.css`
  lacked `@source "./"`, so package-only utilities were dropped when the dev server ran
  with cwd inside `apps/os`. Fixed on main. If a packages/ui-only class is ever missing
  again, check that directive first.
- **Codex dispatch gotchas (both in SUBAGENTS.md now):** CLI 0.142.5 rejects the new
  config-default model → always pass `-c model=gpt-5.5`; fresh git worktrees need an
  ACL grant before codex can write:
  `foreach ($d in @("packages","apps","docs","infra")) { icacls "<wt>\$d" /grant "CodexSandboxUsers:(OI)(CI)(M)" /t /q }`.

## Next step (the actual work)

**M10-03 citations + agent gardening** — per the ratified order in
`docs/tasks/M10-living-wiki-overview.md` (01 → **03** → 02 → 04+06 → 05):
loop-level recall-hit tracking, `citations` array on agent messages + session wrap-ups,
wrap-up contract field for external tools, chips UI, MCP exposure of
`rename_doc`/`archive_doc`/backlinks/link-graph. Write the brief (pin paths via an
Explore pass over `packages/api/src/modules/agent/service.ts` `runTurn`/`recallMemory`
and the sessions module), new worktree `task/M10-03`, dispatch codex.

## Environment state

- **Worktrees:** `companyos-ux07` + `companyos-ux08` are MERGED — safe to
  `git worktree remove` (but the **:3000 dev server currently runs from
  companyos-ux08**; repoint it to the main folder or a new worktree first).
  `companyos-m10-01` (branch task/M10-01, merged via #31) also removable.
- **Local dev DB:** `attention_items` migration ALREADY applied. verify-bot user
  (verify-bot@dev.local / verify-local-3000!) + root grant still present (owner said
  keep). Demo residue okayed by owner: airbuddy-wiki has an "## Approval Test" section;
  a resolved attention item + decision record exist on airbuddy.
- **Staging untouched** — nothing deployed today; next deploy is tag-based per VPS.md.

## Owner items (unchanged)

vault e2e · M5-05/M9+ discussions · pilot report · candidate renames for M10-06
(intake→"Scope setup", capabilities→"Automations", principals→"People & agents").

## Untracked-but-deliberate files in the main folder

Older handoffs, `docs/agent-tools/`, M11–M13 overviews, UX-06 briefs — prior sessions
left them uncommitted on purpose; leave them unless the owner says otherwise.
`USER DATA/` is untouchable, always.
