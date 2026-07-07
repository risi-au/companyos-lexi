# packages/api/src/modules/credentials - AGENTS.md

Credential vault module (M8-09): per-scope encrypted secret values for agents.

## Purpose
Store credential values encrypted in Postgres while exposing only metadata in list
responses. Connection documents and workbench instructions can reference
credentials by name, but secret values are fetched at work time through service/MCP
calls.

## Tables
- `credentials` in `packages/db/src/schema/credentials.ts`
  - `scope_id`, `name` unique per scope
  - `description`
  - `value_ciphertext`, `value_iv`, `value_tag`
  - `created_by`, `created_at`, `updated_at`, `last_accessed_at`

## Contract / Functions
All functions take `db: DB` first and are re-exported from `@companyos/api`.

- `setCredential(db, { scopePath, name, description?, value }, actor)`: admin/owner
  only. Upserts the named credential with AES-256-GCM using `COS_VAULT_KEY`. Emits
  `credential.created` or `credential.updated`.
- `listCredentials(db, { scopePath }, actor)`: viewer-or-better. Returns id, name,
  description, set/updated/last-accessed timestamps, and `hasValue: true`; never
  returns decrypted values or ciphertext.
- `getCredentialValue(db, { scopePath, name }, actor)`: agent/editor/admin/owner.
  Decrypts and returns the value, updates `last_accessed_at`, and emits
  `credential.accessed`.
- `deleteCredential(db, { scopePath, name }, actor)`: admin/owner only. Idempotent.
  Emits `credential.deleted` when a row existed.

## Environment
`COS_VAULT_KEY` must be a base64-encoded 32-byte key. If it is missing or invalid,
writes throw `VaultNotConfiguredError`; reads also throw `VaultNotConfiguredError`.
The app must keep booting without the key.

## Events
Credential events include only `credentialId` and `name`. Event payloads must never
contain plaintext values, ciphertext, IVs, auth tags, passwords, API keys, or tokens.

## How to test
- `node_modules/.bin/vitest.cmd run packages/api/src/modules/credentials/credentials.test.ts`
- Full task verification: `tsc -b`, eslint, and root vitest from repo root.

## Do / Don't
- Do use Node `crypto` AES-256-GCM only; do not add crypto dependencies.
- Do require kernel grants in the service layer.
- Do keep UI inputs write-only and list responses metadata-only.
- Do not log, emit, persist outside ciphertext, or echo plaintext values.
