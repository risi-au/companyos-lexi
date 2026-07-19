# apps/os/src/modules/attention - AGENTS.md

UI module for the user-facing "Things to resolve" surface backed by the API
attention module.

## Purpose

Render open attention items on scope overview pages and let users resolve the items they
can act on from the OS. Approval items show compact context plus approve/reject buttons
for admins. `connection_expiry` items render in the main decisions section with Dismiss only. Targeted `page_update` items render in a separate "Following" section and
only expose Dismiss.

## Files

- `AttentionCard.tsx`: server component rendered by `apps/os/src/app/(app)/s/[...path]/page.tsx`; splits ordinary decision items from `page_update` following notifications, renders `connection_expiry` as dismiss-only, and renders wiki questions with outcome-specific actions.
- `actions.ts`: server action wrapper for `api.resolveAttentionItem` plus `api.resolveWikiQuestionAttentionItem`.
- `wiki-question.ts`: pure parser/display helper for V2 wiki-question payloads and legacy compatibility state.
- `WikiQuestionSubmitButton.tsx`: accessible pending state for Wiki question forms.
- `WikiQuestionForm.tsx`: client form shell that announces calm server-action errors.
- `AGENTS.md`: this contract.

## Contract

- Fetch data through `@/lib/api` wrappers only.
- Generic resolve writes go through `resolveAttentionItem`; the service applies wiki proposals,
  writes events/decision records for approval items, and dismisses targeted page updates.
- `lint_finding` rows never render generic Approve/Reject. Current contradiction
  questions show claim panels, one keyboard-accessible radio group for the mutually
  exclusive choices, before/after previews, Apply this correction,
  Open pages to compare, and Not a conflict. Current stale checks show Open page, Next
  review date, and Mark as current. Legacy or malformed checks show only Close as unclear.
- Page previews omit frontmatter metadata, and mutating Wiki question buttons expose a disabled pending state with an announced status.
- `connection_expiry` rows show title/summary and only the Dismiss action; approve/reject buttons must not render for them.
- `page_update` rows link back to the wiki page, show the last event and coalesced change
  count under Notifications on, and never render approve/reject affordances.
- Use design tokens only. Keep this as an operational card, not a chat/thread surface.

## Do Not

- Do not add polling, notification settings, emails, comments, or chat behavior. The
  owner-approved 2026-07-14 header `NotificationBell` is the sanctioned global notification
  surface; it links back to this card, which remains poll-free.
- Do not render full proposal bodies in context-like surfaces; overview may show only a
  compact preview.
- Do not bypass server actions for mutations.
