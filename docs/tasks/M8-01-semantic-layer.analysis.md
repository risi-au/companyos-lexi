# M8-01 semantic layer analysis

## 1. Embedding granularity

Use one embedding per entity (`doc` or `record`) for M8-01. The brief's table has a unique
key on `(entity_type, entity_id)`, and the immediate consumers need scope-level semantic
recall, wizard similarity, and hybrid search over whole wiki pages/records. Chunking would
require chunk ids, chunk ordering, and multiple hits per source entity, which is useful for
very long pages but expands the contract beyond this task. The content hashed for skip is
the searchable text (`title` + markdown body), so updates replace the entity embedding
idempotently.

## 2. Generation path and outage behavior

Embedding generation runs after the write path returns: `saveDoc` and `createRecord`
enqueue deferred best-effort work from their existing event-emitting mutations. The
worker function can also be called directly by tests and backfill code. A LiteLLM outage,
missing `embed` alias configuration, or vector write failure is fail-open: the original
doc/record write succeeds, the failure is logged through the existing usage/alert style
with redacted metadata, and search behaves as keyword-only when query embeddings or stored
embeddings are unavailable.

## 3. Hybrid ranking

Keep the existing keyword contract unchanged for current consumers and add
`mode?: "keyword" | "semantic" | "hybrid"` with default `hybrid`. `keyword` is exactly the
current FTS path. `semantic` queries vector candidates only when embeddings are configured
and present, otherwise returns the keyword fallback required by the brief. `hybrid` runs
keyword and vector candidate retrieval, then fuses ranks with reciprocal rank fusion
(`1 / (k + rank)`) so neither score scale dominates and existing FTS hits remain stable
when vectors are absent.

## 4. PGlite vector tests

Enable PGlite's vector extension in test setup before migrations, then run the normal
Drizzle migrations against that instance. Tests use a fake embedding client injected into
the API embedding library, so no LiteLLM or live model calls occur. The fake uses a small
deterministic embedding dimension set via test env, which keeps vector SQL exercisable
without relying on provider-specific behavior.
