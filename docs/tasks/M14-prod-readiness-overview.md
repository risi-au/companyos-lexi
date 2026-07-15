# M14: Prod Readiness, Security & Maintenance (milestone capture)

status: **CAPTURE — 2026-07-10, owner-requested.** Deliberately the LAST milestone in
the roadmap: everything else (M10–M13, remaining product work) lands before it, but
nothing in this list is optional — **every item here gates live promotion**. Sub-briefs
get written when the milestone is activated; until then this is the canonical list so
nothing manual/tribal is forgotten between staging and prod.
depends on: `docs/PROD-SETUP.md` (the executable runbook this milestone verifies),
docs/VPS.md (promotion process), infra/RESTORE.md (drill).
origin: owner, plain chat 2026-07-10 — "for prod we need to follow a much better and
strict process for all these"; triggered by the staging BACKUP_REPORT_TOKEN mint, ad-hoc
env edits, and the discovery that system-critical tokens are one confirm-click from
deletion.

## Why this exists

Staging was activated incrementally over many sessions: env vars added by hand, tokens
minted and elevated via SQL, capabilities registered via curl, secrets occasionally
transiting chat. That was acceptable for staging velocity; it is not a prod process.
This milestone turns every one of those ad-hoc steps into either (a) automation, (b) a
runbook line in `docs/PROD-SETUP.md`, or (c) a product fix that removes the footgun.

## 1. Prod environment bring-up (process, not heroics)

- [ ] `docs/PROD-SETUP.md` is the single ordered checklist for standing up prod;
      executing it top-to-bottom on a clean host produces a working live environment.
      Every future staging manual step MUST be added there in the same PR that
      introduces it (reviewer checklist item).
- [ ] **Secrets never transit chat or logs**: owner (or a vault process) places values
      directly on the host; the architect only ever sees names, not values. Document
      the handling rule per secret class in PROD-SETUP.md.
- [ ] Prod gets its OWN: R2 bucket + scoped token, BACKUP_ENCRYPTION_KEY, COS_VAULT_KEY,
      better-auth secret, LiteLLM master + minted keys, GitHub PAT, webhook secret,
      deploy SSH keypair. Zero shared credentials with staging.
- [ ] Live promotion stays manual + tag-only (docs/VPS.md gate); add a written
      promotion checklist (staging sign-off → v* tag → verify → announce).
- [ ] Post-bring-up verification is part of bring-up: backup run-once + report lands,
      restore drill, smoke checklist, health panel green, token expiries visible.

## 2. Secret & token lifecycle

- [ ] **Protected/system tokens** (product fix, owner-flagged 2026-07-10): tokens can
      be marked system-critical (backup-reporter, brain-engine); revoking one requires
      root admin + typed-name confirmation (GitHub-style) and shows a badge in the
      Connect table. Today ANY principal with mint access can revoke them behind a
      single generic confirm — one misclick silently kills backups alerting or the
      brain. *(Build note 2026-07-16: the Connect table now has a derived-status
      column — Active/Expired/Revoked/Never used, #62; the badge should extend that
      cell, not the old boolean.)*
- [ ] **Admin-role minting in the UI**: brain-engine had to be minted as agent then
      elevated via SQL UPDATE. Either support admin minting (root-admin-gated) or
      document the elevation as an explicit runbook step — no more improvised SQL.
- [ ] **Rotation runbook**: brain-engine token + skills-repo PAT both expire
      ~2026-10-05 (90d mints from 2026-07-07). /admin/health surfaces expiry; write the
      rotation steps BEFORE the first rotation is due, then rotate on staging once as
      the drill. *(2026-07-16: the header bell now raises `connection_expiry`
      attention items automatically — 7-day warning + expired, deep-linking to the
      connect tab (#62). Connect-minted tokens (both of the above) get this for free;
      the runbook can count on the warning rather than health-panel-only visibility.)*
- [ ] Policy: no non-expiring agent tokens on root (agent role reaches
      `get_credential`); 90d default; expiry presets reviewed. *(Conflict to resolve
      at activation: the connect wizard's worker-token lane still offers a "None"
      expiry preset — remove or root-gate it when this policy lands.)*

## 3. Security hardening (pre-live pass)

- [ ] Dedicated security review of the exposed surfaces: better-auth flows
      (sign-up/sign-in/temp-password), `/api/mcp` (dual-mode token auth, Origin
      allowlist), **the OAuth AS surface added by #53** (authorize/token endpoints,
      unauthenticated DCR, consent page, JWKS, `/.well-known/*` metadata,
      `oauth_connections` tracking), `/api/v1/*` (n8n + capability report), webhook
      handler (secret validation, replay). PR-level adversarial reviews ran for
      #55/#59/#62 but the pre-live pass must cover the assembled surface end-to-end.
      Use the /security-review process; fix or accept-with-rationale every finding.
- [ ] Rate limiting / abuse guard on auth endpoints and `/api/mcp` (none today).
      *(Urgency raised 2026-07-16: DCR is an unauthenticated public registration
      endpoint by MCP-spec design — an obvious spam/abuse target once live.)*
- [ ] Security headers pass (CSP, HSTS via tunnel config, frame-ancestors, etc.).
- [ ] Dependency hygiene: `pnpm audit` clean or triaged; enable automated dependency
      PRs (Renovate/Dependabot) with the gates as the merge bar.
- [ ] Secrets scanning in CI (gitleaks or GitHub secret scanning + push protection).
- [ ] Audit-log review: credential.accessed and admin actions queryable; retention
      defined.
- [ ] Backup restore drill (infra/RESTORE.md) executed quarterly, calendarized; drill
      result recorded as a db-backup capability run.

## 4. Code & repo maintenance (standing cadence)

- [ ] Task-doc hygiene: `status:` lines flipped in the PR that lands the work (UX-01/02/
      04/05 drifted "todo" after merge — fixed alongside this capture).
- [ ] Docs freshness sweep each milestone close (README, AGENTS.md files, VPS.md,
      PRIMER — the 2026-07-09 sweep found all four stale).
- [ ] Dead-flag/dead-code sweep after each UX/design migration (old tokens removed once
      all areas migrate — DESIGN-SYSTEM-V2.md migration posture says old tokens stay
      live only until then).
- [ ] Test debt: keep gates fast; suite count only grows with real coverage (310 now);
      add an e2e smoke (sign-in → scope page → admin) so staging verification stops
      being manual click-throughs.
- [ ] Migration constraints stay enforced: plain SQL only (no DO $$), new workspace
      packages need Dockerfile COPY lines — add a CI check for both if they bite again.

## 5. Ops & observability

- [ ] External uptime monitoring on the live URL (not just deploy-time smoke).
- [ ] Alert delivery: capability alerts currently land in /admin/automations only —
      wire critical alerts (backup failure, health-panel red) to a push channel the
      owner actually sees.
- [ ] Log retention + access defined for the VPS containers.
- [ ] Incident runbook: what to do when live is down (rollback = redeploy previous v*
      tag; DB restore per RESTORE.md; who's paged).

## Boundaries

Unchanged: never push main; owner authorizes merges and all VPS state changes in plain
chat naming the command; secrets by name only in briefs; `USER DATA/` and M10–M13
capture docs are owner-only.
