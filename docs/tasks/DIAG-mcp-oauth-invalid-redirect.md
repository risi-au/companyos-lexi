# DIAG — MCP OAuth `invalid_redirect` (follow-up to #90)

**Lane:** Investigation · **Risk:** R2 (auth) · **Date:** 2026-07-17 · **Author:** Claude (orchestrator)

## Question
Why does the Codex desktop MCP OAuth flow against `https://cos-staging.risi.au`
dead-end at `/sign-in?error=invalid_redirect&error_description=invalid+redirect+uri`?
Stop condition: root cause stated with evidence + a fix recommendation.

## Method
Read-only recon of the OAuth stack + live black-box probing of the staging
authorization server (`/api/auth/oauth2/*`). Reproduced the exact error via
DCR + `/authorize` requests. Cross-checked against the pinned `@better-auth`
source in the worktree and the repo's release history.

## Findings

### CONFIRMED
1. **Error origin.** The `invalid_redirect` is emitted by the better-auth
   `@better-auth/oauth-provider` `/authorize` handler, and the redirect_uri
   check runs *before* the session check — so it dead-ends at `/sign-in`
   regardless of login. This is why #90's surfacing now shows it.
2. **Reproduced.** Registering a client (unauthenticated DCR succeeds) and
   calling `/authorize` with a redirect_uri whose port differs from the
   registered one returns the byte-identical error the owner saw.
3. **Deployed staging matcher is broken for loopback** (stable truth table,
   `Cf-Cache-Status: DYNAMIC`, cache-busted):

   | Registered | Requested | Result |
   |---|---|---|
   | `localhost:1455` | `localhost:1455` | ACCEPT |
   | `localhost:1455` | `localhost:1456` | REJECT |
   | `localhost:1455` | `127.0.0.1:1455` | ACCEPT |
   | `localhost:1455` | `127.0.0.1:1456` | REJECT |
   | `127.0.0.1:1455` | `127.0.0.1:1455` (EXACT) | **REJECT** |
   | `127.0.0.1:1455` | anything | REJECT |

   Net: `127.0.0.1`-registered clients match **nothing (even their own exact
   redirect)**; `localhost`-registered clients work but get **zero
   ephemeral-port flexibility** (RFC 8252 §7.3 not honored).
4. **Contradiction with pinned source.** The worktree's `@better-auth/oauth-provider@1.6.23`
   + `@better-auth/core@1.6.23` handle both cases correctly: exact `127.0.0.1`
   matches, and numeric-loopback ephemeral-port flexibility is applied
   (`isLoopbackIP` true for `127.0.0.0/8`/`::1`; deliberately false for the
   `localhost` DNS name per RFC 8252 §8.3). Staging does **not** behave like
   this code.
5. **Deploy topology.** Latest release tag `v0.5.3` (2026-07-04) predates the
   OAuth provider commit `ea4b9c1` (2026-07-15), yet staging serves `/oauth2`.
   ⇒ staging tracks `main` (branch deploy), not tags.
6. **DCR is unauthenticated and returns no `registration_access_token` /
   `registration_client_uri`** ⇒ no RFC-7592 client management or deletion
   (feeds #91).

### PLAUSIBLE (needs staging-image inspection to confirm)
- **Build-time dependency drift.** Staging's image likely resolved a different
  transitive `@better-auth/core` (where `isLoopbackIP`/`SafeUrlSchema` live)
  than the worktree lockfile — e.g. a build without `--frozen-lockfile`
  resolving `better-auth: "^1.6.23"` / caret transitives to a newer publish
  whose loopback handling differs. This single cause explains the whole table.
- **Codex trigger.** Codex desktop's MCP OAuth almost certainly registers a
  numeric-loopback (`127.0.0.1:<port>`) callback per RFC 8252 §7.3 — which the
  deployed matcher rejects outright ⇒ consistent first-attempt failure. (Not
  confirmed: could not capture codex's actual redirect_uri; desktop app hands
  off to the browser and logs only discovery.)

### RULED OUT
- Discovery/audience/metadata misconfig (all staging `.well-known` docs
  correct: issuer, endpoints, `resource`, PKCE `S256`).
- Edge/CDN caching (`DYNAMIC`, cache-busted, stable across runs).
- Deployment of an image *older* than the OAuth provider (endpoints exist).

## ROOT CAUSE (CONFIRMED — updated after deploy inspection)
Codex desktop registers a fresh OAuth client on every "Authenticate" click with a
**numeric-loopback redirect `http://127.0.0.1:<ephemeral-port>/callback/<id>`**
(verified in the `oauth_client` table: ports 62405/64742/54537 across 3 attempts).

The deployed staging OAuth server **normalizes the `/authorize` request's
`redirect_uri` host `127.0.0.1` → `localhost`** before matching it against the
client's stored `redirect_uris`. Proof: a client whose *only* stored redirect is
`http://localhost:1455/...` **accepts** a request for `http://127.0.0.1:1455/...`
(impossible under the stock matcher unless the request host was rewritten to
`localhost`), and the `/sign-in` echo shows the requested `127.0.0.1` returned as
`localhost`. Deterministic (8/8 probes).

Consequence: codex's clients are **stored** with `127.0.0.1` but every authorize
request is matched as `localhost` → the stored `127.0.0.1` value never matches
(exact fails; the RFC-8252 loopback branch requires host equality) → **every
attempt returns `invalid_redirect`.** `localhost`-registered clients work because
request and stored both collapse to `localhost` (but get no ephemeral-port flex).

### Where the rewrite happens — hunt results
CONFIRMED it is the **app process itself** (origin-direct curl inside the VPS,
bypassing Cloudflare, still normalizes `127.0.0.1`→`localhost`). Exhaustively
ruled OUT as the source:
- Cloudflare / edge (origin-direct reproduces it).
- Next.js `middleware.ts` (passes `/api/auth` through untouched).
- Container Node v22 URL parsing (`new URL(...).searchParams.get` preserves `127.0.0.1`).
- `better-call` router (builds `query` verbatim from `searchParams`).
- `SafeUrlSchema` / Zod (tested `SafeUrlSchema.parse` → preserves `127.0.0.1`;
  and DCR *stores* `127.0.0.1` literally, so the registration schema doesn't rewrite).
- oauth-provider redirect matcher (deployed bytes == stock 1.6.23; would accept
  `127.0.0.1` exact).
- `getClient` DB-row mapper (passes `redirectUris` through verbatim).
- `searchParamsToQuery`, `verifyOAuthQueryParams`, `canonicalizeOAuthQueryParams`
  (no value transform).
- Storage (DB row for a `127.0.0.1` client is byte-identical to the literal).

**Paradox:** every component verified correct in isolation, yet the composite
behavior deterministically matches a `127.0.0.1` request as `localhost`. Resolving
the exact line now requires **runtime instrumentation inside the deployed app**
(log `ctx.query.redirect_uri` + `client.redirectUris` at the matcher), which needs
a throwaway instrumented deploy — a deployment action.

### Proven workaround (independent of pinpointing the line)
`oiUy` (stored ONLY `http://localhost:1455/...`) **accepts** a request for
`http://127.0.0.1:1455/...` (same port). Therefore **storing loopback redirects as
`localhost` makes codex's `127.0.0.1:<port>` clients match** — a one-hook DCR
normalization in `apps/os/src/lib/auth.ts`, preserving RFC-7591 DCR (#91 constraint).

## Recommendation (fix path)
1. **Inspect what staging actually runs** — the deployed image's resolved
   `@better-auth/oauth-provider` + `@better-auth/core` versions, and whether
   the image build uses `--frozen-lockfile`. Pivotal; needs deploy access
   (VPS). This decides everything below.
2. If drift confirmed → rebuild/redeploy staging from `main` with a frozen
   lockfile (core `1.6.23`, which handles loopback correctly), then re-run the
   codex `Authenticate` flow.
3. Add a **characterization/regression test** in-repo asserting loopback
   redirect matching (127.0.0.1 exact + ephemeral-port flex, localhost exact).
   If the pinned lib passes in CI but staging fails, that *proves* build/deploy
   drift rather than a code bug.
4. **#91 constraint reinforced:** any redirect_uri hardening must preserve
   loopback DCR for MCP clients — do not tighten in a way that re-breaks this.

## FOLLOW-UP BUG (surfaced 2026-07-17 after the loopback fix deployed)
**The loopback fix WORKS** — post-deploy, codex "Authenticate" now reaches the consent
screen (no more `invalid_redirect`). But clicking **Approve** fails: the browser shows
CompanyOS's error boundary ("Something went wrong. Sorry, CompanyOS couldn't load this
view."). Container logs show `Error [APIError]: status:'UNAUTHORIZED', statusCode:401,
body:[Object], digest:223797055` thrown from `submitOAuthConsentAction`
(apps/os/src/app/oauth/consent/actions.ts) on Approve.

### ROOT CAUSE — CONFIRMED (runtime evidence, 2026-07-17)
Got the real error body via a temp debug-log deploy (throwaway tag `v0.5.3-dbg95` built from
the branch; staging `COMPANYOS_TAG` pinned to it; owner reproduced Approve). Log:
```
[DEBUG-95] oauth2Consent threw {"status":"UNAUTHORIZED","statusCode":401,
  "body":{"error_description":"request not found","error":"invalid_request"}}
```
- The failing call is **`oauth2Consent`**; `getOAuthClientPublic` (same `sessionMiddleware`)
  **succeeded** → the session cookie IS present and session resolution works. The "session /
  oAuthState cookie doesn't survive" hypotheses are **DISPROVEN**.
- `"request not found"` is **unique** to `authorizeEndpoint` (oauth-provider index.mjs L3835:
  `if (!ctx.request) throw APIError("UNAUTHORIZED", {error:"invalid_request", ...})`).
- Also correcting the earlier note: `consentEndpoint` does **not** ignore `oauth_query`. A
  `before` hook (matcher `ctx.body?.oauth_query`) verifies its signature and repopulates the
  request-scoped `oAuthState` (which is `AsyncLocalStorage`, **not a cookie**). `consentEndpoint`
  then re-enters `authorizeEndpoint`, which hard-requires `ctx.request`.
- **Root cause (one sentence):** the server action invokes `auth.api.oauth2Consent(...)`
  *programmatically* with only `headers` and no `request`, so the re-entered `authorizeEndpoint`
  sees `ctx.request === undefined` and 401s. (The direct HTTP path via `toNextJsHandler` works
  because it passes the real `Request`.)

### FIX (shipped on fix/mcp-oauth-flow)
Pass a synthetic `Request` (carrying the caller's cookies) **and** `asResponse: false` to the
`oauth2Consent` call. `asResponse` defaults to `isRequestLike(request)`, so passing a Request
would otherwise flip the return to a `Response` and break the `{ url }` the action consumes.
Extracted to `apps/os/src/lib/oauth-consent.ts` (`buildOAuthConsentCall`) + unit test
`oauth-consent.test.ts`; call site in `apps/os/src/app/oauth/consent/actions.ts`.
Verification: environment-bound → re-run codex Approve after the fix deploys to staging.

## Housekeeping
Throwaway staging clients created during diagnosis (no reg-token to self-delete;
same as #90's): `oiUyRpAQLMEOuMiamYYiroaJYyCRGkHh`, `pQldAJYGyPelZzenSdtnLUgjrEAXSuSH`,
`elcOdIryqLOvGPecyxMwasRFmbScfGAS`. Safe (localhost/loopback, public, no secret);
remove when convenient.

Debug-deploy leftovers from the #95 root-cause capture:
- git tag `v0.5.3-dbg95` (points at throwaway DEBUG commit; not on any branch) + its GHCR
  images `companyos-os:v0.5.3-dbg95` / `companyos-migrate:v0.5.3-dbg95` — delete after the fix.
- staging `~/app/.env` `COMPANYOS_TAG` is pinned to `v0.5.3-dbg95`; merging the #95 fix to
  `main` redeploys and repins it to `main` automatically (restores staging).
