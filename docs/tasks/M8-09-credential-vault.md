# M8-09: Credential vault v1 — per-scope encrypted secrets for agents

status: todo (design settled 2026-07-07 owner session; Phase B of the wizard-v2 plan)
module: packages/db (migration) + packages/api (credentials module) + packages/mcp +
apps/os (scope page UI + wizard step)
branch: task/M8-09

## Goal

Agents working a scope get connection/credential info without asking the user each
time — without secret values ever sitting in a git repo, a doc, or transiting the
external interview. Owner: "while working with many clients and users, I don't want
these secrets exposed." The open `connection` procedure doc (how to log in, do's and
don'ts — client-specific, flexible) references credentials by name; values live
encrypted in the OS and are fetched at work time via MCP.

## Do

1. **Migration (plain SQL only)**: `credentials` table — id, scope_id (fk), name
   (unique per scope), description, value_ciphertext, value_iv, value_tag,
   created_by, created_at, updated_at, last_accessed_at.
2. **Crypto**: AES-256-GCM. Key from env `COS_VAULT_KEY` (32-byte base64). Missing
   key → vault disabled fail-open: writes rejected with a clear message, reads
   return a "vault not configured" error, nothing crashes. Key added to
   infra/docker-compose.prod.yml passthrough + .env.example + docs.
3. **Service** (packages/api/src/modules/credentials): setCredential (upsert),
   getCredentialValue, listCredentials (names + descriptions + set/updated
   timestamps — never values), deleteCredential. Grants: `admin` on scope to
   write/delete; `agent`-and-above on scope to read values. Every value read emits
   kernel event `credential.accessed` (scope, name, principal — never the value)
   and bumps last_accessed_at.
4. **MCP tools** (packages/mcp): `list_credentials(scope)`, `get_credential(scope,
   name)`. AGENTS.md managed block (provisioning/agents-md.ts) gains one line
   documenting them.
5. **UI**: credentials section on the scope page — add/edit/delete; value inputs
   are write-only (UI shows set/unset + updated_at, never echoes values). Wizard
   post-provision step lists `required_credentials` from the intake packet and
   reuses this UI; skippable and resumable later from the scope page.
6. **Connection-doc seeding**: when provisioning an intake with
   `required_credentials`, seed a `connection` doc from a template with
   `{{credential:name}}` references + the loginMethodNotes from the packet.
7. **Tests**: encrypt/decrypt round-trip; unique-per-scope; grant matrix (viewer
   denied value read, agent allowed, admin write); audit event emitted on read with
   no value in payload; fail-open behavior without COS_VAULT_KEY; MCP tool
   round-trip; usage-event SENSITIVE_KEY scrubbing still applies.

## Don't

- No plaintext values in logs, events, usage metadata, API list responses, or UI
  echoes. Ever.
- No expiry/rotation automation (M9-01 surfaces staleness), no per-credential ACLs
  beyond scope grants (M5-04).
- Don't block provisioning on credentials being filled — the step is skippable.

## Acceptance criteria

- [ ] Value stored encrypted; DB dump shows no plaintext
- [ ] Agent principal can `get_credential` on its scope; viewer cannot
- [ ] Every read produces a `credential.accessed` event without the value
- [ ] Missing COS_VAULT_KEY degrades cleanly with a clear message
- [ ] Wizard step fills values post-provision; connection doc references resolve
- [ ] AGENTS.md managed block mentions the tools; tests green
