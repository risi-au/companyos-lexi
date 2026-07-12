# M12: Durability & Triple-Persistence (milestone capture)

status: **CAPTURE / PRE-BRIEF — 2026-07-09.** Not an implementation brief. Captures a
ratified direction + open questions so an implementer can chat it into real sub-briefs.
Do NOT treat the sub-task list as acceptance criteria.
owner call: durability is foundational — "crucial to maintain this from scratch."
builds on: records module (M1-04), workbench + git ingestion (M6-06, M8-06),
wiki/docs (M6-09, M8), universal MCP (M11).
discussion source: `C:\dev\Feature Requests\2026-07-08-...SESSION-RECORD.md` Part 9;
this milestone realizes it.

## Vision

The internal operational record of every project/scope — *what happened, when, and
what changed* (changelog, decisions, sessions, wiki) — must survive the app itself and
be owned by the user in plain, diffable text. NOT ad/analytics data (that stays in the
platforms, captured as metrics/mirrors). This is about the OS's own memory being
resilient and portable, never trapped in one database.

## The model (corrected from "3 equal copies")

Not three co-equal masters (that's a merge-conflict nightmare with no source of truth).
Instead: **one writer, replicated to three physical places.**

1. **Postgres (brain + wiki + records)** = the LIVE system of record. Only place that
   can enforce scope grants, personal-wiki privacy, concurrent writes, and MCP
   retrieval (`recall_memory`/`search`/`get_context`). All writes land here.
2. **GitHub remote repo** = a continuously-EXPORTED markdown mirror. Records + wiki
   snapshots serialized to md-with-frontmatter; every change an attributed, diffable
   commit. The "own-it-forever / survives-app-death" copy.
3. **Local clones** = working copies on user/agent machines where work actually
   happens, AND an offline-readable resilience layer: git-native tools (Claude Code,
   Codex, Cursor) can read last-synced project context from the filesystem when the OS
   is unreachable (ties to the "MCP connection lost" concern in M11).

Authority: **Postgres is the single source of truth for writes; git is exported from
it.** Locally-authored changes flow BACK through the OS (as proposals/records via MCP,
or a git→OS ingestion path) — never by directly mutating truth — so the two-tier gate
(M10) and access control survive. Every clone is a full backup; durability comes from
replication, correctness from single-writer.

## In scope / out of scope

**Mirrored to git:** records (changelog / decision / session), wiki page snapshots,
project/scope overview pages — as markdown + frontmatter (wiki is already
markdown-canonical, so export is cheap).

**Never in git (hard exclusions):**
- **Personal wikis** — privacy. Need their own durable store (separate private
  per-user repo, or excluded from shared repos). Open question below.
- **Vault secrets / credentials** — absolute. The secrets doctrine forbids values in
  any repo, ever. Names only, values stay in the vault.
- **Large binaries** (videos, creatives) — stay in Box/Drive; git-LFS at most. The
  mirror is the textual record, not asset storage.

## Decisions captured

- Postgres = live source of truth; git = durable mirror + working substrate; not
  multi-master.
- Per-scope git workbenches already exist and code already ingests git→wiki (M8-06);
  M12 adds the OS→git EXPORT direction and extends mirrors to non-code scopes.
- Local clone doubles as the offline-resilience read layer for git-native tools.
- Exclusions above are hard.

## Open questions for implementation

- Repo granularity: one repo per project (scopes = folders) vs one per scope. (Leaning
  per-project, scopes as folders — matches "one wiki per project, scope-namespaced.")
- Export cadence: event-driven commit vs batched (e.g. nightly + on-demand). Trade
  freshness vs commit noise.
- git→OS ingestion for locally-authored edits: reuse M8-06 ingestion? route through
  M10 proposals so access control + review hold?
- Conflict handling when a local edit and an OS write race.
- Personal-wiki durable store: private per-user repo? encrypted? or Postgres-only with
  its own backup path (not git)?
- Host: GitHub vs self-hosted Gitea on the VPS (data-sovereignty / cost).
- Binary asset policy: git-LFS vs external (Box/Drive) with only pointers mirrored.
- Backup/restore drill: can the instance be rebuilt from git + a Postgres dump? (Brain
  backfill already rebuilds wiki from records — verify records themselves are covered.)

## Rough sub-task breakdown (indicative, not briefs)

- **M12-01** OS→git export pipeline: records + wiki → md+frontmatter, commit with
  authorship, cadence.
- **M12-02** Repo provisioning + clone workflow: per-project mirror repos, how a user
  clones "all projects" locally, folder layout.
- **M12-03** git→OS ingestion of locally-authored changes (via M10 proposals; preserve
  gate + grants).
- **M12-04** Offline resilience: documented local-read fallback for git-native tools
  when MCP is down; staleness signalling.
- **M12-05** Exclusions & policy: personal-wiki/secrets/binary handling; backup-restore
  drill.

Dependencies: M12-03 wants M10-01 (proposals). Otherwise largely independent of
M10/M11 and can start early since it rests on existing records/workbench machinery.
