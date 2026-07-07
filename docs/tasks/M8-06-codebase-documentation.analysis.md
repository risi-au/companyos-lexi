# M8-06 Codebase Documentation - Analysis Gate

## 1. Full-repo pass vs delta pass reads

**Bootstrap (first pass, or backfill mode):** one `listFiles` tree call (filtered to the
workbench subpath when set), then a small prioritized set of authoritative files — at
most 10 files, each truncated to 5,000 characters, 30,000 characters total. The tree
listing itself (paths only, capped at 400 entries in the prompt) conveys structure
without reading source wholesale. Everything flows through the engine's existing
`callLlm`, so the per-run token ceiling and monthly budget apply unchanged; a repo that
would blow the cap gets fewer files (priority order) and the run reports
`truncated: true` on the scope's code-docs summary rather than failing.

**Delta (normal ingest runs):** no tree call. The changed paths come from
`workbench.push` events since the last successful ingest for the scope
(`changedPathSamples` capped at 20 per event by M7-02). Only changed files that classify
as authoritative or that map to an affected page area are read, same 10-file/5k-char
caps. Pages whose area saw no changes are not sent to the LLM and cannot be rewritten —
"update only affected pages" is enforced structurally, not by prompt.

Token budget: bootstrap ≈ one `cheap` call with ~8-12k input tokens worst case; delta ≈
one `cheap` call with ~2-6k. Both fit comfortably inside the default 24k per-run
ceiling alongside the content ingest pass; when they don't, BudgetExceededError stops
the run cleanly and the partial report already exists (M8-02 behavior).

## 2. Authoritative inputs vs sampled source

Authoritative (read whenever present or changed, priority order): `README*`,
`AGENTS.md` (root and one level deep), `package.json` / `pyproject.toml` / `go.mod` /
`Cargo.toml` / `composer.json` / `Gemfile`, lockfile names only (never contents),
`docker-compose*` / `Dockerfile*`, `.github/workflows/*`, `tsconfig*.json`,
`pnpm-workspace.yaml` / `turbo.json`, `.env.example`.

Sampled source: none by default. The tree listing plus authoritative files describe
architecture, stack, integrations, and ops; reading arbitrary source files is the
fastest way to blow budgets and leak code into pages. A changed source path still
influences the pass (it classifies which page is affected and is cited in Sources by
path + SHA) without its contents being read.

Page-area classification: workflows/compose/Dockerfile/infra → `code-ops`; manifests/
lockfile names/tsconfig → `code-stack`; api/webhook/integration/client-ish paths →
`code-integrations`; everything else (src layout, packages, README, AGENTS.md) →
`code-architecture`. A changed path can affect multiple pages; unmatched paths default
to `code-architecture`.

## 3. Root pattern distillation over code pages

The M8-02 root pass already loads each scope's wiki pages — `code-*` pages ride along
with no new code path. Two guards keep client code detail out of root: (a) the existing
scope-name sanitizer applies to all pattern page bodies, and (b) the root-distill prompt
instruction already forbids client-confidential specifics; code pages give it stack- and
structure-level sentences ("scopes with Shopify workbenches use Remix + Prisma") rather
than file contents, because the code pages themselves are distilled, path-cited, and
never contain wholesale file bodies. A fixture test asserts a root `pattern-*` page
derived from two scopes with similar code pages contains no scope names, no repo names,
and no file paths from either client.

## Config

Per-scope opt-out lives in the scope's existing `settings` jsonb:
`settings.brain.codeDocs === false` suppresses the pass (default on). No schema change.
GitHub access is injected as an optional dep (`deps.github`, satisfied by the existing
`GitHubClient`); when GITHUB_TOKEN/GITHUB_ORG are unset the pass reports
`skipped: "no-github"` instead of failing, matching how provisioning degrades.
