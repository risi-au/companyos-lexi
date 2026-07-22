# apps/os/src/modules/digest - AGENTS.md

Digest UI (M13-05): the daily "dream morning" landing surface. Renders the five lanes from
`api.getDigest` (packages/api digest module). Read-only; each item shows why it needs you and
what happens after you act.

## Files
- `DigestView.tsx`: client component; renders each lane with its items or an empty-state note.
- `index.ts`: exports DigestView.

## Notes
- The /digest route (`app/(app)/digest/page.tsx`) is the post-auth landing (middleware + the
  `/` fallback both redirect here). Deep links from items to their source surfaces are a follow-up.
