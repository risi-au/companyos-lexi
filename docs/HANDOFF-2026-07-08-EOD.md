# Session handoff — 2026-07-08 EOD (M9/M5 shipped + UX audit; next: UX implementation)

Supersedes HANDOFF-2026-07-08.md. Written for any frontier model taking over as
architect/orchestrator. Protocol unchanged: docs/ORCHESTRATION.md + docs/SUBAGENTS.md —
you architect/review/commit, **codex implements** (recipe in the superseded handoff, still
accurate: `codex exec --sandbox workspace-write`, .cmd shims, LIMIT-ALERT/CODEX-DONE,
codex can't commit), owner merges PRs. Never push main (docs included) — branch+PR.

## Shipped this session (all merged to main, all deployed to staging)

- **PR #7 M9-01 ops health panel** — /admin/health, token-expiry warnings (brain-engine +
  GitHub PAT, both expire ~2026-10-05), run log, email alerts on status transitions,
  external_credentials registry, migration 0023. Task doc can flip to done.
- **PR #8 M5-03 backups** — nightly encrypted pg_dump sidecar → R2. See "Backup state".
- **PR #9 M9-02 native arm64 releases** — QEMU gone. VERIFIED LIVE: full release+deploy in
  **9m10s** (was 70–100min), image arch arm64 confirmed on VPS, 3 consecutive clean
  releases (runs for #9, #7, #10; #8's deploy auto-cancelled as superseded — normal).
  Acceptance met; task doc can flip to done.
- **PR #10 M5-04 tenant admin** — /admin (users/grants/activity/automations/settings),
  temp-password first-login (better-auth metadata, no migration), LiteLLM key admin with
  US$25/mo default budgets (closes unbounded-spend). Owner decisions recorded in task doc.
- Staging state: migration 0023 applied, internal smoke green, os container recreated
  16:35 UTC 2026-07-07. **Vault ACTIVE** (COS_VAULT_KEY in container; e2e verify happens
  during owner walkthrough — classifier blocks agent-initiated prod credential probes).

## Backup state (M5-03 — one step from done)

Sidecar `companyos-backup-prod` RUNNING on staging (COMPOSE_PROFILES=brain,backup).
Verified working: pg_dump both DBs, tar with .env inside, openssl encrypt. **BLOCKED at
R2 upload: AccessDenied** — signing is valid (not SignatureDoesNotMatch; key shapes
32/64 correct), so the owner's R2 API token lacks permission (likely Object Read-only,
wrong bucket scoping, or an EU-jurisdiction bucket needing the `.eu.` endpoint).
**Owner fixes token in Cloudflare dashboard** → update BACKUP_S3_ACCESS_KEY_ID/
BACKUP_S3_SECRET_ACCESS_KEY in ~/app/.env → rerun:
`ssh aios@159.13.38.87 'docker exec companyos-backup-prod /bin/bash /backup/backup.sh run-once'`
Then: restore drill per infra/RESTORE.md (architect runs), flip task doc to done.

Known follow-ups:
1. **Deploy pipeline gap**: release.yml deploy-staging syncs compose/postgres-init/litellm
   but NOT infra/backup/ — I scp'd it manually 2026-07-08. One-line workflow fix needed
   (add infra/backup/* to the scp list). Small PR, owner reviews (deploy-pipeline change).
2. BACKUP_REPORT_TOKEN unminted (owner, Connect UI) — backups run but failures don't alert.
3. Architect fixed a codex bug pre-merge (list_objects sed parsing — pruning would have
   silently no-oped). Watch the first few nightly runs at 03:00 UTC prune correctly once
   uploads work.

## UX overhaul (owner priority — next major workstream)

Exhaustive audit DONE (subagent, taste-skill + ui-ux-pro-max methodology): **5 concept
docs in docs/design/** (UX-AUDIT, CONCEPTS, NOMENCLATURE, STRING-AUDIT,
DESIGN-SYSTEM-DELTAS). Every route inventoried with world-class verdicts, every string
file:line'd. Headliners: wizard renders all stages in one scroll (needs 6-step stepper —
full treatment in CONCEPTS §1), sidebar has no tree affordances (spec in CONCEPTS §2),
destructive actions unconfirmed, no toast/feedback layer, --space-5 token referenced in
4 files but undefined, no error/404/loading pages, jargon leaks (principal/slug/mint/
UUIDs in UI), design system exists but unused outside auth pages.

**Implementation plan is owner-approved as a prompt** — 5 sequential work packages,
one branch+PR each: UX-01-foundations (token fix, error pages, dark default, hardcoded
colors) → UX-02-feedback-layer (toasts, destructive confirms, dialog a11y) →
UX-03-strings (STRING-AUDIT + code-level renames; wizard TEMPLATE wording is instance
data — proposal doc only, owner edits in /admin/intake) → UX-04-sidebar →
UX-05-wizard-stepper (UI restructure only, keep intake service calls/events intact).
Dispatch each to codex against the design docs; verify with full suites + visual review.

**Claude Design leg (optional, owner-driven):** preview bundle built from real tokens at
docs/design/ds-sync-bundle/ (colors light+dark, type/spacing incl. --space-5 warning,
Button variants). BLOCKED on owner running `/design-login`. Then: DesignSync
list_projects → create "CompanyOS" design-system project → finalize_plan → write bundle
+ the 5 docs/design/*.md → owner opens claude.ai/design with the CONCEPTS.md §1/§2 brief
(exact prompt in this repo's chat history; reconstruct: 2–3 directions for wizard stepper
+ sidebar + admin overview showcase, concepts only, existing screens only).

## Owner checklist (pending on Rishi)

1. Fix R2 token permissions (above) → tell agent to rerun backup.
2. Mint BACKUP_REPORT_TOKEN (Connect UI).
3. `/design-login` if pursuing the Claude Design leg.
4. **Wizard v2 walkthrough** on staging (path in superseded handoff §3) — includes creating
   the first vault credential = the vault e2e verification (ciphertext in DB +
   credential.accessed event; agent verifies after).
5. **v0.8.0 tag decision** after walkthrough — semver tag = live-promotion artifact;
   rotate both 90-day credentials at live promotion.
6. Merge the docs PR carrying this handoff + docs/design/*.

## Access/safety boundaries + engineering gotchas

Unchanged from HANDOFF-2026-07-08.md (read it). Additions learned today:
- Classifier: AskUserQuestion answers do NOT authorize VPS writes — need a plain-chat
  owner sentence naming the action. Prod credential-store probes (MCP list_credentials
  with the brain token) are blocked regardless.
- .env backups on VPS: .env.bak-2026-07-08, -08b, -08c exist (vault key, key rename,
  compose profiles).
- The staging deploy queue keeps only the newest queued run (concurrency staging-deploy)
  — a cancelled deploy for an older commit is normal, not a failure.
- Sidebar.tsx / api.ts / index.ts are merge-conflict hotspots between parallel UI PRs —
  rebase whichever merges second; both-links resolution pattern used for #7 vs #10.

## Backlog after UX (rank)

1. M5-03 close-out (upload fix + drill) — near-done.
2. Release pipeline: sync infra/backup/ in deploy (tiny PR).
3. M9+ source connectors — owner design discussion still not held.
4. M5-05 control plane — parked until a second tenant is real.
5. Deferred by doctrine: client-facing interview mode, email ingestion, CRM-lite,
   in-OS billing, vault rotation/per-credential ACLs.
