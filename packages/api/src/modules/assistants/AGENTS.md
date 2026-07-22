# assistants — bundle contract + reference assistant (M13-01 + M13-07)

**What it is:** The machine-checkable schema (`assistantBundleSchema`) for portable assistant
definitions. Bundles declare role, skills, credentials (NAMES ONLY — never values), kickoff
templates, return contract, and learning hooks. The schema is the contract; bundle instances live
in the skills repo and sync via `sync_skills`. This module also exports the reference bundle:
`metaAdsAssistantBundle` (Meta Ads Assistant, drafted from the 2026-07-17 Nutrition Warehouse
optimum-weekend session).

**What it does:**
- `parseAssistantBundle(data)` — validate + normalize an assistant bundle against the contract.
- `assistantBundleSchema` — the canonical Zod schema.
- `metaAdsAssistantBundle` — a reference bundle (Meta Ads Assistant, `draft` autonomy).

**What it doesn't do:**
- Does NOT store bundles in the DB (they sync from the skills repo via the skills module).
- Does NOT store credential VALUES anywhere — names only; values live in the vault.
- Does NOT arm assistant identities (agent principals + scoped worker tokens + budget-capped
  LiteLLM keys — the plumbing already exists, see `docs/patterns/assistant-identity.md`).

**Tests:** `assistants.test.ts` — covers valid bundle, missing fields, invalid autonomy, and the
reference bundle shape.

**Dependencies:** `zod` (already a dependency of packages/api).

**Related:** `docs/patterns/assistant-identity.md` (how to arm a bundle with identity machinery),
`docs/assistants/meta-ads-assistant.md` (human-readable companion for the reference bundle).
