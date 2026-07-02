# M1-03: Kernel service layer
status: done
module: kernel
branch: task/M1-03

## Goal
`packages/api` gains the kernel services every module and MCP tool will call: scope-tree operations, grant resolution, token auth, and event emission — fully tested against PGlite.

## Context
- `docs/DESIGN.md` §5 (kernel semantics), CONSTITUTION §2–4.
- `packages/db` (merged M1-02) exports the six kernel tables + types. Test pattern with PGlite + migrations exists in `packages/db/src/kernel.test.ts` — reuse it.
- Services take a Drizzle db handle as their first argument (dependency injection — no global connection), so tests inject PGlite and runtime injects postgres-js.

## Do
1. `packages/api/src/kernel/scopes.ts`:
   - `createScope(db, {parentPath|null, slug, name, type, settings?}, actor)`: computes `path` from parent path + slug (root children: `slug`; deeper: `parent.path + "/" + slug`), validates slug (`[a-z0-9-]+`), inserts, emits `scope.created`. Rejects duplicate paths and missing parents with typed errors.
   - `getScope(db, path)`, `getChildren(db, path)`, `getSubtree(db, path)` (path-prefix query), `archiveScope(db, path, actor)` (sets status + emits `scope.archived`).
2. `packages/api/src/kernel/grants.ts`:
   - `grantRole(db, {principalId, scopePath, role}, actor)` — upsert, emits `grant.created`.
   - `resolveAccess(db, principalId, scopePath)` → highest role found walking from the scope up through its ancestors to root, or null. Role order: owner > admin > editor > viewer; `agent` grants read+write on the granted subtree but confer nothing outside it.
   - `requireAccess(db, principalId, scopePath, minRole)` → throws typed `AccessDeniedError` if insufficient.
3. `packages/api/src/kernel/tokens.ts`:
   - `issueToken(db, {principalId, name, expiresAt?})` → returns plaintext token once (`cos_` + 32 random bytes base64url); stores SHA-256 hash.
   - `authenticateToken(db, plaintext)` → principal or null (checks hash, revoked_at, expires_at; updates last_used_at).
   - `revokeToken(db, tokenId, actor)`.
4. `packages/api/src/kernel/events.ts`:
   - `emitEvent(db, {type, scopePath?, principalId?, payload})` — the single helper all writes use; and `listEvents(db, {scopePath?, type?, since?, limit})`.
5. All mutations emit events (CONSTITUTION §3). Export everything from `packages/api` index. Typed error classes in `packages/api/src/errors.ts`.
6. Tests (PGlite): path computation incl. depth 4; duplicate/invalid slug rejection; resolveAccess walk-up (grant on `airbuddy` grants access to `airbuddy/x/y`; no access to sibling `indya`); role precedence; requireAccess throws; token round-trip (issue → authenticate), revoked and expired tokens rejected; every mutation produced an event row (assert counts).

## Don't
- No HTTP/MCP wiring (M1-04), no UI, no Better Auth (that's human-session auth, later).
- Don't modify packages/db schema or migrations. Don't touch apps/, docs/, legacy/.

## Acceptance criteria
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass from root
- [ ] resolveAccess ancestor-walk tests pass exactly as specified above
- [ ] Tokens stored only as hashes; plaintext never persisted; auth path updates last_used_at
- [ ] Every mutating service emits a correctly-typed event (tested)
- [ ] All services accept an injected db handle; no module-level connections
