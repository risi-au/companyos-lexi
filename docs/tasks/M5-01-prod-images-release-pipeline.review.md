# M5-01 review — fix list (cycle 2)

Cycle 1 (tailwindcss phantom dep) is DONE and verified — do not touch it again. The Docker
build now gets past CSS but fails at Next's "Collecting page data" step:

```
Error: DATABASE_URL environment variable is required
  at .next/server/app/api/v1/docs/save/route.js  (packages/db createDb at module scope)
> Build error occurred [Error: Failed to collect page data for /api/v1/docs/save]
```

Local `next build` only passes because `.env` exists; the Docker build stage (correctly) has
no `.env`. Architect decision: use build-stage-only placeholder env vars — do NOT refactor
the app's eager DB init in this task.

## Fixes (do exactly these, nothing else)

1. In `apps/os/Dockerfile`, in the `build` stage ONLY (the stage that runs
   `pnpm --filter @companyos/os build`), add before the build RUN:
   ```dockerfile
   # Build-time placeholders: Next.js "collecting page data" imports route modules, which
   # assert these exist. Never present in the runtime images (separate FROM stages);
   # real values come from the deploy environment.
   ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
   ENV BETTER_AUTH_SECRET="build-placeholder"
   ```
2. Nothing else. No app-source changes, no compose changes, no runtime-stage ENV.

## Verify in-sandbox

- Re-run `next build` (standalone) in-sandbox WITHOUT relying on the repo `.env`: run it with
  those two placeholder vars only (plus your existing font-mock workaround) to prove the
  build no longer needs `.env`. Report the result.

---

# M5-01 review — fix list (cycle 1) [DONE]

The M5-01 implementation passed all root gates (typecheck/lint/190 tests) and compose
validation, but the orchestrator's real `docker build --target os` FAILED:

```
Syntax error: tailwindcss: /app/apps/os/src/app/globals.css
Can't resolve 'tailwindcss' in '/app/packages/ui/src' (1:1)
```

Root cause (verified): `packages/ui/src/globals.css` does `@import "tailwindcss"` but
`packages/ui/package.json` does NOT declare tailwindcss — a phantom dependency. Locally it
resolves only via pnpm's hidden hoist dir (`node_modules/.pnpm/node_modules/tailwindcss`);
the Dockerfile's filtered offline install does not reproduce that, so the image build breaks.

## Fixes (do exactly these, nothing else)

1. `packages/ui/package.json`: add to `devDependencies`:
   - `"tailwindcss": "^4.1.8"` (same range apps/os uses — already in the lockfile, no new
     package versions introduced).
2. Do NOT edit `pnpm-lock.yaml` by hand and do not attempt `pnpm install` — the architect
   will refresh the lockfile after review (flag this in your summary).
3. No other files. Do not restructure the Dockerfile — re-verification of the docker build is
   the orchestrator's job after the lockfile refresh.

## Verify in-sandbox

- `tsc -b`, `eslint`, `vitest run` still green (the dep change should be inert to all three).
