# M9-02: Release pipeline — native arm64 builds, kill the QEMU tax

status: done (PR #9 merged 2026-07-07; verified live: release+deploy 9m10s, arm64 image on VPS, 3 consecutive clean releases)
module: .github/workflows/release.yml
branch: task/M9-02

## Goal

Code-change releases currently take ~70–100+ minutes and intermittently fail. Root
cause (diagnosed live 2026-07-08): the staging VPS is **aarch64**, so the deployed
image is the arm64 one — and the release workflow builds it on x86 `ubuntu-latest`
runners under **QEMU emulation** (`docker/setup-qemu-action` +
`platforms: linux/amd64,linux/arm64`). A CPU-bound `next build` is 10–20× slower
emulated, and QEMU sporadically kills Node build workers with SIGILL (observed:
run for commit 1238d04, "Next.js build worker exited with signal SIGILL" — always
retriable, never a code bug). Fast runs this morning (6–13 min) were GHA
layer-cache replays; every real code merge goes cold.

## Do

1. Split the image builds per arch: amd64 leg on `ubuntu-latest`, arm64 leg on
   GitHub's native ARM runners (`ubuntu-24.04-arm`); remove QEMU. Push per-arch
   digests and stitch a multi-arch manifest (`docker buildx imagetools create`)
   in a fan-in job. Keep `cache-from/to: type=gha` per arch+image scope.
2. First check whether anything actually pulls the amd64 images (staging is arm64;
   local dev builds its own). If nothing does, prefer the simpler option: build
   arm64-only on the ARM runner and drop the manifest stitching. Note the decision
   in the workflow file.
3. Apply the same treatment to both images (os + migrate).
4. deploy-staging job stays as-is (it only pulls on the VPS).
5. Verify: one full release on a code change completes in well under 20 minutes;
   staging deploy + smoke green; `docker image inspect` on the VPS confirms the
   pulled image is arm64.

## Don't

- Don't self-host a runner on the VPS (prod box ≠ build box).
- Don't drop the GHA caches — they're what make docs-only/small-change runs fast.
- ARM runners are paid on private repos: pennies per build vs hour-long pipelines;
  owner accepted the trade (2026-07-08). Don't add other paid runner usage.

## Acceptance criteria

- [ ] No `setup-qemu-action` in the release workflow
- [ ] Code-change release end-to-end < 20 min
- [ ] Staging pulls and runs the new image (arch verified aarch64)
- [ ] No SIGILL-class flakes across at least 3 consecutive releases
