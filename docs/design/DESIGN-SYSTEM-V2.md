# Design System v2 — full redesign, ground truth (supersedes DESIGN-SYSTEM-DELTAS.md)

status: locked 2026-07-09 (owner). Owner explored ~15 directions with Claude Design
(see `reference/CompanyOS.dc.chat-log.txt`) and picked **Direction B — "Ledger"**, then
had it built into a full interactive app-shell mockup: `reference/CompanyOS.dc.html`.
Open it in a browser (any static server — it's a self-contained bundle, `file://` won't
work in most browsers/headless tools because of blob-URL asset unpacking) and click
through it before implementing anything. It is the primary spec; this doc is a written
index into it, not a replacement for reading it.

**This supersedes `DESIGN-SYSTEM-DELTAS.md` in full — not additively.** That doc's
"never changes silently" list (§11.F: slate+blue-700 primary, Inter, 6/10/14 radius,
light-default, no new hues) is explicitly overturned by this decision. Do not merge
tokens from both systems. `CONCEPTS.md` (wizard stepper / sidebar tree / admin overview
structure) mostly still holds structurally — the mockup is a concrete realization of it
— but its visual specifics are replaced by this doc.

## 0. What changed and why

Owner's brief to Claude Design (verbatim intent, chat-log turn 1): the existing system
"looks pretty standard like a SaaS product" — wanted something that "feels like the
whole OS is always there willing to assist the user and not replace them," warm even in
dark mode, simple/elegant/friendly, animated just enough that "each click should mean
something and the user should feel like they are progressing." Explicitly rejected
"anthropic colors" / generic AI-tool palettes — colors had to be bold and distinctive
enough to "stand the test of time" as a cross-company brand, not just this one app.

The chosen direction ("Ledger," turn 39+) is dark-default, mono-accented, with a warm
terracotta/amber identity that holds across **four theme variants** — this is the core
structural change from before: **one brand hue family, four lighting conditions**, not
one light + one dark theme.

## 1. Themes

Four selectable modes, switched from a swatch row in the user menu (bottom-left of
sidebar). State key: `theme` ∈ `auto | light | green | charcoal`, persisted the same way
dark-mode preference persists today (owner call from UX-01 turn 1 still holds: manual
persisted choice, pre-hydration stamp, no flash — `auto` now adds a once-a-minute
re-evaluation timer, see §1.4).

| id | Display name | Character |
|---|---|---|
| `light` | Light — Terrazzo Quiet | the only light option; warm cream/terracotta, ink-plum text |
| `green` | Dark — Green Hall | botanical dark green, amber accent |
| `charcoal` | Dark — Charcoal | warm charcoal/espresso, amber accent |
| `auto` | Auto (Circadian) | resolves to one of the above by time of day, §1.4 |

### 1.1 Token list (all 29, same names across themes — this is the full set, no more no less)

`--bg --surface --raised --sidebar --border --borderstrong --hover --active --selected
--muted --mutedfg --faded --fg --primary --primaryhover --primarydark --primaryfg
--accent --accentfg --ok --okbg --warn --warnbg --err --errbg --info --infobg --overlay
--shadow`

Naming differs from current `tokens.css` (`--background/--foreground/--muted-foreground`
etc.) — this is a deliberate reset, not a rename-in-place. Do not try to map old → new
1:1; retire the old names once consumers are migrated (see §7).

### 1.2 Values per theme (hex, from the live mockup's computed styles)

**`light` — Terrazzo Quiet**
```
--bg:#f2eee7        --surface:#fbf9f4     --raised:#fbf9f4      --sidebar:#ede8de
--border:#dcd6ca     --borderstrong:#c9c2b3 --hover:#e8e2d6      --active:#e2dbcd
--selected:#be5b4421 --muted:#e6e0d4       --mutedfg:#837c72     --faded:#aba396
--fg:#3b3140         --primary:#be5b44     --primaryhover:#c96a53 --primarydark:#8e4231
--primaryfg:#fbf9f4  --accent:#e8a04c      --accentfg:#4a3416
--ok:#8fa680  --okbg:#edf0e5   --warn:#c07f28 --warnbg:#faf3e6
--err:#b0432e --errbg:#f6e4de  --info:#837c72 --infobg:#e9e4da
--overlay:rgb(59 49 64 / .4)   --shadow:0 8px 24px rgb(59 49 64 / .14)
```

**`green` — Dark, Green Hall**
```
--bg:#0f231b        --surface:#17382b     --raised:#1d4030      --sidebar:#12291f
--border:#264434     --borderstrong:#33553f --hover:#1d4030      --active:#234a37
--selected:#efa43b24 --muted:#1d4030       --mutedfg:#8fac9a     --faded:#7f9c8c
--fg:#ece4d1         --primary:#efa43b     --primaryhover:#f5b155 --primarydark:#b87c26
--primaryfg:#241a09  --accent:#e8a04c      --accentfg:#241a09
--ok:#7fb08a  --okbg:#1d4030   --warn:#e8a04c --warnbg:#241f12
--err:#e77e67 --errbg:#3a2620  --info:#8fac9a --infobg:#1d4030
--overlay:rgb(4 12 8 / .55)    --shadow:0 8px 24px rgb(0 0 0 / .35)
```

**`charcoal` — Dark, Charcoal**
```
--bg:#1c1a17        --surface:#262320     --raised:#2b2823      --sidebar:#211e1a
--border:#3a362f     --borderstrong:#4a4539 --hover:#33302a      --active:#3a362e
--selected:#efa43b24 --muted:#33302a       --mutedfg:#9c9483     --faded:#8a8272
--fg:#efe9dc         --primary:#efa43b     --primaryhover:#f5b155 --primarydark:#b87c26
--primaryfg:#241a09  --accent:#e8a04c      --accentfg:#241a09
--ok:#7fb08a  --okbg:#2b3327   --warn:#e8a04c --warnbg:#2a2415
--err:#e77e67 --errbg:#3a2620  --info:#9c9483 --infobg:#2b2723
--overlay:rgb(0 0 0 / .55)     --shadow:0 8px 24px rgb(0 0 0 / .35)
```

Note both dark themes share the same `--primary`/`--accent` (amber `#efa43b`/`#e8a04c`)
— the brand accent is one color across all dark surfaces; only the neutrals (bg/surface/
sidebar/border) shift hue family (green vs charcoal). Light uses a different primary
(terracotta `#be5b44`) because amber-on-cream fails contrast; accent stays amber.

### 1.3 Applying a theme

Sets `document.body.dataset.theme` (not `<html>`, not a `.dark` class) to the resolved
id (`light`/`green`/`charcoal` — never literally `auto`, see §1.4) and CSS var overrides
live under `body[data-theme="x"]` selectors, inheriting down. Port this convention as-is
— it's a smaller diff than restructuring around `.dark` + `data-theme` combined, and the
mockup's whole component tree assumes vars resolve from `body`.

### 1.4 Circadian auto mode

`auto` re-resolves on mount and every 60s while active:
```js
const h = new Date().getHours();
if (h >= 21 || h < 5) theme = 'charcoal';
else {
  theme = 'light';
  if (h < 8) bg = '#f3ead8';       // dawn — warmer cream override on --bg only
  else if (h >= 17) bg = '#f0dcc4'; // dusk — warmer cream override on --bg only
}
```
Late night → charcoal. Otherwise light, with a warm `--bg`-only tint at the dawn/dusk
edges (does not touch any other token). Nothing resolves to `green` automatically —
green is a manual-only choice. Keep this exact schedule unless the owner wants to tune
it; it's cheap to expose as config later but ship the literal thresholds first.

## 2. Typography

- **Sans:** `Gantari` (replaces Inter). Fallback stack: `Gantari, system-ui, sans-serif`.
- **Mono:** `JetBrains Mono` (unchanged from current system) — fallback `ui-monospace,
  monospace`. Used for scope paths, the wizard's `01–06` step numerals, mono lowercase
  sidebar group labels (`work` / `system`), event timestamps.
- Both are self-hosted/bundled in the mockup (embedded as data: URIs in the bundle) —
  add them as real webfonts to the OS (self-hosted, not a Google Fonts CDN call, per
  existing no-third-party-runtime-fetch posture) rather than re-extracting from the
  mockup's bundle.
- Exact size/weight/line-height scale: read off the reference file's rendered headings/
  body/caption text (`docs/design/reference/CompanyOS.dc.html`) rather than guessing —
  it wasn't exposed as named tokens in the mockup, only literal per-element styles.
  Codify what you find as a role scale (page title / section / body / caption / code),
  same shape as the old `--text-*` role idea in DESIGN-SYSTEM-DELTAS.md §3, new values.

## 3. Shape

Radius is **much tighter than the old system**: mockup uses **2px / 3px / 4px** only —
no 6/10/14. This is core to the "Ledger" character (sharp, mono-industrial, not the
rounded-pill SaaS look the owner explicitly rejected). Map old `--radius-sm/md/lg` down
to this range; don't keep the old values around for new components.

## 4. Motion

**New dependency: GSAP** (owner-approved 2026-07-09; free for commercial use since the
2024 Webflow acquisition, no attribution/license cost). Add to `packages/ui` (or a
shared `apps/os` dep — implementer's call on which package.json, but only one place).
Load from the package, not a CDN `<script>` tag (the mockup uses a CDN tag because it's
a throwaway bundle; the OS should bundle it properly).

### 4.1 Motion-intensity scale

A single multiplier `f` scales every GSAP duration, driven by a 0–3 setting (persisted
user preference, separate from theme):

```
motion intensity:  0      1     2 (default)   3
multiplier f:       0     0.7    1             1.4
```

`f = 0` (or OS `prefers-reduced-motion: reduce`) means **skip GSAP entirely** for that
interaction — not "run it at 0 duration," actually branch around it. Every animated
method in the mockup checks this before calling into GSAP (see the `rm()` / `anim()`
pattern in the reference file's script — grep the unpacked page source for `df()` and
`rm()` if you load it in a browser devtools console, or ask codex to extract it the same
way this doc's author did: `document.querySelectorAll('script')` after the bundler
unpacks the blob, then find the largest inline `<script>`).

### 4.2 Literal durations/eases used (× the multiplier above)

| Moment | Duration | Ease |
|---|---|---|
| View/tab content enter (fade+slide) | 0.24s / 0.18s | `power3.out` / `power2.out` |
| Sidebar chevron rotate + subtree stagger | 0.18s, stagger 0.03s | `power2.out` |
| Tab underline slide | 0.2s | `power3.out` |
| Wizard step body enter (slide) | 0.22s | `power3.out` |
| Wizard step inner "stage" stagger | 0.2s, stagger 0.05s, delay 0.04s | `power2.out` |
| Wizard spine-fill rail height | 0.35s | `power2.out` |
| Copy-button press bounce | 0.3s (scale .94→1) | `power3.out` |
| Toast slide in / out | 0.26s / 0.2s | `power3.out` / `power2.in` |
| Provisioning-step spinner rotate | 1s, `repeat:-1` | `none` (linear) |
| Live "pulse" dots (attention indicators) | 1.1s, `repeat:-1, yoyo:true`, opacity→0.35 | `sine.inOut` |
| Provisioning step timing (pending→running→done) | 620ms per step (× 0.3 under reduced motion, not skipped — provisioning must still visibly complete) | — |
| Stat-card numbers | count up over 0.8s | `power2.out` |

### 4.3 CSS keyframes (not GSAP — plain keyframes, always run regardless of motion
intensity except full reduced-motion, since they're the reward moment)

```css
@keyframes popIn   { 0%{transform:scale(.2);opacity:0} 100%{transform:scale(1);opacity:1} }
@keyframes ringOut { 0%{box-shadow:rgba(127,176,138,.5) 0 0 0 0}
                     100%{box-shadow:rgba(127,176,138,0) 0 0 0 18px} }
@keyframes riseFade{ 0%{opacity:0;transform:translateY(4px)} 15%{opacity:1}
                     100%{opacity:0;transform:translateY(-16px)} }
```

This is the **completion "dopamine" moment** — owner explicitly called this out as
important (chat-log turns 85–100): checking off a task pops a moss-green circle in,
bursts a soft ring outward, floats a small "N to go" (or "all clear ✓" at zero) cheer
text that rises and fades, and the row settles into strikethrough. **Only the
just-completed item animates** — anything already-done on load stays static (track a
"just toggled this index" piece of state, clear it once consumed, exactly like the
mockup's `burstQ`). Wire this to every "mark as done" moment across the OS, not just the
wizard checklist it launched in — this is meant to be a recurring OS-wide reward
pattern, not a one-off.

There's also `attnGlow` and `sc-shine` keyframes in the reference bundle (a subtler
attention-glow and a loading shimmer) — read them off the file directly if/when a
component needs them; not documenting exact values here since neither was called out by
the owner as load-bearing.

## 5. Components (behavior contracts — read exact markup/spacing off the reference file)

- **Sidebar tree**: two groups, `work` (mono lowercase label) and `system`. Work group
  is a real expand/collapse tree (chevron rotates, children stagger-fade), depth via
  `16px` indent steps, selected leaf gets a colored dot + primary-colored label. Under
  the selected leaf, module rows render inline (Overview/Activity/Docs/Canvas/Setup/
  Tasks) — this is new: **the module nav lives inside the tree**, not as a separate
  top-bar-only construct. `system` group (Brain / Ops Health / Admin) is flat, no
  children. Badge counts (orange circle) on rows that need attention (Setup, Ops
  Health).
- **Scope page header**: breadcrumb (`indya / marketing / seo`) + status chip + "you're
  an admin here" pill, then a grouped tab bar (Overview·Activity·Docs·Canvas·Setup·
  Access) with an animated sliding underline.
- **Stat ribbon**: borderless cards (no border, just background/shadow per §1), 4 tiles,
  numbers count up on enter.
- **Activity table**: 3-segment control (Events / Work log / Sessions) above a plain
  `Who · Event/What · When` table. **Known bug in the reference file — fix during
  implementation, don't port it**: the mock data (`events`, `workLog`, `sessions`
  arrays, each `{who, what, path, at}`) is fully populated in the component's state but
  the table row template isn't bound to it correctly, so it renders headers with empty
  rows (`{{ e.who }}` etc. never resolve — check devtools console on the reference file,
  it warns about exactly this). Bind it properly; the intended shape is confirmed
  (`{who, what, path, at}`), sample rows are in `reference/CompanyOS.dc.html`'s inline
  script.
- **6-step wizard** (`Basics → Framing → History → Interview → Review → Provision`):
  left rail shows `01`–`06` mono numerals with a spine line that fills to the current
  step (GSAP height tween). Steps beyond `maxStep` are locked (not clickable). Step 4
  ("Interview") is the external-LLM paste-back pattern from the current wizard v2
  (M8-07) — copy-pack button (fixed-width, doesn't resize on label change per an owner
  fix already applied in chat-log turn 107-121), simulated paste, precheck stagger. Step
  5 is the open-questions checklist with the §4.3 completion animation. Step 6 is
  sequential provisioning (pending → running(spinner) → done, one step at a time, ~620ms
  apart) ending in a "Scope is live" state. A "…" menu on the wizard header exposes
  "send back" / "reject" / "dismiss," each behind a confirm dialog.
- **Admin**: tabs `Overview · Users · Access · Activity · Automations · Settings ·
  Health · MCP`. Users/keys tables use the confirm-dialog-before-destructive-action
  pattern (disable user, revoke key) — never a bare `window.confirm`. Empty states per
  tab are designed (icon + title + one-line body), not bare text.
- **Toast**: top-right (moved there from bottom-right during owner review, chat-log turn
  107-121, specifically to avoid covering the wizard's footer buttons), status-colored
  left edge, `aria-live="polite"`, auto-dismiss ~4.2s, slide in/out per §4.2.
- **Confirm dialog**: used for every destructive action (disable user, revoke key,
  reject/dismiss setup) — title, body explaining the consequence in plain language, one
  labelled destructive action button. Never a bare native `confirm()`.

## 6. Mobile / responsive

**In scope for this redesign** (owner call 2026-07-09, overturning the mockup's own
chat-log turn 122-136 where it was left as an open question — it has since been
partially built into the reference file: a `@media (max-width: 820px)` breakpoint turns
the sidebar into a slide-in drawer (`translateX(-100%)` ↔ `0`, `0.28s` transition) with a
scrim backdrop and a burger toggle in the header, tab bar becomes horizontally
scrollable). Verify this breakpoint's behavior in the reference file (resize a browser
to ~390×844) before treating it as done — port and finish it, don't rebuild from
scratch, but check the stat-ribbon/table reflow and wizard rail behavior at that width
specifically, since those weren't mentioned in the chat log as verified.

## 7. Migration posture

This is a **wholesale token replacement**, not an additive delta. Practically:
- New token names (§1.1) fully replace the current `packages/ui/src/tokens.css` set.
  Do not keep both systems live — every consumer of the old names needs updating as part
  of this work, module by module, per the package breakdown below. `validate-tokens`
  (already speced, not yet built — still needed) should be written against the *new*
  token names from the start.
- `DESIGN-SYSTEM-DELTAS.md` is superseded; leave it in place as historical record but
  add a one-line banner pointing here. Do not implement anything from it.
- `CONCEPTS.md` structural ideas (wizard stepper, sidebar tree, admin overview) mostly
  still hold and the mockup is their concrete realization — but any visual spec inside
  it (colors, radii) is superseded by this doc.
- `docs/design/ds-sync-bundle/` (the old @dsCard token/component previews pushed to
  Claude Design) is stale once this ships — regenerate it from the new tokens as a
  later, low-priority step (not part of this package breakdown).

## 8. Package breakdown (supersedes the old UX-01..05 split's *content*, keeps its
   *shape* — foundations first, unblocks everything else)

Same five-package structure as before, same dependency order (01 → 02 → 03 → 04/05),
scope rewritten against this doc instead of DESIGN-SYSTEM-DELTAS.md:

- **UX-01 Foundations** (brief rewritten alongside this doc, see
  `docs/tasks/UX-01-foundations.md`): the 4 theme token sets, Gantari + JetBrains Mono,
  GSAP as a dependency + the motion-intensity plumbing (§4.1) + the shared `anim()`/
  `df()`/`rm()` helper pattern, radius scale, `validate-tokens` rewritten against the new
  names, error/404/loading pages restyled, theme switcher UI (4-way, replacing the old
  light/dark toggle) with pre-hydration stamp (no flash, any of the 4 themes).
- **UX-02 Feedback layer**: toast (top-right per §5) + confirm dialog primitives per
  §4.2/§4.3 motion, wired to replace every `window.alert`/`confirm()` call site.
- **UX-03 Strings**: unchanged in shape from the original plan (copy audit) — re-scope
  against any new copy the mockup introduced (wizard menu actions' confirm-dialog body
  text, admin empty-state copy) once UX-02 lands.
- **UX-04 Sidebar**: the tree nav rewrite (§5 sidebar tree + module rows inside it) +
  mobile drawer (§6).
- **UX-05 Wizard + Admin**: the 6-step rail + completion animation (§4.3) + provisioning
  sequence; admin tabs/tables/empty-states. (Folds "admin overview showcase" into UX-05
  rather than a 6th package — the reference file treats them as one interactive app, and
  admin reuses the same tab/table primitives the wizard package will have just built.)

Detailed briefs for UX-02/04/05 get written the same way UX-01's was — after UX-01 lands
and its primitives/tokens exist to build on, per the original sequencing rationale.
