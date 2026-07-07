# packages/api/src/modules/memory - AGENTS.md

Scoped second-brain memory access for agents.

## Purpose
Provides `recallMemory(db, { query, scopePath?, limit? }, actor)` for MCP/UI clients that need distilled wiki knowledge without broadening grants or trawling raw records.

## Contract
- Read-only. No writes except redacted usage logging via `logUsageEventSafely`.
- Does not call an LLM.
- Returns typed wiki/document hits only: page id/slug/title, scope path, snippet, date, source bucket, and parsed frontmatter/confidence when present.
- Effective scope is the requested scope when the actor can view it; otherwise a single narrower direct grant inside the requested subtree narrows the read.
- Retrieval is structurally limited to:
  - active docs in the effective scope subtree,
  - active docs in the nearest ancestor wiki-owning scope from the existing wiki walk,
  - root docs with slug `critical-facts` or `pattern-*`.
- Root allowlist reads are mediated by service SQL predicates, not by granting root access.
- Usage metadata must never store query text, snippets, markdown bodies, bearer tokens, or plaintext secrets.

## Files
- `service.ts` - read-only memory retrieval and usage logging.
- `memory.test.ts` - PGlite coverage for subtree isolation, root allowlist, ancestor wiki walk, scope narrowing, and usage redaction.

## Do / Don't
- Do keep this as a thin mediation layer over documents/search primitives.
- Do not return records, archived docs, or unrestricted root pages.
- Do not widen token grants or add token schema flags.
