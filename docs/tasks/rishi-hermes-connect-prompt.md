# Next-session prompt — COS-Learning continuation (fix #1, then connect Rishi)

Copy the block below as the next agent's prompt. It is self-contained.

Priority for the next session is **Step 1 (the provisioning repo-creation fix)**.
Steps 2–3 (connect Rishi via Hermes, then begin real work) are owner-driven and
planned for the following day — do them only if Rishi says so in-session.

---

You are the architect/orchestrator continuing the COS-Learning pilot on CompanyOS
staging. **The pilot is RISHI-ONLY** — Priyanka's entire leg is parked until she
onboards in person. Work these steps **in order**, with Rishi's confirmation at each
gate; the deep pilot queue (Priyanka, nomenclature, NW report, v0.9, M11+) stays parked:

1. **Land the provisioning repo-creation fix** via codex (primary — do this first).
2. **Connect Rishi via Hermes** and pass his `direct_mcp` readiness smoke (owner-driven; likely tomorrow).
3. **Begin real COS-Learning work** with Rishi (first real task capture).

## Established state (verified 2026-07-13 — trust but re-check with git/gh/live)

- Staging is live at **https://cos-staging.risi.au** (deployed OS commit `1462c61`;
  repo HEAD `e2f4322` plus the docs PR carrying this prompt + the fix brief). MCP
  endpoint **https://cos-staging.risi.au/api/mcp** — static bearer, auth enforced.
- Project **`cos-learning`** is provisioned (root project, no child scopes) with the
  required seed wiki pages: `participant-registry`, `participant-rishi`,
  `participant-priyanka`, `cross-participant-patterns`, `learning-method`,
  `readiness-checklist`, `mcp-setup`, `start-priyanka`, and the lexi contracts.
- Two learning agent credentials exist, agent-role, scoped to `cos-learning`, verified
  end-to-end over MCP: **`cos-learning-master`** and **`cos-learning-helper-universal`**.
  Values live ONLY in gitignored `C:\dev\cos-learning\.env`
  (`COS_LEARNING_MASTER_TOKEN`, `COS_LEARNING_HELPER_TOKEN`). Never print them.
- **Repo-on-provision credential fix is DONE and live**: the owner deployed a correctly
  -scoped fine-grained PAT as staging `GITHUB_TOKEN` (`GITHUB_ORG` =
  `Brissie-Digital-PTY-LTD`), verified by the OS creating
  `Brissie-Digital-PTY-LTD/wb-mechanism-test` with a synced `AGENTS.md`. Only the
  product-code half remains (Step 1 below).

## Step 1 — land the provisioning repo-creation fix (codex) — PRIMARY

The credential half is already fixed and live. What remains is the **product** fix so
the wizard reliably requests a repo and fails honestly. The brief is written:
**`docs/tasks/FIX-provision-workbench-repo-brief.md`** — two defects:
(1) the workbench is silently skipped unless the pasted spec includes one, and any
`createRepo` error other than `OrgNotFoundError` hard-500s instead of degrading to a
manual step; (2) the provision UI sticks on "Creating…" and shows all-green steps on
failure. Zero schema changes.

- Confirm the brief is committed on `main` (it ships in the docs PR). Then dispatch:
  `.\scripts\dispatch-codex.ps1 -Task FIX-provision-workbench-repo` (default
  gpt-5.5/medium/unelevated). Run it in the background and read its final output.
- Codex CANNOT commit or run vitest/git in its sandbox — its self-check is
  typecheck-only. **You** run the real gates from repo root
  (`pnpm typecheck && pnpm lint && pnpm test`), review the diff against the brief, and
  drive the provision flow in the real app (Playwright): verify (a) a code project now
  auto-creates its repo, (b) a 403/permission failure degrades to a `manual` step with
  scope/modules/docs still created (no 500), (c) the UI no longer sticks on "Creating…".
- After codex writes: sweep for BOM/mojibake (encoding memory / SUBAGENTS.md), run
  `pnpm lint` AFTER `git add`, commit on `task/FIX-provision-workbench-repo`, PR to
  `main`; **owner merges**. If runtime behavior changed, redeploy staging via the tag
  path only (never untagged).

## Step 2 — connect Rishi via Hermes (owner-driven; likely next day)

Rishi uses **Hermes Agent** (github.com/nousresearch/hermes-agent) — the Windows app
talks to a **Hermes instance on the VPS**. Hermes reads MCP servers from
`~/.hermes/config.yaml` **on the VPS host** and supports a **static bearer** via
`mcp_servers.<name>.headers.Authorization`, so the current path works (no OAuth/M11).

1. **Mint Rishi's credential**: `cos-learning` → **Worker tokens** → name
   **`rishi-cos-learning-mcp`**, role **Agent**, expiry Rishi's choice. The value shows
   once — copy it **directly** into the Hermes config, never into chat or a repo.
   (Secret-store write — confirm label/expiry with Rishi first.)
2. **Hermes config** (`~/.hermes/config.yaml` on the VPS; also documented value-free in
   the `cos-learning` wiki page `mcp-setup`):
   ```yaml
   mcp_servers:
     companyos:
       url: "https://cos-staging.risi.au/api/mcp"
       headers:
         Authorization: "Bearer <paste cos_ token>"
   ```
   Reload/restart Hermes.
3. **Connection check** from Hermes (the actual client, not a substitute): `whoami`
   (expect principal `rishi-cos-learning-mcp`, grant `cos-learning`/`agent`) →
   `get_context` with `scope: cos-learning` (arg is `scope`) → register a session
   (`CL-YYYYMMDD-rishi-01` per `DATA-CONTRACT.md`) → write one test learning report to
   `cos-learning` and read it back → confirm ungranted scopes are unavailable. Mark all
   of this `readiness_test` (excluded from synthesis). Report and get Rishi's confirmation.

## Step 3 — begin real COS-Learning work with Rishi

Once connected, start the first real task per `C:\dev\cos-learning\AGENTS.md` (start
ritual) and `START-WORK.md`: pre-work interview → kickoff → worker return → session
capture → Rishi's own end-of-day confirmation. This is the actual point of the pilot.

## Constraints

- Never relay token values through chat; store only in the client's config surface.
- Direct MCP is mandatory; static bearer is the supported path and works for Hermes.
- Production reads/writes (VPS ssh, docker, DB, staging `.env`) are blocked by default —
  get Rishi's explicit authorization per action, or have him run them via the `!` prefix.
- Do not merge Rishi's and Priyanka's profiles; Rishi never confirms Priyanka's evidence.

## Pending cleanup (owner action; not blocking)

- Delete throwaway repos `Brissie-Digital-PTY-LTD/wb-mechanism-test` and
  `Brissie-Digital-PTY-LTD/provision-livetest` (architect's `gh` lacked `delete_repo`).
- Empty `wb-mechanism-test` OS scope lingers (no UI scope-delete).
- Revoke 3 orphan agent credentials (all unused, no held plaintext): provisioning-minted
  principal `ddf7ab23` ("COS-Learning master agent"); the first corrupted
  `cos-learning-master` worker-token mint; the discarded `rishi-cos-learning-mcp` mint.

## Parked (do NOT start)

Priyanka onboarding (own account + her-present smoke; `START-PRIYANKA.md`); nomenclature
ruling; Nutrition Warehouse report; v0.9 tag/walkthrough; M11-01 and beyond. These wait
until Rishi is working and real learning evidence exists.

## Read first (only what you need)

For Step 1: `docs/tasks/FIX-provision-workbench-repo-brief.md`, CompanyOS `ONBOARDING.md`
§4-5 (dispatch + gates), `docs/SUBAGENTS.md` (codex failure modes). For Steps 2-3:
`C:\dev\cos-learning\AGENTS.md`, `docs/PARTICIPANT-MODEL.md`, `docs/DATA-CONTRACT.md`,
and the `cos-learning` wiki pages `mcp-setup` + `start-priyanka` (via MCP `get_doc`).
