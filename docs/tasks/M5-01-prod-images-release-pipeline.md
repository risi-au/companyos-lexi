# M5-01: Production images + prod compose + tag-triggered release pipeline

status: todo
module: infra + apps/os + .github
branch: task/M5-01

## Goal

A tagged release becomes a deployable artifact: `apps/os` builds into a pinned Docker image
(plus a migrate entrypoint), `infra/docker-compose.prod.yml` runs the full live stack from
GHCR images with a one-shot migration step, and a `release.yml` GitHub Actions workflow builds
and pushes images on every `v*` tag. This is the deployment slice of M5 (DESIGN §7:
"one-command Docker bundle"). Deploy-to-VPS automation (SSH) is a later task — this task ends
at "images in GHCR + a compose file + runbook the owner can run on the VPS by hand".

## Context

- docs/DEPLOYMENT.md (ratified — DO NOT EDIT): VPS runs tagged releases only; deploy =
  `docker compose pull && up -d` + migrations; same images/env contract as dev.
- Ingress decision (owner, 2026-07-03): TLS/ingress is handled OUTSIDE this repo by a
  Cloudflare tunnel already set up on the VPS. The prod compose therefore binds the OS app to
  a host port on localhost and includes NO reverse proxy, NO Caddy, NO cloudflared. Do not
  add one. The README notes "point your tunnel/proxy at this port".
- Existing infra: `infra/docker-compose.dev.yml` (postgres:17 with `postgres-init.sql`
  creating companyos/plane/litellm DBs; litellm with `litellm.config.yaml`; n8n). Prod runs
  the same data layer. Plane CE is installed via its own official installer on the VPS —
  README note only, not composed here.
- App: `apps/os` is Next.js 15 (`next build` / `next start`), monorepo deps on
  `@companyos/api`, `@companyos/db`, `@companyos/ui` via pnpm workspace. `next.config.ts`
  currently sets no `output` mode.
- Migrations: `pnpm --filter @companyos/db db:migrate` (drizzle-kit, `packages/db/drizzle/`).
- CI: `.github/workflows/ci.yml` (pnpm install → typecheck → lint → test) on push/PR.
- GitHub org/repo: `risi-au/companyos` → images at `ghcr.io/risi-au/companyos-os` and
  `ghcr.io/risi-au/companyos-migrate`.

## Architect decisions (do not relitigate)

1. **Two images from one multi-stage Dockerfile** at `apps/os/Dockerfile` (build context =
   repo root):
   - `os` (runtime): Next.js standalone output (`output: "standalone"` added to
     `next.config.ts` — dev behavior unchanged), `node:22-alpine`, non-root user, port 3000,
     `HOSTNAME=0.0.0.0`.
   - `migrate`: minimal Node image containing `packages/db` (drizzle config, migrations
     folder, node_modules needed by drizzle-kit) whose default command runs the migration
     against `DATABASE_URL` and exits.
2. **`infra/docker-compose.prod.yml`** services: `postgres` (same image/init/volumes shape as
   dev), `litellm`, `n8n`, `migrate` (one-shot, `depends_on postgres: service_healthy`,
   `restart: "no"`), `os` (depends on `migrate: service_completed_successfully`, binds
   `127.0.0.1:${OS_PORT:-3000}:3000`). Image refs use
   `ghcr.io/risi-au/companyos-os:${COMPANYOS_TAG}` / `...-migrate:${COMPANYOS_TAG}` — the tag
   var is REQUIRED (no `latest` default; tag-to-tag promotion per DEPLOYMENT.md). All config
   via env/`.env`, no secrets in the file. `restart: unless-stopped` on long-running services.
3. **`.github/workflows/release.yml`**: on push of tag `v*` — run the same gates as ci.yml
   (typecheck/lint/test), then buildx-build both images and push to GHCR tagged `<git tag>`
   (no `latest` tag), using `GITHUB_TOKEN` with `packages: write` permission and the
   `docker/build-push-action` + GHA cache. Gates and build in ONE job so a red gate never
   publishes an image.
4. **No VPS/SSH automation, no DEPLOYMENT.md edits, no control-plane image** in this task.
5. **Verification limits acknowledged:** the implementer sandbox has no Docker and no network.
   Correctness bar in-sandbox: YAML/workflow well-formed, `tsc/eslint/vitest` green, and
   `next build` succeeds with standalone output. The orchestrator runs the real
   `docker build` + `docker compose config` gate locally.

## Do

1. Add `output: "standalone"` to `apps/os/next.config.ts`.
2. Write `apps/os/Dockerfile` per decision 1 (multi-stage: pnpm fetch/install with workspace
   filtering, build, prune; two final stages named `os` and `migrate`). Add a root
   `.dockerignore` (node_modules, .next, .git, .turbo, docs, `**/*.test.*`, .env*).
3. Write `infra/docker-compose.prod.yml` per decision 2, reusing `postgres-init.sql` and
   `litellm.config.yaml`.
4. Write `.github/workflows/release.yml` per decision 3. Do not modify `ci.yml`.
5. Extend `.env.example` with a commented `# --- prod (VPS) ---` section: `COMPANYOS_TAG`,
   `OS_PORT`, and any var the prod compose interpolates that isn't already listed.
6. Verify `next build` works with standalone output (run it in-sandbox; report output size of
   `.next/standalone`). Run `tsc -b`, `eslint`, `vitest` as usual.
7. Docs, same change set:
   - `infra/README.md`: new "Production (VPS)" section — exact first-deploy runbook
     (copy `.env`, `docker login ghcr.io`, `COMPANYOS_TAG=v0.x.y docker compose -f
     infra/docker-compose.prod.yml up -d`, where migrations happen, how to roll back to the
     previous tag, "point your Cloudflare tunnel at 127.0.0.1:${OS_PORT}", Plane CE side-by-side
     note).
   - `infra/AGENTS.md`: prod compose contract + the two-image layout.
   - `apps/os/AGENTS.md` (if it exists): note the Dockerfile + standalone output.

## Don't

- Don't edit `docs/DEPLOYMENT.md`, `docs/DESIGN.md`, `docs/CONSTITUTION.md`, or `ci.yml`.
- Don't add Caddy, cloudflared, or any reverse proxy/ingress to the compose file.
- Don't add a `latest` image tag or a default `COMPANYOS_TAG`.
- Don't touch application source beyond `next.config.ts` (`output` only); no new npm deps.
- Don't build a control-plane image, SSH deploy automation, backup jobs, or tenant admin
  (separate M5 tasks).
- Don't modify `docker-compose.dev.yml` behavior.
- Don't attempt to commit — the sandbox blocks `.git`; leave completed work in the tree.

## Acceptance criteria

- [ ] `next build` succeeds with `output: "standalone"`; dev (`next dev`) behavior unchanged.
- [ ] `apps/os/Dockerfile` produces two targets (`os`, `migrate`); orchestrator-verified:
      `docker build --target os` and `--target migrate` succeed from repo root.
- [ ] `docker compose -f infra/docker-compose.prod.yml config` validates with a `.env`
      containing the documented vars (orchestrator-verified); fails loudly when
      `COMPANYOS_TAG` is unset.
- [ ] `release.yml` triggers only on `v*` tags, runs all three gates before any push, and
      pushes both images to GHCR tagged with the git tag.
- [ ] `.env.example` documents every var the prod compose interpolates.
- [ ] Runbook in `infra/README.md` covers first deploy, upgrade tag-to-tag, and rollback.
- [ ] Root `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
- [ ] `infra/AGENTS.md` (and `apps/os/AGENTS.md` if present) updated in the same change set.
