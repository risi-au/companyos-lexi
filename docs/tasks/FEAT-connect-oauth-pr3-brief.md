# FEAT-connect-oauth-pr3: truthful token status + expiry attention in the bell

status: todo
module: multi (connect + attention services in packages/api, one enum migration, bell/panel UI in apps/os)
branch: task/FEAT-connect-oauth-pr3 (stacked on task/FEAT-connect-oauth-pr2)
issue: #53 (this PR closes it)
plan: docs/tasks/FEAT-connect-oauth.plan.md (section "PR 3 — Status + notifications" + "Files to modify (PR 3)")

## Goal

The Worker-tokens list stops lying: each token shows a derived status — Active / Expired /
Revoked / Never used — instead of Active-unless-revoked. Expired and expiring-soon (7 days)
worker tokens raise `connection_expiry` attention items that appear in the header bell and
deep-link to the scope's connect tab; revoking a token clears its open items.

## Context (read these, nothing else)

- Plan: `docs/tasks/FEAT-connect-oauth.plan.md` (PR 3 section — follow it exactly)
- `docs/CONSTITUTION.md`
- `packages/api/src/modules/connect/service.ts` + `connect.test.ts` + `AGENTS.md` —
  `listConnectionTokens` (status derivation goes here), `revokeConnectionToken` (auto-dismiss
  hook), sweep function lands in this file
- `packages/api/src/modules/attention/service.ts` + `attention.test.ts` + `AGENTS.md` —
  `createAttentionItem`/`resolveAttentionItem`; add internal no-actor helpers here
- `packages/db/src/schema/attention.ts` — `attention_kind` enum + `AttentionItem` type unions
- `packages/db/AGENTS.md` — migration workflow (generate only; enum value add is a plain
  migration, precedent: `personal` scope_type)
- `apps/os/src/lib/labels.ts` — `labelForConnectionStatus` (line ~84)
- `apps/os/src/modules/connect/ConnectPanel.tsx` — status cell (PR 2 shape of this file)
- `apps/os/src/app/(app)/_components/notification-actions.ts` — bell refresh action
  (sweep trigger goes here); `NotificationBell.tsx` — kind labels + link targets
- `apps/os/src/modules/attention/AttentionCard.tsx` + `AGENTS.md` — kind-specific rendering

## Key facts

- This branch stacks on PR 2: `oauth_connections` exists, wizard is in ConnectPanel.
  Do NOT rework PR 2 code; add to it.
- Attention module rules: bell is the only sanctioned notification surface; AttentionCard
  stays poll-free; `page_update` is the dismiss-only precedent for non-approval kinds.
- The sweep has no acting user, so it cannot go through `createAttentionItem`'s grant
  check; `created_by` is NOT NULL, so use the token's `minted_by` principal.
- Bell items currently all link to `/s/<scopePath>?tab=overview`.

## Do

1. **Enum migration**: add `connection_expiry` to `attention_kind` in
   `packages/db/src/schema/attention.ts` and every kind union in that file (and any other
   kind union the typecheck surfaces). Generate the migration with
   `pnpm --filter @companyos/db db:generate`. Do not run it against any DB.
2. **Derived status** in `listConnectionTokens`: add `status: "active" | "expired" |
   "revoked" | "never_used"` to each row — precedence: revoked > expired
   (`expiresAt` non-null and `< now`) > never_used (`lastUsedAt` null) > active. Keep the
   existing `revoked` boolean (UI compatibility). Derive in TS after fetch; no query rewrite.
3. **Internal attention helpers** in the attention service (module-internal, NOT exported
   from the package index if avoidable; if the connect module cannot import them
   internally — modules must not import each other — put them in the attention service
   and re-export through `@companyos/api` like other cross-module service calls):
   - `createSystemAttentionItem(db, { scopeId, kind, title, summary, payload, createdBy })`:
     inserts an open item without grant checks, emits `attention.created` (same payload
     shape as the normal path).
   - `dismissAttentionItemsInternal(db, { kind, payloadTokenId, note })`: dismisses all
     open items of that kind whose `payload->>'tokenId'` matches, `resolved_by` = the
     item's own `created_by`, emits `attention.resolved` per item, creates NO decision
     records.
4. **Sweep** `ensureConnectionExpiryAttention(db)` in the connect service:
   - Candidates: non-revoked connection tokens with non-null `expires_at` where
     `expires_at < now + 7 days`.
   - State: `expired` if `expires_at < now`, else `expiring`.
   - For each candidate with no open `connection_expiry` item for its `tokenId`: create
     one via `createSystemAttentionItem` on the token's scope — title like
     `Worker token "<name>" expires soon` / `... has expired`, summary with the date,
     payload `{ tokenId, name, scopePath, state, expiresAt }`, `createdBy` = `minted_by`.
   - If an open item exists but its `payload.state` is `expiring` and the token is now
     expired: dismiss it (note "superseded: token expired") and create the `expired` item.
   - Idempotent: running twice in a row creates nothing new. Return counts
     `{ created, superseded }` for tests.
5. **Auto-clean on revoke**: `revokeConnectionToken` additionally dismisses open
   `connection_expiry` items for that token (note "token revoked") in the same
   transaction/flow.
6. **Sweep trigger** in `notification-actions.ts`: at the top of
   `refreshNotificationsAction`, call the sweep behind a module-level in-process throttle
   (skip if last run < 5 minutes ago; fire-and-forget failure-safe — a sweep error must
   not break the bell). Note the throttle variable resets per server process; that is
   acceptable.
7. **Bell UI** (`NotificationBell.tsx`): add `connection_expiry: "Worker token"` to
   KIND_LABELS; link items of this kind to `/s/<scopePath>?tab=connect` (others keep
   `?tab=overview`).
8. **AttentionCard**: render `connection_expiry` items in the decisions section with
   title/summary and a Dismiss-only affordance for admin/owner (route through the
   existing resolve server action with status `dismissed`); no approve/reject buttons.
9. **ConnectPanel + labels**: `labelForConnectionStatus(status: string)` maps the four
   states to "Active" / "Expired" / "Revoked" / "Never used"; status cell uses
   `row.status`, rendering Expired/Revoked in `--destructive` and Never used in muted
   foreground (design tokens only).
10. **Tests**:
    - connect: status matrix (all four states); sweep creates once + idempotent;
      expiring→expired supersede; revoke dismisses open items; events emitted
      (`attention.created` / `attention.resolved`).
    - attention: internal helpers insert/dismiss without grants and emit events; normal
      actor paths unchanged.
    - Keep every existing test green.
11. **AGENTS.md updates** in the same change set: connect service (status derivation,
    sweep, revoke hook), attention service (internal helpers + new kind), apps/os
    attention module (new kind rendering), and the bell note if
    `apps/os/AGENTS.md`/module docs mention kinds.

## Don't

- Commit (orchestrator commits after review)
- Touch USER DATA/, legacy/, `.env*`, vps-login.txt
- Rework PR 2 wizard code or existing mint/list/revoke signatures (adding the `status`
  field is the only list change)
- Add cron infra, background jobs, emails, or per-item notification settings
- Hand-edit `drizzle/meta/_journal.json`; run migrations against the dev DB
- Notify for OAuth connections (tokens only in this PR)
- Non-ASCII characters or BOMs in source files

## Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from repo root
- [ ] Token list shows truthful status for all four states
- [ ] An expiring-soon (within 7d) token yields exactly one open bell item that
      deep-links to the connect tab; expiry flips it to an "expired" item; revoke clears it
- [ ] Sweep is idempotent and throttled; bell refresh never fails because of it
- [ ] All tests in Do#10 exist and pass; AGENTS.md files updated
- [ ] Report every file changed + deviations

On usage limits print `LIMIT-ALERT:` and stop.
