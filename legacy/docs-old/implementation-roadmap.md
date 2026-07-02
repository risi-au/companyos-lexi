# Phased Implementation Roadmap

## Phase 1: Foundation (Target: 2-4 weeks)
**Goal:** Working base where any folder (Cursor) or Discord thread automatically gets correct scoped context. Core services running and stable.

**Key Deliverables:**
- VPS provisioned, hardened, Docker ready
- Postgres + pgvector running
- Affine self-hosted and accessible
- n8n running
- gbrain schema + MCP server initialized
- Hermes installed + Discord bot connected + basic Context Loader skill functional
- First test project folder with `.cos/` structure created
- Context loading tested from terminal and simulated Cursor

**Files we will create/use:**
- `scripts/setup/full-stack-docker-compose.yml` (base)
- `hermes-skills/context-loader.md` (first skill)
- Setup scripts for gbrain and Hermes

## Phase 2: Visual Onboarding + SSOT (3-4 weeks)
**Goal:** New project or client can be onboarded visually in Affine in under 15 minutes with 100% consistency.

**Deliverables:**
- Onboarding canvas + wizard in Affine
- `onboarder` Hermes skill that automates GitHub folder/repo creation, gbrain entries, Discord channel/thread, Affine pages
- Enforcement of standards via templates + validation

## Phase 3: Automations + Visual Processes (4-6 weeks)
**Goal:** First major recurring process (Weekly Meta Ads) fully automated end-to-end.

**Deliverables:**
- Visual process canvas in Affine
- Hybrid n8n + Hermes workflow (data pull → dual-model analysis → apply changes → update GitHub MDs + gbrain + Affine)
- Notification to Discord thread

## Phase 4: Intelligence Layer + Propagation (overlapping/ongoing)
**Goal:** System becomes self-improving and standards propagate automatically.

**Deliverables:**
- Full Hindsight integration (retain/recall/reflect)
- Auditor/Propagator agent that scans all projects and opens PRs for outdated standards
- Nightly gbrain dream cycle + synthesis

## Phase 5: Scale & Polish (ongoing)
Add new businesses purely through the onboarding flow. No manual setup. Continuous improvement via gbrain + Hindsight.

**MVP Target:** End of Phase 3 core working (~3 months focused effort).

Start with Phase 1, Step 1.