# apps/os/src/modules/connect - AGENTS.md

Per-scope "Connect to MCP" UI (M6-02). Lets authorized users mint scoped MCP connection tokens, copy ready-to-paste client configuration snippets, and revoke visible connections according to the service-layer permission matrix.

## Purpose
Provide a scope-local connection panel for remote MCP clients. The UI is intentionally thin: current principal resolution happens in server actions, all permission checks and writes happen in `packages/api` connect services, and plaintext tokens are only held in client state immediately after minting. Scoped memory access is default-on for connection tokens and displayed as the service-derived `memoryAccess` value.

## Files
- `ConnectPanel.tsx`: client component with mint form, token-shown-once copy UI, MCP client snippets, and this scope's connections table including the derived Memory column.
- `actions.ts`: "use server" wrappers around `api.mintConnectionToken`, `api.listConnectionTokens`, `api.revokeConnectionToken`, plus MCP public URL resolution from env.
- `index.ts`: public export for the scope page.
- `AGENTS.md`: this file.

## Data / Contract
Consumes from `@companyos/api` via `@/lib/api`:
- `mintConnectionToken({ scopePath, name, role, expiresAt? }, actor)`
- `listConnectionTokens({ scopePath }, actor)`
- `revokeConnectionToken({ tokenId }, actor)`

Roles are limited to `agent` and `viewer` in the UI. Expiry presets are UI-only and are converted to absolute `expiresAt` dates before calling the service.

## Permissions
The service layer is authoritative. The UI mirrors the M6-02 matrix:
- `viewer`: can read connection docs and table; cannot mint or revoke.
- `editor` / `agent`: can mint `agent` or `viewer` connections and revoke only rows the service marks as revocable.
- `admin` / `owner`: can mint and revoke any listed connection.

## Environment
Snippets use `MCP_PUBLIC_URL`. If unset, actions derive `${COMPANYOS_URL}/api/mcp`; if both are unset, snippets fall back to `/api/mcp` for local/dev contexts.

## Usage in scope page
```tsx
import { ConnectPanel } from "@/modules/connect";

<ConnectPanel scopePath={scopePath} initialAccess={access} />
```

## Testing / Acceptance
- `pnpm typecheck && pnpm lint && pnpm test` from repo root.
- Browser verification: viewer sees read-only panel; editor can mint and sees plaintext once; snippets include the fresh token; revoke buttons match the matrix; table refreshes after mint/revoke.

## Do / Don't
- Server actions + service layer only; never call the database directly from UI.
- Never store plaintext tokens outside transient client state.
- Update this AGENTS.md on behavioral changes.
