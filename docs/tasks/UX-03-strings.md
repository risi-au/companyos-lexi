# UX-03: Strings — copy audit + code-level renames (the last UX package)

status: done (PR #25 merged 2026-07-10)
module: apps/os (strings only) + packages/ui (component default strings only)
branch: task/UX-03 (off main @ 82fd40c)

## Why

Every UI package (UX-01..06) has landed. What remains is the words: the UI still leaks
jargon ("scope", "principal", "mint", "intake packet"), developer voice ("Insufficient
permissions", "Failed to X"), raw enums ("awaiting_external" → "awaiting external"),
vendor names ("via Plane"), and AI-tell separators (`·`, `→`, em-dashes). Two audit docs
already specify the fixes row by row:

- **`docs/design/STRING-AUDIT.md`** — sentence-level: every flagged string, with the
  exact proposed rewrite. §6 is the standards list (error copy = cause + recovery; no
  raw enums/UUIDs/tool names; one ellipsis, no em/en dashes; prefer layout over glyph
  separators; second person, present tense, calm).
- **`docs/design/NOMENCLATURE.md`** — vocabulary-level: §2 core nouns (scope→project in
  labels, intake→setup, mint→create, Plane→tasks, Tenant Admin→Admin, …), §3 verbs,
  §4 status/role **label maps** (enums never render raw).

Both docs are the spec. **Their `file:line` references are stale** (written before
UX-02/04/05/06 rewrote those components) — locate each string by its content
(`grep -rn "<string>" apps/os/src packages/ui/src`), not by the quoted line number. A
few rows are already fixed or their string no longer exists (e.g. all `alert()`/
`confirm()` sites are now toast/confirm-dialog); skip those rows silently.

## Do

1. **Status/role label maps** (NOMENCLATURE §4). Create
   `apps/os/src/lib/labels.ts` exporting small `labelFor*` maps (intake status, roles,
   session status, health status, credential set/unset, password state, integration
   configured-state) exactly per the §4 table, and use them at every render site that
   currently shows a raw or `.replace(/_/g," ")`-munged enum. Enums/DB/API values stay
   untouched — this is a render-layer map only.
2. **Apply STRING-AUDIT rewrites** (§1–§5): for each row, find the current string and
   apply the "Rewrite" column. Where a rewrite depends on NOMENCLATURE (§2/§3 terms),
   use the NOMENCLATURE proposal. Where the rewrite prescribes a structural change
   beyond words (e.g. "two-column layout", "render as skeleton", tile merges,
   tooltips-instead-of-tags), do the **copy part only** and keep the structure —
   structural polish is out of scope (see Don't).
3. **Apply NOMENCLATURE §2/§3 code-level renames** that are pure label/text changes:
   e.g. "New scope"→"New project", "Creation wizard"→"Set up {scope name}",
   "Assemble pack"→"Copy interview pack", "Submit return"→"Submit results",
   "Tenant Admin"→"Admin", "Mint virtual key"→"Create key", "via Plane"→tooltip copy,
   intake tab label "Intake"→"Setup" (**display label only — the `?tab=` param value,
   route slugs, and redirects stay exactly as they are**), "Reject"→"Send back",
   "Dismiss"→"Discard setup", etc. Rows marked "—"/keep in the tables stay as-is.
4. **Audit the copy UX-02/04/05/06 introduced** against STRING-AUDIT §6 + NOMENCLATURE:
   - confirm-dialog `title`/`body`/`confirmLabel` at every `useConfirm` call site
     (CanvasView, ConnectPanel, CredentialsPanel, DocsView ×2, McpManagerView ×2, and
     each admin `ConfirmSubmitButton`): title = short noun phrase, body = consequence in
     plain language, confirm label names the object ("Revoke token", not "Confirm").
   - every admin `EmptyState` (title + one-line body — no "No X returned." developer
     voice).
   - wizard 6-step rail step labels + the wizard "…" menu wording + the completion
     cheer copy (spec says `"N to go"` / `"all clear ✓"` — the ✓ is currently missing;
     that's a copy fix, add it).
   - toast messages introduced by UX-02 (cause + recovery, named object).
5. **Fix tests that assert on changed strings.** The suite must stay green
   (310 tests). Update string expectations only — never weaken a test's logic.
6. **Update this file's status line** to `status: implemented` and add a short
   "Deviations" section listing any audit row you intentionally skipped and why
   (already-fixed, string gone, or requires out-of-scope structure).

## Deviations

- Structural rows from the audit were handled as copy-only changes. Layout merges, skeletons, tooltip-only replacements, and tab regrouping were left unchanged per the Don't list.
- Rows for old `alert()` / `confirm()` strings that no longer exist were skipped as already replaced by toast or confirm-dialog flows.
- Wizard template and framing-question wording was not changed because those strings are instance data owned through `/admin/intake`.
- Contract vocabulary in APIs, route handlers, form field names, DB/API/MCP values, comments, and TypeScript identifiers was left unchanged where renaming would change behavior or contracts.
- Doc revision author names were not resolved beyond the existing saved-by value because that would require service/data changes rather than a display-string rewrite.

## Don't

- **No behavior or IA changes.** No `?tab=` value renames, no route/slug changes, no
  redirects, no tab merging (Dashboard/Overview stay two tabs), no tab regrouping
  (Work Log/Sessions/Activity stay as-is), no tile merges, no new components, no layout
  restructuring, no skeletons. Copy only — if a rewrite needs structure, take the words
  and leave the structure.
- **No enum, DB, API, or MCP changes.** `scope`, `principal`, `provision_scope`,
  `save_doc`, tool names, API params, DB values: contract vocabulary, do not rename
  (NOMENCLATURE §1/§6). Label maps live in the render layer only.
- **No wizard-template/framing-question wording changes.** That's instance data edited
  in `/admin/intake` (NOMENCLATURE §5 is the owner's proposal doc — leave it to him).
  Code-level wizard chrome (step labels, buttons, statuses) IS in scope.
- Don't touch `docs/design/*` (read-only spec), other `docs/tasks/*` files (only this
  file's status line), anything under `USER DATA/`, or `docs/tasks/M1{0,1,2,3}-*.md`.
- No new dependencies; no raw hex (validate-tokens gate); no direct `gsap` imports.
- Per STRING-AUDIT §6: no em/en dashes in UI strings (commas, periods, colons,
  parentheses; hyphens only in compounds), one real ellipsis "…" (no "..."), at most
  one `·` per line and prefer none.

## Acceptance criteria

- [ ] `apps/os/src/lib/labels.ts` exists; no raw enum values render anywhere a §4 map
      applies (grep spot-checks: `replace(/_/g` gone from render paths; "awaiting
      external", "needs review" lowercase raw forms gone from JSX).
- [ ] Grep-level: "Tenant Admin", "Mint virtual key", "No packets awaiting review.",
      "Insufficient permissions", "Not authenticated" (user-visible sites), "Assemble
      pack", "Submit return", "Reset temp", "slug (optional)" no longer appear in
      user-visible strings under `apps/os/src`.
- [ ] Every `useConfirm` call site has noun-phrase title + consequence body + verb+object
      confirm label; every admin `EmptyState` has non-developer copy; completion cheer
      shows "all clear ✓".
- [ ] `?tab=` values, routes, enums, API/MCP names byte-identical to main (reviewer will
      diff for this).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from root; no new deps, no
      lockfile changes.
- [ ] This file's status line flipped + Deviations section added.
