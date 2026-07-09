# UX-02: Feedback layer — toast + confirm dialog primitives, wired to replace native alert()/confirm()

status: todo (written 2026-07-09, against DESIGN-SYSTEM-V2.md §4.2/§4.3/§5/§8)
module: packages/ui + apps/os (call-site wiring only)
branch: task/UX-02 (off main @ 1be8b77, after UX-01 merged)

## Why

UX-01 landed the v2 foundations (tokens, fonts, `packages/ui/src/motion.ts` GSAP
helper, 4-theme switcher). The app still uses raw browser `window.alert()` and
`confirm()` for all feedback and destructive-action gates — 13 call sites. Those are
un-styled, un-branded, and (for `confirm`) block the main thread with an OS-native
modal that ignores the design system entirely. UX-02 builds the two missing feedback
primitives and swaps every native call over to them. Nothing else.

Read **`docs/design/DESIGN-SYSTEM-V2.md` §4.2 (motion durations/eases), §4.3 (CSS
keyframes), §5 (component contracts — Toast + Confirm dialog bullets at the end), §8
(package breakdown, UX-02 line)** before starting. The visual reference is
`docs/design/reference/CompanyOS.dc.html` — a packed Claude Design bundle; serve it over
local HTTP (`python -m http.server` from `docs/design/reference/`, then open
`http://localhost:8000/CompanyOS.dc.html`; it will **not** render over `file://` — the
blob-URL asset unpacker breaks). Read the exact toast markup/spacing/colors and the
confirm-dialog layout off the rendered mockup and its unpacked inline `<script>` (the
toast + confirm behaviors live in the largest inline script after the bundler unpacks
the blob — `document.querySelectorAll('script')` in devtools, same extraction the V2 doc
author used). The V2 doc §4.2/§4.3/§5 are the distilled contract; the file is ground
truth for anything not pinned to an exact value there.

## Foundations already in place (build on these, do not reinvent)

- `packages/ui/src/motion.ts` exports `anim(fn)` (guarded GSAP entry — no-ops under
  reduced motion / intensity 0), `df(duration)` (duration × intensity multiplier),
  `rm()` (true = skip GSAP), `getMotionIntensity()`. **Use these for every animation** —
  do not import `gsap` directly in the new components, and do not re-implement the
  reduced-motion check.
- `packages/ui/src/tokens.css` defines all 29 v2 tokens per theme under
  `body[data-theme="light|green|charcoal"]`. Status tokens you need:
  `--ok/--okbg`, `--warn/--warnbg`, `--err/--errbg`, `--info/--infobg`, plus `--overlay`
  (modal scrim), `--surface`/`--raised`/`--border`/`--fg`/`--mutedfg`, `--shadow`, and
  the tight radius scale added in UX-01 (`--radius-2/-3/-4`). **Style exclusively with
  `var(--token)`** — no raw hex (validate-tokens will fail the build otherwise).
- `packages/ui/src/index.ts` is the barrel; the only component today is `Button`. Export
  the new primitives + hooks from here.
- GSAP is already a real dependency of `packages/ui` (`gsap ^3.13.0`, in the lockfile).
  **Do not add any new dependency** (no `sonner`, `radix`, `react-hot-toast`, etc.) —
  build both primitives by hand with React + the existing motion helper. If you believe
  a dep is genuinely required, STOP and flag it in your worker_done instead of
  hand-editing package.json (see the sandbox note in docs/SUBAGENTS.md — a faked install
  will be caught in review and bounced).

## Do

1. **Toast primitive** (`packages/ui/src/components/toast.tsx`):
   - A `ToastProvider` (React context) + an imperative API exposed via a `useToast()`
     hook returning `{ toast }`, where `toast(opts)` and convenience `toast.success/
     toast.error/toast.info/toast.warn(message, opts?)` enqueue a toast. Shape:
     `{ id, status: "ok"|"warn"|"err"|"info", title?: string, message: string,
     duration?: number }`.
   - Render a fixed **top-right** stack (per §5 — moved there from bottom-right so it
     never covers wizard footer buttons; keep it top-right). Each toast: `--surface`/
     `--raised` background, `--shadow`, `--radius-3`, a **status-colored left edge**
     (4px bar / border-left in `--ok`/`--warn`/`--err`/`--info` by status), body text in
     `--fg`, optional dimmer title in `--mutedfg`.
   - **Auto-dismiss ~4.2s** (default `duration`), pause-on-hover is a nice-to-have not a
     requirement. Manual dismiss (× button) required. `aria-live="polite"` on the stack
     region, `role="status"` per toast. Errors (`status:"err"`) may use
     `aria-live="assertive"`.
   - Motion via the helper: **slide in 0.26s `power3.out`, slide out 0.2s `power2.in`**
     (§4.2), wrapped in `anim()` and scaled by `df()`. Under reduced motion / intensity 0
     (`rm()` true) the toast appears/removes instantly with no transform — still fully
     functional. Newest toast on top; stagger multiple is fine but not required.
2. **Confirm dialog primitive** (`packages/ui/src/components/confirm-dialog.tsx`):
   - A `ConfirmProvider` + `useConfirm()` hook returning an async
     `confirm(opts) => Promise<boolean>`. Opts:
     `{ title, body, confirmLabel?: string ("Confirm"), cancelLabel?: string
     ("Cancel"), tone?: "destructive"|"default" ("destructive") }`. Resolves `true` on
     confirm, `false` on cancel/backdrop/Esc.
   - Modal centered over an `--overlay` scrim. Panel: `--raised` bg, `--border`,
     `--radius-4`, `--shadow`. Title (§ `--fg`, heavier weight), body in `--mutedfg` /
     `--fg` explaining the consequence in plain language, then a right-aligned action
     row: a secondary Cancel and **one** primary action button. For
     `tone:"destructive"` the action button is styled with `--err`/`--errbg` (danger);
     for `"default"`, `--primary`. Reuse the existing `Button` where it fits; a danger
     variant is fine to add to `Button` if cleaner, but keep that additive.
   - **Accessibility (required):** `role="dialog"` + `aria-modal="true"`,
     `aria-labelledby`/`aria-describedby` wired to the title/body ids, focus moves into
     the dialog on open (default focus on Cancel for destructive actions, not the
     destructive button), focus is trapped while open, **Esc cancels**, backdrop click
     cancels, focus returns to the trigger on close. Only one dialog open at a time
     (queue or replace — replace is fine).
   - Entry motion: reuse the §4.2 view-enter feel (fade + small scale/slide, ~0.2s
     `power3.out`) via `anim()`+`df()`; instant under `rm()`. Backdrop fade is a plain
     CSS transition (fine to keep outside the GSAP helper).
3. **Mount the providers once** at the app shell. `apps/os/src/app/(app)/layout.tsx` is
   an async **server** component, so create a small `"use client"` wrapper (e.g.
   `apps/os/src/app/(app)/_components/FeedbackProviders.tsx`) that composes
   `<ToastProvider><ConfirmProvider>{children}</ConfirmProvider></ToastProvider>` and
   render it inside `(app)/layout.tsx` wrapping `{children}`. Verify it wraps every
   call-site module below (all live under the `(app)` group).
4. **Wire the 13 native call sites** — replace each, no behavior change beyond the UI:
   - `alert(...)` → error toast. **6 sites:**
     - `apps/os/src/app/(app)/_components/Sidebar.tsx:219` and `:225`
       (`toast.error(res.error)` / caught message)
     - `apps/os/src/modules/docs/DocsView.tsx:187`, `:214`, `:241`, `:284`
   - `confirm(...)`/`window.confirm(...)` → `await confirm({...})` gate. **7 sites** —
     each handler becomes `async` and early-returns on `false`; preserve the existing
     message as the dialog `body` (promote a short noun phrase to `title`):
     - `apps/os/src/modules/canvas/CanvasView.tsx:245` — "Archive this canvas?"
     - `apps/os/src/modules/connect/ConnectPanel.tsx:179` — "Revoke this connection token?"
     - `apps/os/src/modules/credentials/CredentialsPanel.tsx:105` — Delete credential "…"
     - `apps/os/src/modules/docs/DocsView.tsx:227` — Archive "…"
     - `apps/os/src/modules/docs/DocsView.tsx:275` — Restore this revision?
     - `apps/os/src/modules/mcp-manager/McpManagerView.tsx:110` and `:129` (offboard)
   - Each of these files is already a `"use client"` component — add
     `const { toast } = useToast();` / `const confirm = useConfirm();` at the top of the
     component and call through. Do not change the underlying mutation/API calls, only
     the feedback/gate mechanism.
5. **Exports.** Add `ToastProvider`, `useToast`, `ConfirmProvider`, `useConfirm` (and any
   exported types) to `packages/ui/src/index.ts`.
6. **AGENTS.md.** Update `packages/ui/AGENTS.md`: document the two new primitives, that
   they are the canonical way to show feedback / gate destructive actions, that
   `window.alert`/`confirm` are now banned in `apps/os/src`, and that animations must go
   through the `motion.ts` helper. One sentence each — match UX-01's entries.

## Don't

- **No sweep.** Touch only the 13 call sites in step 4 (plus their imports) and the files
  named in steps 1–3, 5, 6. Do not migrate other old-token consumers, do not restyle
  unrelated components, do not "improve" the modules you're editing beyond the swap.
- **No new dependency.** Hand-roll both primitives (see foundations note). No `sonner`,
  `radix`, `react-hot-toast`, headless-ui, etc.
- **No UX-03/04/05 work.** No sidebar tree, no wizard, no admin tabs/tables, no
  copy/string audit beyond the toast/confirm strings the swap itself requires (keep the
  existing messages; only split into title/body where natural).
- Don't import `gsap` directly — go through `motion.ts` (`anim`/`df`/`rm`).
- Don't use raw hex or any color literal — `var(--token)` only (validate-tokens gate).
- Don't modify `docs/design/reference/*` (read-only), any other file under `docs/tasks/`
  (only this file's status line), or anything under `USER DATA/`.
- Don't change route slugs, `?tab=` values, or intake/API service calls.
- Don't touch the theme switcher or motion-intensity plumbing from UX-01.

## Acceptance criteria

- [ ] `Toast`/`useToast` + confirm dialog/`useConfirm` exist in `packages/ui`, exported
      from `index.ts`, styled only with `var(--token)` (no raw hex).
- [ ] Toast renders top-right, status-colored left edge per status, `aria-live` set,
      auto-dismisses ~4.2s, manually dismissable; slides in/out at the §4.2 timings via
      the motion helper and appears instantly under `prefers-reduced-motion`.
- [ ] Confirm dialog: `role="dialog"`/`aria-modal`, focus trap, Esc + backdrop cancel,
      focus returns to trigger, destructive button in `--err`; `confirm()` resolves
      `true`/`false` correctly and the awaiting handler acts on it.
- [ ] **Zero** `window.alert`/`alert(`/`window.confirm`/`confirm(` remain in
      `apps/os/src` (`grep -rnE "window\.(alert|confirm)|(^|[^.\w])(alert|confirm)\("
      apps/os/src` returns nothing). All 13 sites migrated with unchanged underlying
      behavior.
- [ ] Providers mounted once in the `(app)` shell via a client wrapper; every call-site
      module is within that provider tree at runtime.
- [ ] `packages/ui/AGENTS.md` updated.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green from root (lint includes
      `validate-tokens`). No new dependency added to any package.json / lockfile.
