# Memory System Deep-Dive: COS Brain vs. Honcho vs. the Field

*Date: 2026-07-19. Companion to `COS-TO-LEXI-GAP-REPORT.md` (expands Shot 8). Based on: full audit of `packages/brain` / `packages/api` / `packages/db` internals (HEAD `4512d66`), a technical dossier on Honcho v3.0.11 (plastic-labs, AGPL-3.0), and a landscape survey of Zep/Graphiti, Mem0, Letta, LangMem, Memobase, Cognee, Supermemory, Hindsight, EverOS, MemU. Vendor benchmark claims flagged as vendor-run throughout.*

---

## 1. First, the category error to avoid

COS's brain and Honcho/Mem0/Zep are **not the same kind of system**, and the comparison only makes sense once you see that:

| | **COS brain** | **Honcho / Mem0 / Zep** |
|---|---|---|
| Memory unit | Whole markdown **pages** (wiki-as-memory) | Atomic **claims** (conclusions, fact-edges, memory rows) |
| Input | Work **records**, events, sessions, git pushes | Chat **messages** / interaction streams |
| Question it answers | "What is true about this project/company?" | "Who is this person and what do they prefer?" |
| Synthesis | Nightly LLM **full-page rewrites** | Continuous/batched claim extraction + dream-time revision |
| Provenance | Convention (`## Sources` markdown section) | Graphiti: strong (episodes); Honcho: internal-only; Mem0: weak |

Lexi needs **both** layers: institutional memory (what COS has) *and* per-user interaction/preference memory (what it completely lacks — Ask OS chat turns are explicitly excluded from brain inputs, `packages/brain/src/engine.ts:791`). So the real question isn't "ours vs. theirs" — it's "which layers do we build, buy, or borrow."

---

## 2. Head-to-head on the mechanics

### Ingestion
- **COS**: fire-and-forget embedding enqueue on write (lossy, no retry — `lib/embeddings.ts:251-257`); nightly synthesis triggered by a cron sidecar hitting an HTTP endpoint that runs the whole engine **inline in the request** — no queue, no lock, no worker (`apps/os/src/app/api/v1/brain/run/route.ts:43-54`). Inputs capped at 200 records + 500 events per scope (`engine.ts:784,788`).
- **Honcho**: synchronous cheap write + Postgres queue consumed by a separate Deriver process, horizontally scalable, token-batched (~1 reasoning pass per 1k tokens, 30-min flush). Genuinely better engineering.
- **Graphiti**: LLM extraction per episode (expensive per write, bi-temporal dedup). **Mem0 v3**: one ADD-only call per write, conflicts deferred to query time.

### "Dreaming" (sleep-time compute)
- **COS**: nightly per-scope ingest (one `cheap` call with **all scope docs at 4KB each** in the prompt — `engine.ts:842,926-933`) + weekly lint (contradiction flag + graduation proposals). Contradictions are **flag-only** — humans resolve via attention items.
- **Honcho**: agentic Dreamer per (observer, observed) pair — a *deduction specialist* (knowledge updates, **contradiction resolution**) + *induction specialist* (pattern formation with confidence). More sophisticated than COS's, but experimental, and dreaming is about *people*, not projects.
- **Hindsight**: `reflect()` builds separate "mental models" from raw memories. **EverOS**: offline "Reflection" merging markdown clusters — the closest living relative of the COS design.

### Retrieval
- **COS**: hybrid FTS + pgvector with RRF k=60, grant-mediated union (personal → subtree → ancestor → root), **no LLM at query time** — cheap and predictable. Weakened by whole-document embeddings (no chunking — `lib/embeddings.ts:83-85`) and global HNSW with post-filter scope isolation.
- **Honcho**: dialectic = agentic tool-loop, 1–10 LLM iterations per query ($0.001–$0.50 managed). Powerful, expensive. Its *free* reads (representation, context packing) are the parts worth stealing.
- **Hindsight**: best-in-class 4-way parallel recall (semantic + BM25 + graph + temporal, RRF + cross-encoder).

---

## 3. Can COS's memory scale? Honest answer: the *architecture* yes, the *current implementation* no

The binding constraints are **not Postgres** — they're in the synthesis loop:

**The killers (break first, in order):**
1. **The 24k-token run ceiling vs. uncapped prompts** (`engine.ts:33` + `:842`). Every ingest resends *all* scope docs (~4KB each). A mature scope with >~90KB of pages+inputs **can never complete ingest** — memory quality silently degrades exactly as a scope accumulates history. Synthesis cost is O(entire scope) per night against a flat budget. Monthly budget enforcement also silently dies beyond 1,000 usage rows (`usage/service.ts:422`).
2. **Inline-request brain runs** — no queue, no lock; concurrent runs can interleave page writes; a run is not transactional (partial multi-page synthesis stays partially applied).
3. **Whole-page rewrite synthesis** — no claim-level delta; a bad LLM merge is committed wholesale with no diff validation; provenance stays as prose, not structured claim→source links (blocks the Lexi knowledge contract).
4. **Unbounded `events` / `usage_events` / `agent_messages`** with no retention; `document_revisions` has **no index on `document_id`** (seq scan per save); webhook idempotency scans unindexed payloads; revisions pruned to 50/doc (history beyond that unrecoverable).
5. **No conversational/user-model memory at all** — the assistant layer cannot learn from interaction, only from nightly-routed work records. For "Lexi learns you," this is the missing organ.

---

## 4. Scenario matrix — what holds, what breaks

| Scenario | Verdict | What breaks / what's needed |
|---|---|---|
| **Single user (Rishi), ~10 scopes, 1–2 yrs data** | 🟢 **Holds** with minor fixes | Add the missing `document_revisions` index, events/usage retention policy, raise/chunk the ingest ceiling. Postgres yawns at this volume. |
| **One company, 10–50 users + daily agents** | 🟡 **Cracks** | Lint graduation reloads 100 personal pages **per linted scope** (quadratic N+1); DB pool of 10 saturates with inline brain runs; per-user preference memory can't keep up via nightly routing — an assistant that "learns you" needs same-day claim-level memory, not tomorrow's wiki rewrite. |
| **Heavy data (1M+ records, years of history)** | 🟠 **Retrieval degrades, synthesis halts** | Whole-doc vectors blur, global HNSW + post-filter slows, ingest ceiling blocks mature scopes. Needs: chunking, incremental/claim-level synthesis, per-scope vector partitioning. |
| **Multi-company (instance-per-tenant)** | 🟢 **Holds by design** | Single-tenant schema is a feature here. Fleet ops is a DevOps problem, not a memory problem. |
| **Final Lexi: company + individual federated brains** | 🔴 **Neither COS nor Honcho is ready** | Individual Lexi must be portable/light (user-owned hardware or per-user instance) — a Postgres+LiteLLM VPS brain per person is heavy; think SQLite/LanceDB-class (EverOS/MemU pattern). Federation needs export bundles + stable artifact IDs + no-cross-brain-leakage proofs — which is *your own* conformance suite, unwritten. |
| **Many end-users (SaaS-style, 1000s)** | 🔴 **Out of current scope** (correctly) | Would need per-user claim stores at scale — the Memobase/Honcho home turf. Not the proving phase. |

---

## 5. Should you adapt or fork something better? — No. Here's the sharper move

**Don't fork Honcho.** AGPL-3.0 on a network-deployed memory layer inside a SaaS; two breaking rewrites in 7 months with dreaming explicitly experimental; its best models (Neuromancer) are managed-only; its reasoning is tuned for *identity cognition*, not institutional knowledge; and — decisively — **its public API has no conclusion→source citations**, which violates the hard provenance requirement. Forking it would import their churn and lose the one genuine differentiator.

**Don't adopt Zep/Graphiti as core** either — best-in-class bi-temporal model, but requires Neo4j/FalkorDB (goodbye single-Postgres doctrine) and the multi-user layer is Zep Cloud (vendor pull).

**The whitespace the survey found:** *no surveyed system ships human-confirmation review states or claim-level citations as first-class citizens.* The `unreviewed → verified/disputed/stale` model is unclaimed territory. Any vendor adopted becomes a downgrade on the strongest axis.

**The recommended path — "keep the core, steal the organs":**

1. **Keep COS brain as engine v1** (the Lexi architecture doc already concluded this) and extract the Lexi Core contract around it (Shot 8 in the gap report).
2. **Fix the five killers directly** — none require a vendor:
   - Move brain runs to a **queue + worker** (steal Honcho's deriver pattern: Postgres queue, token-batched work units, per-scope ordering).
   - Replace whole-page-resend with **incremental synthesis**: chunking + only changed pages/claims in the prompt; raise the ceiling; fix the 1000-row budget undercount.
   - Go **claim-aware**: store structured claims (jsonb) with `sourceRefs`, `reviewState`, temporal fields per the `knowledge-artifact-v1` schema — pages become *renderings* of claims. This unlocks diff validation of LLM merges, real citations, and the review-state differentiator.
   - Add **temporal validity** (`valid_from/until`, invalidate-don't-delete) — steal Graphiti's one great idea; it solves staleness properly.
   - Indexes + retention: `document_revisions(document_id)`, events/usage partitioning or archival.
3. **Add the missing per-user layer as a separate service behind the contract** — preference/working-style memory with same-day learning. Cheapest honest route: **LangMem-style primitives on the existing Postgres** (MIT, single-DB, profile + episodic docs) or a Memobase-style profile-slot table (buildable in ~a week) — not a Honcho dependency. Feed it from Ask OS turns + session returns; gate promotion into the personal wiki through the existing attention queue (this is exactly the M13-04 defaulting cascade's data source).
4. **Steal Honcho's dreamer *idea*** for the lint pass: deduction (contradiction resolution proposals) + induction (pattern formation with confidence) — as *proposals* into attention items, keeping humans as the gate. 80% of the value, none of the AGPL/experimental churn.
5. **For far-future Individual Lexi:** evaluate EverOS/MemU-class markdown-file stores (portable, git-versionable, zero-LLM-write options) — they fit the "personal brain on the person's own metal" requirement better than anything Postgres-bound.

**Re-evaluation triggers** (when to reconsider adopting): if Graphiti ships a Postgres backend; if Honcho changes license or productizes citation export; if the 1000s-of-users SaaS scenario arrives before the claim-level rebuild is done.

---

## Bottom line

The memory *architecture* — immutable records → synthesized markdown → hybrid retrieval, human-gated — is sound, more portable than anything on the market, and sits on genuinely unclaimed differentiators (review states, provenance, grant-mediated privacy). The memory *implementation* has a synthesis loop that scales O(scope maturity) against a flat token budget, plus a missing per-user interaction layer. Neither problem is solved by Honcho or any provider — Honcho would give a better queue and a worse everything else. **Fix the loop, add the user layer, steal four patterns (Honcho's batched deriver + dreamer, Graphiti's bi-temporal invalidation, Hindsight's 4-way recall, Memobase's profile slots), and the system scales through every scenario up to the federated one — which only the Lexi Core contract work can unlock anyway.**

---

## Appendix A — Honcho dossier highlights (v3.0.11, mid-2026)

- **Model**: Workspace → Peers (humans = agents = same object) → Sessions → Messages; conclusions (claim-level, level-tagged: explicit/deductive/inductive/contradiction); representations; peer cards (≤40 stable facts). Observer/observed collections keyed `(observer, observed, workspace)` — scoped theory-of-mind.
- **Ingestion**: sync write, Postgres queue, separate Deriver process, token-batched (~1k tokens/representation pass, 30-min flush), 1 embedding/message, summaries per 20/60 messages. Managed ingestion $2/M tokens.
- **Dreamer**: per (observer, observed) pair after ≥50 new explicit conclusions + ≥8h idle; deduction specialist (knowledge updates, contradiction resolution) + induction specialist (patterns with natural-language confidence). Experimental.
- **Retrieval**: dialectic chat = agentic tool loop (1–10 iterations, tiered pricing); representation/context endpoints = DB-only, free, ~200ms.
- **Infra**: Postgres + pgvector required, Redis optional, docker compose (api + deriver), AGPL-3.0, no pre-built image, dim changes destructive. Workspaces = tenant boundary.
- **Maturity**: 6k stars, ~20 contributors (top 3 ≈ 69% of commits), $5.4M pre-seed Plastic Labs, two breaking rewrites in 7 months, managed-only fine-tuned Neuromancer models.
- **Provenance weakness**: public Conclusion object exposes no message IDs, premises, or confidence; no bulk export endpoint; chat returns unstructured text.

## Appendix B — Landscape survey summary

| System | Memory unit | Synthesis | Retrieval | Storage | License | Provenance | Fit note |
|---|---|---|---|---|---|---|---|
| **Graphiti (Zep)** | Temporal fact edges + entity nodes; episodes | Dedup + **bi-temporal invalidation** | Hybrid + graph, no LLM at query | Neo4j/FalkorDB/Neptune ⚠️ | Apache-2.0 | **Excellent (episodes)** | Best memory semantics; breaks single-Postgres doctrine |
| **Mem0** | NL fact memories (+opt graph) | v3: ADD-only accumulate; temporal ranking at query | Vec+BM25+entity fusion | PG+pgvector (server) | Apache-2.0 | Op-history log; source retention opt-in | Highest adoption; accumulation-noise risk at 1M+ |
| **Letta** | Self-edited memory blocks + archival | Agent-judged; sleep-time workers | Blocks in-context; archival vec | Postgres+pgvector | Apache-2.0 | Full history; **.af export** | Agent runtime, not a memory service; mid-pivot ⚠️ |
| **LangMem** | JSON docs (semantic/episodic/procedural/profile) | Single-call LLM reconcile (bg or hot) | Store semantic search | PG via LangGraph store | MIT | DIY | Library primitives; build the product yourself |
| **Memobase** | **Profile slots** + event timeline | Fixed **3 LLM calls/flush** | SQL profile (<100ms) + event vec | PG + Redis | Apache-2.0 | ⚠️ blobs deleted by default (opt-in persist) | Right shape for preference memory; cheapest writes |
| **Cognee** | Graph nodes/edges + chunks + summaries | cognify + improve passes; ontologies | Multi-mode incl. LLM-in-loop opt | **Single Postgres (1.0)** | Apache-2.0 | Chunk-level lineage; audit/OTEL | Best composite fit if adopting; heavy ingest cost |
| **Supermemory** | Facts + auto profiles + docs | Contradiction/supersede/auto-forget | Hybrid RAG+memory | Cloud / local binary | MIT (engine OSS-ness ⚠️) | Doc-linked; claim-level ⚠️ | Bench claims self-reported |
| **Hindsight** | World facts / experiences / **mental models** | reflect() builds mental models | **4-way parallel + RRF + cross-encoder** | **Postgres-native (pg0)** | MIT | Raw retained beside derived | Best Postgres-native retrieval to crib |
| **EverOS** | **Canonical Markdown files + wiki** | Offline Reflection (cluster merge) | Embed+rerank, 5-axis filters | Markdown+SQLite+LanceDB | Apache-2.0 | **Source-backed pages**; files = export | Closest living relative of COS design; Individual-Lexi relevant |
| **MemU** | Markdown files written by host agent | Segment-level reconciliation | Embeddings only | SQLite or PG+pgvector | Apache-2.0 | File-level | Zero-LLM write path; ultra-light personal memory |

**Survey whitespace**: no system ships human-confirmation review states or claim-level citations as first-class citizens — the COS/Lexi differentiator is unclaimed territory.

**Shortlist for COS constraints** (per-user preference memory + institutional record memory + strict provenance + export bundles + single-Postgres + vendor independence): 1. **Cognee** (composite fit), 2. **Graphiti** (semantics to steal), 3. **Hindsight** (Postgres-native retrieval to crib). Situational: **Memobase** (preference slots), **LangMem** (MIT primitives), **EverOS** (design reference for portable markdown memory).

## Appendix C — Key evidence locations (COS audit)

- Brain engine: `packages/brain/src/engine.ts` (run loop `:406-554`, ingest `:826-898`, lint `:1247-1311`, token ceilings `:33-34`, budget `:322-384`)
- Code-docs pass: `packages/brain/src/code-docs.ts:255-395`
- Brain run route (inline, no queue): `apps/os/src/app/api/v1/brain/run/route.ts:35-65`; cron sidecar `infra/docker-compose.prod.yml:122-146`
- Search (RRF k=60): `packages/api/src/modules/search/service.ts:200-289`; recall/mediation: `packages/api/src/modules/memory/service.ts:279-439`
- Embeddings (whole-doc, fire-and-forget): `packages/api/src/lib/embeddings.ts:83-85,251-257`; HNSW index `drizzle/0018:44`
- Unindexed revisions: `packages/db/src/schema/documents.ts:43-57` (50/doc prune `packages/api/src/modules/docs/service.ts:177-196`)
- Chat excluded from memory: `engine.ts:791` (input filter); `agent_messages` unbounded `packages/db/src/schema/agent.ts:39-57`
- DB pool max 10: `packages/db/src/index.ts:21`; events table `packages/db/src/schema/kernel.ts:106-120`
