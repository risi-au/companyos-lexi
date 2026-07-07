# M8-07: Creation wizard v2 — briefing, related history, structured framing, pack rewrite

status: done (PR #4 merged 2026-07-07, deployed to staging, content synced; owner
edits wording live in /admin/intake)
module: packages/wizard + packages/api (intake, search) + apps/os (wizard UI) +
companyos-skills repo (scope-intake content)
branch: task/M8-07

Full design + product doctrine: this doc is the implementation brief distilled from
the approved plan (owner design session 2026-07-07). Companion docs:
`docs/patterns/OPERATING-DOCTRINE.md` (deliverable of this task) and
`docs/tasks/M8-09-credential-vault.md` (Phase B, separate).

## Settled design decisions (do not re-litigate)

- End user is an internal person who knows the requirement. Placement = existing
  tree picker; a new required free-text **reason** ("what is this scope for?") is
  captured at creation and carried verbatim into the pack.
- **No internal chat-LLM call anywhere in the wizard path.** Retrieval is
  embeddings (`embed` alias) with lexical fail-open; synthesis belongs to the
  external interview agent.
- Conversion doctrine: **link, don't migrate** — pre-signing history stays where it
  happened; the wizard carries a digest + permanent references into the new scope.
- Secrets: the external interview must **never** collect secret values — names +
  what-for only (`required_credentials`). Values are entered post-provision into
  the vault (M8-09).
- Scope docs stay in the OS DB; the git repo gets only the managed AGENTS.md.

## Do

1. **Reason field**: `NewScopeDialog` (apps/os Sidebar) gains a required "What is
   this scope for?" textarea → stored as `answers.reason` on the intake draft
   created by `ensureDraftIntakeForScope`.
2. **Structured framing**: IntakePanel replaces the raw-JSON answers textarea with
   form fields generated from the framing template's `## Framing questions`
   (key: question lines — parser exists in packages/wizard). Reason displayed on
   top. Answers still persist to the same `answers` JSON.
3. **Related history step (new)**: after framing, run hybrid search (M8-01 search
   module) across scopes the actor can read, seeded with reason + scope name; show
   hits (records/docs, title + snippet + scope); user selects which to include;
   selections stored on the intake row (new jsonb column, same migration as #6).
4. **Pack rewrite** (`assembleExternalPack` in packages/wizard +
   `assembleIntakeExternalPack` in intake/service.ts). Pack sections in order:
   briefing (from skill/template content — see Content below); structural context
   (scope path, parent chain, parent `getContextBundle`; **root `scope-map` +
   `critical-facts` fallback when top-level**); reason verbatim + framing answers;
   lead-history digest (step-3 selections: titles, snippets, record ids); similar
   work (top 2–3 `findReusePatterns` summaries + accepted pattern spec/seeds with
   "adapt, don't copy"); packet schema with per-field guidance. Both variants
   (paste-back + MCP); MCP variant adds pointers to `get_context`/`search`.
5. **Packet schema extensions** (`intakePacketSchema` in packages/wizard):
   `required_credentials: [{name, whatFor, loginMethodNotes}]` and
   `external_systems: [{name, purpose, notes}]` (M9+ connector inventory).
   Both optional-defaulted for backward compat; round-trip through
   `parsePastedIntakePacket`.
6. **Pack snapshot + review loudness**: store the assembled pack text on the intake
   row at assemble time (plain-SQL migration: pack snapshot column + related-history
   selections column). Review panel shows the snapshot (collapsible) and a loud
   warning banner when the paste was markdown-only (fenced JSON missing).
7. **Semantic `findReusePatterns`**: embed-alias similarity over root `pattern-*`
   pages with the existing lexical scoring as fail-open fallback (no chat LLM).
8. **Source-refs at provision**: `provisionFromIntakePacket` writes a
   `source-refs` system record in the new scope linking the step-3 selections
   (record/doc ids + scope paths) — the permanent lead→client bridge.
9. **Content** (files under `docs/tasks/M8-07-content/` are the source of truth,
   architect-drafted, **owner-approved wording required before merge**):
   - `scope-intake/SKILL.md` rewrite (external interview operating guide)
   - `templates/interview.md`, `templates/new-project.md`,
     `templates/new-sub-scope.md`
   - `DEFAULT_TEMPLATE_FILES` in intake/service.ts updated **byte-identical** to
     those files; after merge the same content is pushed to the companyos-skills
     repo (auto-sync via M8-08 handles the rest).
   - `docs/patterns/OPERATING-DOCTRINE.md` (repo doc; also seeded as a root wiki
     pattern page in the skills push).
10. **Tests**: pack variants (parent / top-level fallback / patterns present +
    accepted / history selections / both new schema fields round-trip); framing
    form ↔ answers JSON; snapshot stored + surfaced; markdown-only warning state;
    semantic-with-lexical-fallback matcher; source-refs record creation.

## Don't

- No chat-LLM call in any wizard/intake request path.
- No credential VALUES anywhere in intake tables, packs, or packets (vault is
  M8-09; this task only carries names/notes).
- Don't fork template content — files in docs/tasks/M8-07-content/ and
  DEFAULT_TEMPLATE_FILES stay byte-matched.
- Don't migrate/move source records at conversion — references only.
- Migrations: plain SQL only (no DO $$), one migration for both new columns.

## Acceptance criteria

- [ ] Creating a scope requires a reason; it appears in the pack verbatim
- [ ] Framing is form-fields (no raw JSON editing in the default path)
- [ ] Related-history hits can be selected and appear in the pack digest
- [ ] Top-level scope pack contains root scope-map/critical-facts context
- [ ] Pack briefing explains CompanyOS, interview purpose, conduct, output format
- [ ] required_credentials + external_systems survive paste-back round-trip
- [ ] Review shows the exact pack sent + loud markdown-only warning
- [ ] Provision writes the source-refs record
- [ ] All tests green; owner has signed off on content wording
