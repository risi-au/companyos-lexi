# M10-02: personal wikis — implementation brief

Implements decisions 3 + 4 of `docs/tasks/M10-living-wiki-overview.md`. Verbatim scope
(overview line 140-143): *`personal` scope type + auto-provision per principal, grant +
mediation rules (owner-only visibility, system writes for the brain), recall union
extension, brain routing rule (person-vs-work test) + two-way graduation proposals
(needs M10-01), wizard defaulting cascade reads personal pages.*

Non-negotiables from the overview: recall union becomes **personal → scope subtree →
nearest ancestor → root allowlist**; personal scopes are **not readable by admins**
("no admin backdoor into personal wikis; brain access is mediated as system"); all
doc/revision/search/brain machinery otherwise unchanged.

**Ratified interpretation for this brief (architect call, do not re-litigate):**
"system mediation for the brain" = a principal qualifies as a *mediated system
principal* iff `principals.kind === "agent"` AND it holds a grant (role `admin` or
`agent`) directly on the **root scope**. Such principals get `agent`-level (rank 3)
access to personal scopes. Human principals NEVER inherit access to a personal scope,
regardless of root role — only a direct grant on the personal scope itself counts.

## A. `personal` scope type (`packages/db` + kernel)

1. `packages/db/src/schema/kernel.ts:17` — add `"personal"` to `scopeTypeEnum`;
   update the `Scope` interface union (`:123-135`). Generate the migration with
   drizzle-kit (plain SQL `ALTER TYPE ... ADD VALUE`; never hand-edit
   `drizzle/meta/_journal.json`; do NOT run against the dev DB).
2. `packages/api/src/kernel/scopes.ts` — `createScope` (`:31`): the structural gate at
   `:82-92` ("top-level must be project / nested must be subproject") must allow
   `personal` as a **top-level (child of root) scope only**; `personal` under any
   non-root parent is invalid. Auto-parenting to root (`:69-79`) stays as-is for
   personal scopes.

## B. Auto-provision per human principal

1. New kernel function (put it next to the scope service or in a small
   `packages/api/src/kernel/personal.ts`):
   `ensurePersonalScope(db, principalId): Promise<{ scopePath: string }>` —
   idempotent. Convention: slug/path = `personal-<principalId>` (uuid is lowercase
   hex + hyphens, satisfies `SLUG_REGEX` at `scopes.ts:16`), name =
   `"<principal name> — personal"`, `type: "personal"`. If the scope already exists,
   return it. On create: `createScope` + `grantRole` (`kernel/grants.ts:31-91`)
   giving the principal a direct `owner` grant. (`scope.created` is emitted by
   `createScope` — fine.)
2. Hook: `packages/api/src/kernel/auth-link.ts` `linkAuthUser` (`:30`) — call
   `ensurePersonalScope` for the human principal on **every** successful link path
   (new-principal branch `:67-90` AND existing-principal email-link branch `:54-62`),
   so pre-existing users get their personal scope lazily on next sign-in. No separate
   backfill script.
3. Personal-scope lookup helper for reads:
   `getPersonalScopePath(principalId): string` (pure convention helper) — used by
   recall + wizard below. Do not scan grants for this.

## C. Grant mediation — the critical piece

`packages/api/src/kernel/grants.ts` `resolveAccess` (`:93-124`): the ancestor walk
(`:100-118`) means a root grant currently resolves on every scope — including
personal ones. Add a **short-circuit before the ancestor walk**:

- If the target scope's `type === "personal"`:
  - A grant **directly on that scope** resolves normally (the person themself, or
    anyone they explicitly granted).
  - Else, if the caller is a *mediated system principal* (definition above: kind
    `agent` + direct root grant of role `admin`/`agent`), resolve `"agent"` (rank 3 —
    enough for editor-gated doc writes per `ROLE_RANK` `:10-16`).
  - Else resolve `null`. **No ancestor inheritance, ever, for personal scopes.**
- All other scope types: behavior byte-identical to today.

Implementation note: the short-circuit needs the scope row's `type` — fetch it in the
same query that resolves the path (resolveAccess already loads the scope chain).
Keep `requireAccess` (`:126-141`) unchanged.

## D. Recall union extension (`packages/api/src/modules/memory/service.ts`)

1. `RecallMemoryHit["source"]` (`:31`) gains `"personal"` (the `Citation` type
   `:16-22` already has it — post-M10-03).
2. Union predicate assembled at `:296-300` (`scopePredicate` OR `includeAncestorPath`
   OR `rootAllowlistPredicate`): prepend a `personalScopePredicate` — docs whose
   scope is the **acting principal's** personal scope (path via
   `getPersonalScopePath(actorPrincipalId)`; resolve to scope id; skip the predicate
   if the scope doesn't exist yet). Applies to both keyword (`:317`) and semantic
   (`:340, :362`) queries — same assembled predicate, as today.
3. `sourceFor` (`:155-160`): return `"personal"` when the hit's scopePath equals the
   actor's personal scope path (pass it in as a parameter).
4. Ranking: keep RRF fusion as-is; personal hits are distinguished by `source`, not
   boosted. (Decision 3 orders the *union*, not a re-rank.)

## E. Brain: person-vs-work routing + two-way graduation proposals

Files: `packages/brain/src/engine.ts`, `packages/api/src/modules/attention/service.ts`.

1. **Exclude personal scopes from routine sweep targets**: `targetTopLevelScopes`
   (`engine.ts:643-653`) / `targetScopes` (`:655-661`) must skip `type === "personal"`
   scopes — the brain must not bulk-ingest them like project scopes.
2. **Person-vs-work routing rule**: extend the ingest instruction set (the
   `scope-ingest` purpose prompt, `engine.ts:35` / `ingestScope` `:721-782`) with the
   ratified test, verbatim: *"is the fact about the person or about the work? Person
   (tool prefs, folder conventions, schedules, working style) → that person's
   personal wiki. Client/project truth → scope wiki. Cross-client playbook → root
   pattern."* Give the LLM the available routing targets: pass a compact map of
   human principals → personal scope paths (query `principals` kind=human joined via
   the path convention) into the prompt context, and accept an optional
   `targetScopePath` per returned page; validate it (must be the ingest scope, or a
   personal scope from the map) before `saveDoc` (`:775`). Writes to personal scopes
   go through the same `saveDoc` with the engine's principal — access comes from the
   §C mediation rule.
3. **Graduation proposals (two-way), via M10-01 attention items** — the `graduation`
   kind already exists (`packages/db/src/schema/attention.ts:13-18`, no migration):
   - New typed payload in `attention/service.ts` mirroring `WikiProposalPayload`
     (`:19-25`, validator `:45-59`):
     `GraduationPayload { direction: "personal-to-scope" | "scope-to-personal",
     fromScopePath, fromSlug, proposal: WikiProposalPayload }` — i.e. the payload
     embeds a standard wiki proposal for the TARGET page so approval can reuse the
     existing apply path.
   - `resolveAttentionItem` (`:236-295`): on `approved` for kind `graduation`, apply
     the embedded `proposal` exactly like a `wiki_proposal` (`:247-254` path).
     Decision record + `attention.resolved` event already emitted there.
   - Brain emission: in the lint/maintenance pass where findings become attention
     items (`createAttentionItemsForLintFindings` `engine.ts:604-641` as the pattern),
     add a graduation pass instructing the LLM (same lint purpose or a sibling) to
     flag (a) personal-wiki facts that are actually work/scope truth →
     `personal-to-scope`, and (b) scope-wiki facts that are person-specific →
     `scope-to-personal`. Dedupe like lint findings (`lintFindingKey` `:596-597`
     pattern). Do NOT auto-pick winners; items are proposals only.
   - Privacy guard: a `personal-to-scope` item is filed on the TARGET (work) scope but
     must not leak more than the proposed page content itself; never include other
     personal pages in the payload.
4. Personal scopes ARE valid targets for the brain's event-driven maintenance (it has
   §C access); only the routine bulk sweep excludes them (point 1).

## F. Wizard defaulting cascade reads personal pages

`packages/api/src/modules/intake/service.ts` — `structuralContextForIntake`
(`:616-628`), consumed by `assembleIntakeExternalPack` (`:686-715`): append a
`## Personal context (actor)` section containing the acting principal's personal wiki
pages — fetch up to 5 most recently updated docs from their personal scope (title +
first ~40 lines of body each, truncated). Skip silently if no personal scope or no
pages. This flows into `assembleExternalPack` (`packages/wizard/src/index.ts:300-367`)
without wizard-package changes.

## G. Visibility (UI enumeration)

`packages/api/src/kernel/scopes.ts` `getVisibleTree` (`:246-311`):
- Root-granted branch (`:268-272`, returns ALL scopes): filter out every
  `type === "personal"` scope EXCEPT the caller's own.
- Non-root branch (`:274-308`): personal scopes only appear via direct grants —
  verify the caller's own personal scope shows up and others' don't.
- The caller's own personal scope should appear in the sidebar as a normal top-level
  entry (its name from §B). No special UI treatment in this brief.
- `NewScopeDialog` parent options (`apps/os/src/app/(app)/_components/Sidebar.tsx:510-512`)
  already filter to project/subproject — confirm personal never appears as a parent
  option (test or assertion, no UI redesign).

## Don't

- No admin backdoor of any kind: no env flag, no root-role exception for humans, no
  "support access". If a human isn't directly granted, resolveAccess returns null.
- No new retrieval machinery, no re-ranking changes, no per-nested-scope wikis.
- No personal-wiki UI surface work beyond the visibility filtering in §G (M10-04
  owns wiki surface UX).
- No changes to `wiki_proposal` handling, records, or the M10-03 citations path
  (citations `source: "personal"` will light up automatically via §D).
- Don't hand-edit the drizzle journal; don't run migrations against the dev DB.
- Modules never import each other; business logic in `packages/api`; every write
  emits an event (createScope/grantRole/saveDoc/attention already do).
- Do not commit. Do not touch `USER DATA/`, `legacy/`, `.env`, `vps-login.txt`.

## Acceptance criteria

1. `pnpm typecheck && pnpm lint && pnpm test` green from repo root.
2. Migration adds `personal` to `scope_type`; `createScope` accepts personal only as
   child of root; rejects nested personal.
3. `linkAuthUser` (new AND existing principal paths) leaves the human principal with
   an existing personal scope `personal-<principalId>` + direct owner grant;
   calling twice provisions once.
4. `resolveAccess` on a personal scope: direct owner grant → `owner`; human with root
   `owner`/`admin` grant → `null`; agent-kind principal with direct root grant →
   `agent`; unrelated principal → `null`. Non-personal scopes: unchanged behavior
   (existing grant tests still pass).
5. `recallMemory` for a principal with pages in their personal scope returns those
   hits with `source: "personal"` alongside scope-subtree hits; another principal
   recalling in the same scope context does NOT get them.
6. Graduation: a `graduation` attention item with an embedded proposal, when approved
   by an admin on the item's scope, applies the target-page edit (saveDoc) and writes
   the decision record; rejection applies nothing. Both directions representable.
7. Brain: routine sweep target list excludes personal scopes; ingest prompt contains
   the person-vs-work rule and the principal→personal-path map; a page routed to a
   valid personal target is written there (test with the PGlite harness + fixture
   LLM responses, following existing engine tests).
8. `getVisibleTree` as root admin: own personal scope visible, other principals'
   personal scopes absent; as plain user: same property.
9. Wizard external pack for an actor with personal pages contains the personal
   context section; empty/no-scope case degrades silently.
10. AGENTS.md updated for every module whose contract changed (kernel docs live in
    `packages/api/AGENTS.md`; also memory, attention, intake, brain, db, apps/os
    sidebar if touched).
11. Report every file changed with a one-line summary. On usage limits print
    `LIMIT-ALERT:` and stop.
