# M2-03: Web app foundation (auth, shell, scope tree, scope pages)
status: todo
module: web (apps/os)
branch: task/M2-03

## Goal
`pnpm dev` serves a signed-in OS: login, app shell in the design system, scope tree navigation in the sidebar, and a scope page showing live records + tasks (read-only). The first thing a human actually *sees*.

## Context
- `docs/DESIGN.md` §4 (stack), `docs/DESIGN-SYSTEM.md` (visual contract — follow exactly: tokens, Inter/JetBrains Mono, light+dark, Lucide icons), CONSTITUTION §2 (API-first: pages/server components call `packages/api` services only, never the DB), §7 (tokens only).
- **Better Auth** with the Drizzle adapter on our Postgres. Auth tables live in `packages/db/src/schema/auth.ts` (additive migration — pre-approved). Email/password only for now; OIDC comes later (config-ready).
- **Auth ↔ kernel principal link (pre-approved additive kernel change):** add nullable `auth_user_id` text column (unique) to `principals` via new migration. On first sign-in: if a principal with the same email exists, link it; else create a principal (kind human). **Bootstrap rule:** if no principal in the instance has an `owner` grant on the root scope with a linked auth user, the first user to sign in gets their principal linked + owner grant on root (emits `principal.bootstrapped`). Implement this in `packages/api/src/kernel/auth-link.ts` with tests.
- Web session → services: every server-side call resolves the session's principal id and passes it as actor (services enforce grants — the UI adds no permission logic of its own).
- Demo data exists: scope `airbuddy` with records, tasks in Plane, metrics, and a saved dashboard spec.

## Do
1. `packages/db/src/schema/auth.ts` (Better Auth's generated schema) + `principals.auth_user_id` migration. Wire Better Auth server config in `apps/os/src/lib/auth.ts` (drizzle adapter, email/password enabled, secret from env `BETTER_AUTH_SECRET` — add to .env.example).
2. Auth pages: `/sign-in`, `/sign-up` (styled per design system, minimal). Middleware/layout guard: all app routes require session, redirect to /sign-in. Sign-out in the user menu.
3. App shell (`apps/os/src/app/(app)/layout.tsx`): left sidebar — product name, scope tree (from `getSubtree` service, indented, collapsible top levels, active state), user menu at bottom (name, sign out, theme toggle light/dark via tokens). Content area with breadcrumb (scope path segments).
4. Scope page `/(app)/s/[...path]/page.tsx`: header (scope name, type badge, status), tab bar driven by module_instances (for now render two tabs unconditionally: **Overview**, **Activity**):
   - Overview: recent records list (kind badge, title, date — via listRecords) + open tasks list (via listTasks; handle Plane-unconfigured gracefully) as two token-styled cards.
   - Activity: recent events for the scope (listEvents) as a simple timeline.
5. Home `/` : redirect to `/s/root` (root scope page works like any other).
6. A tiny `+ New scope` affordance in the sidebar (dialog: name, slug, type, parent = current scope) calling createScope — the first write from the UI (owner/admin only; hide otherwise based on resolveAccess).
7. Tests: auth-link unit tests (link-by-email, create-new, bootstrap-first-owner) in packages/api; component smoke tests are NOT required (UI verified by architect in browser).

## Don't
- No dashboard rendering (M2-04). No KB/canvas. No admin pages. No OIDC providers yet.
- No DB access from apps/os outside the auth adapter — services only.
- Don't touch packages/mcp, other module schemas, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] auth-link tests pass incl. bootstrap rule
- [ ] `pnpm dev` → sign-up → land on root scope; sidebar shows airbuddy tree; airbuddy Overview shows seeded records and Plane tasks; Activity shows events; theme toggle works (verified by architect in browser — leave it working)
- [ ] No raw colors/spacing in new UI code — tokens/primitives only (spot-checked in review)
- [ ] .env.example updated (BETTER_AUTH_SECRET)
