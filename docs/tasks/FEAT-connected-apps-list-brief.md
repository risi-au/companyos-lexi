# Brief: Connected apps section in ConnectPanel (implementer)

Plan: `docs/tasks/FEAT-connected-apps-list.plan.md`. Read `docs/CONSTITUTION.md` §12
(agent conduct) and `apps/os/src/modules/connect/AGENTS.md` before editing.

## Do (exactly this, three files)

### 1. `apps/os/src/modules/connect/actions.ts`

Add one action following the exact pattern of `listConnectionTokensAction`:

- `export async function listOAuthConnectionsAction()` — no parameters.
- `const actor = await getCurrentActorPrincipalId();` then
  `if (!actor) throw new Error("Your session expired. Sign in again.");`
- `return api.listOAuthConnections({ principalId: actor }, actor);`
- Do NOT pass `since` (the existing `getOAuthConnectionStatusAction` keeps its `since`;
  leave it untouched).

### 2. `apps/os/src/modules/connect/ConnectPanel.tsx`

- Add a local row interface (dates may arrive serialized):

  ```ts
  interface OAuthConnectionRow {
    oauthClientId: string;
    clientName: string | null;
    principalId: string;
    firstUsedAt: string | Date;
    lastUsedAt: string | Date;
  }
  ```

- Add `const [oauthConnections, setOauthConnections] = useState<OAuthConnectionRow[]>([]);`
- Extend the existing `refresh()` `Promise.all` with `listOAuthConnectionsAction()` as a
  third element; `setOauthConnections(oauthRows as OAuthConnectionRow[])` on success, reset
  to `[]` in the existing catch. Do not add a second loading flag — reuse `loading`.
- Insert a new section BETWEEN the `<ConnectWizard ... />` line and the worker-tokens card
  `<div className="rounded-[var(--radius-md)] ...">`:
  - While `loading`: render nothing for this section (the tokens card already shows the
    loading line).
  - If `oauthConnections.length === 0`: exactly one muted line, NOT a card:
    `<div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No apps connected via OAuth yet.</div>`
  - Otherwise: a card copying the worker-tokens card conventions exactly
    (`rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]`):
    - Header: `Link2` icon from lucide-react (size 18) + title "Connected apps"
      (`text-[var(--font-size-sm)] font-medium`) + muted subtitle line
      "Apps connected to your account via OAuth"
      (`text-[var(--font-size-xs)] text-[var(--muted-foreground)]` — plain, not font-mono).
      No refresh button in this card.
    - Table: same markup style as the tokens table (`overflow-x-auto` wrapper,
      `w-full text-left text-[var(--font-size-sm)]` — use `min-w-[480px]`, not 900),
      thead classes copied from the tokens table. Columns: App, First used, Last seen.
    - App cell: `row.clientName` when non-null (`font-medium`), else `row.oauthClientId`
      in `font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]`.
    - Date cells: `py-[var(--space-2)] tabular-nums` + the existing `formatDate` helper.
    - Row key: `row.oauthClientId`. Row class: `border-t border-[var(--border)]`.

### 3. `apps/os/src/modules/connect/AGENTS.md`

- Files section: extend the `ConnectPanel.tsx` line to mention the Connected apps section.
- Data/Contract section: add `listOAuthConnections({ principalId }, actor)` (self-only).
- One or two sentences under the OAuth-first wizard section: the panel lists the signed-in
  principal's OAuth-connected apps (name, first used, last seen); revoke and session
  counts are out of scope.

## Don't

- No changes to `packages/api`, schema, services, tests, or any other file.
- No per-app revoke button, no counts, no `since` filtering, no new loading/error states.
- No new dependencies; icons only from lucide-react (already imported in the file).
- No component test scaffolding.
- Plain ASCII in source string literals; UTF-8 without BOM.
- Do NOT commit. Do NOT run pnpm (not available in your sandbox).

## Acceptance

- Diff touches exactly the three files above.
- `tsc`/eslint clean for the touched files (orchestrator runs the full gates).
- Empty state = one muted line, no card. Non-empty = card visually consistent with the
  worker-tokens card.

## Report back

List files changed and any deviation from this brief with a one-line reason.
