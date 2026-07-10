# M10: The Living Wiki (milestone overview)

status: design ratified 2026-07-09 (owner + architect). Queued behind current pending
tasks. Brainstorm records: `C:\dev\Feature Requests\2026-07-09-WIKI-FEATURE-BRAINSTORM.md`
(this milestone) and `2026-07-08-META-ADS-AUTOMATION-AND-ASSISTANTS-SESSION-RECORD.md`
(assistants direction this milestone serves).
builds on: M8 (brain + wiki substrate) — extends, supersedes nothing.
closes: the "no generic human-approval primitive" gap flagged 2026-07-08.

## Vision

Promote the wiki from a convention on the docs module to the OS's first-class knowledge
surface — the way PromptQL made their wiki the product's core primitive, but on the
substrate we already built (docs + revisions + wikilinks + hybrid search + brain
maintenance). Three additions make it live:

1. **Agents show their work.** Every agent answer and every session wrap-up carries
   structured citations — which wiki pages informed it — rendered as clickable chips.
2. **Humans canonize.** Task agents and Ask OS propose wiki edits; a human approves the
   diff. The brain keeps self-maintaining, marked unreviewed until a human verifies.
3. **The OS knows its people.** Every principal gets a personal wiki — who they are, the
   tools they use, how they work — visible only to them (+ the system), following them
   into any MCP-connected tool. This is the "principal-shaped memory" primitive the
   assistants design needs, done as transparent, user-editable pages instead of an
   opaque store.

Everything that needs a human converges on one **attention queue** ("Things to
resolve"): wiki proposals, brain-detected contradictions, stale pages, graduation
suggestions, publish gates. One queue, rendered at every touchpoint — OS home page,
in-tool via MCP at session start, mobile. No new chat surface: per doctrine, users work
in their own tools and the OS talks to them there.

Guiding incentive (keep verbatim, it's the adoption engine): *the person who hits
missing context has the reason to fix it, right in the flow.* Wizard and agent
questions are cache misses; answering one should write the page so it is never asked
again.

## Ratified decisions

1. **Rebrand Docs → Wiki.** The Docs tab becomes the Wiki tab; same tables, wiki-first
   UX (see M10-04). Markdown (`body_md`) stays the only canonical format — the
   structured editor is a scaffold over it, never a second storage shape.
2. **Two-tier edit gate.** The brain engine keeps writing in place; its edits are
   *unreviewed* until a human verifies (agent writes set `learned_at`, human
   verification sets `verified_at` — frontmatter already exists). Task agents and Ask
   OS never write directly: they file a **proposal** (page diff) a human approves,
   edits, or rejects. PromptQL's "wants to learn → Add to wiki" flow, on our grants.
3. **Personal wikis.** New `personal` scope type, one scope auto-provisioned per human
   principal, granted only to that principal (+ system mediation for the brain — same
   pattern as mediated root reads). All doc/revision/search/brain machinery unchanged.
   `recall_memory`'s union becomes: **personal → scope subtree → nearest ancestor →
   root allowlist**. Not readable by admins.
4. **Placement routing gains one test:** *is the fact about the person or about the
   work?* Person (tool prefs, folder conventions, schedules, working style) →
   personal. Client/project truth → scope. Cross-client playbook → root pattern.
   **Graduation runs both ways:** N personal wikis converging on the same practice →
   the brain proposes graduating it to the scope wiki (via an attention item).
5. **No Talk pages, no chat module.** Disputes and questions are **attention items**,
   not discussions. The durable trail is a decision record linked from the page (new
   revision + decision record on resolve). Human↔human mediation is future scope
   (route to another top-level user, or a thread to settle the version); **for now,
   when two humans disagree, both versions stay on the page side by side, each
   attributed with the author's username** — a documented convention, not a schema
   change.
6. **One attention queue, every touchpoint.** "Things to resolve" is the OS home
   page's primary surface; the same queue is delivered in-tool (a `get_context` /
   session-start banner: "3 items need you — answer here or open the OS", answerable
   over MCP) and on mobile (approvals). MCP has no server push — delivery is
   session-start pull + mobile push for urgency + home page as the always-true source.
   Do not build a poller pretending otherwise.
7. **The approval primitive is generic.** One `proposals`/attention-items construct
   with typed payloads; day-one consumers: wiki canonization (M10-01), contradiction/
   staleness resolution (brain lint findings stop being alert-only), graduation
   proposals, and external gates (e.g. the Meta-ads publish gate). The intake packet
   approve flow stays as-is for now; converge later if it earns it.
8. **One wiki per project, scope-namespaced pages** (WIKI.md convention holds).
   Sub-scope knowledge lives in the project wiki addressed as `[[scope-path:slug]]`;
   per-nested-scope wikis remain an anti-pattern; graduation stays deliberate + logged.
   Every project gets a **brain-maintained overview page** (same treatment as root's
   `scope-map`/`critical-facts`): what this project is, current state, recent-activity
   digest linking to changelog/decision records. The "log" is records, never
   append-only wiki pages.
9. **Structured citations.** The agent loop records which `recall_memory`/`search`
   hits informed an answer; answers and session wrap-ups carry a `citations` array
   (page slug + scopePath + revision at read time). Rendered as chips; click-through
   opens the page. External tools report pages-used in wrap-ups over MCP.
10. **Structured page editor** (PromptQL-inspired; owner explicitly wants their
    create-page UX improved on): form fields **Title · Aliases · Definition ·
    Details · Sections (title + content, addable)**, Write/Preview toggle,
    "skip for now" → stub page. Mapping is pure convention: aliases → frontmatter
    `aliases:` (indexed for FTS + embeddings + wikilink resolution), definition →
    lede paragraph, sections → `##` headings. Round-trips byte-safe to `body_md`;
    raw markdown editing stays available.
11. **Self-documenting OS.** Ship `cos-*` namespaced wiki pages (product manual) in
    every instance, answered through the same retrieval + citation path — "how do I
    mint a token?" gets a cited answer from Ask OS for free.
12. **Seeding.** The creation wizard + platform mirrors seed a scope wiki on day one
    (pieces exist from M8-04 / mirror direction); "start from scratch" stays valid.
13. **Nomenclature pass (owner call, 2026-07-09):** several user-facing names blur
    distinct concepts and confused even the owner. Rename **user-facing labels only**
    — internal schema/table/tool names stay (no migration churn); update
    docs/design/NOMENCLATURE.md as the source of truth. Confirmed renames:
    - **Docs → Wiki** (decision 1).
    - **"Connect" split three ways:** *Connected apps* (account-level — your MCP
      clients: Claude, Hermes…), *Platform connections* (scope-level vault
      credentials: Meta, Shopify, Google Ads — the connect-once promise), *Worker
      tokens* (scope-level minting for non-human principals). One word "Connect"
      currently covers all three; that's the confusion M11-01's panel fix implements.
    - **Attention queue → "Things to resolve"** as the user-facing surface name
      (attention_items stays the internal name).
    Candidates to confirm during M10-06 (not yet decided): *intake / intake packet* →
    "Scope setup" / "setup packet"; *capabilities* → "Automations" (careful: n8n
    overlap); *principals* → "People & agents" in directory UI.

## Conventions (additive to docs/patterns/WIKI.md — update it in M10-01)

- **Review states:** a page revision is `unreviewed` when its author principal is an
  agent and `verified_at` < `learned_at` (or absent). Human save or explicit verify
  sets `verified_at` + `verified_by`. Surfaces show an unreviewed badge; recall hits
  already return frontmatter so agents can weigh trust.
- **Disagreement convention:** conflicting claims render as attributed variant blocks
  (`> **rishi:** …` / `> **jane:** …`) until resolved; the brain lint pass flags them
  as attention items but never auto-picks a winner between humans.
- **Citation object:** `{ slug, scopePath, revisionId?, source: scope|ancestor|
  root-pattern|critical-facts|personal }` — extends the existing recall-hit shape;
  no new retrieval machinery.
- **Aliases:** frontmatter list; search indexes them; wikilink resolution treats an
  alias match as a resolved link (extend `extractLinksForDocument`).
- **Secrets rule unchanged:** credential values never appear in wiki pages, personal
  or otherwise — names only, values in the vault.

## Brief breakdown

- **M10-01 attention & approval primitive:** `attention_items` + typed proposal
  payloads (wiki page diff first), lifecycle (open → resolved/rejected, all events),
  MCP tools (list/answer/approve so items are answerable in-tool), home-page "Things
  to resolve" surface, `get_context` banner line with open-item count, wiring brain
  lint findings + Ask OS `save_doc` interception into proposals, decision-record
  emission on resolve. Update WIKI.md conventions. **Unblocks everything.**
- **M10-02 personal wikis:** `personal` scope type + auto-provision per principal,
  grant + mediation rules (owner-only visibility, system writes for the brain),
  recall union extension, brain routing rule (person-vs-work test) + two-way
  graduation proposals (needs M10-01), wizard defaulting cascade reads personal pages.
- **M10-03 citations + agent gardening:** loop-level recall-hit tracking, citations on
  agent messages + session wrap-ups, wrap-up contract field for external tools, chips
  UI, MCP exposure of `rename_doc` / `archive_doc` / backlinks / link-graph.
- **M10-04 wiki surface:** Docs → Wiki rebrand, structured editor (decision 10),
  on-this-page outline, backlinks panel, per-page Following + notifications
  (change/create/archive → attention/digest, honoring decision 6 delivery), unreviewed
  badges + verify action, aliases, project overview page maintenance (brain), scope-
  namespaced browsing within a project wiki.
- **M10-05 self-docs & seeding:** `cos-*` page set authored + shipped, answered via
  standard retrieval; wizard/mirror wiki seeding polish; wiki-contributions/day as an
  instance health metric on the ops panel.
- **M10-06 nomenclature pass:** decision 13 — apply confirmed renames across UI copy,
  `cos-*` self-doc pages, and skills-repo templates; settle the candidate renames
  with the owner; update NOMENCLATURE.md; grep for stale terms in user-facing
  strings. Zero schema/API changes. Cheap; can ride along with M10-04's UI work.

Dependencies: 01 → {02 graduation, 04 badges/notifications}; 03 independent of 01;
04 after 03 for chips; 06 with 04; 05 last.
Suggested order: 01 → 03 → 02 → 04+06 → 05.

## Don't (milestone-wide)

- No Talk/discussion module, no chat surface, no threads — attention items + decision
  records only.
- No second storage format: the structured editor round-trips to markdown; if the form
  can't express something, the markdown wins.
- No always-loaded wiki context: retrieval stays search-on-demand (`recall_memory` /
  `search`); `get_context` carries indexes and banners, not page bodies.
- No per-nested-scope wikis; no append-only log pages; placement rules in WIKI.md stay
  in force.
- No admin backdoor into personal wikis; brain access is mediated as system, mirroring
  the root-read pattern.
- No server-push pretence over MCP: session-start pull + mobile push + home page only.
