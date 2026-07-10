# apps/os/src/modules/attention - AGENTS.md

UI module for the user-facing "Things to resolve" surface backed by the API
attention module.

## Purpose

Render open attention items on scope overview pages and let admins resolve them from
the OS. The card is intentionally compact in M10-01: it shows kind, title, age, a short
summary, and approve/reject buttons. Full diff review belongs to M10-04.

## Files

- `AttentionCard.tsx`: server component rendered by `apps/os/src/app/(app)/s/[...path]/page.tsx`.
- `actions.ts`: server action wrapper for `api.resolveAttentionItem`.
- `AGENTS.md`: this contract.

## Contract

- Fetch data through `@/lib/api` wrappers only.
- Resolve writes go through `resolveAttentionItem`; the service applies wiki proposals
  and writes events/decision records.
- Use design tokens only. Keep this as an operational card, not a chat/thread surface.

## Do Not

- Do not add polling, notifications, Talk pages, comments, or chat behavior.
- Do not render full proposal bodies in context-like surfaces; overview may show only a
  compact preview.
- Do not bypass server actions for mutations.
