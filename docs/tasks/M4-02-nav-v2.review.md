# Review: M4-02 nav v2 — fix cycle 1

Reviewed commit 5d7503a against the brief and CONSTITUTION.md. Gates pass (typecheck, lint, 140 tests). Live-verified in browser: switcher (overview entry + projects, cookie persistence), per-project sidebar with nested subproject sections and active states, module links, Members only on the project section, Task Manager href resolves in Plane (200). All good — except one regression.

## Fix list

1. **Restore the "+ New scope" affordance.** The old Sidebar contained the only UI for creating scopes (a "New scope" button opening `NewScopeDialog`, wired to the `createNewScope` server action in `_components/actions.ts`). Your rewrite deleted it; `createNewScope` is now dead code and there is no way to create a project or subproject from the web UI.
   - Bring back the dialog (reuse the old implementation from git history: `git show main~2:"apps/os/src/app/(app)/_components/Sidebar.tsx"` or similar — it was in Sidebar.tsx on main before this branch).
   - Placement: a small "+" button in the sidebar — either next to the "Project" switcher label (creates top-level projects) and/or per section header (creates a subproject under that node). Simplest acceptable: one "+ New scope" button below the nav sections that opens the existing dialog (it already takes a parent path input).
   - The dialog must default the type sensibly: `project` when parent is root/none, `subproject` otherwise (match M4-01 types).
   - After create, navigate to the new scope page (the action already returns `path`).

## Constraints

- Touch only `apps/os/src/app/(app)/_components/Sidebar.tsx` (and, if needed, a new small `NewScopeDialog.tsx` beside it) — no changes to actions.ts semantics, no API/kernel changes.
- Keep all M4-02 behavior verified above intact.
- Update `apps/os/AGENTS.md` nav notes in the same commit.
- Commit message: `M4-02 fix1: restore New Scope dialog in sidebar`
