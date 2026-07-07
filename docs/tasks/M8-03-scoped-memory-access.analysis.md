# M8-03 Scoped Memory Access - Analysis Gate

## 1. Raw Hits vs LLM-Synthesized Answers

`recall_memory` should return deterministic raw wiki hits: page identity, owning scope, slug, title, snippet, and surfaced frontmatter confidence/provenance fields when present. It must not call an LLM or synthesize an answer.

Rationale:
- Scope safety is easier to prove when the service returns only structurally selected pages/snippets.
- Cost and latency stay aligned with `get_context`/`search`.
- The caller already has an LLM and can synthesize from the returned evidence.
- Usage logging can stay redacted by storing counts, byte/token estimates, source buckets, and slug classes without queries or snippets.

## 2. Root Page Allowlist

Non-root tokens may recall only these root wiki pages:
- `critical-facts`
- slugs matching `pattern-*`

No other root docs are recallable by mediated memory, even if they semantically match. The service enforces this in the query predicate itself: root-scope rows are included only when `documents.slug = 'critical-facts' OR documents.slug LIKE 'pattern-%'`. This is separate from grant checks and never widens the caller's actual grants.

Root-scoped actors keep their normal grant behavior and may receive root wiki pages through their effective scope, but the mediated root-pattern branch remains structurally allowlisted for non-root actors.

## 3. Token Flag vs Default-On

Memory access is default-on for scoped agent/viewer MCP connection tokens. No token schema or grant widening is needed.

Rationale:
- The access boundary is already the principal's grant subtree plus the root allowlist; a separate mutable flag would create configuration drift without increasing isolation.
- Existing tokens become capable after deployment, which matches the milestone goal that every agent token can draw on the brain.
- The Connect panel and MCP Manager should show "Memory: on" as a derived capability for connection tokens rather than persisting a new flag.
