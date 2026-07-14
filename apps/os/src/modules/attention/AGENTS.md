# apps/os/src/modules/attention - AGENTS.md

UI module for the user-facing "Things to resolve" surface backed by the API
attention module.

## Purpose

Render open attention items on scope overview pages and let users resolve the items they
can act on from the OS. Approval items show compact context plus approve/reject buttons
for admins. Targeted `page_update` items render in a separate "Following" section and
only expose Dismiss.

## Files

- `AttentionCard.tsx`: server component rendered by `apps/os/src/app/(app)/s/[...path]/page.tsx`; splits ordinary decision items from `page_update` following notifications.
- `actions.ts`: server action wrapper for `api.resolveAttentionItem`.
- `AGENTS.md`: this contract.

## Contract

- Fetch data through `@/lib/api` wrappers only.
- Resolve writes go through `resolveAttentionItem`; the service applies wiki proposals,
  writes events/decision records for approval items, and dismisses targeted page updates.
- `page_update` rows link back to the wiki page, show the last event and coalesced change
  count, and never render approve/reject affordances.
- Use design tokens only. Keep this as an operational card, not a chat/thread surface.

## Do Not

- Do not add polling, notification settings, emails, comments, or chat behavior. The
  owner-approved 2026-07-14 header `NotificationBell` is the sanctioned global notification
  surface; it links back to this card, which remains poll-free.
- Do not render full proposal bodies in context-like surfaces; overview may show only a
  compact preview.
- Do not bypass server actions for mutations.
