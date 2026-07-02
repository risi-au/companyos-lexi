# CompanyOS Design System

*The visual contract. Generated with UI/UX Pro Max design intelligence (2026-07-02), curated by the architect. `packages/ui` design tokens implement this; every module composes primitives that consume those tokens (CONSTITUTION §7). Change the look here + in the token files — never in modules.*

## Identity

Professional operations software you live in all day: **data-dense but scannable, calm, fast, trustworthy**. Think Linear/Stripe-dashboard energy, not marketing-site energy. The UI recedes; the client's numbers, tasks, and records are the interface.

- **Style direction:** Minimalism / Swiss. Clean grids, generous-but-purposeful whitespace, clear hierarchy, high contrast, geometric. No glassmorphism, no decorative gradients, no emoji-as-icons.
- **Modes:** Light **and** dark, designed together, token-switched. Dark is first-class (ops tools get used at night), light is default.
- **Density:** compact tables and lists (this is an ops tool, not a blog), but touch targets ≥44px and 8px+ gaps preserved.

## Color tokens (primitive → semantic)

Semantic layer only is shown; primitives live in `packages/ui` tokens file. Light / Dark values:

| Semantic token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F8FAFC` | `#0B1220` | App canvas |
| `--surface` | `#FFFFFF` | `#111A2E` | Cards, panels, widgets |
| `--foreground` | `#0F172A` | `#E2E8F0` | Primary text |
| `--muted` | `#E9EEF6` | `#1B2740` | Subtle fills, hover rows |
| `--muted-foreground` | `#64748B` | `#8FA3C0` | Secondary text |
| `--border` | `#DBEAFE`→slate mix `#E2E8F0` | `#243352` | Hairlines, dividers |
| `--primary` | `#1E40AF` | `#3B82F6` | Actions, links, active nav |
| `--primary-foreground` | `#FFFFFF` | `#0B1220` | Text on primary |
| `--accent` | `#D97706` | `#F59E0B` | Sparingly: highlights, callouts (WCAG-checked) |
| `--destructive` | `#DC2626` | `#F87171` | Dangerous actions, errors |
| `--ring` | `--primary` | `--primary` | Focus rings (2px, always visible) |

**Status colors** (capability runs, alerts, task states — never conveyed by color alone, always icon/text too):
`--status-ok #16A34A/#4ADE80` · `--status-warn #D97706/#FBBF24` · `--status-error #DC2626/#F87171` · `--status-neutral = muted-foreground`

**Chart palette:** categorical series derive from a 6-step token set (`--chart-1…6`) starting at primary blue, then teal, amber, violet, rose, slate — colorblind-safe ordering; sequential/diverging scales generated from primary. Legends + tooltips mandatory; see dataviz rules in `.claude/skills/ui-ux-pro-max` data.

## Typography

- **UI + headings + body:** **Inter** (Minimal Swiss pairing — the standard for dashboards/enterprise). Base 16px, line-height 1.5; compact table text 13–14px, never body text <12px.
- **Data/numbers/code:** **JetBrains Mono** for metric values, IDs, scope keys, timestamps, code blocks — `font-variant-numeric: tabular-nums` everywhere numbers align in columns.
- Scale: 12/13/14/16/18/24/30/36. Weights 400/500/600 (700 sparingly). Tight tracking (-0.01em) on headings ≥24px.

## Shape, space, elevation

- **Spacing:** 4px base grid (4/8/12/16/24/32/48/64).
- **Radius:** `--radius-sm 6px` (inputs, chips), `--radius-md 10px` (cards, widgets), `--radius-lg 14px` (modals). One family, no mixing.
- **Elevation:** two shadow steps only — `--shadow-sm` (cards) and `--shadow-md` (popovers/modals). Borders do most separation work; shadows stay subtle in light, near-invisible in dark (use surface contrast instead).

## Motion

150–250ms ease-out for hover/focus/expand; 300ms max for panels. Motion conveys state change, never decoration. `prefers-reduced-motion` respected globally. Skeletons (not spinners) for >1s loads.

## Iconography

**Lucide** only, 1.5px stroke, 16/20px sizes. One icon language everywhere. Icon-only buttons require `aria-label`.

## Non-negotiables (from UX rule DB, enforced in review)

- Contrast ≥4.5:1 body text (3:1 large), both modes
- Visible focus states; full keyboard nav; tab order = visual order
- `cursor-pointer` on clickables; hover + pressed states distinct
- Virtualize lists >50 rows (ops tool = big tables)
- Reserve space for async content (no layout jump on dashboard load)
- Responsive: 375 / 768 / 1024 / 1440. PWA-ready. No horizontal page scroll — wide tables scroll inside their container
- No emojis as icons; no raw hex in modules (tokens only — `validate-tokens` script runs in CI)

## Tooling

- `.claude/skills/` in this repo contains the UI/UX Pro Max skill suite (design, design-system, ui-styling, brand). Claude sessions use it for UI tasks; its `design-system/scripts/validate-tokens.cjs` checks for hardcoded values.
- Grok implementers: this document is your only design input. If a task needs a visual decision not covered here, flag it in the commit body rather than inventing one.
- Later refinement passes (e.g., Claude Design) edit tokens + primitives in `packages/ui`, never module code.
