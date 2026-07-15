# FIX-bell-badge-refresh — bell badge doesn't update after resolving a notification

## Bug (owner-reported on staging, 2026-07-15)

Resolving/clearing an attention item ("Things to resolve") does not update the header
NotificationBell badge count. The owner had to refresh the page to see the lower number.
(The 60s poll or a window refocus would also eventually correct it, but same-tab
resolution should update it immediately.)

## Root cause (already diagnosed — do not re-investigate)

`apps/os/src/app/(app)/_components/NotificationBell.tsx` seeds client state once:

```tsx
const [items, setItems] = useState(initialItems);
const [total, setTotal] = useState(initialTotal);
```

`resolveAttentionFormAction` (`apps/os/src/modules/attention/actions.ts`) calls
`revalidatePath(...)`, so Next re-renders the `(app)` layout and passes FRESH
`initialItems`/`initialTotal` props to `NotificationBell` — but `useState` initializers
run only on first mount, so the stale badge persists until the next poll/refocus/reload.

## Do

1. In `NotificationBell.tsx`, sync `items` and `total` state when the
   `initialItems`/`initialTotal` props change. Use the standard React
   "adjust state when props change during render" pattern (track previous props in
   state and call the setters during render when they differ), NOT a `useEffect` —
   per React docs this avoids a stale-frame flash. Reference comparison on
   `initialItems` is fine (the server sends a new array each render).
2. Keep the existing 60s visibility-aware poll and focus-refresh behavior exactly
   as is. A poll result arriving between server renders must still win (i.e. the
   prop-sync must only fire when the props actually change identity, not on every
   render).
3. If (and only if) the repo already has an established client-component test
   pattern under `apps/os`, add a small test for the prop-sync. If there is no
   component/DOM test setup, do NOT invent one — skip the test and say so in your
   final summary.

## Don't

- Don't touch `notification-actions.ts`, `attention/actions.ts`, or any server code.
- Don't add polling frequency changes, new dependencies, or context providers.
- Don't restructure the component; this is a minimal state-sync fix.
- Don't commit (you can't) — leave changes in the working tree.

## Acceptance criteria

- `pnpm typecheck` passes (run `tsc -b` directly if pnpm is unavailable to you).
- After resolving an attention item on a scope page, the bell badge count drops
  without a manual page refresh (the architect will verify this in the running app).
- No behavior change to the poll/focus/visibility logic.
