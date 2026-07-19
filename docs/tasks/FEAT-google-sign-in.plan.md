# FEAT-google-sign-in: Add optional Google social login

status: done
type: feature
issue: #86
modules: apps/os auth UI, infra runtime config
branch: feat/google-sign-in
size: standard
risk: R2
triage: orchestrate

> TRIP feature plan. No production code in this file.
> Owner approval: Rishi, 2026-07-18 (continue queued #86)

## Outcome

When an instance has both Google OAuth credentials configured, `/sign-in` and `/sign-up`
offer a Google option alongside email/password. Instances without both values retain the current
UI and auth behavior. Google verified-email account linking must converge on the existing Better
Auth user and therefore the existing CompanyOS principal and personal scope.

## Evidence and constraints

- Better Auth 1.6 documents `socialProviders.google` with `clientId` and `clientSecret` and uses
  `<baseURL>/callback/google`, mounted here at `/api/auth/callback/google`.
- Better Auth 1.6 account linking is enabled by default. A Google sign-in whose verified email
  matches an existing locally verified user implicitly adds the provider account to that user.
  Better Auth 1.6.23 also requires the existing local row to be verified by default to prevent
  account pre-hijacking. Keep that guard explicit and do not add `trustedProviders`.
- CompanyOS already calls `getCurrentActorPrincipalId()` on the first app render. It invokes
  `linkAuthUser`, then `ensurePersonalScope`; preserving the Better Auth user id preserves the
  kernel principal and prevents duplicate personal scopes.
- The staging public base URL is `https://cos-staging.risi.au`, so its Google authorized redirect
  URI is `https://cos-staging.risi.au/api/auth/callback/google`.
- Runtime credentials belong only in instance environment/vault configuration. No values enter
  git, plans, issues, logs, or client bundles.
- #91 PR #109 is independent and also touches `apps/os/src/lib/auth.ts` and `apps/os/AGENTS.md`.
  Rebase after #109 merges if GitHub cannot merge both patches cleanly.

## Design

### 1. Server-only Google configuration

**Files**: `apps/os/src/lib/google-auth.ts`, focused unit test, `apps/os/src/lib/auth.ts`

- Read and trim `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server.
- Return no provider configuration unless both values are non-empty.
- Pass the complete configuration through `socialProviders.google` only when enabled.
- Explicitly keep Better Auth account linking enabled without weakening either verified-email
  requirement.
- Export only a boolean/config helper to server components; never expose either credential.

### 2. Preserve post-auth navigation

**Files**: shared auth redirect helper + focused test

- Extract the existing same-origin redirect validation from the sign-in client.
- For a normal sign-in, preserve a safe `?redirect=` destination or use `/s/root`.
- For an MCP OAuth authorization resumed through `/sign-in`, return to
  `/api/auth/oauth2/authorize` with the original authorization query after Google establishes the
  session, matching the current email/password behavior.
- Reject protocol-relative, backslash, malformed, and cross-origin destinations.

### 3. Conditional Google UI

**Files**: sign-in/sign-up pages and a shared client button component

- Make each route's page a thin server component that passes only `googleEnabled` to its client
  form.
- Render one secondary `Continue with Google` action and an `or` divider only when enabled.
- Use the existing Button primitive and semantic tokens; maintain 44px targets, visible focus,
  keyboard behavior, loading state, and error feedback.
- Keep the email/password forms and sign-up/sign-in links unchanged.
- Google sign-in resumes the computed post-auth destination. Google sign-up lands on `/s/root`.

### 4. Runtime contract and operator docs

**Files**: `.env.example`, `infra/docker-compose.prod.yml`, `infra/README.md`, `infra/AGENTS.md`,
`apps/os/AGENTS.md`

- Add empty placeholders only; never real credentials.
- Pass both optional values into the OS container with fail-open empty defaults.
- Document local and staging redirect URIs, the all-or-nothing enablement rule, and the owner-only
  staging activation/restart procedure.
- Keep instances bootable with email/password when either variable is absent.

## Test plan

- Unit: both credentials produce a provider config; missing/blank/partial values disable Google.
- Unit: safe normal redirects and OAuth authorization resumption are preserved; unsafe redirects
  fall back to `/s/root`.
- Existing kernel auth-link tests prove repeated use of one Better Auth user id stays on one
  principal/personal scope; no kernel change is planned.
- Full gate: `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test`, and
  `corepack pnpm --filter @companyos/os build`.
- Validate compose interpolation without revealing values when an available container runtime can
  do so; otherwise rely on CI/manual YAML review per `infra/AGENTS.md`.
- Fresh inline read-only Codex review must return APPROVED before publication.
- Post-merge staging verification is owner-gated: register the callback in Google Cloud, add both
  secrets to the staging environment, restart/redeploy, then test a new user and, when a locally
  verified existing user is available, the same-email linking flow.

## Files expected

| Path | Change |
|---|---|
| `apps/os/src/lib/google-auth.ts` | Server-only optional Google provider config |
| `apps/os/src/lib/google-auth.test.ts` | Configuration gating regression tests |
| `apps/os/src/lib/auth-redirect.ts` | Shared post-auth destination policy |
| `apps/os/src/lib/auth-redirect.test.ts` | Safe redirect and OAuth-resume tests |
| `apps/os/src/lib/auth.ts` | Google provider and verified-email linking policy |
| `apps/os/src/components/GoogleSignInButton.tsx` | Shared accessible social action |
| `apps/os/src/app/sign-in/*` | Server gate plus existing client form |
| `apps/os/src/app/sign-up/*` | Server gate plus existing client form |
| `apps/os/AGENTS.md` | Auth contract |
| `.env.example` | Empty variable placeholders only |
| `infra/docker-compose.prod.yml` | Optional OS environment pass-through |
| `infra/README.md` | Provider setup and callback runbook |
| `infra/AGENTS.md` | Runtime contract |
| `docs/tasks/FEAT-google-sign-in.plan.md` | Plan and finish report |

## Do not

- Do not commit credentials or read/write staging secrets from the agent session.
- Do not use `NEXT_PUBLIC_*`, client-side config endpoints, or credential values in rendered HTML.
- Do not add forced/trusted-provider linking or allow different-email linking.
- Do not modify kernel principal logic, auth schema, or migrations unless diagnosis disproves the
  pinned Better Auth same-user behavior.
- Do not remove or weaken email/password sign-in.
- Do not change MCP OAuth provider behavior, DCR, consent, JWTs, or metadata.

## Acceptance criteria

- [x] Google provider exists only when both server credentials are configured.
- [x] Google actions appear on sign-in and sign-up only when configured.
- [x] Email/password remains unchanged and available.
- [x] Normal safe redirects and MCP OAuth authorization resumption work after Google sign-in.
- [x] Verified same-email Google sign-in reuses the Better Auth user and CompanyOS principal path.
- [x] Local and staging callback URLs and runtime variables are documented.
- [x] Focused tests and the full gate pass.
- [x] Fresh inline read-only review returns APPROVED.
- [x] No secret value, database write, or staging mutation is performed.
- [x] Owner verifies the existing root owner and a normal Google user on staging.

## Finish report

- Files changed: optional server config, Better Auth wiring, auth redirect helper/tests,
  sign-in/sign-up server and client surfaces, shared Google action, env/compose pass-through,
  app/infra docs, and this plan.
- Deviations from plan: both auth pages are forced dynamic so runtime credentials are evaluated
  after image build. The installed Better Auth 1.6.23 pre-hijacking guard is explicit: an
  unverified local account is not implicitly linked even when Google verifies the same email.
- Left undone: none. The owner configured Google Cloud/staging, then verified both
  the existing root owner and a normal Google user on 2026-07-19. Follow-up #111
  fixed explicit linking for an unverified local credential account and personal-only
  user landing; PR #112 is merged and verified on staging.
- Gate: lint: PASS | typecheck: PASS | tests: PASS (57 files, 482 tests) | build: PASS
  (inline non-secret build placeholders; sign-in/sign-up dynamic) | compose: PASS (Google unset) |
  review: APPROVED (fresh read-only Orca task `task_8af81d96f642`)
