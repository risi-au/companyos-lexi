# Pattern: Assistant identity

An **assistant** is a standing AI agent with a defined role, skills, credentials, and autonomy
posture. It needs a durable identity so it can authenticate, spend budget, and hold scope-bound
credentials. CompanyOS already has the machinery — this pattern documents how to wire a bundle to
an identity.

## Three pieces
1. **Agent principal.** Create an agent principal (via `createPrincipal`, type `agent`) for the
   assistant. The principal carries the assistant's name and ties to the parent organization.
2. **Scoped bearer token (worker token).** Provision a scope (`provisionScope`) for the assistant
   so it can hold vault entries (credential names from the bundle map to vault keys on this
   scope). Generate a bearer token for the assistant via `createToken` (type `worker`, bound to
   the agent principal). The assistant authenticates over MCP with a `cos_` worker token bound
   to that principal — the "Use a worker token instead" lane (non-human principals only).
3. **Budget-capped model key.** Mint a LiteLLM key for the assistant via `mintAdminLiteLlmKey`
   and cap spend with `setAdminLiteLlmKeyBudget`, so an assistant can never exceed its budget.

## Wiring a bundle to an identity
- The bundle's `credentials` (names only) map to vault entries on the assistant's scope.
- The bundle's `skillsManifest` resolves against the synced skills index.
- The bundle's `returnContract` is the minimum structured wrap-up (ties to briefed sessions,
  M13-02) the assistant must return via `complete_session`.
- Autonomy: default `draft` — the assistant proposes; spend/publish/send is proxied through the
  approval queue. `act` requires per-action approval, each a logged decision.

## Doctrine
- Credential values never live in a bundle or context file — names only; values in the vault.
- One active body per identity (the token is the baton). Bodies join the human's session by id.
